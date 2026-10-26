//! `node:crypto` native binding — `pbkdf2`/`scrypt`/`random*`
//! plus the `ExternCryptoJob` / `CryptoJob<Ctx>` work-pool plumbing.

use core::ffi::{c_char, c_void};

// `rust-argon2` exports its lib as crate `argon2`; alias past the `argon2` fn below.
use ::argon2 as rust_argon2;
use bun_boringssl as boringssl;
use bun_collections::CaseInsensitiveAsciiStringArrayHashMap;
use bun_core::String as BunString;
use bun_jsc::bindgen::{self, BufferSource, Callable, JsHeap, JsLocal, JsScope, StringOrJsBytes};
use bun_jsc::{
    self as jsc, ArrayBuffer, ErrorCode, JSGlobalObject, JSType, JSValue, Job, JobContext, JsPtr,
    JsResult, JsThread, Protected, Strong, UUID, UUID7,
};

use crate::crypto::pbkdf2::{self, PBKDF2};
use crate::generated_bindgen::node_crypto_binding::{RandomUUIDOptions, ScryptOptions};
use crate::node::{StringOrBuffer, ThreadIsolated};

// `&JSGlobalObject` is ABI-identical to a non-null pointer; remaining params
// are by-value `JSValue`, so no caller-side preconditions remain.
unsafe extern "C" {
    safe fn Bun__Process__queueNextTick2(
        global: &JSGlobalObject,
        func: JSValue,
        arg1: JSValue,
        arg2: JSValue,
    );
}

