use core::ffi::{c_char, c_void};
use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_collections::CaseInsensitiveAsciiStringArrayHashMap;
use bun_core::UUID;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, ConcurrentTask, JSFunction, JSGlobalObject, JSValue,
    JsResult, Strong, VirtualMachine,
};
use bun_str::String as BunString;
use bun_threading::{WorkPool, WorkPoolTask};

use super::util::validators;
use crate::api::bun::Crypto;
use crate::node::StringOrBuffer;

type PBKDF2 = <Crypto as crate::api::bun::CryptoTypes>::EVP::PBKDF2;
// TODO(port): the line above is a placeholder for `Crypto.EVP.PBKDF2` — Phase B should
// resolve to the actual path (likely `crate::api::bun::crypto::evp::PBKDF2`).

// ───────────────────────────────────────────────────────────────────────────
// ExternCryptoJob — Zig `fn ExternCryptoJob(comptime name: []const u8) type`.
// This does token-pasting to form C symbol names (`Bun__<name>Ctx__runTask`
// etc.), so a `macro_rules!` is the correct port shape per PORTING.md.
// ───────────────────────────────────────────────────────────────────────────
macro_rules! extern_crypto_job {
    ($Name:ident, $name_str:literal) => {
        pub mod $Name {
            use super::*;

            // `Ctx` is `opaque {}` — Nomicon FFI opaque-handle pattern.
            #[repr(C)]
            pub struct Ctx {
                _p: [u8; 0],
                _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
            }

            // TODO(port): `#[link_name = concat!(..)]` is not accepted in stable Rust
            // attribute position; Phase B should switch to `paste!` or a small proc-macro.
            unsafe extern "C" {
                #[link_name = concat!("Bun__", $name_str, "Ctx__runTask")]
                fn ctx_run_task(ctx: *mut Ctx, global: *mut JSGlobalObject);
                #[link_name = concat!("Bun__", $name_str, "Ctx__runFromJS")]
                fn ctx_run_from_js(ctx: *mut Ctx, global: *mut JSGlobalObject, callback: JSValue);
                #[link_name = concat!("Bun__", $name_str, "Ctx__deinit")]
                fn ctx_deinit(ctx: *mut Ctx);
            }

            #[repr(C)]
            pub struct Job {
                vm: &'static VirtualMachine,
                task: WorkPoolTask,
                any_task: jsc::AnyTask,
                poll: KeepAlive,
                callback: Strong, // Strong.Optional
                ctx: *mut Ctx,
            }

            impl Job {
                pub extern "C" fn create(
                    global: &JSGlobalObject,
                    ctx: *mut Ctx,
                    callback: JSValue,
                ) -> *mut Job {
                    let vm = global.bun_vm();
                    let job = Box::into_raw(Box::new(Job {
                        vm,
                        task: WorkPoolTask { callback: Self::run_task },
                        // SAFETY: any_task is overwritten immediately below before any use.
                        any_task: unsafe { core::mem::zeroed() },
                        poll: KeepAlive::default(),
                        ctx,
                        callback: Strong::create(callback, global),
                    }));
                    // SAFETY: `job` was just allocated and is exclusively owned here.
                    unsafe {
                        (*job).any_task = jsc::AnyTask::new::<Job>(Self::run_from_js).init(job);
                    }
                    job
                }

                pub extern "C" fn create_and_schedule(
                    global: &JSGlobalObject,
                    ctx: *mut Ctx,
                    callback: JSValue,
                ) {
                    let job = Self::create(global, ctx, callback.with_async_context_if_needed(global));
                    // SAFETY: `job` is a freshly-boxed live pointer.
                    unsafe { (*job).schedule() };
                }

                pub fn run_task(task: *mut WorkPoolTask) {
                    // SAFETY: `task` points to `Job.task`; recover parent via offset_of.
                    let job: *mut Job = unsafe {
                        (task as *mut u8).sub(offset_of!(Job, task)).cast::<Job>()
                    };
                    // SAFETY: job is live for the duration of the work-pool task.
                    let job = unsafe { &mut *job };
                    let vm = job.vm;
                    // Mirror Zig `defer vm.enqueueTaskConcurrent(...)` — runs after the body.
                    let _guard = scopeguard::guard((), |_| {
                        vm.enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()));
                    });
                    // SAFETY: ctx is the FFI-owned opaque handle passed in `create`.
                    unsafe { ctx_run_task(job.ctx, vm.global as *const _ as *mut _) };
                }

                pub fn run_from_js(this: *mut Job) {
                    // SAFETY: `this` was boxed in `create`; we are on the JS thread.
                    let this = unsafe { &mut *this };
                    let _guard = scopeguard::guard((), |_| {
                        // SAFETY: only call site; runs once.
                        unsafe { Self::deinit(this) };
                    });
                    let vm = this.vm;

                    if vm.is_shutting_down() {
                        return;
                    }

                    let Some(callback) = this.callback.try_swap() else {
                        return;
                    };

                    let res: JsResult<()> = jsc::from_js_host_call_generic(vm.global, || {
                        // SAFETY: ctx is live until `deinit` below.
                        unsafe { ctx_run_from_js(this.ctx, vm.global as *const _ as *mut _, callback) };
                    });
                    if let Err(err) = res {
                        let _ = vm.global.report_uncaught_exception(
                            vm.global
                                .take_exception(err)
                                .as_exception(vm.global.vm())
                                .expect("unreachable"),
                        );
                    }
                }

                unsafe fn deinit(this: *mut Job) {
                    // SAFETY: caller guarantees `this` came from `Box::into_raw` in `create`.
                    let mut this = unsafe { Box::from_raw(this) };
                    // SAFETY: ctx is the FFI-owned opaque handle; C++ owns its destructor.
                    unsafe { ctx_deinit(this.ctx) };
                    this.poll.unref(this.vm);
                    drop(this.callback.take()); // Strong: Drop deallocates the handle slot.
                    // Box drop frees `this`.
                }

                pub extern "C" fn schedule(this: &mut Job) {
                    this.poll.r#ref(this.vm);
                    WorkPool::schedule(&mut this.task);
                }
            }

            // Zig `comptime { @export(...) }` — exported C symbols.
            // TODO(port): `#[export_name = concat!(..)]` needs Phase-B macro support (paste!).
            #[unsafe(no_mangle)]
            #[export_name = concat!("Bun__", $name_str, "__create")]
            pub extern "C" fn __create(
                global: &JSGlobalObject,
                ctx: *mut Ctx,
                callback: JSValue,
            ) -> *mut Job {
                Job::create(global, ctx, callback)
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!("Bun__", $name_str, "__schedule")]
            pub extern "C" fn __schedule(this: &mut Job) {
                Job::schedule(this)
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!("Bun__", $name_str, "__createAndSchedule")]
            pub extern "C" fn __create_and_schedule(
                global: &JSGlobalObject,
                ctx: *mut Ctx,
                callback: JSValue,
            ) {
                Job::create_and_schedule(global, ctx, callback)
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
// CryptoJob<Ctx> — Zig `fn CryptoJob(comptime Ctx: type) type`.
// ───────────────────────────────────────────────────────────────────────────

/// Trait expressing the duck-typed interface Zig's `CryptoJob` expects of `Ctx`.
pub trait CryptoJobCtx: Sized {
    fn init(&mut self, global: &JSGlobalObject) -> JsResult<()>;
    /// Zig calls `ctx.runTask(ctx.result)`; in Rust the impl reads its own
    /// `result` field directly.
    // PORT NOTE: reshaped for borrowck — Zig passed `self.result` as a separate arg.
    fn run_task(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue);
    fn deinit(&mut self);
}

#[repr(C)]
pub struct CryptoJob<Ctx: CryptoJobCtx> {
    vm: &'static VirtualMachine,
    task: WorkPoolTask,
    any_task: jsc::AnyTask,
    poll: KeepAlive,
    callback: Strong, // Strong.Optional
    ctx: Ctx,
}

impl<Ctx: CryptoJobCtx> CryptoJob<Ctx> {
    pub fn init(global: &JSGlobalObject, callback: JSValue, ctx: &Ctx) -> JsResult<*mut Self>
    where
        Ctx: Clone,
    {
        // TODO(port): Zig copies `ctx.*` by value into the heap allocation; `Clone`
        // bound is the closest Rust shape. Phase B may switch to taking `Ctx` by value.
        let vm = global.bun_vm();
        let job = Box::into_raw(Box::new(CryptoJob {
            vm,
            task: WorkPoolTask { callback: Self::run_task },
            // SAFETY: any_task is overwritten below before any use.
            any_task: unsafe { core::mem::zeroed() },
            poll: KeepAlive::default(),
            ctx: ctx.clone(),
            callback: Strong::create(callback.with_async_context_if_needed(global), global),
        }));
        // If `ctx.init` throws, we must release the callback `Strong` and any resources the
        // ctx already owns (e.g. `Scrypt` has already protected its password/salt buffers in
        // `from_js`). `deinit` handles all of that; `poll.unref` is a no-op while inactive.
        let guard = scopeguard::guard(job, |job| {
            // SAFETY: job came from Box::into_raw above and has not been consumed.
            unsafe { Self::deinit(job) };
        });
        // SAFETY: job is exclusively owned here.
        unsafe { (**guard).ctx.init(global)? };
        let job = scopeguard::ScopeGuard::into_inner(guard);
        // SAFETY: job is exclusively owned here.
        unsafe {
            (*job).any_task = jsc::AnyTask::new::<Self>(Self::run_from_js).init(job);
        }
        Ok(job)
    }

    pub fn init_and_schedule(global: &JSGlobalObject, callback: JSValue, ctx: &Ctx) -> JsResult<()>
    where
        Ctx: Clone,
    {
        let job = Self::init(global, callback, ctx)?;
        // SAFETY: job is a freshly-boxed live pointer.
        unsafe { (*job).schedule() };
        Ok(())
    }

    pub fn run_task(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to `Self.task`; recover parent via offset_of.
        let job: *mut Self =
            unsafe { (task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>() };
        // SAFETY: job is live for the duration of the work-pool task.
        let job = unsafe { &mut *job };
        let vm = job.vm;
        let _guard = scopeguard::guard((), |_| {
            vm.enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()));
        });

        job.ctx.run_task();
    }

    pub fn run_from_js(this: *mut Self) {
        // SAFETY: `this` was boxed in `init`; we are on the JS thread.
        let this_ref = unsafe { &mut *this };
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: only call site; runs once.
            unsafe { Self::deinit(this) };
        });
        let vm = this_ref.vm;

        if vm.is_shutting_down() {
            return;
        }

        let Some(callback) = this_ref.callback.try_swap() else {
            return;
        };

        this_ref.ctx.run_from_js(vm.global, callback);
    }

    unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller guarantees `this` came from `Box::into_raw` in `init`.
        let mut this = unsafe { Box::from_raw(this) };
        this.ctx.deinit();
        this.poll.unref(this.vm);
        drop(this.callback.take());
        // Box drop frees `this`.
    }

    pub extern "C" fn schedule(this: &mut Self) {
        this.poll.r#ref(this.vm);
        WorkPool::schedule(&mut this.task);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// random
// ───────────────────────────────────────────────────────────────────────────
mod random {
    use super::*;

    #[derive(Clone)]
    pub struct JobCtx {
        pub value: JSValue,
        pub bytes: *mut u8,
        pub offset: u32,
        pub length: usize,
        pub result: (), // void
    }

    impl CryptoJobCtx for JobCtx {
        fn init(&mut self, _: &JSGlobalObject) -> JsResult<()> {
            self.value.protect();
            Ok(())
        }

        fn run_task(&mut self) {
            // SAFETY: `bytes` points into an ArrayBuffer kept alive by `self.value`
            // (protected in `init`); offset+length were range-checked by callers.
            let slice = unsafe {
                core::slice::from_raw_parts_mut(self.bytes.add(self.offset as usize), self.length)
            };
            bun_core::csprng(slice);
        }

        fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue) {
            let vm = global.bun_vm();
            vm.event_loop()
                .run_callback(callback, global, JSValue::UNDEFINED, &[JSValue::NULL, self.value]);
        }

        fn deinit(&mut self) {
            self.value.unprotect();
        }
    }

    pub type Job = CryptoJob<JobCtx>;

    pub const MAX_POSSIBLE_LENGTH: usize = {
        let a = ArrayBuffer::MAX_SIZE;
        let b = i32::MAX as usize;
        if a < b { a } else { b }
    };
    pub const MAX_RANGE: i64 = 0xffff_ffff_ffff;

    #[bun_jsc::host_fn]
    pub fn random_int(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let [mut min_value, mut max_value, mut callback] = call_frame.arguments_as_array::<3>();

        let mut min_specified = true;
        if max_value.is_undefined() || max_value.is_callable() {
            callback = max_value;
            max_value = min_value;
            min_value = JSValue::js_number(0);
            min_specified = false;
        }

        if !callback.is_undefined() {
            let _ = validators::validate_function(global, "callback", callback)?;
        }

        if !min_value.is_safe_integer() {
            return global.throw_invalid_argument_type_value2("min", "a safe integer", min_value);
        }
        if !max_value.is_safe_integer() {
            return global.throw_invalid_argument_type_value2("max", "a safe integer", max_value);
        }

        let min: i64 = min_value.as_number().trunc() as i64;
        let max: i64 = max_value.as_number().trunc() as i64;

        if max <= min {
            return global
                .err_out_of_range(format_args!(
                    "The value of \"max\" is out of range. It must be greater than the value of \"min\" ({}). Received {}",
                    min, max
                ))
                .throw();
        }

        if max - min > MAX_RANGE {
            if min_specified {
                return global
                    .err_out_of_range(format_args!(
                        "The value of \"max - min\" is out of range. It must be <= {}. Received {}",
                        MAX_RANGE,
                        max - min
                    ))
                    .throw();
            }
            return global
                .err_out_of_range(format_args!(
                    "The value of \"max\" is out of range. It must be <= {}. Received {}",
                    MAX_RANGE,
                    max - min
                ))
                .throw();
        }

        // TODO(port): Zig uses `std.crypto.random.intRangeLessThan(i64, min, max)`.
        // Phase B should wire this to the same CSPRNG (BoringSSL RAND_bytes-backed).
        let res = bun_core::crypto_random::int_range_less_than::<i64>(min, max);

        if !callback.is_undefined() {
            callback.call_next_tick(global, [JSValue::UNDEFINED, JSValue::js_number(res)])?;
            return Ok(JSValue::UNDEFINED);
        }

        Ok(JSValue::js_number(res))
    }

    #[bun_jsc::host_fn]
    pub fn random_uuid(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        let mut disable_entropy_cache = false;
        if !args.is_empty() {
            let options = args[0];
            if !options.is_undefined() {
                validators::validate_object(global, options, "options", (), ())?;
                if let Some(disable_entropy_cache_value) =
                    options.get(global, "disableEntropyCache")?
                {
                    disable_entropy_cache = validators::validate_boolean(
                        global,
                        disable_entropy_cache_value,
                        "options.disableEntropyCache",
                        (),
                    )?;
                }
            }
        }

        let (str, bytes) = BunString::create_uninitialized_latin1(36);

        let uuid = if disable_entropy_cache {
            UUID::init()
        } else {
            global.bun_vm().rare_data().next_uuid()
        };

        uuid.print(&mut bytes[0..36]);
        Ok(str.transfer_to_js(global))
    }

    pub fn assert_offset(
        global: &JSGlobalObject,
        offset_value: JSValue,
        element_size: u8,
        length: usize,
    ) -> JsResult<u32> {
        if !offset_value.is_number() {
            return global.throw_invalid_argument_type_value("offset", "number", offset_value);
        }
        let offset = offset_value.as_number() * (element_size as f64);

        let max_length = length.min(MAX_POSSIBLE_LENGTH);
        if offset.is_nan() || offset > (max_length as f64) || offset < 0.0 {
            return global.throw_range_error(
                offset,
                jsc::RangeErrorOptions {
                    field_name: "offset",
                    min: Some(0),
                    max: Some(i64::try_from(max_length).unwrap()),
                    ..Default::default()
                },
            );
        }

        Ok(offset as u32)
    }

    pub fn assert_size(
        global: &JSGlobalObject,
        size_value: JSValue,
        element_size: u8,
        offset: u32,
        length: usize,
    ) -> JsResult<u32> {
        let mut size = validators::validate_number(global, size_value, "size", None, None)?;
        size *= element_size as f64;

        if size.is_nan() || size > (MAX_POSSIBLE_LENGTH as f64) || size < 0.0 {
            return global.throw_range_error(
                size,
                jsc::RangeErrorOptions {
                    field_name: "size",
                    min: Some(0),
                    max: Some(i64::try_from(MAX_POSSIBLE_LENGTH).unwrap()),
                    ..Default::default()
                },
            );
        }

        if size + (offset as f64) > (length as f64) {
            return global.throw_range_error(
                size + (offset as f64),
                jsc::RangeErrorOptions {
                    field_name: "size + offset",
                    max: Some(i64::try_from(length).unwrap()),
                    ..Default::default()
                },
            );
        }

        Ok(size as u32)
    }

    #[bun_jsc::host_fn]
    pub fn random_bytes(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let [size_value, callback] = call_frame.arguments_as_array::<2>();

        let size = assert_size(global, size_value, 1, 0, MAX_POSSIBLE_LENGTH + 1)?;

        if !callback.is_undefined() {
            let _ = validators::validate_function(global, "callback", callback)?;
        }

        let (result, bytes) = ArrayBuffer::alloc(global, ArrayBuffer::Kind::ArrayBuffer, size)?;

        if callback.is_undefined() {
            // sync
            bun_core::csprng(bytes);
            return Ok(result);
        }

        let ctx = JobCtx {
            value: result,
            bytes: bytes.as_mut_ptr(),
            offset: 0,
            length: size as usize,
            result: (),
        };
        Job::init_and_schedule(global, callback, &ctx)?;

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn random_fill_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let [buf_value, offset_value, size_value] = call_frame.arguments_as_array::<3>();

        let Some(buf) = buf_value.as_array_buffer(global) else {
            return global.throw_invalid_argument_type_value(
                "buf",
                "ArrayBuffer or ArrayBufferView",
                buf_value,
            );
        };

        let element_size = buf.bytes_per_element().unwrap_or(1);

        let offset = assert_offset(
            global,
            if offset_value.is_undefined() { JSValue::js_number(0) } else { offset_value },
            element_size,
            buf.byte_len as usize,
        )?;

        let size = if size_value.is_undefined() {
            buf.byte_len - offset
        } else {
            assert_size(global, size_value, element_size, offset, buf.byte_len as usize)?
        };

        if size == 0 {
            return Ok(buf_value);
        }

        bun_core::csprng(&mut buf.slice()[offset as usize..][..size as usize]);

        Ok(buf_value)
    }

    #[bun_jsc::host_fn]
    pub fn random_fill(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let [buf_value, mut offset_value, mut size_value, mut callback] =
            call_frame.arguments_as_array::<4>();

        let Some(buf) = buf_value.as_array_buffer(global) else {
            return global.throw_invalid_argument_type_value(
                "buf",
                "ArrayBuffer or ArrayBufferView",
                buf_value,
            );
        };

        let element_size = buf.bytes_per_element().unwrap_or(1);

        let mut offset: u32 = 0;
        if offset_value.is_callable() {
            callback = offset_value;
            offset = assert_offset(global, JSValue::js_number(0), element_size, buf.byte_len as usize)?;
            size_value = JSValue::js_number(buf.len);
        } else if size_value.is_callable() {
            callback = size_value;
            offset = assert_offset(global, offset_value, element_size, buf.byte_len as usize)?;
            // `offset` is a byte offset (already scaled by element_size) but `buf.len`
            // is an element count, so `buf.len - offset` would mix units and can
            // underflow. Defer to the `buf.byte_len - offset` default below instead.
            size_value = JSValue::UNDEFINED;
        } else {
            let _ = validators::validate_function(global, "callback", callback)?;
            offset = assert_offset(global, offset_value, element_size, buf.byte_len as usize)?;
        }

        let size = if size_value.is_undefined() {
            buf.byte_len - offset
        } else {
            assert_size(global, size_value, element_size, offset, buf.byte_len as usize)?
        };

        if size == 0 {
            let _ = callback.call(global, JSValue::UNDEFINED, &[JSValue::NULL, buf_value])?;
            return Ok(JSValue::UNDEFINED);
        }

        let ctx = JobCtx {
            value: buf_value,
            bytes: buf.slice().as_mut_ptr(),
            offset,
            length: size as usize,
            result: (),
        };
        Job::init_and_schedule(global, callback, &ctx)?;

        Ok(JSValue::UNDEFINED)
    }
}

