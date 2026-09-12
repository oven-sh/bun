//! `node:crypto` native binding — `pbkdf2`/`scrypt`/`random*`/`timingSafeEqual`
//! plus the `ExternCryptoJob` / `CryptoJob<Ctx>` work-pool plumbing.

use core::ffi::{c_char, c_void};

// `rust-argon2` exports its lib as crate `argon2`; alias past the `argon2` host fn below.
use ::argon2 as rust_argon2;
use bun_boringssl as boringssl;
use bun_collections::CaseInsensitiveAsciiStringArrayHashMap;
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSValue, Job, JobContext, JsPtr, JsResult,
    JsThread, Protected, Strong,
};

use crate::node::{Flavor, StringOrBuffer, ThreadIsolated, ThreadIsolatedArg};

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
    fn is_safe_integer(self) -> bool;
    fn call_next_tick_2(self, global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<()>;
}

impl JSValueCryptoExt for JSValue {
    /// `Number.isSafeInteger` semantics.
    #[inline]
    fn is_safe_integer(self) -> bool {
        if self.is_int32() {
            return true;
        }
        if !self.is_double() {
            return false;
        }
        let d = self.as_double();
        d.trunc() == d && d.abs() <= jsc::MAX_SAFE_INTEGER as f64
    }

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
        pub mod $Name {
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
                let cx = global.js_thread();
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

pub mod random {
    use super::*;

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
        Scratch {
            scratch: Vec<u8>,
            size: usize,
            offset: u32,
        },
    }

    #[derive(bun_jsc::JsAffine)]
    struct RandomFillJs {
        callback: Strong,
        value: Protected,
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

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
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
            if let RandomFillJob::Scratch {
                scratch, offset, ..
            } = this
            {
                if let Some(mut buf) = js.value.value().as_array_buffer(global) {
                    let off = offset as usize;
                    let dst = buf.slice_mut();
                    match off.checked_add(scratch.len()) {
                        Some(end) if end <= dst.len() => {
                            dst[off..end].copy_from_slice(&scratch);
                        }
                        // Buffer was detached/shrunk while the job ran.
                        _ => {}
                    }
                }
            }
            global.bun_vm().event_loop_mut().run_callback(
                js.callback.get(),
                global,
                JSValue::UNDEFINED,
                &[JSValue::NULL, js.value.value()],
            );
            Ok(())
        }
    }

    fn schedule(global: &JSGlobalObject, callback: JSValue, job: RandomFillJob, value: JSValue) {
        let cx = global.js_thread();
        Job::<RandomFillJob>::schedule(
            &cx,
            job,
            RandomFillJs {
                callback: Strong::create(callback.with_async_context_if_needed(global), global),
                value: Protected::new(value),
            },
        );
    }

    mod _hostfns {
        use super::*;
        use crate::node::util::validators;
        use bun_core::String as BunString;
        use bun_jsc::{JSType, StringJsc as _, UUID, UUID7};