/// Local extension surface for `JSValue` methods not yet on `bun_jsc::JSValue`.
/// (`with_async_context_if_needed` graduated to an inherent method upstream.)
trait JSValueCryptoExt {
    fn call_next_tick_2(self, global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<()>;
}

impl JSValueCryptoExt for JSValue {
    #[inline]
    fn call_next_tick_2(self, global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<()> {
        jsc::from_js_host_call_generic(global, || Bun__Process__queueNextTick2(global, self, a, b))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ExternCryptoJob — token-pastes C symbol names (`Bun__<name>Ctx__runTask`
// etc.), so a `macro_rules!` is the right shape.
// ───────────────────────────────────────────────────────────────────────────

/// Completion-callback arguments produced by a job ctx's JS-thread half
/// (`runFromJS`). Layout mirrors `Bun::JSCallbackArgs` (JSCallbackArgs.h),
/// which fills it through the extern "C" out-pointer.
#[repr(C)]
struct JsCallbackArgs {
    argv: [JSValue; 3],
    argc: u32,
}

impl JsCallbackArgs {
    const EMPTY: Self = Self {
        argv: [JSValue::UNDEFINED; 3],
        argc: 0,
    };

    fn as_slice(&self) -> &[JSValue] {
        &self.argv[..(self.argc as usize).min(self.argv.len())]
    }
}

macro_rules! extern_crypto_job {
    ($Name:ident, $name_str:literal) => {
        pub(crate) mod $Name {
            use super::*;

            // `Ctx` is `opaque {}` — Nomicon FFI opaque-handle pattern.
            bun_opaque::opaque_ffi! { pub struct Ctx; }

            // `Ctx` is an `opaque_ffi!` ZST handle, so `&Ctx` is ABI-identical
            // to a non-null pointer and discharges the validity proof at the
            // type level. `global` in `runTask` is forwarded raw (the trait
            // hands us `*mut`; C++ never reads through it off-thread).
            //
            // `runFromJS` (the JS-thread half; `runTask` is the work-pool
            // half) returns the completion callback's arguments by value. It
            // never sees the callback, so it cannot run user JS; `then` frees
            // the ctx and then invokes.
            unsafe extern "C" {
                #[link_name = concat!("Bun__", $name_str, "Ctx__runTask")]
                safe fn ctx_run_task(ctx: &Ctx, global: &JSGlobalObject);
                #[link_name = concat!("Bun__", $name_str, "Ctx__runFromJS")]
                safe fn ctx_run_from_js(
                    ctx: &Ctx,
                    global: &JSGlobalObject,
                    out: &mut JsCallbackArgs,
                );
                #[link_name = concat!("Bun__", $name_str, "Ctx__deinit")]
                safe fn ctx_deinit(ctx: &Ctx);
            }

            /// The C++ context this job owns: plain data, freed wherever the job ends.
            pub(crate) struct OwnedCtx(*mut Ctx);
            // SAFETY: an owned C++ heap object with no thread affinity.
            unsafe impl Send for OwnedCtx {}
            impl Drop for OwnedCtx {
                fn drop(&mut self) {
                    ctx_deinit(Ctx::opaque_ref(self.0));
                }
            }

            pub(crate) struct ExternJob {
                ctx: OwnedCtx,
                global: JsPtr<JSGlobalObject>,
            }

            impl JobContext for ExternJob {
                type OffThread = Self;
                type Js = Strong;

                fn run(
                    this: &mut Self,
                    done: bun_jsc::Completion<Self>,
                ) -> Option<bun_jsc::Completion<Self>> {
                    // SAFETY: the creating global, alive under the job's ticket; C++
                    // only threads it through to error reporting state.
                    ctx_run_task(Ctx::opaque_ref(this.ctx.0), unsafe {
                        this.global.under_ticket(done.ticket())
                    });
                    Some(done)
                }

                fn then(this: Self, callback: Strong, cx: &JsThread<'_>) -> JsResult<()> {
                    let global = cx.global();
                    let mut args = JsCallbackArgs::EMPTY;
                    let produced = jsc::from_js_host_call_generic(global, || {
                        ctx_run_from_js(Ctx::opaque_ref(this.ctx.0), global, &mut args);
                    });
                    // `runFromJS` never sees the callback, so it cannot run user
                    // JS; free the ctx first, then invoke.
                    drop(this);
                    produced?;
                    global.bun_vm().event_loop_mut().run_callback(
                        bun_event_loop::ContextId::NONE,
                        callback.get(),
                        global,
                        JSValue::UNDEFINED,
                        args.as_slice(),
                    );
                    Ok(())
                }
            }

            #[unsafe(export_name = concat!("Bun__", $name_str, "__createAndSchedule"))]
            pub(crate) extern "C" fn __create_and_schedule(
                global: &JSGlobalObject,
                ctx: *mut Ctx,
                callback: JSValue,
            ) {
                let cx = global.js_thread_of_caller();
                let callback = callback.with_async_context_if_needed(global);
                Job::<ExternJob>::schedule(
                    &cx,
                    ExternJob {
                        ctx: OwnedCtx(ctx),
                        // SAFETY: the creating global outlives every borrow of its VM.
                        global: unsafe { JsPtr::new(core::ptr::NonNull::from(global)) },
                    },
                    Strong::create(callback, global),
                );
            }
        }
    };
}

// Definitions for job structs created from C++.
extern_crypto_job!(CheckPrimeJob, "CheckPrimeJob");
extern_crypto_job!(GeneratePrimeJob, "GeneratePrimeJob");
extern_crypto_job!(HkdfJob, "HkdfJob");
extern_crypto_job!(SecretKeyJob, "SecretKeyJob");
extern_crypto_job!(RsaKeyPairJob, "RsaKeyPairJob");
extern_crypto_job!(DsaKeyPairJob, "DsaKeyPairJob");
extern_crypto_job!(EcKeyPairJob, "EcKeyPairJob");
extern_crypto_job!(NidKeyPairJob, "NidKeyPairJob");
extern_crypto_job!(DhKeyPairJob, "DhKeyPairJob");
extern_crypto_job!(DhJob, "DhJob");
extern_crypto_job!(SignJob, "SignJob");

// ───────────────────────────────────────────────────────────────────────────
// CryptoJob<Ctx>
// ───────────────────────────────────────────────────────────────────────────

// No `Clone`: `value` is JSC-protected in `init`/unprotected in `deinit`, and
// `InPlace` borrows into that ArrayBuffer. Cloning would alias the protect/unprotect
// pair and the borrowed buffer. `CryptoJob::init` moves the ctx by value.
/// `crypto.randomFill` / `randomBytes` off the JS thread.
enum RandomFillJob {
    /// `randomBytes`: the ArrayBuffer was allocated by us and nothing else
    /// can observe it yet, so fill its bytes directly (under the job's ticket,
    /// which keeps its VM alive).
    InPlace { bytes: JsPtr<u8>, length: usize },
    /// `randomFill`: the caller's buffer stays untouched until completion;
    /// `scratch` (empty, `size` bytes reserved) is filled off-thread and copied in at `offset` on the JS thread.
    /// `offset` counts from the start of `memory` if the job has one.
    Scratch {
        scratch: Vec<u8>,
        size: usize,
        offset: usize,
    },
}

#[derive(bun_jsc::JsAffine)]
struct RandomFillJs {
    callback: Strong,
    value: Protected,
    /// The `WebAssembly.Memory` that `value` is a view of. `grow()` detaches `value`.
    memory: Option<Protected>,
}

const MAX_POSSIBLE_LENGTH: usize = {
    let a = ArrayBuffer::MAX_SIZE as usize;
    let b = i32::MAX as usize;
    if a < b { a } else { b }
};
const MAX_RANGE: i64 = 0xffff_ffff_ffff;

impl JobContext for RandomFillJob {
    type OffThread = Self;
    type Js = RandomFillJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        match this {
            RandomFillJob::Scratch { scratch, size, .. } => {
                let size = *size;
                // SAFETY: `rand_bytes` only writes, and fills every byte of the slice it is given.
                unsafe {
                    bun_core::vec::fill_spare(scratch, 0, |spare| {
                        boringssl::rand_bytes(&mut spare[..size]);
                        (size, ())
                    })
                }
            }
            RandomFillJob::InPlace { bytes, length } => {
                // SAFETY: `bytes` points into the ArrayBuffer `value` keeps alive;
                // the ticket keeps the VM (and so that buffer) alive; `length` is
                // the buffer's own allocation size.
                let slice = unsafe {
                    core::slice::from_raw_parts_mut(
                        core::ptr::from_mut(bytes.under_ticket(done.ticket())),
                        *length,
                    )
                };
                boringssl::rand_bytes(slice);
            }
        }
        Some(done)
    }

    fn then(this: Self, js: RandomFillJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let mut args = [JSValue::NULL, js.value.value()];
        if let RandomFillJob::Scratch {
            scratch, offset, ..
        } = this
        {
            let target = js.memory.as_ref().unwrap_or(&js.value).value();
            if !ArrayBuffer::write_to_live(target, offset, &scratch) {
                let error = global.err(
                    jsc::ErrorCode::CRYPTO_OPERATION_FAILED,
                    format_args!("The buffer was detached or resized before it was filled"),
                );
                args = [error.to_js(), JSValue::UNDEFINED];
            }
        }
        global.bun_vm().event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            js.callback.get(),
            global,
            JSValue::UNDEFINED,
            &args,
        );
        Ok(())
    }
}

fn schedule(
    cx: &JsThread<'_>,
    callback: JSValue,
    job: RandomFillJob,
    value: JSValue,
    memory: Option<JSValue>,
) {
    let global = cx.global();
    Job::<RandomFillJob>::schedule(
        cx,
        job,
        RandomFillJs {
            callback: Strong::create(callback.with_async_context_if_needed(global), global),
            value: Protected::new(value),
            memory: memory.map(Protected::new),
        },
    );
}

pub(crate) fn random_int_between<'a>(
    cx: &mut JsScope<'a>,
    min: f64,
    max: f64,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<f64>> {
    random_int(cx, Some(min), max, callback)
}

pub(crate) fn random_int_below<'a>(
    cx: &mut JsScope<'a>,
    max: f64,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<f64>> {
    random_int(cx, None, max, callback)
}

/// `Number.isSafeInteger`.
fn is_safe_integer(number: f64) -> bool {
    number.trunc() == number && number.abs() <= jsc::MAX_SAFE_INTEGER as f64
}

fn random_int<'a>(
    cx: &mut JsScope<'a>,
    min: Option<f64>,
    max: f64,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<f64>> {
    let global = cx.global();
    let min_specified = min.is_some();
    let min = min.unwrap_or(0.0);

    if !is_safe_integer(min) {
        return Err(global.throw_invalid_argument_type_value2(
            b"min",
            b"a safe integer",
            JSValue::js_number(min),
        ));
    }
    if !is_safe_integer(max) {
        return Err(global.throw_invalid_argument_type_value2(
            b"max",
            b"a safe integer",
            JSValue::js_number(max),
        ));
    }

    let min = min as i64;
    let max = max as i64;

    if max <= min {
        return Err(global
            .err(
                jsc::ErrorCode::OUT_OF_RANGE,
                format_args!(
                    "The value of \"max\" is out of range. It must be greater than the value of \"min\" ({}). Received {}",
                    min, max
                ),
            )
            .throw());
    }

    if max - min > MAX_RANGE {
        // Node's ERR_OUT_OF_RANGE adds "_" numerical separators to integer
        // "Received" values whose magnitude exceeds 2^32
        // (lib/internal/errors.js, addNumericalSeparator).
        let received = {
            let digits = (max - min).to_string();
            let (sign, digits) = match digits.strip_prefix('-') {
                Some(rest) => ("-", rest),
                None => ("", digits.as_str()),
            };
            let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
            out.push_str(sign);
            let lead = digits.len() % 3;
            for (i, ch) in digits.chars().enumerate() {
                if i != 0 && (i + 3 - lead) % 3 == 0 {
                    out.push('_');
                }
                out.push(ch);
            }
            out
        };
        if min_specified {
            return Err(global
                .err(
                    jsc::ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "The value of \"max - min\" is out of range. It must be <= {}. Received {}",
                        MAX_RANGE, received
                    ),
                )
                .throw());
        }
        return Err(global
            .err(
                jsc::ErrorCode::OUT_OF_RANGE,
                format_args!(
                    "The value of \"max\" is out of range. It must be <= {}. Received {}",
                    MAX_RANGE, received
                ),
            )
            .throw());
    }

    // Uniform random in [min, max) via Lemire's nearly-divisionless
    // rejection sampling on the VM's entropy cache (`RAND_bytes` costs ~0.5 µs per call).
    let res: i64 = {
        let range = (max - min) as u64;
        debug_assert!(range > 0);
        let rare_data = global.bun_vm().as_mut().rare_data();
        let mut buf = [0u8; 8];
        let x = loop {
            buf.copy_from_slice(rare_data.entropy_slice(8));
            let x = u64::from_ne_bytes(buf);
            let m = (x as u128).wrapping_mul(range as u128);
            let l = m as u64;
            if l < range {
                let t = range.wrapping_neg() % range;
                if l >= t {
                    break (m >> 64) as u64;
                }
                // else: rejected, loop again
            } else {
                break (m >> 64) as u64;
            }
        };
        min.wrapping_add(x as i64)
    };

    if let Some(callback) = callback {
        callback.to_js().call_next_tick_2(
            global,
            JSValue::UNDEFINED,
            JSValue::js_number(res as f64),
        )?;
        return Ok(None);
    }

    Ok(Some(res as f64))
}

pub(crate) fn random_uuid(heap: &JsHeap<'_>, options: &RandomUUIDOptions) -> BunString {
    let (str, bytes) = BunString::create_uninitialized_latin1(36);

    let uuid = if options.disable_entropy_cache {
        UUID::init()
    } else {
        // SAFETY: it only leads to the VM's entropy cache.
        let global = unsafe { heap.global() };
        global.bun_vm().as_mut().rare_data().next_uuid()
    };

    uuid.print(
        (&mut bytes[..36])
            .try_into()
            .expect("infallible: size matches"),
    );
    str
}

pub(crate) fn random_uuid_v7(heap: &JsHeap<'_>, options: &RandomUUIDOptions) -> BunString {
    // SAFETY: it only reads the clock and leads to the VM's entropy cache.
    let global = unsafe { heap.global() };

    // jsDateNow() is exactly what JS Date.now() returns, so the embedded
    // timestamp is never behind a Date.now() sample taken by the caller.
    let now_ms = global.js_date_now().max(0.0) as u64;
    let mut entropy = [0u8; 10];
    if options.disable_entropy_cache {
        boringssl::rand_bytes(&mut entropy);
    } else {
        entropy.copy_from_slice(&global.bun_vm().as_mut().rare_data().entropy_slice(10)[..10]);
    }
    let uuid = UUID7::init(now_ms, entropy, bun_jsc::uuid::TimestampSource::Clock);

    let (str, bytes) = BunString::create_uninitialized_latin1(36);
    uuid.print(
        (&mut bytes[..36])
            .try_into()
            .expect("infallible: size matches"),
    );
    str
}

fn assert_offset(
    global: &JSGlobalObject,
    offset: f64,
    element_size: u8,
    length: usize,
) -> JsResult<u32> {
    let offset = offset * (element_size as f64);

    let max_length = length.min(MAX_POSSIBLE_LENGTH);
    if offset.is_nan() || offset > (max_length as f64) || offset < 0.0 {
        // Node spells this range with "&&" (lib/internal/crypto/random.js assertOffset).
        let range = format!(">= 0 && <= {max_length}");
        return Err(global.throw_range_error(
            offset,
            jsc::RangeErrorOptions {
                field_name: b"offset",
                msg: range.as_bytes(),
                ..Default::default()
            },
        ));
    }

    Ok(offset as u32)
}

fn assert_size(
    global: &JSGlobalObject,
    size: f64,
    element_size: u8,
    offset: u32,
    length: usize,
) -> JsResult<u32> {
    let size = size * (element_size as f64);

    if size.is_nan() || size > (MAX_POSSIBLE_LENGTH as f64) || size < 0.0 {
        // Node spells this range with "&&" (lib/internal/crypto/random.js assertSize).
        let range = format!(">= 0 && <= {MAX_POSSIBLE_LENGTH}");
        return Err(global.throw_range_error(
            size,
            jsc::RangeErrorOptions {
                field_name: b"size",
                msg: range.as_bytes(),
                ..Default::default()
            },
        ));
    }

    if size + (offset as f64) > (length as f64) {
        return Err(global.throw_range_error(
            size + (offset as f64),
            jsc::RangeErrorOptions {
                field_name: b"size + offset",
                max: i64::try_from(length).expect("int cast"),
                ..Default::default()
            },
        ));
    }

    Ok(size as u32)
}

pub(crate) fn random_bytes<'a>(
    cx: &mut JsScope<'a>,
    size: f64,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<JSValue>> {
    let global = cx.global();

    let size = assert_size(global, size, 1, 0, MAX_POSSIBLE_LENGTH + 1)?;

    let (result, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, size)?;

    let Some(callback) = callback else {
        // sync
        boringssl::rand_bytes(bytes);
        return Ok(Some(result));
    };

    schedule(
        &cx.js_thread(),
        callback.to_js(),
        RandomFillJob::InPlace {
            // SAFETY: `bytes` is `result`'s backing store, kept alive by the job's
            // Js side; a slice's data pointer is non-null even when empty.
            bytes: unsafe { JsPtr::new(core::ptr::NonNull::new_unchecked(bytes.as_mut_ptr())) },
            length: size as usize,
        },
        result,
        None,
    );

    Ok(None)
}

pub(crate) fn random_fill_sync<'a>(
    heap: &JsHeap<'a>,
    buf: JsLocal<'a, BufferSource>,
    offset: f64,
    size: Option<f64>,
) -> JsResult<JsLocal<'a, BufferSource>> {
    // SAFETY: it only says where the bytes of `buf` are, and throws.
    let global = unsafe { heap.global() };
    let mut bytes = ArrayBuffer::from_typed_array(global, buf.to_js());

