use core::ffi::c_uint;

use bun_boringssl_sys as boringssl;
use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsResult,
    ZigStringSlice,
};

use crate::node::StringOrBuffer;

use crate::crypto::create_crypto_error;
use crate::crypto::evp::{self, Algorithm};

// BoringSSL error code; not yet exported by `bun_boringssl_sys`
// (Zig: src/boringssl_sys/boringssl.zig:6422).
const EVP_R_MEMORY_LIMIT_EXCEEDED: u32 = 132;

pub struct PBKDF2 {
    pub password: StringOrBuffer,
    pub salt: StringOrBuffer,
    pub iteration_count: u32,
    pub length: i32,
    pub algorithm: Algorithm,
}

impl Default for PBKDF2 {
    fn default() -> Self {
        Self {
            password: StringOrBuffer::default(),
            salt: StringOrBuffer::default(),
            iteration_count: 1,
            length: 0,
            // PORT NOTE: Zig had no default for `algorithm` (callers always set it).
            // Sha256 is an arbitrary placeholder so `Default` compiles.
            algorithm: Algorithm::Sha256,
        }
    }
}

impl PBKDF2 {
    pub fn run(&mut self, output: &mut [u8]) -> bool {
        let password = self.password.slice();
        let salt = self.salt.slice();
        let algorithm = self.algorithm;
        let iteration_count = self.iteration_count;
        let length = self.length;

        output.fill(0);
        debug_assert!(self.length <= i32::try_from(output.len()).expect("int cast"));
        boringssl::ERR_clear_error();
        // SAFETY: password/salt point to valid slices for the given lengths;
        // algorithm.md() returns a non-null EVP_MD; output is writable for `length` bytes.
        let rc = unsafe {
            boringssl::PKCS5_PBKDF2_HMAC(
                if !password.is_empty() {
                    password.as_ptr()
                } else {
                    core::ptr::null()
                },
                password.len(),
                salt.as_ptr(),
                salt.len(),
                iteration_count as c_uint,
                algorithm.md().unwrap(),
                usize::try_from(length).expect("int cast"),
                output.as_mut_ptr(),
            )
        };

        if rc <= 0 {
            return false;
        }

        true
    }

    // Zig `deinit()` only freed `password`/`salt`; both are `StringOrBuffer`
    // whose `Drop` releases the slice/WTF ref, so the explicit hook is gone —
    // dropping `PBKDF2` is sufficient for the sync path. The async path holds
    // `ThreadSafe<PBKDF2>`, whose `Drop` additionally unprotects JS-rooted
    // buffers via the `Unprotect` impl below.

    pub fn from_js(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        is_async: bool,
    ) -> JsResult<PBKDF2> {
        let [arg0, arg1, arg2, arg3, arg4, arg5] = call_frame.arguments_as_array::<6>();

        if !arg3.is_number() {
            return Err(global_this.throw_invalid_argument_type_value(b"keylen", b"number", arg3));
        }

        let keylen_num = arg3.as_number();

        if keylen_num.is_infinite() || keylen_num.is_nan() {
            return Err(global_this.throw_range_error(
                keylen_num,
                bun_jsc::RangeErrorOptions {
                    field_name: b"keylen",
                    msg: b"an integer",
                    ..Default::default()
                },
            ));
        }

        if keylen_num < 0.0 || keylen_num > i32::MAX as f64 {
            return Err(global_this.throw_range_error(
                keylen_num,
                bun_jsc::RangeErrorOptions {
                    field_name: b"keylen",
                    min: 0,
                    max: i32::MAX as i64,
                    ..Default::default()
                },
            ));
        }

        let keylen: i32 = keylen_num as i32;

        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        if !arg2.is_any_int() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"iterations",
                b"number",
                arg2,
            ));
        }

        let iteration_count = arg2.coerce_to_int64(global_this)?;

        if !global_this.has_exception()
            && (iteration_count < 1 || iteration_count > i32::MAX as i64)
        {
            return Err(global_this.throw_range_error(
                iteration_count,
                bun_jsc::RangeErrorOptions {
                    field_name: b"iterations",
                    min: 1,
                    max: i32::MAX as i64 + 1,
                    ..Default::default()
                },
            ));
        }

        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        let algorithm = 'brk: {
            if !arg4.is_string() {
                return Err(
                    global_this.throw_invalid_argument_type_value(b"digest", b"string", arg4)
                );
            }

            'invalid: {
                let slice = arg4.to_slice(global_this)?;
                match evp::lookup_ignore_case(slice.slice()) {
                    Some(alg) => match alg {
                        Algorithm::Shake128 | Algorithm::Shake256 => break 'invalid,
                        other => break 'brk other,
                    },
                    None => break 'invalid,
                }
            }

            if !global_this.has_exception() {
                let slice = arg4.to_slice(global_this)?;
                let name = slice.slice();
                return Err(global_this
                    .err(
                        bun_jsc::ErrorCode::CRYPTO_INVALID_DIGEST,
                        format_args!("Invalid digest: {}", bstr::BStr::new(name)),
                    )
                    .throw());
                // `slice` drops here (was `defer slice.deinit()`).
            }
            return Err(bun_jsc::JsError::Thrown);
        };

        let mut out = PBKDF2 {
            password: StringOrBuffer::default(),
            salt: StringOrBuffer::default(),
            iteration_count: u32::try_from(iteration_count).expect("int cast"),
            length: keylen,
            algorithm,
        };
        // Zig: `defer { if (globalThis.hasException()) { if (is_async) out.deinitAndUnprotect() else out.deinit(); } }`
        // Non-async path: `StringOrBuffer` fields drop with `out` on early return — no explicit call needed.
        let mut guard = scopeguard::guard(&mut out, |out| {
            if global_this.has_exception() && is_async {
                bun_jsc::Unprotect::unprotect(out);
            }
        });

        let allow_string_object = true;
        guard.salt = match StringOrBuffer::from_js_maybe_async(
            global_this,
            arg1,
            is_async,
            allow_string_object,
        )? {
            Some(v) => v,
            None => {
                return Err(global_this.throw_invalid_argument_type_value(
                    b"salt",
                    b"string or buffer",
                    arg1,
                ));
            }
        };

        if guard.salt.slice().len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("salt is too long")));
        }

        guard.password = match StringOrBuffer::from_js_maybe_async(
            global_this,
            arg0,
            is_async,
            allow_string_object,
        )? {
            Some(v) => v,
            None => {
                return Err(global_this.throw_invalid_argument_type_value(
                    b"password",
                    b"string or buffer",
                    arg0,
                ));
            }
        };

        if guard.password.slice().len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("password is too long")));
        }

        if is_async {
            if !arg5.is_function() {
                return Err(global_this.throw_invalid_argument_type_value(
                    b"callback",
                    b"function",
                    arg5,
                ));
            }
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(out)
    }
}