#[bun_jsc::host_fn]
fn pbkdf2(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let data = PBKDF2::from_js(global_this, call_frame, true)?;

    let job = PBKDF2::Job::create(VirtualMachine::get(), global_this, &data);
    Ok(job.promise.value())
}

#[bun_jsc::host_fn]
fn pbkdf2_sync(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let mut data = PBKDF2::from_js(global_this, call_frame, false)?;
    // TODO(port): Zig had `defer data.deinit()` plus an extra `data.deinit()` on the
    // OOM branch (double-deinit). Preserving the defer; the duplicate call is dropped
    // since Rust scopeguard would also run on early return.
    let _guard = scopeguard::guard((), |_| data.deinit());
    let out_arraybuffer =
        JSValue::create_buffer_from_length(global_this, u32::try_from(data.length).unwrap())?;

    let Some(output) = out_arraybuffer.as_array_buffer(global_this) else {
        return global_this.throw_out_of_memory();
    };

    if !data.run(output.slice()) {
        let err = Crypto::create_crypto_error(global_this, boringssl::ERR_get_error());
        boringssl::ERR_clear_error();
        return global_this.throw_value(err);
    }

    Ok(out_arraybuffer)
}

#[bun_jsc::host_fn]
pub fn timing_safe_equal(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let [l_value, r_value] = call_frame.arguments_as_array::<2>();

    let Some(l_buf) = l_value.as_array_buffer(global) else {
        return global
            .err_invalid_arg_type(format_args!(
                "The \"buf1\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView."
            ))
            .throw();
    };
    let l = l_buf.byte_slice();

    let Some(r_buf) = r_value.as_array_buffer(global) else {
        return global
            .err_invalid_arg_type(format_args!(
                "The \"buf2\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView."
            ))
            .throw();
    };
    let r = r_buf.byte_slice();

    if l.len() != r.len() {
        return global
            .err_crypto_timing_safe_equal_length(format_args!(
                "Input buffers must have the same byte length"
            ))
            .throw();
    }

    Ok(JSValue::from(
        // SAFETY: l and r are valid slices of equal length; CRYPTO_memcmp reads exactly len bytes.
        unsafe { boringssl::CRYPTO_memcmp(l.as_ptr().cast(), r.as_ptr().cast(), l.len()) } == 0,
    ))
}

