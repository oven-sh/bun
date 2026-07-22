//! `node:crypto` native binding — `pbkdf2`/`scrypt`/`random*`/`timingSafeEqual`
//! plus the `ExternCryptoJob` / `CryptoJob<Ctx>` work-pool plumbing.

use core::ffi::{c_char, c_void};

use bun_boringssl as boringssl;
use bun_collections::CaseInsensitiveAsciiStringArrayHashMap;
use bun_jsc::{
    self as jsc, AnyTaskJob, AnyTaskJobCtx, ArrayBuffer, CallFrame, JSGlobalObject, JSValue,
    JsResult, StrongOptional,
};

use crate::node::StringOrBuffer;

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
pub(crate) trait JSValueCryptoExt {
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
            unsafe extern "C" {
                #[link_name = concat!("Bun__", $name_str, "Ctx__runTask")]
                safe fn ctx_run_task(ctx: &Ctx, global: *mut JSGlobalObject);
                #[link_name = concat!("Bun__", $name_str, "Ctx__runFromJS")]
                safe fn ctx_run_from_js(ctx: &Ctx, global: &JSGlobalObject, callback: JSValue);
                #[link_name = concat!("Bun__", $name_str, "Ctx__deinit")]
                safe fn ctx_deinit(ctx: &Ctx);
            }

            pub(crate) struct ExternCtx {
                ctx: *mut Ctx,
                callback: StrongOptional,
            }

            impl AnyTaskJobCtx for ExternCtx {
                fn run(&mut self, global: *mut JSGlobalObject) {
                    ctx_run_task(Ctx::opaque_ref(self.ctx), global);
                }
                fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
                    let Some(callback) = self.callback.try_swap() else {
                        return Ok(());
                    };
                    let ctx = Ctx::opaque_ref(self.ctx);
                    if let Err(err) = jsc::from_js_host_call_generic(global, || {
                        ctx_run_from_js(ctx, global, callback);
                    }) {
                        global.report_active_exception_as_unhandled(err);
                    }
                    Ok(())
                }
            }

            impl Drop for ExternCtx {
                fn drop(&mut self) {
                    ctx_deinit(Ctx::opaque_ref(self.ctx));
                    self.callback.deinit();
                }
            }

            pub(crate) type Job = AnyTaskJob<ExternCtx>;

            // Exported C symbols.
            #[unsafe(export_name = concat!("Bun__", $name_str, "__create"))]
            pub(crate) extern "C" fn __create(
                global: &JSGlobalObject,
                ctx: *mut Ctx,
                callback: JSValue,
            ) -> *mut Job {
                Job::create(
                    global,
                    ExternCtx {
                        ctx,
                        callback: StrongOptional::create(callback, global),
                    },
                )
                .expect("ExternCtx::init is infallible")
            }

            #[unsafe(export_name = concat!("Bun__", $name_str, "__schedule"))]
            pub(crate) extern "C" fn __schedule(this: &mut Job) {
                // SAFETY: `this` is a live pointer returned by `__create`.
                unsafe { Job::schedule(this) };
            }

            #[unsafe(export_name = concat!("Bun__", $name_str, "__createAndSchedule"))]
            pub(crate) extern "C" fn __create_and_schedule(
                global: &JSGlobalObject,
                ctx: *mut Ctx,
                callback: JSValue,
            ) {
                let callback = callback.with_async_context_if_needed(global);
                Job::create_and_schedule(
                    global,
                    ExternCtx {
                        ctx,
                        callback: StrongOptional::create(callback, global),
                    },
                )
                .expect("ExternCtx::init is infallible");
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

/// Trait expressing the interface `CryptoJob` expects of `Ctx`.
pub trait CryptoJobCtx: Sized {
    fn init(&mut self, global: &JSGlobalObject) -> JsResult<()>;
    /// The impl reads its own `result` field directly.
    fn run_task(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue);
    fn deinit(&mut self);
}

/// Adapter binding a [`CryptoJobCtx`] + JS callback into an [`AnyTaskJobCtx`].
/// `Drop` runs `inner.deinit()` then releases the callback handle.
pub struct CallbackCtx<C: CryptoJobCtx> {
    callback: StrongOptional,
    inner: C,
}

impl<C: CryptoJobCtx> AnyTaskJobCtx for CallbackCtx<C> {
    #[inline]
    fn init(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        self.inner.init(global)
    }
    #[inline]
    fn run(&mut self, _global: *mut JSGlobalObject) {
        self.inner.run_task();
    }
    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        let Some(callback) = self.callback.try_swap() else {
            return Ok(());
        };
        self.inner.run_from_js(global, callback);
        Ok(())
    }
}