        #[bun_jsc::host_fn]
        fn random_int(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let [mut min_value, mut max_value, mut callback] = call_frame.arguments_as_array::<3>();

            let mut min_specified = true;
            if max_value.is_undefined() || max_value.is_callable() {
                callback = max_value;
                max_value = min_value;
                min_value = JSValue::js_number(0.0);
                min_specified = false;
            }

            if !callback.is_undefined() {
                let _ = validators::validate_function(global, "callback", callback)?;
            }

            if !min_value.is_safe_integer() {
                return Err(global.throw_invalid_argument_type_value2(
                    b"min",
                    b"a safe integer",
                    min_value,
                ));
            }
            if !max_value.is_safe_integer() {
                return Err(global.throw_invalid_argument_type_value2(
                    b"max",
                    b"a safe integer",
                    max_value,
                ));
            }

            let min: i64 = min_value.as_number().trunc() as i64;
            let max: i64 = max_value.as_number().trunc() as i64;

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
            // rejection sampling, backed by BoringSSL `RAND_bytes` (thread-local
            // AES-CTR DRBG, no syscall per call).
            let res: i64 = {
                let range = (max - min) as u64;
                debug_assert!(range > 0);
                let mut buf = [0u8; 8];
                let x = loop {
                    boringssl::rand_bytes(&mut buf);
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

            if !callback.is_undefined() {
                callback.call_next_tick_2(
                    global,
                    JSValue::UNDEFINED,
                    JSValue::js_number(res as f64),
                )?;
                return Ok(JSValue::UNDEFINED);
            }

            Ok(JSValue::js_number(res as f64))
        }

        #[bun_jsc::host_fn]
        fn random_uuid(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let args = call_frame.arguments();

            let mut disable_entropy_cache = false;
            if !args.is_empty() {
                let options = args[0];
                if !options.is_undefined() {
                    validators::validate_object(
                        global,
                        options,
                        format_args!("options"),
                        Default::default(),
                    )?;
                    if let Some(disable_entropy_cache_value) =
                        options.get(global, "disableEntropyCache")?
                    {
                        disable_entropy_cache = validators::validate_boolean(
                            global,
                            disable_entropy_cache_value,
                            format_args!("options.disableEntropyCache"),
                        )?;
                    }
                }
            }

            let (str, bytes) = BunString::create_uninitialized_latin1(36);

            let uuid = if disable_entropy_cache {
                UUID::init()
            } else {
                global.bun_vm().as_mut().rare_data().next_uuid()
            };

            uuid.print(
                (&mut bytes[..36])
                    .try_into()
                    .expect("infallible: size matches"),
            );
            str.into_js(global)
        }

        #[bun_jsc::host_fn]
        fn random_uuid_v7(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let args = call_frame.arguments();

            let mut disable_entropy_cache = false;
            if !args.is_empty() {
                let options = args[0];
                if !options.is_undefined() {
                    validators::validate_object(
                        global,
                        options,
                        format_args!("options"),
                        Default::default(),
                    )?;
                    if let Some(disable_entropy_cache_value) =
                        options.get(global, "disableEntropyCache")?
                    {
                        disable_entropy_cache = validators::validate_boolean(
                            global,
                            disable_entropy_cache_value,
                            format_args!("options.disableEntropyCache"),
                        )?;
                    }
                }
            }

            // jsDateNow() is exactly what JS Date.now() returns, so the embedded
            // timestamp is never behind a Date.now() sample taken by the caller.
            let now_ms = global.js_date_now().max(0.0) as u64;
            let mut entropy = [0u8; 10];
            if disable_entropy_cache {
                boringssl::rand_bytes(&mut entropy);
            } else {
                entropy
                    .copy_from_slice(&global.bun_vm().as_mut().rare_data().entropy_slice(10)[..10]);
            }
            let uuid = UUID7::init(now_ms, entropy, bun_jsc::uuid::TimestampSource::Clock);

            let (str, bytes) = BunString::create_uninitialized_latin1(36);
            uuid.print(
                (&mut bytes[..36])
                    .try_into()
                    .expect("infallible: size matches"),
            );
            str.into_js(global)
        }

        fn assert_offset(
            global: &JSGlobalObject,
            offset_value: JSValue,
            element_size: u8,
            length: usize,
        ) -> JsResult<u32> {
            if !offset_value.is_number() {
                return Err(global.throw_invalid_argument_type_value(
                    b"offset",
                    b"number",
                    offset_value,
                ));
            }
            let offset = offset_value.as_number() * (element_size as f64);

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
            size_value: JSValue,
            element_size: u8,
            offset: u32,
            length: usize,
        ) -> JsResult<u32> {
            let mut size = validators::validate_number(global, size_value, "size", None, None)?;
            size *= element_size as f64;

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

        #[bun_jsc::host_fn]
        fn random_bytes(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let [size_value, callback] = call_frame.arguments_as_array::<2>();

            let size = assert_size(global, size_value, 1, 0, MAX_POSSIBLE_LENGTH + 1)?;

            if !callback.is_undefined() {
                let _ = validators::validate_function(global, "callback", callback)?;
            }

            let (result, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, size)?;

            if callback.is_undefined() {
                // sync
                boringssl::rand_bytes(bytes);
                return Ok(result);
            }

            schedule(
                global,
                callback,
                RandomFillJob::InPlace {
                    // SAFETY: `bytes` is `result`'s backing store, kept alive by the job's
                    // Js side; a slice's data pointer is non-null even when empty.
                    bytes: unsafe {
                        JsPtr::new(core::ptr::NonNull::new_unchecked(bytes.as_mut_ptr()))
                    },
                    length: size as usize,
                },
                result,
            );

            Ok(JSValue::UNDEFINED)
        }

        #[bun_jsc::host_fn]
        fn random_fill_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let [buf_value, offset_value, size_value] = call_frame.arguments_as_array::<3>();

            let Some(mut buf) = buf_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    b"buf",
                    b"ArrayBuffer or ArrayBufferView",
                    buf_value,
                ));
            };