impl bun_jsc::Unprotect for PBKDF2 {
    /// Zig `PBKDF2.deinitAndUnprotect`, JS-side half — owned slices are
    /// released by `Drop for StringOrBuffer`.
    #[inline]
    fn unprotect(&mut self) {
        self.password.unprotect();
        self.salt.unprotect();
    }
}

pub struct Pbkdf2Ctx {
    /// Wrapped in [`bun_jsc::ThreadSafe`] so the paired `unprotect()` runs on
    /// drop — `Job` is only constructed on the async path
    /// (`from_js(.., is_async=true)` already protected the buffers).
    pub pbkdf2: bun_jsc::ThreadSafe<PBKDF2>,
    pub output: Vec<u8>,
    pub err: Option<u32>,
    pub promise: JSPromiseStrong,
}

impl AnyTaskJobCtx for Pbkdf2Ctx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let len = usize::try_from(self.pbkdf2.length).expect("int cast");
        // Zig: `bun.default_allocator.alloc(u8, len) catch { ... }`
        // Rust `Vec` allocation aborts on OOM; mirror the error path with try_reserve.
        let mut buf = Vec::new();
        if buf.try_reserve_exact(len).is_err() {
            self.err = Some(EVP_R_MEMORY_LIMIT_EXCEEDED);
            return;
        }
        buf.resize(len, 0);
        self.output = buf;

        if !self.pbkdf2.run(&mut self.output) {
            self.err = Some(boringssl::ERR_get_error());
            boringssl::ERR_clear_error();

            self.output = Vec::new();
        }
    }

    fn then(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        let mut promise = self.promise.swap();
        if let Some(err) = self.err {
            promise
                .reject_with_async_stack(global_this, Ok(create_crypto_error(global_this, err)))?;
            return Ok(());
        }

        let output_slice = core::mem::take(&mut self.output);
        debug_assert!(output_slice.len() == usize::try_from(self.pbkdf2.length).expect("int cast"));
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator → mimalloc free).
        let buffer_value = JSValue::create_buffer(global_this, output_slice.leak());
        // Zig: `this.output = &[_]u8{};` — already done via `mem::take` above.
        promise.resolve(global_this, buffer_value)?;
        Ok(())
    }
}

pub type Job = AnyTaskJob<Pbkdf2Ctx>;

/// Zig `Job.create` — heap-allocate, init the promise, ref the loop, and hand
/// to the work pool. Returns the live job so the caller can read
/// `(*job).ctx.promise.value()` before the JS-thread completion fires.
/// Free fn (not `impl Job`) because `AnyTaskJob<_>` is a foreign type.
pub fn create_job(global_this: &JSGlobalObject, data: PBKDF2) -> *mut Job {
    let job = AnyTaskJob::create(
        global_this,
        Pbkdf2Ctx {
            // `from_js(.., is_async=true)` already protected — adopt, don't re-protect.
            pbkdf2: bun_jsc::ThreadSafe::adopt(data),
            output: Vec::new(),
            err: None,
            promise: JSPromiseStrong::init(global_this),
        },
    )
    .expect("Pbkdf2Ctx::init is infallible");
    // SAFETY: `job` is a freshly-created live pointer.
    unsafe { AnyTaskJob::schedule(job) };
    job
}

/// For usage in Rust
pub fn pbkdf2<'a>(
    output: &'a mut [u8],
    password: &[u8],
    salt: &[u8],
    iteration_count: u32,
    algorithm: Algorithm,
) -> Option<&'a [u8]> {
    // Return type borrows `output`; Zig returned `?[]const u8` aliasing the input.
    let mut pbk = PBKDF2 {
        algorithm,
        password: StringOrBuffer::EncodedSlice(ZigStringSlice::from_utf8_never_free(password)),
        salt: StringOrBuffer::EncodedSlice(ZigStringSlice::from_utf8_never_free(salt)),
        iteration_count,
        length: i32::try_from(output.len()).expect("int cast"),
    };

    if !pbk.run(output) {
        return None;
    }

    Some(output)
}

// ported from: src/runtime/crypto/PBKDF2.zig