impl<C: CryptoJobCtx> Drop for CallbackCtx<C> {
    fn drop(&mut self) {
        self.inner.deinit();
        self.callback.deinit();
    }
}

/// Kept as a free fn since `CryptoJob<C>` is
/// a type alias for the foreign `AnyTaskJob<_>`.
pub(crate) fn crypto_job_init_and_schedule<C: CryptoJobCtx>(
    global: &JSGlobalObject,
    callback: JSValue,
    ctx: C,
) -> JsResult<()> {
    AnyTaskJob::create_and_schedule(
        global,
        CallbackCtx {
            callback: StrongOptional::create(callback.with_async_context_if_needed(global), global),
            inner: ctx,
        },
    )
}

// ───────────────────────────────────────────────────────────────────────────
// random
// ───────────────────────────────────────────────────────────────────────────
pub mod random {
    use super::*;

    // No `Clone`: `value` is JSC-protected in `init`/unprotected in `deinit`, and
    // `bytes` borrows into that ArrayBuffer. Cloning would alias the protect/unprotect
    // pair and the borrowed buffer. `CryptoJob::init` moves the ctx by value.
    pub struct JobCtx {
        pub value: JSValue,
        pub bytes: *mut u8,
        pub offset: u32,
        pub length: usize,
        // Worker-owned destination for user-supplied buffers (`randomFill`).
        // The user can detach (`transfer()`) or shrink (`resize()`) the backing
        // store between scheduling and the WorkPool write, so the worker fills
        // this scratch and `run_from_js` re-validates + copies on the JS thread.
        // `randomBytes` allocates its own buffer (unreachable from JS until the
        // callback fires) and leaves this `None`.
        pub scratch: Option<Vec<u8>>,
        pub result: (), // void
    }

    pub(crate) const MAX_POSSIBLE_LENGTH: usize = {
        let a = ArrayBuffer::MAX_SIZE as usize;
        let b = i32::MAX as usize;
        if a < b { a } else { b }
    };
    pub(crate) const MAX_RANGE: i64 = 0xffff_ffff_ffff;

    impl CryptoJobCtx for JobCtx {
        fn init(&mut self, _: &JSGlobalObject) -> JsResult<()> {
            self.value.protect();
            Ok(())
        }

        fn run_task(&mut self) {
            if let Some(scratch) = &mut self.scratch {
                boringssl::rand_bytes(scratch);
                return;
            }
            // SAFETY: `bytes` points into an ArrayBuffer kept alive by `self.value`
            // (protected in `init`); offset+length were range-checked by callers.
            // This branch is only used for internally-allocated buffers that JS
            // cannot reach (and therefore cannot detach/resize) until `run_from_js`.
            let slice = unsafe {
                core::slice::from_raw_parts_mut(self.bytes.add(self.offset as usize), self.length)
            };
            boringssl::rand_bytes(slice);
        }

        fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue) {
            if let Some(scratch) = self.scratch.take() {
                // Re-fetch the buffer on the JS thread and re-validate bounds:
                // the user may have detached or resized it while the WorkPool
                // task ran. On mismatch, drop the random bytes rather than
                // write through a stale pointer.
                if let Some(mut buf) = self.value.as_array_buffer(global) {
                    let off = self.offset as usize;
                    let dst = buf.slice_mut();
                    match off.checked_add(scratch.len()) {
                        Some(end) if end <= dst.len() => {
                            dst[off..end].copy_from_slice(&scratch);
                        }
                        _ => {}
                    }
                }
            }
            // `bun_vm()` is the audited safe `&'static VirtualMachine` accessor;
            // `event_loop_mut()` is the audited safe `&mut EventLoop` accessor.
            global.bun_vm().event_loop_mut().run_callback(
                callback,
                global,
                JSValue::UNDEFINED,
                &[JSValue::NULL, self.value],
            );
        }