            let element_size = buf.bytes_per_element().unwrap_or(1);

            let offset = assert_offset(
                global,
                if offset_value.is_undefined() {
                    JSValue::js_number(0.0)
                } else {
                    offset_value
                },
                element_size,
                buf.byte_len,
            )?;

            // `size` is usize (`buf.byte_len - offset`, both usize). The
            // `assert_size` branch is bounded by `MAX_POSSIBLE_LENGTH` (≤ i32::MAX) so widening
            // its `u32` result is lossless; the default branch must NOT truncate to `u32` —
            // a >4 GiB ArrayBuffer remainder would silently fill only `(n % 2^32)` bytes.
            let size: usize = if size_value.is_undefined() {
                buf.byte_len - offset as usize
            } else {
                assert_size(global, size_value, element_size, offset, buf.byte_len)? as usize
            };

            if size == 0 {
                return Ok(buf_value);
            }

            boringssl::rand_bytes(&mut buf.slice_mut()[offset as usize..][..size]);

            Ok(buf_value)
        }

        #[bun_jsc::host_fn]
        fn random_fill(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
            let [buf_value, offset_value, mut size_value, mut callback] =
                call_frame.arguments_as_array::<4>();

            let Some(buf) = buf_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    b"buf",
                    b"ArrayBuffer or ArrayBufferView",
                    buf_value,
                ));
            };

            let element_size = buf.bytes_per_element().unwrap_or(1);

            let offset: u32;
            if offset_value.is_callable() {
                callback = offset_value;
                offset =
                    assert_offset(global, JSValue::js_number(0.0), element_size, buf.byte_len)?;
                size_value = JSValue::js_number(buf.len as f64);
            } else if size_value.is_callable() {
                callback = size_value;
                offset = assert_offset(global, offset_value, element_size, buf.byte_len)?;
                // `offset` is a byte offset (already scaled by element_size) but `buf.len`
                // is an element count, so `buf.len - offset` would mix units and can
                // underflow. Defer to the `buf.byte_len - offset` default below instead.
                size_value = JSValue::UNDEFINED;
            } else {
                let _ = validators::validate_function(global, "callback", callback)?;
                offset = assert_offset(global, offset_value, element_size, buf.byte_len)?;
            }

            // `size` is usize (`buf.byte_len - offset`, both usize). The
            // `assert_size` branch is bounded by `MAX_POSSIBLE_LENGTH` (≤ i32::MAX) so widening
            // its `u32` result is lossless; the default branch must NOT truncate to `u32` —
            // a >4 GiB ArrayBuffer remainder would silently fill only `(n % 2^32)` bytes.
            let size: usize = if size_value.is_undefined() {
                buf.byte_len - offset as usize
            } else {
                assert_size(global, size_value, element_size, offset, buf.byte_len)? as usize
            };

            if size == 0 {
                let _ = callback.call(global, JSValue::UNDEFINED, &[JSValue::NULL, buf_value])?;
                return Ok(JSValue::UNDEFINED);
            }

            // `vec![0u8; size]` aborts the process on OOM. The 3-arg overload
            // `randomFill(buf, offset, cb)` defaults `size` to the full
            // remaining buffer length, which can exceed allocator limits for a
            // multi-GiB ArrayBuffer — surface that as a JS error instead.
            let mut scratch = Vec::new();
            if scratch.try_reserve_exact(size).is_err() {
                return Err(global.throw_out_of_memory());
            }

            schedule(
                global,
                callback,
                RandomFillJob::Scratch {
                    scratch,
                    size,
                    offset,
                },
                buf_value,
            );

            Ok(JSValue::UNDEFINED)
        }
    } // mod _hostfns

    pub use _hostfns::*;
}

// ───────────────────────────────────────────────────────────────────────────
// Scrypt
// ───────────────────────────────────────────────────────────────────────────
pub(crate) struct Scrypt {
    password: StringOrBuffer<'static>,
    salt: StringOrBuffer<'static>,
    n: u32,
    r: u32,
    p: u32,
    maxmem: u64,
    keylen: u32,
}
// SAFETY: `password` and `salt` are `StringOrBuffer`s (see its impl); the rest is plain data.
unsafe impl ThreadIsolatedArg for Scrypt {}