#[bun_jsc::host_fn]
pub fn secure_heap_used(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn get_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::js_number(0))
}

#[bun_jsc::host_fn]
pub fn set_fips(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn set_engine(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    global
        .err_crypto_custom_engine_not_supported(format_args!(
            "Custom engines not supported by BoringSSL"
        ))
        .throw()
}

extern "C" fn for_each_hash(
    _: *const boringssl::EVP_MD,
    maybe_from: *const c_char,
    _: *const c_char,
    ctx: *mut c_void,
) {
    if maybe_from.is_null() {
        return;
    }
    // SAFETY: ctx was `&mut CaseInsensitiveAsciiStringArrayHashMap<()>` cast in `get_hashes`.
    let hashes: &mut CaseInsensitiveAsciiStringArrayHashMap<()> =
        unsafe { &mut *(ctx as *mut CaseInsensitiveAsciiStringArrayHashMap<()>) };
    // SAFETY: `maybe_from` is non-null (checked above) and points to a NUL-terminated C string
    // from BoringSSL's static tables.
    let from_bytes = unsafe { core::ffi::CStr::from_ptr(maybe_from) }.to_bytes();
    hashes.put(from_bytes, ());
}

#[bun_jsc::host_fn]
fn get_hashes(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    let mut hashes: CaseInsensitiveAsciiStringArrayHashMap<()> =
        CaseInsensitiveAsciiStringArrayHashMap::new();

    // TODO(dylan-conway): cache the names
    // SAFETY: `for_each_hash` matches the expected callback signature; `&mut hashes` is valid
    // for the duration of the call.
    unsafe {
        boringssl::EVP_MD_do_all_sorted(
            for_each_hash,
            (&mut hashes) as *mut _ as *mut c_void,
        );
    }

    let array = JSValue::create_empty_array(global, hashes.count())?;

    for (i, hash) in hashes.keys().iter().enumerate() {
        let str = BunString::create_utf8_for_js(global, hash)?;
        array.put_index(global, u32::try_from(i).unwrap(), str)?;
    }

    Ok(array)
}

// ───────────────────────────────────────────────────────────────────────────
// Scrypt
// ───────────────────────────────────────────────────────────────────────────
#[derive(Clone)]
pub struct Scrypt {
    password: StringOrBuffer,
    salt: StringOrBuffer,
    n: u32,
    r: u32,
    p: u32,
    maxmem: u64,
    keylen: u32,

    // used in async mode
    buf: Strong, // Strong.Optional, default .empty
    // TODO(port): lifetime — `result` borrows the ArrayBuffer backing held alive by `buf`.
    result: *mut [u8],
    err: Option<u32>,
}

type ScryptJob = CryptoJob<Scrypt>;

impl Scrypt {
    /// Zig: `fromJS(..., comptime is_async: bool) JSError!if (is_async) struct{@This(),JSValue} else @This()`.
    /// Rust cannot vary the return type on a const-generic bool, so this always returns
    /// `(Self, JSValue)`; the sync caller ignores the second element.
    // PORT NOTE: reshaped — return type unified across IS_ASYNC.
    pub fn from_js<const IS_ASYNC: bool>(
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<(Self, JSValue)> {
        let [password_value, salt_value, keylen_value, options_arg, callback_arg] =
            call_frame.arguments_as_array::<5>();
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
            return global.throw_invalid_argument_type_value(
                "password",
                "string, ArrayBuffer, Buffer, TypedArray, or DataView",
                password_value,
            );
        };

        let password = scopeguard::guard(password, |p| {
            if IS_ASYNC {
                p.deinit_and_unprotect();
            } else {
                p.deinit();
            }
        });

        let Some(salt) =
            StringOrBuffer::from_js_maybe_async(global, salt_value, IS_ASYNC, true)?
        else {
            return global.throw_invalid_argument_type_value(
                "salt",
                "string, ArrayBuffer, Buffer, TypedArray, or DataView",
                salt_value,
            );
        };

        let salt = scopeguard::guard(salt, |s| {
            if IS_ASYNC {
                s.deinit_and_unprotect();
            } else {
                s.deinit();
            }
        });

        let keylen = validators::validate_int32(global, keylen_value, "keylen", (), Some(0), None)?;

        let mut n: Option<u32> = None;
        let mut r: Option<u32> = None;
        let mut p: Option<u32> = None;
        let mut maxmem: Option<i64> = None;

        if let Some(options_value) = maybe_options_value {
            if let Some(options) = options_value.get_object() {
                if let Some(n_value) = options.get(global, "N")? {
                    n = Some(validators::validate_uint32(global, n_value, "N", (), false)?);
                }

                if let Some(cost_value) = options.get(global, "cost")? {
                    if n.is_some() {
                        return global.throw_incompatible_option_pair("N", "cost");
                    }
                    n = Some(validators::validate_uint32(global, cost_value, "cost", (), false)?);
                }

                if let Some(r_value) = options.get(global, "r")? {
                    r = Some(validators::validate_uint32(global, r_value, "r", (), false)?);
                }

                if let Some(blocksize_value) = options.get(global, "blockSize")? {
                    if r.is_some() {
                        return global.throw_incompatible_option_pair("r", "blockSize");
                    }
                    r = Some(validators::validate_uint32(
                        global,
                        blocksize_value,
                        "blockSize",
                        (),
                        false,
                    )?);
                }

                if let Some(p_value) = options.get(global, "p")? {
                    p = Some(validators::validate_uint32(global, p_value, "p", (), false)?);
                }

                if let Some(parallelization_value) = options.get(global, "parallelization")? {
                    if p.is_some() {
                        return global.throw_incompatible_option_pair("p", "parallelization");
                    }
                    p = Some(validators::validate_uint32(
                        global,
                        parallelization_value,
                        "parallelization",
                        (),
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
            maxmem: u64::try_from(maxmem.unwrap()).unwrap(),
            keylen: u32::try_from(keylen).unwrap(),
            buf: Strong::empty(),
            result: &mut [] as *mut [u8],
            err: None,
        };
        // Re-arm errdefer guards now that ownership moved into `ctx`.
        let ctx = scopeguard::guard(ctx, |c| {
            if IS_ASYNC {
                c.salt.deinit_and_unprotect();
                c.password.deinit_and_unprotect();
            } else {
                c.salt.deinit();
                c.password.deinit();
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
            boringssl::EVP_PBE_validate_scrypt_params(
                core::ptr::null(),
                0,
                core::ptr::null(),
                0,
                n,
                r,
                p,
                maxmem,
                core::ptr::null_mut(),
                0,
            )
        } == 0
        {
            return global.throw_invalid_scrypt_params();
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
            boringssl::EVP_PBE_scrypt(
                password.as_ptr(),
                password.len(),
                salt.as_ptr(),
                salt.len(),
                self.n,
                self.r,
                self.p,
                self.maxmem,
                key.as_mut_ptr(),
                key.len(),
            )
        };

        if res == 0 {
            self.err = Some(boringssl::ERR_peek_last_error());
            return;
        }
    }

    fn deinit_sync(&mut self) {
        self.salt.deinit();
        self.password.deinit();
        drop(self.buf.take());
    }
}

impl CryptoJobCtx for Scrypt {
    fn init(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        if self.keylen as usize > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT {
            return global.throw_out_of_memory();
        }
        let (buf, bytes) = ArrayBuffer::alloc(global, ArrayBuffer::Kind::ArrayBuffer, self.keylen)?;

        // to be filled in later
        self.result = bytes as *mut [u8];
        self.buf = Strong::create(buf, global);
        Ok(())
    }

    fn run_task(&mut self) {
        // SAFETY: `result` points into the ArrayBuffer rooted by `self.buf` (set in `init`).
        let key = unsafe { &mut *self.result };
        self.run_task_impl(key);
    }

    fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue) {
        let vm = global.bun_vm();

        if let Some(err) = self.err {
            if err != 0 {
                let mut buf = [0u8; 256];
                // SAFETY: buf is a valid 256-byte buffer.
                let msg = unsafe {
                    boringssl::ERR_error_string_n(err, buf.as_mut_ptr().cast(), buf.len())
                };
                let exception = global
                    .err_crypto_operation_failed(format_args!(
                        "Scrypt failed: {}",
                        bstr::BStr::new(msg)
                    ))
                    .to_js();
                vm.event_loop()
                    .run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
                return;
            }

            let exception = global
                .err_crypto_operation_failed(format_args!("Scrypt failed"))
                .to_js();
            vm.event_loop()
                .run_callback(callback, global, JSValue::UNDEFINED, &[exception]);
            return;
        }

        let buf = self.buf.swap();
        vm.event_loop()
            .run_callback(callback, global, JSValue::UNDEFINED, &[JSValue::UNDEFINED, buf]);
    }

    fn deinit(&mut self) {
        self.salt.deinit_and_unprotect();
        self.password.deinit_and_unprotect();
        drop(self.buf.take());
    }
}

#[bun_jsc::host_fn]
fn scrypt(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let (ctx, callback) = Scrypt::from_js::<true>(global, call_frame)?;
    ScryptJob::init_and_schedule(global, callback, &ctx)?;
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn scrypt_sync(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let (mut ctx, _) = Scrypt::from_js::<false>(global, call_frame)?;
    let _guard = scopeguard::guard((), |_| ctx.deinit_sync());
    let (buf, bytes) = ArrayBuffer::alloc(global, ArrayBuffer::Kind::ArrayBuffer, ctx.keylen)?;
    ctx.run_task_impl(bytes);
    Ok(buf)
}

pub fn create_node_crypto_binding_zig(global: &JSGlobalObject) -> JSValue {
    let crypto = JSValue::create_empty_object(global, 15);

    crypto.put(global, BunString::init("pbkdf2"), JSFunction::create(global, "pbkdf2", pbkdf2, 5, ()));
    crypto.put(global, BunString::init("pbkdf2Sync"), JSFunction::create(global, "pbkdf2Sync", pbkdf2_sync, 5, ()));
    crypto.put(global, BunString::init("randomInt"), JSFunction::create(global, "randomInt", random::random_int, 2, ()));
    crypto.put(global, BunString::init("randomFill"), JSFunction::create(global, "randomFill", random::random_fill, 4, ()));
    crypto.put(global, BunString::init("randomFillSync"), JSFunction::create(global, "randomFillSync", random::random_fill_sync, 3, ()));
    crypto.put(global, BunString::init("randomUUID"), JSFunction::create(global, "randomUUID", random::random_uuid, 1, ()));
    crypto.put(global, BunString::init("randomBytes"), JSFunction::create(global, "randomBytes", random::random_bytes, 2, ()));
    crypto.put(global, BunString::init("timingSafeEqual"), JSFunction::create(global, "timingSafeEqual", timing_safe_equal, 2, ()));

    crypto.put(global, BunString::init("secureHeapUsed"), JSFunction::create(global, "secureHeapUsed", secure_heap_used, 0, ()));
    crypto.put(global, BunString::init("getFips"), JSFunction::create(global, "getFips", get_fips, 0, ()));
    crypto.put(global, BunString::init("setFips"), JSFunction::create(global, "setFips", set_fips, 1, ()));
    crypto.put(global, BunString::init("setEngine"), JSFunction::create(global, "setEngine", set_engine, 2, ()));

    crypto.put(global, BunString::init("getHashes"), JSFunction::create(global, "getHashes", get_hashes, 0, ()));

    crypto.put(global, BunString::init("scrypt"), JSFunction::create(global, "scrypt", scrypt, 5, ()));
    crypto.put(global, BunString::init("scryptSync"), JSFunction::create(global, "scryptSync", scrypt_sync, 4, ()));

    crypto
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_crypto_binding.zig (815 lines)
//   confidence: medium
//   todos:      6
//   notes:      extern_crypto_job! needs paste!/proc-macro for link_name/export_name concat; Scrypt::from_js return-type unified across IS_ASYNC; global.ERR(.CODE, ..) mapped to err_<code>(format_args!); CryptoJob deinit kept as explicit unsafe fn (intrusive @fieldParentPtr + Box::from_raw, not Drop)
// ──────────────────────────────────────────────────────────────────────────