    let element_size = bytes.bytes_per_element().unwrap_or(1);

    let offset = assert_offset(global, offset, element_size, bytes.byte_len)?;

    // `size` is usize (`bytes.byte_len - offset`, both usize). The
    // `assert_size` branch is bounded by `MAX_POSSIBLE_LENGTH` (≤ i32::MAX) so widening
    // its `u32` result is lossless; the default branch must NOT truncate to `u32` —
    // a >4 GiB ArrayBuffer remainder would silently fill only `(n % 2^32)` bytes.
    let size: usize = match size {
        None => bytes.byte_len - offset as usize,
        Some(size) => assert_size(global, size, element_size, offset, bytes.byte_len)? as usize,
    };

    if size == 0 {
        return Ok(buf);
    }

    boringssl::rand_bytes(&mut bytes.slice_mut()[offset as usize..][..size]);

    Ok(buf)
}

pub(crate) fn random_fill_range<'a>(
    cx: &mut JsScope<'a>,
    buf: JsLocal<'a, BufferSource>,
    offset: f64,
    size: Option<f64>,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    random_fill(cx, buf, Some(offset), size, callback)
}

pub(crate) fn random_fill_from_offset<'a>(
    cx: &mut JsScope<'a>,
    buf: JsLocal<'a, BufferSource>,
    offset: f64,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    random_fill(cx, buf, Some(offset), None, callback)
}