// ───────────────────────────────────────────────────────────────────────────
// Argon2 (crypto.argon2 / crypto.argon2Sync)
// ───────────────────────────────────────────────────────────────────────────

/// One argon2 derivation, routed to the pure-Rust `rust-argon2` crate that
/// `Bun.password` already uses (BoringSSL has no argon2). Inputs are copied
/// out of JS at call time so the work-pool half never touches JS memory;
/// node's async jobs copy the same way.
pub(crate) struct Argon2 {
    message: Vec<u8>,
    nonce: Vec<u8>,
    secret: Vec<u8>,
    associated_data: Vec<u8>,
    parallelism: u32,
    tag_length: u32,
    memory: u32,
    passes: u32,
    variant: rust_argon2::Variant,
    output: Vec<u8>,
    failed: bool,
}

mod _impl {
    use super::*;
    use crate::node::util::validators;
    use bun_jsc::{ErrorCode, JSFunction, JSType};

    use crate::crypto::pbkdf2::{self, PBKDF2};

    impl Scrypt {
        /// The return type cannot vary on the const-generic bool, so this always
        /// returns `(Self, JSValue)`; the sync caller ignores the second element.
        fn from_js<const IS_ASYNC: bool>(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<(Self, JSValue)> {
            let [
                password_value,
                salt_value,
                keylen_value,
                options_arg,
                callback_arg,
            ] = call_frame.arguments_as_array::<5>();
            let mut maybe_options_value: Option<JSValue> = Some(options_arg);
            let mut callback = callback_arg;

            if IS_ASYNC {
                if callback.is_undefined() {
                    callback = maybe_options_value.unwrap();
                    maybe_options_value = None;
                }
            }

            let Some(password) = StringOrBuffer::from_js(global, password_value)? else {
                return Err(global.throw_invalid_argument_type_value(
                    b"password",
                    b"string, ArrayBuffer, Buffer, TypedArray, or DataView",
                    password_value,
                ));
            };

            let Some(salt) = StringOrBuffer::from_js(global, salt_value)? else {
                return Err(global.throw_invalid_argument_type_value(
                    b"salt",
                    b"string, ArrayBuffer, Buffer, TypedArray, or DataView",
                    salt_value,
                ));
            };

            let keylen = validators::validate_int32(
                global,
                keylen_value,
                format_args!("keylen"),
                Some(0),
                None,
            )?;

            let mut n: Option<u32> = None;
            let mut r: Option<u32> = None;
            let mut p: Option<u32> = None;
            let mut maxmem: Option<i64> = None;

            if let Some(options_value) = maybe_options_value {
                if let Some(options) = options_value.get_object() {
                    // `get_object` returned non-null; the JSObject is rooted by
                    // `options_value` (kept alive on the stack for this scope).
                    // `JSObject` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
                    // centralised non-null-ZST deref proof.
                    let options = bun_jsc::JSObject::opaque_ref(options);
                    if let Some(n_value) = options.get(global, "N")? {
                        n = Some(validators::validate_uint32(
                            global,
                            n_value,
                            format_args!("N"),
                            false,
                        )?);
                    }

                    if let Some(cost_value) = options.get(global, "cost")? {
                        if n.is_some() {
                            return Err(global.throw_incompatible_option_pair(b"N", b"cost"));
                        }
                        n = Some(validators::validate_uint32(
                            global,
                            cost_value,
                            format_args!("cost"),
                            false,
                        )?);
                    }

                    if let Some(r_value) = options.get(global, "r")? {
                        r = Some(validators::validate_uint32(
                            global,
                            r_value,
                            format_args!("r"),
                            false,
                        )?);
                    }

                    if let Some(blocksize_value) = options.get(global, "blockSize")? {
                        if r.is_some() {
                            return Err(global.throw_incompatible_option_pair(b"r", b"blockSize"));
                        }
                        r = Some(validators::validate_uint32(
                            global,
                            blocksize_value,
                            format_args!("blockSize"),
                            false,
                        )?);
                    }

                    if let Some(p_value) = options.get(global, "p")? {
                        p = Some(validators::validate_uint32(
                            global,
                            p_value,
                            format_args!("p"),
                            false,
                        )?);
                    }

                    if let Some(parallelization_value) = options.get(global, "parallelization")? {
                        if p.is_some() {
                            return Err(
                                global.throw_incompatible_option_pair(b"p", b"parallelization")
                            );
                        }
                        p = Some(validators::validate_uint32(
                            global,
                            parallelization_value,
                            format_args!("parallelization"),
                            false,
                        )?);
                    }

                    if let Some(maxmem_value) = options.get(global, "maxmem")? {
                        maxmem = Some(validators::validate_integer(
                            global,
                            maxmem_value,
                            "maxmem",
                            Some(0),
                            None,
                        )?);
                    }
                }
            }

            const N_DEFAULT: u32 = 16384;
            const R_DEFAULT: u32 = 8;
            const P_DEFAULT: u32 = 1;
            const MAXMEM_DEFAULT: i64 = 33554432;

            if n.is_none() || n.unwrap() == 0 {
                n = Some(N_DEFAULT);
            }
            if r.is_none() || r.unwrap() == 0 {
                r = Some(R_DEFAULT);
            }
            if p.is_none() || p.unwrap() == 0 {
                p = Some(P_DEFAULT);
            }
            if maxmem.is_none() || maxmem.unwrap() == 0 {
                maxmem = Some(MAXMEM_DEFAULT);
            }

            let mut ctx = Scrypt {
                password,
                salt,
                n: n.unwrap(),
                r: r.unwrap(),
                p: p.unwrap(),
                maxmem: u64::try_from(maxmem.unwrap()).expect("int cast"),
                keylen: u32::try_from(keylen).expect("int cast"),
            };
            if IS_ASYNC {
                let _ = validators::validate_function(global, "callback", callback)?;
            }

            ctx.check_scrypt_params(global)?;

            // An option getter may have changed the buffers.
            for input in [&mut ctx.password, &mut ctx.salt] {
                if IS_ASYNC {
                    input.make_thread_isolated_copy(global)?;
                } else if let StringOrBuffer::Buffer(buffer) = input {
                    buffer.buffer = ArrayBuffer::from_typed_array(global, buffer.buffer.value);
                }
            }

            if IS_ASYNC {
                return Ok((ctx, callback));
            }
            Ok((ctx, JSValue::UNDEFINED))
        }

        /// `from_js::<true>` for the work-pool job, with its callback.
        fn from_js_async(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<(ThreadIsolated<Self>, JSValue)> {
            let (ctx, callback) = Self::from_js::<true>(global, call_frame)?;
            // SAFETY: `from_js::<true>` copied the buffers and thread-isolated the strings.
            Ok((unsafe { ThreadIsolated::new(ctx) }, callback))
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
        fn run_task_impl(&self, key: &mut [u8]) -> Option<u32> {
            let password = self.password.slice();
            let salt = self.salt.slice();

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
        params: ThreadIsolated<Scrypt>,
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

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            // SAFETY: `result` is `buf`'s backing store (kept by the Js side); VM alive under the ticket.
            let key = unsafe { this.result.under_ticket(done.ticket()) };
            this.err = this.params.run_task_impl(key);
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
                event_loop.run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
                return Ok(());
            }

            event_loop.run_callback(
                callback,
                global,
                JSValue::UNDEFINED,
                &[JSValue::UNDEFINED, js.buf.get()],
            );
            Ok(())
        }
    }

    #[bun_jsc::host_fn]
    fn pbkdf2(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (data, callback) = PBKDF2::from_js_async(global_this, call_frame)?;
        pbkdf2::create_job(global_this, data, callback);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn pbkdf2_sync(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // `PBKDF2`'s `StringOrBuffer` fields release on `Drop`, so the local
        // just goes out of scope.
        let (mut data, _) = PBKDF2::from_js(global_this, call_frame, Flavor::Sync)?;
        // `create_buffer_from_length` → `JSBuffer__bufferFromLength`, which constructs
        // with `JSBufferSubclassStructure` (a Node.js `Buffer`, not a plain Uint8Array/ArrayBuffer).
        // `pbkdf2Sync()` MUST return a Buffer — `Buffer.isBuffer(result)` and Buffer-only methods
        // (`.toString('hex')`, `.readUInt32BE`, …) depend on it.
        let out_arraybuffer = JSValue::create_buffer_from_length(global_this, data.length)?;
        let Some(mut output) = out_arraybuffer.as_array_buffer(global_this) else {
            return Err(global_this.throw_out_of_memory());
        };

        if !data.run(output.slice_mut()) {
            boringssl::c::ERR_clear_error();
            let err = global_this.create_error_instance(format_args!("PBKDF2 derivation failed"));
            return Err(global_this.throw_value(err));
        }

        Ok(out_arraybuffer)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn timing_safe_equal(
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [l_value, r_value] = call_frame.arguments_as_array::<2>();

        let Some(l_buf) = l_value.as_array_buffer(global) else {
            return Err(global
            .err(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!(
                    "The \"buf1\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView."
                ),
            )
            .throw());
        };
        let l = l_buf.byte_slice();

        let Some(r_buf) = r_value.as_array_buffer(global) else {
            return Err(global
            .err(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!(
                    "The \"buf2\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView."
                ),
            )
            .throw());
        };
        let r = r_buf.byte_slice();

        if l.len() != r.len() {
            return Err(global
                .err(
                    ErrorCode::CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
                    format_args!("Input buffers must have the same byte length"),
                )
                .throw());
        }

        Ok(JSValue::from(boringssl::c::constant_time_eq(l, r)))
    }

    #[bun_jsc::host_fn]
    fn secure_heap_used(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn get_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(0.0))
    }

    #[bun_jsc::host_fn]
    fn set_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn set_engine(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Err(global
            .err(
                ErrorCode::CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED,
                format_args!("Custom engines not supported by BoringSSL"),
            )
            .throw())
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

    #[bun_jsc::host_fn]
    fn get_hashes(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let mut hashes: CaseInsensitiveAsciiStringArrayHashMap<()> =
            CaseInsensitiveAsciiStringArrayHashMap::new();

        // Perf idea (dylan-conway): cache the names
        // SAFETY: `for_each_hash` matches the expected callback signature; `&mut hashes` is valid
        // for the duration of the call.
        unsafe {
            boringssl::c::EVP_MD_do_all_sorted(for_each_hash, (&raw mut hashes).cast::<c_void>());
        }

        let array = JSValue::create_empty_array(global, hashes.count())?;

        for (i, hash) in hashes.keys().iter().enumerate() {
            let str = bun_string_jsc::create_utf8_for_js(global, hash)?;
            array.put_index(global, u32::try_from(i).expect("int cast"), str)?;
        }

        Ok(array)
    }

    #[bun_jsc::host_fn]
    fn scrypt(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (params, callback) = Scrypt::from_js_async(global, call_frame)?;
        if params.keylen as usize > jsc::virtual_machine::synthetic_allocation_limit() {
            return Err(global.throw_out_of_memory());
        }
        let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, params.keylen)?;
        let cx = global.js_thread();
        Job::<ScryptJob>::schedule(
            &cx,
            ScryptJob {
                params,
                // SAFETY: `bytes` is `buf`'s backing store, kept alive by the job's Js side.
                result: unsafe { JsPtr::new(core::ptr::NonNull::from(bytes)) },
                err: None,
            },
            ScryptJs {
                callback: Strong::create(callback.with_async_context_if_needed(global), global),
                buf: Strong::create(buf, global),
            },
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn scrypt_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // `password`/`salt` release on drop; nothing was protected on this path.
        let (ctx, _) = Scrypt::from_js::<false>(global, call_frame)?;
        let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, ctx.keylen)?;
        if ctx.run_task_impl(bytes).is_some() {
            return Err(global
                .err(
                    ErrorCode::CRYPTO_OPERATION_FAILED,
                    format_args!("Scrypt failed"),
                )
                .throw());
        }
        Ok(buf)
    }

    impl Argon2 {
        /// Arguments arrive pre-validated from `checkArgon2()` in `crypto.ts`;
        /// the checks here only defend the internal binding itself.
        fn from_js(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<(Self, JSValue)> {
            fn copy_buffer_arg(
                global: &JSGlobalObject,
                value: JSValue,
                name: &'static [u8],
            ) -> JsResult<Vec<u8>> {
                let Some(buf) = value.as_array_buffer(global) else {
                    return Err(global.throw_invalid_argument_type_value(
                        name,
                        b"ArrayBuffer, Buffer, TypedArray, or DataView",
                        value,
                    ));
                };
                let bytes = buf.byte_slice();
                let mut copy = Vec::new();
                if copy.try_reserve_exact(bytes.len()).is_err() {
                    return Err(global.throw_out_of_memory());
                }
                copy.extend_from_slice(bytes);
                Ok(copy)
            }

            let [
                message_value,
                nonce_value,
                parallelism_value,
                tag_length_value,
                memory_value,
                passes_value,
                secret_value,
                associated_data_value,
                variant_value,
                callback,
            ] = call_frame.arguments_as_array::<10>();

            let parallelism = validators::validate_uint32(
                global,
                parallelism_value,
                format_args!("parameters.parallelism"),
                true,
            )?;
            let tag_length = validators::validate_uint32(
                global,
                tag_length_value,
                format_args!("parameters.tagLength"),
                true,
            )?;
            let memory = validators::validate_uint32(
                global,
                memory_value,
                format_args!("parameters.memory"),
                true,
            )?;
            let passes = validators::validate_uint32(
                global,
                passes_value,
                format_args!("parameters.passes"),
                true,
            )?;
            let variant = match validators::validate_uint32(
                global,
                variant_value,
                format_args!("type"),
                false,
            )? {
                0 => rust_argon2::Variant::Argon2d,
                1 => rust_argon2::Variant::Argon2i,
                2 => rust_argon2::Variant::Argon2id,
                _ => {
                    return Err(global.throw_invalid_argument_type_value(
                        b"type",
                        b"a supported argon2 type",
                        variant_value,
                    ));
                }
            };

            // The validators admit sizes rust-argon2 would abort on
            // (`vec![Block::zero(); mem_cost]` and the output Vec allocate
            // infallibly). Pre-fail the job instead, so both paths deliver
            // the same catchable error node produces when OpenSSL's argon2
            // allocation fails.
            let limit = jsc::virtual_machine::synthetic_allocation_limit();
            let failed =
                (memory as usize).saturating_mul(1024) > limit || tag_length as usize > limit;

            let ctx = Argon2 {
                message: copy_buffer_arg(global, message_value, b"message")?,
                nonce: copy_buffer_arg(global, nonce_value, b"nonce")?,
                secret: copy_buffer_arg(global, secret_value, b"secret")?,
                associated_data: copy_buffer_arg(global, associated_data_value, b"associatedData")?,
                parallelism,
                tag_length,
                memory,
                passes,
                variant,
                output: Vec::new(),
                failed,
            };
            Ok((ctx, callback))
        }

        fn run(&mut self) {
            if self.failed {
                return;
            }
            let config = rust_argon2::Config {
                ad: &self.associated_data,
                hash_length: self.tag_length,
                lanes: self.parallelism,
                mem_cost: self.memory,
                secret: &self.secret,
                // Sequential like Bun.password (pwhash.rs): lanes determine
                // the output, not the thread count, so results match node,
                // which threads lanes via OpenSSL on its worker.
                thread_mode: rust_argon2::ThreadMode::Sequential,
                time_cost: self.passes,
                variant: self.variant,
                version: rust_argon2::Version::Version13,
            };
            match rust_argon2::hash_raw(&self.message, &self.nonce, &config) {
                Ok(hash) => self.output = hash,
                // Unreachable via `node:crypto`: `checkArgon2()` bounds are a
                // superset of rust-argon2's constraints.
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

    /// `crypto.argon2` off the JS thread: `from_js` copied every input out of
    /// JS, so the pool half owns plain memory and needs no `JsPtr`.
    impl JobContext for Argon2 {
        type OffThread = Self;
        type Js = Argon2Js;

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            this.run();
            Some(done)
        }

        fn then(mut this: Self, js: Argon2Js, cx: &JsThread<'_>) -> JsResult<()> {
            let global = cx.global();
            let event_loop = global.bun_vm().event_loop_mut();
            let callback = js.callback.get();
            if this.failed {
                let exception =
                    global.create_error_instance(format_args!("Argon2 derivation failed"));
                event_loop.run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
                return Ok(());
            }
            let output = core::mem::take(&mut this.output);
            // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator).
            match JSValue::create_buffer(global, output.leak()) {
                Ok(buf) => event_loop.run_callback(
                    callback,
                    global,
                    JSValue::UNDEFINED,
                    &[JSValue::UNDEFINED, buf],
                ),
                // The result could not be built (allocation failure): that is
                // this derivation's error.
                Err(err) => event_loop.run_callback(
                    callback,
                    global,
                    JSValue::UNDEFINED,
                    &[global.take_error(err)],
                ),
            }
            Ok(())
        }
    }

    #[bun_jsc::host_fn]
    fn argon2(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (ctx, callback) = Argon2::from_js(global, call_frame)?;
        let _ = validators::validate_function(global, "callback", callback)?;
        let cx = global.js_thread();
        Job::<Argon2>::schedule(
            &cx,
            ctx,
            Argon2Js {
                callback: Strong::create(callback.with_async_context_if_needed(global), global),
            },
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn argon2_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (mut ctx, _) = Argon2::from_js(global, call_frame)?;
        ctx.run();
        if ctx.failed {
            let err = global.create_error_instance(format_args!("Argon2 derivation failed"));
            return Err(global.throw_value(err));
        }
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator).
        JSValue::create_buffer(global, ctx.output.leak())
    }

    pub(crate) fn create_node_crypto_binding_zig(global: &JSGlobalObject) -> JSValue {
        let crypto = JSValue::create_empty_object(global, 17);

        // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw `JSHostFn` ABI;
        // pass that (not the safe-Rust body) to `JSFunction::create`.
        crypto.put(
            global,
            b"pbkdf2",
            JSFunction::create(global, "pbkdf2", __jsc_host_pbkdf2, 6, Default::default()),
        );
        crypto.put(
            global,
            b"pbkdf2Sync",
            JSFunction::create(
                global,
                "pbkdf2Sync",
                __jsc_host_pbkdf2_sync,
                5,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomInt",
            JSFunction::create(
                global,
                "randomInt",
                random::__jsc_host_random_int,
                2,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomFill",
            JSFunction::create(
                global,
                "randomFill",
                random::__jsc_host_random_fill,
                4,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomFillSync",
            JSFunction::create(
                global,
                "randomFillSync",
                random::__jsc_host_random_fill_sync,
                3,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomUUID",
            JSFunction::create(
                global,
                "randomUUID",
                random::__jsc_host_random_uuid,
                1,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomUUIDv7",
            JSFunction::create(
                global,
                "randomUUIDv7",
                random::__jsc_host_random_uuid_v7,
                1,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"randomBytes",
            JSFunction::create(
                global,
                "randomBytes",
                random::__jsc_host_random_bytes,
                2,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"timingSafeEqual",
            JSFunction::create(
                global,
                "timingSafeEqual",
                __jsc_host_timing_safe_equal,
                2,
                Default::default(),
            ),
        );

        crypto.put(
            global,
            b"secureHeapUsed",
            JSFunction::create(
                global,
                "secureHeapUsed",
                __jsc_host_secure_heap_used,
                0,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"getFips",
            JSFunction::create(
                global,
                "getFips",
                __jsc_host_get_fips,
                0,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"setFips",
            JSFunction::create(
                global,
                "setFips",
                __jsc_host_set_fips,
                1,
                Default::default(),
            ),
        );
        crypto.put(
            global,
            b"setEngine",
            JSFunction::create(
                global,
                "setEngine",
                __jsc_host_set_engine,
                2,
                Default::default(),
            ),
        );

        crypto.put(
            global,
            b"getHashes",
            JSFunction::create(
                global,
                "getHashes",
                __jsc_host_get_hashes,
                0,
                Default::default(),
            ),
        );

        crypto.put(
            global,
            b"scrypt",
            JSFunction::create(global, "scrypt", __jsc_host_scrypt, 5, Default::default()),
        );
        crypto.put(
            global,
            b"scryptSync",
            JSFunction::create(
                global,
                "scryptSync",
                __jsc_host_scrypt_sync,
                4,
                Default::default(),
            ),
        );

        crypto.put(
            global,
            b"argon2",
            JSFunction::create(global, "argon2", __jsc_host_argon2, 10, Default::default()),
        );
        crypto.put(
            global,
            b"argon2Sync",
            JSFunction::create(
                global,
                "argon2Sync",
                __jsc_host_argon2_sync,
                9,
                Default::default(),
            ),
        );

        crypto
    }
} // mod _impl

pub(crate) use _impl::{create_node_crypto_binding_zig, timing_safe_equal};
