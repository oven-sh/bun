use core::ffi::{c_uint, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_aio::KeepAlive;
use bun_aio::posix_event_loop::{get_vm_ctx, AllocatorType};
use bun_boringssl_sys as boringssl;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, WorkPool, WorkPoolTask,
    ZigStringSlice,
};
// `bun_jsc::{VirtualMachine, AnyTask, ConcurrentTask}` are *modules*; import the structs.
use bun_jsc::AnyTask::AnyTask;
use bun_jsc::ConcurrentTask::ConcurrentTask;
use bun_jsc::virtual_machine::VirtualMachine;

use crate::node::StringOrBuffer;

use crate::crypto::create_crypto_error;
use crate::crypto::evp::{Algorithm, AlgorithmExt as _};

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
                password.len(),
                salt.as_ptr(),
                salt.len(),
                iteration_count as c_uint,
                // `Algorithm::md()` returns `*const bun_sha_hmac::sha::ffi::EVP_MD`; cast to the
                // boringssl-sys opaque — both name the same C `struct env_md_st`.
                algorithm.md().unwrap().cast::<boringssl::EVP_MD>(),
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
            return Err(global_this.throw_invalid_argument_type_value(b"iterations", b"number", arg2));
        }

        let iteration_count = arg2.coerce_to_int64(global_this)?;

        if !global_this.has_exception() && (iteration_count < 1 || iteration_count > i32::MAX as i64)
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
                return Err(global_this.throw_invalid_argument_type_value(b"digest", b"string", arg4));
            }

            'invalid: {
                match bun_jsc::comptime_string_map_jsc::from_js_case_insensitive(
                    Algorithm::map(),
                    global_this,
                    arg4,
                )? {
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
                return Err(
                    global_this.throw_invalid_argument_type_value(b"callback", b"function", arg5)
                );
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

pub struct Job {
    /// Wrapped in [`bun_jsc::ThreadSafe`] so the paired `unprotect()` runs on
    /// drop — `Job` is only constructed on the async path
    /// (`from_js(.., is_async=true)` already protected the buffers).
    pub pbkdf2: bun_jsc::ThreadSafe<PBKDF2>,
    pub output: Vec<u8>,
    pub task: WorkPoolTask,
    pub promise: JSPromiseStrong,
    // Zig: `vm: *jsc.VirtualMachine` — raw mut pointer; `enqueue_task_concurrent`
    // requires `&mut self`, so a `&'static` borrow would be too restrictive.
    pub vm: *mut VirtualMachine,
    pub err: Option<u32>,
    pub any_task: AnyTask,
    pub poll: KeepAlive,
}

impl Job {
    pub fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to the `task` field of a heap-allocated `Job` created in `create()`.
        let job: &mut Job = unsafe {
            &mut *task.cast::<u8>()
                .sub(offset_of!(Job, task))
                .cast::<Job>()
        };
        let job_ptr: *mut Job = job;
        // PORT NOTE: reshaped for borrowck — Zig used `defer vm.enqueueTaskConcurrent(...)`;
        // raw-ptr access in the defer avoids holding a `&mut Job` across the body below.
        scopeguard::defer! {
            // SAFETY: `job_ptr` points to the heap-allocated Job (alive until run_from_js drops it);
            // `vm` is the per-thread VirtualMachine, valid for the program lifetime.
            unsafe {
                (*(*job_ptr).vm)
                    .enqueue_task_concurrent(ConcurrentTask::create((*job_ptr).any_task.task()));
            }
        }

        let len = usize::try_from(job.pbkdf2.length).expect("int cast");
        // Zig: `bun.default_allocator.alloc(u8, len) catch { ... }`
        // Rust `Vec` allocation aborts on OOM; mirror the error path with try_reserve.
        let mut buf = Vec::new();
        if buf.try_reserve_exact(len).is_err() {
            job.err = Some(EVP_R_MEMORY_LIMIT_EXCEEDED);
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
        // PORT NOTE: Zig was `bun.JSTerminated!void`; widened to JsResult per crate convention.
        // SAFETY: `this` was produced by `heap::alloc` in `create()` and is uniquely owned here;
        // dropping the Box at any return point runs `impl Drop for Job` (Zig: `defer this.deinit()`).
        let mut this = unsafe { bun_core::heap::take(this) };

        // SAFETY: `vm` is the live per-thread VirtualMachine pointer captured in `create()`.
        let vm = unsafe { &*this.vm };
        if vm.is_shutting_down() {
            return Ok(());
        }

        let global_this = vm.global();
        let mut promise = this.promise.swap();
        if let Some(err) = this.err {
            promise
                .reject_with_async_stack(global_this, Ok(create_crypto_error(global_this, err)))?;
            return Ok(());
        }

        let output_slice = core::mem::take(&mut this.output);
        debug_assert!(output_slice.len() == usize::try_from(this.pbkdf2.length).expect("int cast"));
        // Ownership transfers to JSC (freed via MarkedArrayBuffer_deallocator → mimalloc free).
        let buffer_value = JSValue::create_buffer(global_this, output_slice.leak());
        // Zig: `this.output = &[_]u8{};` — already done via `mem::take` above.
        promise.resolve(global_this, buffer_value)?;
        Ok(())
    }

    pub fn create(
        vm: *mut VirtualMachine,
        global_this: &JSGlobalObject,
        // Zig: `data: *const PBKDF2` then `pbkdf2 = data.*` (struct copy). `PBKDF2` is not
        // `Copy` in Rust (owns `StringOrBuffer`s), so take by value — the sole caller
        // (`node_crypto_binding::pbkdf2`) owns it and hands it over.
        data: PBKDF2,
    ) -> *mut Job {
        let job = bun_core::heap::into_raw(Box::new(Job {
            // `from_js(.., is_async=true)` already protected — adopt, don't re-protect.
            pbkdf2: bun_jsc::ThreadSafe::adopt(data),
            output: Vec::new(),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Job::run_task,
            },
            promise: JSPromiseStrong::default(),
            vm,
            err: None,
            // Zig used `undefined` then assigned below; AnyTask::default() is a safe placeholder.
            any_task: AnyTask::default(),
            poll: KeepAlive::default(),
        }));

        // SAFETY: `job` was just allocated and is uniquely owned here.
        let job_ref = unsafe { &mut *job };
        job_ref.promise = JSPromiseStrong::init(global_this);
        // Zig: `AnyTask.New(@This(), &runFromJS).init(job)`. Rust's `AnyTask::New<T>`
        // cannot carry a comptime callback (see event_loop/AnyTask.rs), so build the
        // erased AnyTask directly with a non-capturing shim that adapts the JsResult
        // error type (event_loop's `JsResult` erases jsc::Error to `*mut ()`).
        job_ref.any_task = AnyTask {
            ctx: NonNull::new(job.cast::<c_void>()),
            callback: |ctx: *mut c_void| {
                Job::run_from_js(ctx.cast::<Job>()).map_err(Into::into)
            },
        };
        // PORT NOTE: KeepAlive::ref_ now takes an aio EventLoopCtx; the JS-loop ctx is fetched
        // via the global hook (registered by crate::init) — same pattern as s3/simple_request.rs.
        job_ref.poll.ref_(get_vm_ctx(AllocatorType::Js));
        WorkPool::schedule(&raw mut job_ref.task);

        job
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        self.poll.unref(get_vm_ctx(AllocatorType::Js));
        // `pbkdf2: ThreadSafe<PBKDF2>` unprotects + drops via field drop.
        // `promise` (JSPromiseStrong) and `output` (Vec) drop via their own `Drop` impls.
    }
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