        fn deinit(&mut self) {
            self.value.unprotect();
        }
    }

    mod _hostfns {
        use super::*;
        use crate::node::util::validators;
        use bun_core::String as BunString;
        use bun_jsc::{JSType, StringJsc as _, UUID, UUID7};

        #[bun_jsc::host_fn]
        pub(crate) fn random_int(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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
        pub(crate) fn random_uuid(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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

            let (mut str, bytes) = BunString::create_uninitialized_latin1(36);

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
            str.transfer_to_js(global)
        }

        #[bun_jsc::host_fn]
        pub(crate) fn random_uuid_v7(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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

            let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
            uuid.print(
                (&mut bytes[..36])
                    .try_into()
                    .expect("infallible: size matches"),
            );
            str.transfer_to_js(global)
        }

        pub(crate) fn assert_offset(
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

        pub(crate) fn assert_size(
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
        pub(crate) fn random_bytes(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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

            let ctx = JobCtx {
                value: result,
                bytes: bytes.as_mut_ptr(),
                offset: 0,
                length: size as usize,
                scratch: None,
                result: (),
            };
            crypto_job_init_and_schedule(global, callback, ctx)?;

            Ok(JSValue::UNDEFINED)
        }

        #[bun_jsc::host_fn]
        pub(crate) fn random_fill_sync(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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
        pub(crate) fn random_fill(
            global: &JSGlobalObject,
            call_frame: &CallFrame,
        ) -> JsResult<JSValue> {
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
            scratch.resize(size, 0);

            let ctx = JobCtx {
                value: buf_value,
                bytes: core::ptr::null_mut(),
                offset,
                length: size,
                scratch: Some(scratch),
                result: (),
            };
            crypto_job_init_and_schedule(global, callback, ctx)?;

            Ok(JSValue::UNDEFINED)
        }
    } // mod _hostfns

    pub use _hostfns::*;
}

// ───────────────────────────────────────────────────────────────────────────
// Scrypt
// ───────────────────────────────────────────────────────────────────────────
pub(crate) struct Scrypt {
    // Plain `StringOrBuffer` — NOT `ThreadSafe<_>`. The struct serves both
    // `scryptSync` (no protect taken) and async `scrypt` (protect taken in
    // `from_js_maybe_async(.., true)`); wrapping in `ThreadSafe` here would make
    // the sync path's drop call `JSValue::unprotect()` on a buffer it never
    // protected, stealing a refcount from any independent protector. The async
    // path releases its protect via `Unprotect for Scrypt` in
    // `CryptoJobCtx::deinit` instead.
    password: StringOrBuffer,
    salt: StringOrBuffer,
    n: u32,
    r: u32,
    p: u32,
    maxmem: u64,
    keylen: u32,

    // used in async mode
    buf: StrongOptional, // Strong.Optional, default .empty
    // Invariant: `result` borrows the ArrayBuffer backing kept alive by `buf`;
    // `buf` must stay set for as long as `result` is dereferenced.
    result: *mut [u8],
    err: Option<u32>,
}

mod _impl {
    use super::*;
    use crate::node::util::validators;
    use bun_jsc::{ErrorCode, JSFunction, JSType};

    use crate::crypto::pbkdf2::{self, PBKDF2};

    impl Scrypt {
        /// The return type cannot vary on the const-generic bool, so this always
        /// returns `(Self, JSValue)`; the sync caller ignores the second element.
        pub(crate) fn from_js<const IS_ASYNC: bool>(
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

            let Some(password) =
                StringOrBuffer::from_js_maybe_async(global, password_value, IS_ASYNC, true)?
            else {
                return Err(global.throw_invalid_argument_type_value(
                    b"password",
                    b"string, ArrayBuffer, Buffer, TypedArray, or DataView",
                    password_value,
                ));
            };

            // On error: `Drop for StringOrBuffer` releases the data; only the async branch took a
            // `protect()` (inside `from_js_maybe_async`), so only that branch may unprotect —
            // an unconditional unprotect would steal a refcount on the sync path.
            let password = scopeguard::guard(password, |mut p| {
                if IS_ASYNC {
                    bun_jsc::Unprotect::unprotect(&mut p);
                }
            });

            let Some(salt) =
                StringOrBuffer::from_js_maybe_async(global, salt_value, IS_ASYNC, true)?
            else {
                return Err(global.throw_invalid_argument_type_value(
                    b"salt",
                    b"string, ArrayBuffer, Buffer, TypedArray, or DataView",
                    salt_value,
                ));
            };

            let salt = scopeguard::guard(salt, |mut s| {
                if IS_ASYNC {
                    bun_jsc::Unprotect::unprotect(&mut s);
                }
            });

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

            let ctx = Scrypt {
                password: scopeguard::ScopeGuard::into_inner(password),
                salt: scopeguard::ScopeGuard::into_inner(salt),
                n: n.unwrap(),
                r: r.unwrap(),
                p: p.unwrap(),
                maxmem: u64::try_from(maxmem.unwrap()).expect("int cast"),
                keylen: u32::try_from(keylen).expect("int cast"),
                buf: StrongOptional::empty(),
                result: std::ptr::from_mut::<[u8]>(&mut []),
                err: None,
            };
            // Re-arm the error guard now that ownership moved into `ctx` — it
            // covers the `validateFunction`/`checkScryptParams` calls below.
            let ctx = scopeguard::guard(ctx, |mut c| {
                if IS_ASYNC {
                    bun_jsc::Unprotect::unprotect(&mut c);
                }
            });

            if IS_ASYNC {
                let _ = validators::validate_function(global, "callback", callback)?;
            }

            ctx.check_scrypt_params(global)?;

            let ctx = scopeguard::ScopeGuard::into_inner(ctx);

            if IS_ASYNC {
                return Ok((ctx, callback));
            }

            Ok((ctx, JSValue::UNDEFINED))
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

        fn run_task_impl(&mut self, key: &mut [u8]) {
            let password = self.password.slice();
            let salt = self.salt.slice();

            if key.is_empty() {
                // result will be an empty buffer
                return;
            }

            if password.len() > i32::MAX as usize || salt.len() > i32::MAX as usize {
                self.err = Some(0);
                return;
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
                self.err = Some(boringssl::c::ERR_peek_last_error());
                return;
            }
        }

        fn deinit_sync(&mut self) {
            // `salt`/`password` are `StringOrBuffer` — released by `Drop` when
            // `self` goes out of scope (the `scrypt_sync` scopeguard's `c`).
            self.buf.deinit();
        }
    }

    impl bun_jsc::Unprotect for Scrypt {
        /// Release the `protect()` taken by `from_js_maybe_async(.., true)` on the
        /// async path. The sync path never calls this (see `deinit_sync`).
        #[inline]
        fn unprotect(&mut self) {
            bun_jsc::Unprotect::unprotect(&mut self.password);
            bun_jsc::Unprotect::unprotect(&mut self.salt);
        }
    }

    impl CryptoJobCtx for Scrypt {
        fn init(&mut self, global: &JSGlobalObject) -> JsResult<()> {
            if self.keylen as usize > jsc::virtual_machine::synthetic_allocation_limit() {
                return Err(global.throw_out_of_memory());
            }
            let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, self.keylen)?;

            // to be filled in later
            self.result = std::ptr::from_mut::<[u8]>(bytes);
            self.buf = StrongOptional::create(buf, global);
            Ok(())
        }

        fn run_task(&mut self) {
            // SAFETY: `result` points into the ArrayBuffer rooted by `self.buf` (set in `init`).
            let key = unsafe { &mut *self.result };
            self.run_task_impl(key);
        }

        fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue) {
            // a self-ptr live for the VM lifetime. Short-lived `&mut` formed at use site
            // per VirtualMachine.rs §event_loop contract.
            let event_loop = global.bun_vm().event_loop_mut();

            if let Some(err) = self.err {
                if err != 0 {
                    let mut buf = [0u8; 256];
                    // SAFETY: buf is a valid 256-byte buffer; ERR_error_string_n
                    // NUL-terminates within `len` bytes and returns `buf`.
                    unsafe {
                        boringssl::c::ERR_error_string_n(err, buf.as_mut_ptr().cast(), buf.len())
                    };
                    // SAFETY: `buf` is NUL-terminated by the call above.
                    let msg = unsafe { bun_core::ffi::cstr(buf.as_ptr().cast()) };
                    let exception = global
                        .err(
                            ErrorCode::CRYPTO_OPERATION_FAILED,
                            format_args!("Scrypt failed: {}", bstr::BStr::new(msg.to_bytes())),
                        )
                        .to_js();
                    event_loop.run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
                    return;
                }

                let exception = global
                    .err(
                        ErrorCode::CRYPTO_OPERATION_FAILED,
                        format_args!("Scrypt failed"),
                    )
                    .to_js();
                event_loop.run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
                return;
            }

            let buf = self.buf.swap();
            event_loop.run_callback(
                callback,
                global,
                JSValue::UNDEFINED,
                &[JSValue::UNDEFINED, buf],
            );
        }

        fn deinit(&mut self) {
            // `Drop for StringOrBuffer` releases salt/password when `CryptoJob` is freed.
            bun_jsc::Unprotect::unprotect(self);
            self.buf.deinit();
        }
    }

    #[bun_jsc::host_fn]
    fn pbkdf2(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let data = PBKDF2::from_js(global_this, call_frame, true)?;

        let job = pbkdf2::create_job(global_this, data);
        // SAFETY: `job` was just boxed by `create()` and is live; `ctx.promise` is
        // not touched by the off-thread `run` body, and the JS-thread completion
        // cannot run until this host fn returns.
        Ok(unsafe { (*job).ctx.promise.value() })
    }

    #[bun_jsc::host_fn]
    fn pbkdf2_sync(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let data = PBKDF2::from_js(global_this, call_frame, false)?;
        // `PBKDF2`'s `StringOrBuffer` fields release on `Drop`, so the local
        // just goes out of scope.
        let mut data = data;
        // `create_buffer_from_length` → `JSBuffer__bufferFromLength`, which constructs
        // with `JSBufferSubclassStructure` (a Node.js `Buffer`, not a plain Uint8Array/ArrayBuffer).
        // `pbkdf2Sync()` MUST return a Buffer — `Buffer.isBuffer(result)` and Buffer-only methods
        // (`.toString('hex')`, `.readUInt32BE`, …) depend on it.
        let out_arraybuffer =
            JSValue::create_buffer_from_length(global_this, data.length as usize)?;
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
    pub fn timing_safe_equal(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
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
    pub(super) fn secure_heap_used(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        // BoringSSL has no secure heap. Return Node's "unavailable" shape so
        // `crypto.secureHeapUsed().used` etc. work instead of throwing on undefined.
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(global, b"total", JSValue::js_number(0.0));
        obj.put(global, b"used", JSValue::js_number(0.0));
        obj.put(global, b"utilization", JSValue::js_number(0.0));
        obj.put(global, b"min", JSValue::js_number(0.0));
        Ok(obj)
    }

    #[bun_jsc::host_fn]
    pub(super) fn get_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(0.0))
    }

    #[bun_jsc::host_fn]
    pub(super) fn set_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub(super) fn set_engine(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
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
            let str = jsc::bun_string_jsc::create_utf8_for_js(global, hash)?;
            array.put_index(global, u32::try_from(i).expect("int cast"), str)?;
        }

        Ok(array)
    }

    #[bun_jsc::host_fn]
    fn scrypt(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (ctx, callback) = Scrypt::from_js::<true>(global, call_frame)?;
        crypto_job_init_and_schedule(global, callback, ctx)?;
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    fn scrypt_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let (ctx, _) = Scrypt::from_js::<false>(global, call_frame)?;
        let mut ctx = scopeguard::guard(ctx, |mut c| c.deinit_sync());
        let (buf, bytes) = ArrayBuffer::alloc::<{ JSType::ArrayBuffer }>(global, ctx.keylen)?;
        ctx.run_task_impl(bytes);
        if ctx.err.is_some() {
            return Err(global
                .err(
                    ErrorCode::CRYPTO_OPERATION_FAILED,
                    format_args!("Scrypt failed"),
                )
                .throw());
        }
        Ok(buf)
    }

    pub fn create_node_crypto_binding_zig(global: &JSGlobalObject) -> JSValue {
        let crypto = JSValue::create_empty_object(global, 15);

        // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw `JSHostFn` ABI;
        // pass that (not the safe-Rust body) to `JSFunction::create`.
        crypto.put(
            global,
            b"pbkdf2",
            JSFunction::create(global, "pbkdf2", __jsc_host_pbkdf2, 5, Default::default()),
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

        crypto
    }
} // mod _impl

pub use _impl::{create_node_crypto_binding_zig, timing_safe_equal};
