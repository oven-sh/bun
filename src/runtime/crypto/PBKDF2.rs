use core::ffi::c_uint;

use bun_boringssl_sys as boringssl;
use bun_jsc::{JSGlobalObject, JSValue, Job, JobContext, JsResult, JsThread, Strong};

use crate::node::{StringOrBuffer, ThreadIsolated};

use crate::crypto::evp::{self, Algorithm};

pub(crate) struct PBKDF2 {
    iteration_count: u32,
    pub length: usize,
    algorithm: Algorithm,
}

pub(crate) fn algorithm_from_digest(
    global_this: &JSGlobalObject,
    digest: &[u8],
) -> JsResult<Algorithm> {
    match evp::lookup_ignore_case(digest) {
        Some(Algorithm::Shake128 | Algorithm::Shake256) | None => {}
        Some(algorithm) if algorithm.md().is_none() => {}
        Some(algorithm) => return Ok(algorithm),
    }
    Err(global_this
        .err(
            bun_jsc::ErrorCode::CRYPTO_INVALID_DIGEST,
            format_args!("Invalid digest: {}", bstr::BStr::new(digest)),
        )
        .throw())
}

impl PBKDF2 {
    pub(crate) fn new(
        global_this: &JSGlobalObject,
        password: &[u8],
        salt: &[u8],
        iteration_count: u32,
        length: usize,
        algorithm: Algorithm,
    ) -> JsResult<Self> {
        if salt.len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("salt is too long")));
        }
        if password.len() > i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("password is too long")));
        }
        Ok(PBKDF2 {
            iteration_count,
            length,
            algorithm,
        })
    }

    pub(crate) fn run(&self, password: &[u8], salt: &[u8], output: &mut [u8]) -> bool {
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

        rc > 0
    }
}

/// `crypto.pbkdf2` off the JS thread.
pub(crate) struct Pbkdf2Job {
    pub pbkdf2: PBKDF2,
    pub password: ThreadIsolated<StringOrBuffer<'static>>,
    pub salt: ThreadIsolated<StringOrBuffer<'static>>,
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

        if !this
            .pbkdf2
            .run(this.password.slice(), this.salt.slice(), &mut this.output)
        {
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
            event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global_this,
                JSValue::UNDEFINED,
                &[err],
            );
            return Ok(());
        }

        let output_slice = core::mem::take(&mut this.output);
        debug_assert!(output_slice.len() == this.pbkdf2.length);
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator → mimalloc free).
        match JSValue::create_buffer(global_this, output_slice.leak()) {
            Ok(buffer_value) => event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global_this,
                JSValue::UNDEFINED,
                &[JSValue::NULL, buffer_value],
            ),
            // The result could not be built (allocation failure): that is this
            // derivation's error.
            Err(err) => event_loop.run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global_this,
                JSValue::UNDEFINED,
                &[global_this.take_error(err)],
            ),
        }
        Ok(())
    }
}

/// Schedule the derivation on the work pool.
pub(crate) fn create_job(
    cx: &bun_jsc::JsThread<'_>,
    data: PBKDF2,
    password: ThreadIsolated<StringOrBuffer<'static>>,
    salt: ThreadIsolated<StringOrBuffer<'static>>,
    callback: JSValue,
) {
    Job::<Pbkdf2Job>::schedule(
        cx,
        Pbkdf2Job {
            pbkdf2: data,
            password,
            salt,
            output: Vec::new(),
            err: false,
        },
        Pbkdf2Js {
            callback: Strong::create(
                callback.with_async_context_if_needed(cx.global()),
                cx.global(),
            ),
        },
    );
}