pub(crate) fn random_fill_all<'a>(
    cx: &mut JsScope<'a>,
    buf: JsLocal<'a, BufferSource>,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    random_fill(cx, buf, None, None, callback)
}

fn random_fill<'a>(
    cx: &mut JsScope<'a>,
    buf: JsLocal<'a, BufferSource>,
    offset: Option<f64>,
    size: Option<f64>,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    let global = cx.global();
    let buf_value = buf.to_js();
    let callback = callback.to_js();

    let buf = ArrayBuffer::from_typed_array(global, buf_value);

    let element_size = buf.bytes_per_element().unwrap_or(1);

    // Without an offset the size is every element, which `assert_size` holds to its limit.
    let (offset, size) = match offset {
        Some(offset) => (offset, size),
        None => (0.0, Some(buf.len as f64)),
    };
    let offset = assert_offset(global, offset, element_size, buf.byte_len)?;

    // `size` is usize (`buf.byte_len - offset`, both usize). The
    // `assert_size` branch is bounded by `MAX_POSSIBLE_LENGTH` (≤ i32::MAX) so widening
    // its `u32` result is lossless; the default branch must NOT truncate to `u32` —
    // a >4 GiB ArrayBuffer remainder would silently fill only `(n % 2^32)` bytes.
    let size: usize = match size {
        None => buf.byte_len - offset as usize,
        Some(size) => assert_size(global, size, element_size, offset, buf.byte_len)? as usize,
    };

    if size == 0 {
        let _ = callback.call(global, JSValue::UNDEFINED, &[JSValue::NULL, buf_value])?;
        return Ok(());
    }

    // `vec![0u8; size]` aborts the process on OOM. The 3-arg overload
    // `randomFill(buf, offset, cb)` defaults `size` to the full
    // remaining buffer length, which can exceed allocator limits for a
    // multi-GiB ArrayBuffer — surface that as a JS error instead.
    let mut scratch = Vec::new();
    if scratch.try_reserve_exact(size).is_err() {
        return Err(global.throw_out_of_memory());
    }

    let (memory, view_offset) = buf.find_wasm_memory().unzip();
    schedule(
        &cx.js_thread(),
        callback,
        RandomFillJob::Scratch {
            scratch,
            size,
            offset: view_offset.unwrap_or(0) + offset as usize,
        },
        buf_value,
        memory,
    );

    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// Scrypt
