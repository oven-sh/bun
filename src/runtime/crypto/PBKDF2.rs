use core::ffi::c_int;
use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_boringssl_sys as boringssl;
use bun_jsc::node::StringOrBuffer;
use bun_jsc::{
    AnyTask, CallFrame, ConcurrentTask, JSGlobalObject, JSValue, JsPromiseStrong, JsResult,
    VirtualMachine, ZigString,
};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::crypto::create_crypto_error;
use crate::crypto::evp::{self, Algorithm};

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
            password: StringOrBuffer::empty(),
            salt: StringOrBuffer::empty(),
            iteration_count: 1,
            length: 0,
            // TODO(port): Zig had no default for `algorithm`; callers always set it.
            algorithm: Algorithm::default(),
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
        debug_assert!(self.length <= i32::try_from(output.len()).unwrap());
        // SAFETY: FFI call into BoringSSL; clears the thread-local error queue.
        unsafe { boringssl::ERR_clear_error() };
        // SAFETY: password/salt point to valid slices for the given lengths;
        // algorithm.md() returns a non-null EVP_MD; output is writable for `length` bytes.
        let rc = unsafe {
            boringssl::PKCS5_PBKDF2_HMAC(
                if !password.is_empty() {
                    password.as_ptr()
                } else {
                    core::ptr::null()
                },
                c_int::try_from(password.len()).unwrap(),
                salt.as_ptr(),
                c_int::try_from(salt.len()).unwrap(),
                c_int::try_from(iteration_count).unwrap(),
                algorithm.md().unwrap(),
                c_int::try_from(length).unwrap(),
                output.as_mut_ptr(),
            )
        };

        if rc <= 0 {
            return false;
        }

        true
    }

    // Plain `deinit` (free owned StringOrBuffer fields) is handled by `Drop` on `StringOrBuffer`.
    // TODO(port): `deinit_and_unprotect` is kept as an explicit method because async callers must
    // additionally unprotect JS-rooted buffers; revisit whether this should consume `self` in Phase B.
    pub fn deinit_and_unprotect(&mut self) {
        self.password.deinit_and_unprotect();
        self.salt.deinit_and_unprotect();
    }

    pub fn from_js(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        is_async: bool,
    ) -> JsResult<PBKDF2> {
        let [arg0, arg1, arg2, arg3, arg4, arg5] = call_frame.arguments_as_array::<6>();

        if !arg3.is_number() {
            return global_this.throw_invalid_argument_type_value("keylen", "number", arg3);
        }

        let keylen_num = arg3.as_number();

        if keylen_num.is_infinite() || keylen_num.is_nan() {
            return global_this.throw_range_error(
                keylen_num,
                bun_jsc::RangeErrorOptions {
                    field_name: "keylen",
                    msg: Some("an integer"),
                    ..Default::default()
                },
            );
        }

        if keylen_num < 0.0 || keylen_num > i32::MAX as f64 {
            return global_this.throw_range_error(
                keylen_num,
                bun_jsc::RangeErrorOptions {
                    field_name: "keylen",
                    min: Some(0),
                    max: Some(i32::MAX as i64),
                    ..Default::default()
                },
            );
        }

        let keylen: i32 = keylen_num as i32;

        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        if !arg2.is_any_int() {
            return global_this.throw_invalid_argument_type_value("iterations", "number", arg2);
        }

        let iteration_count = arg2.coerce::<i64>(global_this)?;

        if !global_this.has_exception() && (iteration_count < 1 || iteration_count > i32::MAX as i64)
        {
            return global_this.throw_range_error(
                iteration_count,
                bun_jsc::RangeErrorOptions {
                    field_name: "iterations",
                    min: Some(1),
                    max: Some(i32::MAX as i64 + 1),
                    ..Default::default()
                },
            );
        }

        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        let algorithm = 'brk: {
            if !arg4.is_string() {
                return global_this.throw_invalid_argument_type_value("digest", "string", arg4);
            }

            'invalid: {
                match evp::Algorithm::map().from_js_case_insensitive(global_this, arg4)? {
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
                return global_this
                    .err(bun_jsc::ErrorCode::CRYPTO_INVALID_DIGEST)
                    .fmt(format_args!("Invalid digest: {}", bstr::BStr::new(name)))
                    .throw();
                // `slice` drops here (was `defer slice.deinit()`).
            }
            return Err(bun_jsc::JsError::Thrown);
        };

        let mut out = PBKDF2 {
            password: StringOrBuffer::empty(),
            salt: StringOrBuffer::empty(),
            iteration_count: u32::try_from(iteration_count).unwrap(),
            length: keylen,
            algorithm,
        };
        // Zig: `defer { if (globalThis.hasException()) { if (is_async) out.deinitAndUnprotect() else out.deinit(); } }`
        // Non-async path: `StringOrBuffer` fields drop with `out` on early return — no explicit call needed.
        let mut guard = scopeguard::guard(&mut out, |out| {
            if global_this.has_exception() && is_async {
                out.deinit_and_unprotect();
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
                return global_this.throw_invalid_argument_type_value(
                    "salt",
                    "string or buffer",
                    arg1,
                );
            }
        };

        if guard.salt.slice().len() > i32::MAX as usize {
            return global_this.throw_invalid_arguments("salt is too long", ());
        }

        guard.password = match StringOrBuffer::from_js_maybe_async(
            global_this,
            arg0,
            is_async,
            allow_string_object,
        )? {
            Some(v) => v,
            None => {
                return global_this.throw_invalid_argument_type_value(
                    "password",
                    "string or buffer",
                    arg0,
                );
            }
        };

        if guard.password.slice().len() > i32::MAX as usize {
            return global_this.throw_invalid_arguments("password is too long", ());
        }

        if is_async {
            if !arg5.is_function() {
                return global_this.throw_invalid_argument_type_value("callback", "function", arg5);
            }
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(out)
    }
}

