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
                let cx = global.js_thread_of_caller_no_frame();
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
    let truncated = number.trunc();
    number == truncated && truncated.abs() <= jsc::MAX_SAFE_INTEGER as f64
}

fn random_int(
    cx: &mut JsScope<'a>,
    min: Option<f64>,
    max: f64,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<f64>> {
    let global = cx.global();
    let min_specified = min.is_some();
    let min_f = min.unwrap_or(0.0);
    let max_f = max;
    let min = min_f.trunc() as i64;
    let max = max_f.trunc() as i64;

    if !is_safe_integer(min_f) {
        return Err(global.throw_invalid_argument_type_value2(
            b"min",
            b"a safe integer",
            JSValue::js_number(min_f),
        ));
    }
    if !is_safe_integer(max_f) {
        return Err(global.throw_invalid_argument_type_value2(
            b"max",
            b"a safe integer",
            JSValue::js_number(max_f),
        ));
    }

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