// ───────────────────────────────────────────────────────────────────────────
pub(crate) struct Scrypt {
    n: u32,
    r: u32,
    p: u32,
    maxmem: u64,
    keylen: u32,
}

// ───────────────────────────────────────────────────────────────────────────
// Argon2 (crypto.argon2 / crypto.argon2Sync)
// ───────────────────────────────────────────────────────────────────────────

/// One argon2 derivation, routed to the pure-Rust `rust-argon2` crate that
/// `Bun.password` already uses (BoringSSL has no argon2). `Bytes` is borrowed
/// from JS for `argon2Sync` and a copy for the work-pool job, which never
/// touches JS memory; node's async jobs copy the same way.
pub(crate) struct Argon2<Bytes> {
    message: Bytes,
    nonce: Bytes,
    secret: Bytes,
    associated_data: Bytes,
    parallelism: u32,
    tag_length: u32,
    memory: u32,
    passes: u32,
    variant: rust_argon2::Variant,
    output: Vec<u8>,
    failed: bool,
}

impl Scrypt {
    fn new(global: &JSGlobalObject, keylen: u32, options: &ScryptOptions) -> JsResult<Self> {
        if options.n.is_some() && options.cost.is_some() {
            return Err(global.throw_incompatible_option_pair(b"N", b"cost"));
        }
        if options.r.is_some() && options.block_size.is_some() {
            return Err(global.throw_incompatible_option_pair(b"r", b"blockSize"));
        }
        if options.p.is_some() && options.parallelization.is_some() {
            return Err(global.throw_incompatible_option_pair(b"p", b"parallelization"));
        }

        const N_DEFAULT: u32 = 16384;
        const R_DEFAULT: u32 = 8;
        const P_DEFAULT: u32 = 1;
        const MAXMEM_DEFAULT: u64 = 33554432;

        let or_default = |value: Option<u32>, default| value.filter(|&n| n != 0).unwrap_or(default);

        let ctx = Scrypt {
            n: or_default(options.n.or(options.cost), N_DEFAULT),
            r: or_default(options.r.or(options.block_size), R_DEFAULT),
            p: or_default(options.p.or(options.parallelization), P_DEFAULT),
            maxmem: options
                .maxmem
                .filter(|&maxmem| maxmem != 0)
                .unwrap_or(MAXMEM_DEFAULT),
            keylen,
        };
        ctx.check_scrypt_params(global)?;
        Ok(ctx)
    }

    fn check_scrypt_params(&self, global: &JSGlobalObject) -> JsResult<()> {
        let n = self.n;
        let r = self.r;
        let p = self.p;
        let maxmem = self.maxmem;
        // SAFETY: all pointer args are null with len 0; numeric args are plain values.
        if unsafe {
            boringssl::c::EVP_PBE_validate_scrypt_params(
                core::ptr::null(),
                0,
                core::ptr::null(),
                0,
                u64::from(n),
                u64::from(r),
                u64::from(p),
                maxmem as usize,
                core::ptr::null_mut(),
                0,
            )
        } == 0
        {
            return Err(global.throw_invalid_scrypt_params());
        }
        Ok(())
    }

