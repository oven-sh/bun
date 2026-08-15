use core::ffi::c_uint;

use bun_boringssl_sys as boringssl;
use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, Job, JobContext, JsResult,
    JsThread,
};

use crate::node::StringOrBuffer;

use crate::crypto::evp::{self, Algorithm};

pub(crate) struct PBKDF2 {
    pub password: StringOrBuffer,
    pub salt: StringOrBuffer,
    pub iteration_count: u32,
    pub length: usize,
    algorithm: Algorithm,
}

impl PBKDF2 {
    pub(crate) fn run(&mut self, output: &mut [u8]) -> bool {
        let password = self.password.slice();
        let salt = self.salt.slice();
        let algorithm = self.algorithm;
        let iteration_count = self.iteration_count;
        let length = self.length;

        output.fill(0);
        debug_assert!(self.length <= output.len());
        // Node.js (OpenSSL) rejects a zero-length derivation; BoringSSL accepts it.
        if length == 0 {
            return false;
        }
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
                length,
                output.as_mut_ptr(),
            )
        };

        if rc <= 0 {
            return false;
        }

        true
    }

    // `password`/`salt` are `StringOrBuffer` whose `Drop` releases the
    // slice/WTF ref, so no explicit cleanup hook is needed —
    // dropping `PBKDF2` is sufficient for the sync path. The async path holds
    // `ThreadSafe<PBKDF2>`, whose `Drop` additionally unprotects JS-rooted
    // buffers via the `Unprotect` impl below.

    pub(crate) fn from_js(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        is_async: bool,
    ) -> JsResult<PBKDF2> {
        let [arg0, arg1, arg2, arg3, arg4, arg5] = call_frame.arguments_as_array::<6>();

        if !arg3.is_number() {
            return Err(global_this.throw_invalid_argument_type_value(b"keylen", b"number", arg3));
        }

        let keylen_num = arg3.as_number();

        if !arg3.is_integer() {
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

        // 0..=i32::MAX was checked above.
        let keylen = keylen_num as usize;

        if !arg2.is_number() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"iterations",
                b"number",
                arg2,
            ));
        }

        let iterations_num = arg2.as_number();

        if !arg2.is_integer() {
            return Err(global_this.throw_range_error(
                iterations_num,
                bun_jsc::RangeErrorOptions {
                    field_name: b"iterations",
                    msg: b"an integer",
                    ..Default::default()
                },
            ));
        }

        if iterations_num < 1.0 || iterations_num > i32::MAX as f64 {
            return Err(global_this.throw_range_error(
                iterations_num,
                bun_jsc::RangeErrorOptions {
                    field_name: b"iterations",
                    min: 1,
                    max: i32::MAX as i64,
                    ..Default::default()
                },
            ));
        }

        let iteration_count: i64 = iterations_num as i64;

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
                        other if other.md().is_none() => break 'invalid,
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
                // `slice` drops here.
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

        if !is_async {
            if let StringOrBuffer::Buffer(buffer) = &mut guard.salt {
                buffer.buffer = ArrayBuffer::from_typed_array(global_this, buffer.buffer.value);
            }
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
    /// JS-side half of cleanup — owned slices are released by
    /// `Drop for StringOrBuffer`.
    #[inline]
    fn unprotect(&mut self) {
        self.password.unprotect();
        self.salt.unprotect();
    }
}

/// `crypto.pbkdf2` off the JS thread.
pub(crate) struct Pbkdf2Job {
    /// `from_js(.., is_async=true)` protected the input buffers; the
    /// [`bun_jsc::ThreadSafe`] releases that with the job.
    pub pbkdf2: bun_jsc::ThreadSafe<PBKDF2>,
    pub output: Vec<u8>,
    pub err: bool,
}

impl JobContext for Pbkdf2Job {
    type OffThread = Self;
    type Js = JSPromiseStrong;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        let len = this.pbkdf2.length;
        // `Vec` allocation aborts on OOM; use try_reserve to surface an error instead.
        let mut buf = Vec::new();
        if buf.try_reserve_exact(len).is_err() {
            this.err = true;
            return Some(done);
        }
        buf.resize(len, 0);
        this.output = buf;

        if !this.pbkdf2.run(&mut this.output) {
            this.err = true;
            boringssl::ERR_clear_error();
            this.output = Vec::new();
        }
        Some(done)
    }

    fn then(mut this: Self, mut promise: JSPromiseStrong, cx: &JsThread<'_>) -> JsResult<()> {
        let global_this = cx.global();
        let promise = promise.swap();
        if this.err {
            let err = global_this.create_error_instance(format_args!("PBKDF2 derivation failed"));
            promise.reject_with_async_stack(global_this, Ok(err))?;
            return Ok(());
        }

        let output_slice = core::mem::take(&mut this.output);
        debug_assert!(output_slice.len() == this.pbkdf2.length);
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator → mimalloc free).
        let buffer_value = JSValue::create_buffer(global_this, output_slice.leak());
        promise.settle(global_this, buffer_value)?;
        Ok(())
    }
}

/// Schedule the derivation on the work pool; returns its promise.
pub(crate) fn create_job(global_this: &JSGlobalObject, data: PBKDF2) -> JSValue {
    let cx = global_this.js_thread();
    let promise = JSPromiseStrong::init(global_this);
    let value = promise.value();
    Job::<Pbkdf2Job>::schedule(
        &cx,
        Pbkdf2Job {
            // `from_js(.., is_async=true)` already protected — adopt, don't re-protect.
            pbkdf2: bun_jsc::ThreadSafe::adopt(data),
            output: Vec::new(),
            err: false,
        },
        promise,
    );
    value
}