pub struct Job {
    pub pbkdf2: PBKDF2,
    pub output: Vec<u8>,
    pub task: WorkPoolTask,
    pub promise: JsPromiseStrong,
    pub vm: &'static VirtualMachine,
    pub err: Option<u32>,
    pub any_task: AnyTask,
    pub poll: KeepAlive,
}

impl Job {
    pub fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to the `task` field of a heap-allocated `Job` created in `create()`.
        let job: &mut Job = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(Job, task))
                .cast::<Job>()
        };
        let _enqueue = scopeguard::guard((), |_| {
            job.vm
                .enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()));
        });
        // PORT NOTE: reshaped for borrowck — scopeguard above borrows `job`; in Phase B this may
        // need raw-pointer access since `enqueue_task_concurrent` runs after the body mutates `job`.
        // TODO(port): verify borrow ordering once WorkPoolTask/AnyTask shapes are finalized.

        let len = usize::try_from(job.pbkdf2.length).unwrap();
        // Zig: `bun.default_allocator.alloc(u8, len) catch { ... }`
        // Rust `Vec` allocation aborts on OOM; mirror the error path with try_reserve.
        let mut buf = Vec::new();
        if buf.try_reserve_exact(len).is_err() {
            job.err = Some(boringssl::EVP_R_MEMORY_LIMIT_EXCEEDED);
            return;
        }
        buf.resize(len, 0);
        job.output = buf;

        if !job.pbkdf2.run(&mut job.output) {
            // SAFETY: FFI call into BoringSSL thread-local error queue.
            job.err = Some(unsafe { boringssl::ERR_get_error() });
            // SAFETY: FFI call into BoringSSL; clears the thread-local error queue.
            unsafe { boringssl::ERR_clear_error() };

            job.output = Vec::new();
        }
    }

    pub fn run_from_js(this: *mut Job) -> JsResult<()> {
        // TODO(port): narrow error set — Zig was `bun.JSTerminated!void`.
        // SAFETY: `this` was produced by `Box::into_raw` in `create()` and is uniquely owned here;
        // dropping the Box at any return point runs `impl Drop for Job` (Zig: `defer this.deinit()`).
        let mut this = unsafe { Box::from_raw(this) };

        if this.vm.is_shutting_down() {
            return Ok(());
        }

        let global_this = this.vm.global();
        let promise = this.promise.swap();
        if let Some(err) = this.err {
            promise.reject_with_async_stack(global_this, create_crypto_error(global_this, err))?;
            return Ok(());
        }

        let output_slice = core::mem::take(&mut this.output);
        debug_assert!(output_slice.len() == usize::try_from(this.pbkdf2.length).unwrap());
        let buffer_value = JSValue::create_buffer(global_this, output_slice);
        // Zig: `this.output = &[_]u8{};` — already done via `mem::take` above.
        promise.resolve(global_this, buffer_value)?;
        Ok(())
    }

    pub fn create(
        vm: &'static VirtualMachine,
        global_this: &JSGlobalObject,
        data: &PBKDF2,
    ) -> *mut Job {
        let job = Box::into_raw(Box::new(Job {
            pbkdf2: *data,
            // TODO(port): `PBKDF2` may not be `Copy` (StringOrBuffer fields); Zig moved by value.
            output: Vec::new(),
            task: WorkPoolTask {
                callback: Job::run_task,
            },
            promise: JsPromiseStrong::default(),
            vm,
            err: None,
            // TODO(port): Zig used `undefined` then assigned below; need MaybeUninit or two-phase init.
            any_task: AnyTask::default(),
            poll: KeepAlive::default(),
        }));

        // SAFETY: `job` was just allocated and is uniquely owned here.
        let job_ref = unsafe { &mut *job };
        job_ref.promise = JsPromiseStrong::init(global_this);
        job_ref.any_task = AnyTask::new::<Job>(Job::run_from_js).init(job);
        job_ref.poll.ref_(vm);
        WorkPool::schedule(&mut job_ref.task);

        job
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        self.poll.unref(self.vm);
        self.pbkdf2.deinit_and_unprotect();
        // `promise` (JsPromiseStrong) and `output` (Vec) drop via their own `Drop` impls.
    }
}

/// For usage in Rust
pub fn pbkdf2(
    output: &mut [u8],
    password: &[u8],
    salt: &[u8],
    iteration_count: u32,
    algorithm: Algorithm,
) -> Option<&[u8]> {
    // TODO(port): return type borrows `output`; Zig returned `?[]const u8` aliasing the input.
    let mut pbk = PBKDF2 {
        algorithm,
        password: StringOrBuffer::EncodedSlice(ZigString::Slice::from_utf8_never_free(password)),
        salt: StringOrBuffer::EncodedSlice(ZigString::Slice::from_utf8_never_free(salt)),
        iteration_count,
        length: i32::try_from(output.len()).unwrap(),
    };

    if !pbk.run(output) {
        return None;
    }

    Some(output)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/PBKDF2.zig (262 lines)
//   confidence: medium
//   todos:      7
//   notes:      Job uses intrusive @fieldParentPtr; run_task scopeguard borrow of `job` will need raw-ptr reshaping in Phase B. RangeErrorOptions/ErrorCode/throw builder shapes are guesses.
// ──────────────────────────────────────────────────────────────────────────