    /// `Some(err)` on failure (`0` when there is no BoringSSL error code).
    fn run_task_impl(&self, password: &[u8], salt: &[u8], key: &mut [u8]) -> Option<u32> {
        if key.is_empty() {
            // result will be an empty buffer
            return None;
        }

        if password.len() > i32::MAX as usize || salt.len() > i32::MAX as usize {
            return Some(0);
        }

        // SAFETY: password/salt/key are valid slices for the given lengths.
        let res = unsafe {
            boringssl::c::EVP_PBE_scrypt(
                password.as_ptr(),
                password.len(),
                salt.as_ptr(),
                salt.len(),
                u64::from(self.n),
                u64::from(self.r),
                u64::from(self.p),
                self.maxmem as usize,
                key.as_mut_ptr(),
                key.len(),
            )
        };

        if res == 0 {
            return Some(boringssl::c::ERR_peek_last_error());
        }
        None
    }
}

/// `crypto.scrypt` off the JS thread: derives straight into the result
/// ArrayBuffer's bytes under the job's ticket, which keeps their VM alive.
pub(crate) struct ScryptJob {
    params: Scrypt,
    password: ThreadIsolated<StringOrBuffer<'static>>,
    salt: ThreadIsolated<StringOrBuffer<'static>>,
    result: JsPtr<[u8]>,
    err: Option<u32>,
}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct ScryptJs {
    callback: Strong,
    buf: Strong,
}

impl JobContext for ScryptJob {
    type OffThread = Self;
    type Js = ScryptJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // SAFETY: `result` is `buf`'s backing store (kept by the Js side); VM alive under the ticket.
        let key = unsafe { this.result.under_ticket(done.ticket()) };
        this.err = this
            .params
            .run_task_impl(this.password.slice(), this.salt.slice(), key);
        Some(done)
    }

    fn then(this: Self, js: ScryptJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let event_loop = global.bun_vm().event_loop_mut();
        let callback = js.callback.get();

        if let Some(err) = this.err {
            let exception = if err != 0 {
                let mut buf = [0u8; 256];
                // SAFETY: buf is a valid writable buffer of the given length.
                unsafe {
                    boringssl::c::ERR_error_string_n(err, buf.as_mut_ptr().cast(), buf.len())
                };
                // SAFETY: ERR_error_string_n always NUL-terminates within `buf`.
                let msg = unsafe { bun_core::ffi::cstr(buf.as_ptr().cast()) };
                global
                    .err(
                        ErrorCode::CRYPTO_OPERATION_FAILED,
                        format_args!("Scrypt failed: {}", bstr::BStr::new(msg.to_bytes())),
                    )
                    .to_js()
            } else {
                global
                    .err(
                        ErrorCode::CRYPTO_OPERATION_FAILED,
                        format_args!("Scrypt failed"),
                    )
                    .to_js()
            };
            event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                JSValue::UNDEFINED,
                &[exception],
            );
            return Ok(());
        }

        event_loop.run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global,
            JSValue::UNDEFINED,
            &[JSValue::UNDEFINED, js.buf.get()],
        );
        Ok(())
    }
}

/// For a work-pool job: a string is thread-isolated, and the bytes of a buffer, as they are now, are copied.
fn isolate_for_job<'a>(
    cx: &mut JsScope<'a>,
    input: StringOrJsBytes<'a>,
) -> JsResult<ThreadIsolated<StringOrBuffer<'static>>> {
    let bytes = match input {
        StringOrJsBytes::String(string) => {
            return Ok(StringOrBuffer::thread_isolated_string(cx.global(), string));
        }
        StringOrJsBytes::Bytes(bytes) => bytes.get(&cx.heap),
    };
    let mut copy = Vec::new();
    if copy.try_reserve_exact(bytes.len()).is_err() {
        return Err(cx.global().throw_out_of_memory());
    }
    copy.extend_from_slice(bytes);
    cx.global().vm().report_extra_memory(copy.len());
    Ok(StringOrBuffer::owned_isolated(copy))
}

pub(crate) fn pbkdf2<'a>(
    cx: &mut JsScope<'a>,
    password: StringOrJsBytes<'a>,
    salt: StringOrJsBytes<'a>,
    iterations: u32,
    keylen: u32,
    digest: &[u8],
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<()> {
    let Some(callback) = callback else {
        return Err(cx.global().throw_invalid_argument_type_value(
            b"callback",
            b"function",
            JSValue::UNDEFINED,
        ));
    };
    let algorithm = pbkdf2::algorithm_from_digest(cx.global(), digest)?;

    let password = isolate_for_job(cx, password)?;
    let salt = isolate_for_job(cx, salt)?;
    let data = PBKDF2::new(
        cx.global(),
        password.slice(),
        salt.slice(),
        iterations,
        keylen as usize,
        algorithm,
    )?;
    pbkdf2::create_job(&cx.js_thread(), data, password, salt, callback.to_js());
    Ok(())
}

/// `pbkdf2(password, salt, iterations, keylen, callback)`: as in Node, the digest is what is missing.
pub(crate) fn pbkdf2_without_digest<'a>(
    cx: &mut JsScope<'a>,
    _: StringOrJsBytes<'a>,
    _: StringOrJsBytes<'a>,
    _: u32,
    _: u32,
    _: JsLocal<'a, Callable>,
) -> JsResult<()> {
    Err(cx
        .global()
        .throw_invalid_argument_type_value(b"digest", b"string", JSValue::UNDEFINED))
}

