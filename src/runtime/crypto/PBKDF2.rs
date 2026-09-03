use core::ffi::c_uint;

use bun_boringssl_sys as boringssl;
use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSValue, Job, JobContext, JsResult, JsThread, Strong,
};

use crate::node::{Flavor, StringObjects, StringOrBuffer, ThreadIsolated, ThreadIsolatedArg};

use crate::crypto::evp::{self, Algorithm};

pub(crate) struct PBKDF2 {
    pub password: StringOrBuffer<'static>,
    pub salt: StringOrBuffer<'static>,
    pub iteration_count: u32,
    pub length: usize,
    algorithm: Algorithm,
}
// SAFETY: `password` and `salt` are `StringOrBuffer`s (see its impl); the rest is plain data.
unsafe impl ThreadIsolatedArg for PBKDF2 {}

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

    /// The second element is the validated callback on the `Async` flavor and
    /// `JSValue::UNDEFINED` on `Sync` (as `Scrypt::from_js`).
    pub(crate) fn from_js(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        flavor: Flavor,
    ) -> JsResult<(PBKDF2, JSValue)> {
        let [arg0, arg1, arg2, arg3, mut arg4, mut arg5] = call_frame.arguments_as_array::<6>();
        // pbkdf2(password, salt, iterations, keylen, callback): digest omitted.
        if flavor == Flavor::Async && arg4.is_function() {
            arg5 = arg4;
            arg4 = JSValue::UNDEFINED;
        }

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
                let slice = arg4.to_utf8(global_this)?;
                match evp::lookup_ignore_case(slice.slice()) {
                    Some(alg) => match alg {
                        Algorithm::Shake128 | Algorithm::Shake256 => break 'invalid,
                        other if other.md().is_none() => break 'invalid,
                        other => break 'brk other,
                    },
                    None => break 'invalid,
                }
            }

            let slice = arg4.to_utf8(global_this)?;
            let name = slice.slice();
            return Err(global_this
                .err(
                    bun_jsc::ErrorCode::CRYPTO_INVALID_DIGEST,
                    format_args!("Invalid digest: {}", bstr::BStr::new(name)),
                )
                .throw());
        };

        let mut out = PBKDF2 {
            password: StringOrBuffer::default(),
            salt: StringOrBuffer::default(),
            iteration_count: u32::try_from(iteration_count).expect("int cast"),
            length: keylen,
            algorithm,
        };
        out.salt = match StringOrBuffer::from_js_maybe_async(
            global_this,
            arg1,
            flavor,
            StringObjects::Allow,
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

        if out.salt.slice().len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("salt is too long")));
        }

        out.password = match StringOrBuffer::from_js_maybe_async(
            global_this,
            arg0,
            flavor,
            StringObjects::Allow,
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

        if out.password.slice().len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("password is too long")));
        }

        if flavor == Flavor::Sync {
            if let StringOrBuffer::Buffer(buffer) = &mut out.salt {
                buffer.buffer = ArrayBuffer::from_typed_array(global_this, buffer.buffer.value);
            }
        }

        let callback = match flavor {
            Flavor::Async => {
                if !arg5.is_function() {
                    return Err(global_this.throw_invalid_argument_type_value(
                        b"callback",
                        b"function",
                        arg5,
                    ));
                }
                arg5
            }
            Flavor::Sync => JSValue::UNDEFINED,
        };

        Ok((out, callback))
    }

    /// [`from_js`](Self::from_js) for the work-pool job, with its validated callback.
    pub(crate) fn from_js_async(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<(ThreadIsolated<PBKDF2>, JSValue)> {
        let (data, callback) = Self::from_js(global_this, call_frame, Flavor::Async)?;
        // SAFETY: parsed with `Flavor::Async`.
        Ok((unsafe { ThreadIsolated::new(data) }, callback))
    }
}

/// `crypto.pbkdf2` off the JS thread.
pub(crate) struct Pbkdf2Job {
    pub pbkdf2: ThreadIsolated<PBKDF2>,
    pub output: Vec<u8>,
    pub err: bool,
}

/// JS-thread state for [`Pbkdf2Job`]: the user callback, invoked as `(err)` or `(null, buffer)`.
#[derive(bun_jsc::JsAffine)]
pub(crate) struct Pbkdf2Js {
    pub callback: Strong,
}

impl JobContext for Pbkdf2Job {
    type OffThread = Self;
    type Js = Pbkdf2Js;

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

    fn then(mut this: Self, js: Pbkdf2Js, cx: &JsThread<'_>) -> JsResult<()> {
        let global_this = cx.global();
        let event_loop = global_this.bun_vm().event_loop_mut();
        let callback = js.callback.get();
        if this.err {
            let err = global_this.create_error_instance(format_args!("PBKDF2 derivation failed"));
            event_loop.run_callback(callback, global_this, JSValue::UNDEFINED, &[err]);
            return Ok(());
        }

        let output_slice = core::mem::take(&mut this.output);
        debug_assert!(output_slice.len() == this.pbkdf2.length);
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator → mimalloc free).
        match JSValue::create_buffer(global_this, output_slice.leak()) {
            Ok(buffer_value) => event_loop.run_callback(
                callback,
                global_this,
                JSValue::UNDEFINED,
                &[JSValue::NULL, buffer_value],
            ),
            // The result could not be built (allocation failure): that is this
            // derivation's error.
            Err(err) => event_loop.run_callback(
                callback,
                global_this,
                JSValue::UNDEFINED,
                &[global_this.take_error(err)],
            ),
        }
        Ok(())
    }
}

/// Schedule the derivation on the work pool; `callback` was validated by `from_js_async`.
pub(crate) fn create_job(
    global_this: &JSGlobalObject,
    data: ThreadIsolated<PBKDF2>,
    callback: JSValue,
) {
    let cx = global_this.js_thread();
    Job::<Pbkdf2Job>::schedule(
        &cx,
        Pbkdf2Job {
            pbkdf2: data,
            output: Vec::new(),
            err: false,
        },
        Pbkdf2Js {
            callback: Strong::create(
                callback.with_async_context_if_needed(global_this),
                global_this,
            ),
        },
    );
}