pub(crate) fn pbkdf2_sync(
    heap: &JsHeap<'_>,
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    keylen: u32,
    digest: &[u8],
) -> JsResult<JSValue> {
    // SAFETY: it only allocates the result and throws, and nothing borrowed is read after a throw.
    let global_this = unsafe { heap.global() };
    let algorithm = pbkdf2::algorithm_from_digest(global_this, digest)?;
    let data = PBKDF2::new(
        global_this,
        password,
        salt,
        iterations,
        keylen as usize,
        algorithm,
    )?;
    // `create_buffer_from_length` → `JSBuffer__bufferFromLength`, which constructs
    // with `JSBufferSubclassStructure` (a Node.js `Buffer`, not a plain Uint8Array/ArrayBuffer).
    // `pbkdf2Sync()` MUST return a Buffer — `Buffer.isBuffer(result)` and Buffer-only methods
    // (`.toString('hex')`, `.readUInt32BE`, …) depend on it.
    let out_arraybuffer = JSValue::create_buffer_from_length(global_this, data.length)?;
    let Some(mut output) = out_arraybuffer.as_array_buffer(global_this) else {
        return Err(global_this.throw_out_of_memory());
    };

    if !data.run(password, salt, output.slice_mut()) {
        boringssl::c::ERR_clear_error();
        let err = global_this.create_error_instance(format_args!("PBKDF2 derivation failed"));
        return Err(global_this.throw_value(err));
    }

    Ok(out_arraybuffer)
}

pub(crate) fn secure_heap_used() {}

pub(crate) fn get_fips() -> i32 {
    0
}

pub(crate) fn set_fips() {}

pub(crate) fn set_engine<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, ()> {
    Err(heap.error_with_code(
        ErrorCode::CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED,
        format_args!("Custom engines not supported by BoringSSL"),
    ))
}

extern "C" fn for_each_hash(
    _: *const boringssl::c::EVP_MD,
    maybe_from: *const c_char,
    _: *const c_char,
    ctx: *mut c_void,
) {
    if maybe_from.is_null() {
        return;
    }
    // SAFETY: ctx was `&mut CaseInsensitiveAsciiStringArrayHashMap<()>` cast in `get_hashes`.
    let hashes: &mut CaseInsensitiveAsciiStringArrayHashMap<()> =
        unsafe { bun_ptr::callback_ctx::<CaseInsensitiveAsciiStringArrayHashMap<()>>(ctx) };
    // SAFETY: `maybe_from` is non-null (checked above) and points to a NUL-terminated C string
    // from BoringSSL's static tables.
    let from_bytes = unsafe { bun_core::ffi::cstr(maybe_from) }.to_bytes();
    bun_core::handle_oom(hashes.put(from_bytes, ()));
}

pub(crate) fn get_hashes() -> Vec<Box<[u8]>> {
    let mut hashes: CaseInsensitiveAsciiStringArrayHashMap<()> =
        CaseInsensitiveAsciiStringArrayHashMap::new();

    // Perf idea (dylan-conway): cache the names
    // SAFETY: `for_each_hash` matches the expected callback signature; `&mut hashes` is valid
    // for the duration of the call.
    unsafe {
        boringssl::c::EVP_MD_do_all_sorted(for_each_hash, (&raw mut hashes).cast::<c_void>());
    }

    core::mem::take(&mut *hashes).into_entries().0
}

pub(crate) fn scrypt<'a>(
    cx: &mut JsScope<'a>,
    password: StringOrJsBytes<'a>,
    salt: StringOrJsBytes<'a>,
    keylen: u32,
    options: &ScryptOptions,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    let params = Scrypt::new(cx.global(), keylen, options)?;

    let password = isolate_for_job(cx, password)?;
    let salt = isolate_for_job(cx, salt)?;
    let cx = cx.js_thread();
    let global = cx.global();
    if params.keylen as usize > jsc::virtual_machine::synthetic_allocation_limit() {
        return Err(global.throw_out_of_memory());
    }
    let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, params.keylen)?;
    Job::<ScryptJob>::schedule(
        &cx,
        ScryptJob {
            params,
            password,
            salt,
            // SAFETY: `bytes` is `buf`'s backing store, kept alive by the job's Js side.
            result: unsafe { JsPtr::new(core::ptr::NonNull::from(bytes)) },
            err: None,
        },
        ScryptJs {
            callback: Strong::create(
                callback.to_js().with_async_context_if_needed(global),
                global,
            ),
            buf: Strong::create(buf, global),
        },
    );
    Ok(())
}

pub(crate) fn scrypt_with_defaults<'a>(
    cx: &mut JsScope<'a>,
    password: StringOrJsBytes<'a>,
    salt: StringOrJsBytes<'a>,
    keylen: u32,
    callback: JsLocal<'a, Callable>,
) -> JsResult<()> {
    scrypt(
        cx,
        password,
        salt,
        keylen,
        &ScryptOptions::default(),
        callback,
    )
}

pub(crate) fn scrypt_sync(
    heap: &JsHeap<'_>,
    password: &[u8],
    salt: &[u8],
    keylen: u32,
    options: &ScryptOptions,
) -> JsResult<JSValue> {
    // SAFETY: it only allocates the result and throws, and nothing borrowed is read after a throw.
    let global = unsafe { heap.global() };
    let ctx = Scrypt::new(global, keylen, options)?;
    let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, ctx.keylen)?;
    if ctx.run_task_impl(password, salt, bytes).is_some() {
        return Err(global
            .err(
                ErrorCode::CRYPTO_OPERATION_FAILED,
                format_args!("Scrypt failed"),
            )
            .throw());
    }
    Ok(buf)
}

/// rust-argon2 ignores the synthetic allocation limit. `hash_raw` reports real allocation failures.
fn argon2_exceeds_allocation_limit(memory: u32, tag_length: u32) -> bool {
    let limit = jsc::virtual_machine::synthetic_allocation_limit();
    (memory as usize).saturating_mul(1024) > limit || tag_length as usize > limit
}

/// `variant` is a value of `kArgon2Types` of `crypto.ts`.
fn argon2_variant(variant: u8) -> rust_argon2::Variant {
    match variant {
        0 => rust_argon2::Variant::Argon2d,
        1 => rust_argon2::Variant::Argon2i,
        _ => rust_argon2::Variant::Argon2id,
    }
}

impl<Bytes: AsRef<[u8]>> Argon2<Bytes> {
    fn new(
        message: Bytes,
        nonce: Bytes,
        parallelism: u32,
        tag_length: u32,
        memory: u32,
        passes: u32,
        secret: Bytes,
        associated_data: Bytes,
        variant: u8,
    ) -> Self {
        Argon2 {
            message,
            nonce,
            secret,
            associated_data,
            parallelism,
            tag_length,
            memory,
            passes,
            variant: argon2_variant(variant),
            output: Vec::new(),
            failed: argon2_exceeds_allocation_limit(memory, tag_length),
        }
    }

    fn run(&mut self) {
        if self.failed {
            return;
        }
        let config = rust_argon2::Config {
            ad: self.associated_data.as_ref(),
            hash_length: self.tag_length,
            lanes: self.parallelism,
            mem_cost: self.memory,
            secret: self.secret.as_ref(),
            // Sequential like Bun.password (pwhash.rs): lanes determine
            // the output, not the thread count, so results match node,
            // which threads lanes via OpenSSL on its worker.
            thread_mode: rust_argon2::ThreadMode::Sequential,
            time_cost: self.passes,
            variant: self.variant,
            version: rust_argon2::Version::Version13,
        };
        match rust_argon2::hash_raw(self.message.as_ref(), self.nonce.as_ref(), &config) {
            Ok(hash) => self.output = hash,
            // `checkArgon2()` already rejected every parameter rust-argon2
            // rejects, so this is an allocation failure.
            Err(_) => self.failed = true,
        }
    }
}

/// JS-thread state for the argon2 job: the user callback, invoked as
/// `(err)` or `(undefined, buffer)`.
#[derive(bun_jsc::JsAffine)]
pub(crate) struct Argon2Js {
    callback: Strong,
}

/// `crypto.argon2` off the JS thread: every input is a copy, so the pool half
/// owns plain memory and needs no `JsPtr`.
impl JobContext for Argon2<Vec<u8>> {
    type OffThread = Self;
    type Js = Argon2Js;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.run();
        Some(done)
    }

    fn then(mut this: Self, js: Argon2Js, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let event_loop = global.bun_vm().event_loop_mut();
        let callback = js.callback.get();
        if this.failed {
            let exception = global.create_error_instance(format_args!("Argon2 derivation failed"));
            event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                JSValue::UNDEFINED,
                &[exception],
            );
            return Ok(());
        }
        let output = core::mem::take(&mut this.output);
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator).
        match JSValue::create_buffer(global, output.leak()) {
            Ok(buf) => event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                JSValue::UNDEFINED,
                &[JSValue::UNDEFINED, buf],
            ),
            // The result could not be built (allocation failure): that is
            // this derivation's error.
            Err(err) => event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                JSValue::UNDEFINED,
                &[global.take_error(err)],
            ),
        }
        Ok(())
    }
}

pub(crate) fn argon2<'a>(
    cx: &mut JsScope<'a>,
    message: Vec<u8>,
    nonce: Vec<u8>,
    parallelism: u32,
    tag_length: u32,
    memory: u32,
    passes: u32,
    secret: Vec<u8>,
    associated_data: Vec<u8>,
    variant: u8,
    callback: JsLocal<'a, Callable>,
) {
    let cx = cx.js_thread();
    let global = cx.global();
    let callback = callback.to_js();
    Job::<Argon2<Vec<u8>>>::schedule(
        &cx,
        Argon2::new(
            message,
            nonce,
            parallelism,
            tag_length,
            memory,
            passes,
            secret,
            associated_data,
            variant,
        ),
        Argon2Js {
            callback: Strong::create(callback.with_async_context_if_needed(global), global),
        },
    );
}

pub(crate) fn argon2_sync<'a>(
    heap: &JsHeap<'a>,
    message: &[u8],
    nonce: &[u8],
    parallelism: u32,
    tag_length: u32,
    memory: u32,
    passes: u32,
    secret: &[u8],
    associated_data: &[u8],
    variant: u8,
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    let mut ctx = Argon2::new(
        message,
        nonce,
        parallelism,
        tag_length,
        memory,
        passes,
        secret,
        associated_data,
        variant,
    );
    ctx.run();
    if ctx.failed {
        return Err(heap.error(format_args!("Argon2 derivation failed")));
    }
    heap.create_buffer_from_box(ctx.output.into_boxed_slice())
}
