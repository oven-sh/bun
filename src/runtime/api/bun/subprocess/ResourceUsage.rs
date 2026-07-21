use crate::api::bun::Rusage;
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult, Local, Scope};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

// `#[repr(C)]` only to satisfy the `improper_ctypes` lint on the generated
// `extern "C" fn(..., *mut ResourceUsage)` shims — C++ never reads this layout
// (it round-trips `m_ctx` as `void*`).
#[bun_jsc::JsClass(no_construct, no_constructor)]
#[repr(C)]
pub struct ResourceUsage {
    pub rusage: Rusage,
}

impl ResourceUsage {
    pub fn create(rusage: &Rusage, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(Box::new(ResourceUsage { rusage: *rusage }).to_js(global))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_cpu_time<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let cpu = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let rusage = &this.rusage;

        let usr_time = scope.local(JSValue::from_timeval_no_truncate(
            global,
            rusage.utime_usec(),
            rusage.utime_sec(),
        )?);
        let sys_time = scope.local(JSValue::from_timeval_no_truncate(
            global,
            rusage.stime_usec(),
            rusage.stime_sec(),
        )?);
        let total = scope.local(JSValue::big_int_sum(
            global,
            usr_time.unscoped(),
            sys_time.unscoped(),
        ));

        cpu.put(scope, b"user", usr_time);
        cpu.put(scope, b"system", sys_time);
        cpu.put(scope, b"total", total);

        Ok(cpu)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_max_rss<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.maxrss_()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_shared_memory_size<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.ixrss_()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_swap_count<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.nswap_()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_ops<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let ops = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let inblock = scope.number(this.rusage.inblock_());
        let oublock = scope.number(this.rusage.oublock_());
        ops.put(scope, b"in", inblock);
        ops.put(scope, b"out", oublock);
        Ok(ops)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_messages<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let msgs = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let sent = scope.number(this.rusage.msgsnd_());
        let received = scope.number(this.rusage.msgrcv_());
        msgs.put(scope, b"sent", sent);
        msgs.put(scope, b"received", received);
        Ok(msgs)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_signal_count<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.nsignals_()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn get_context_switches<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let ctx = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let voluntary = scope.number(this.rusage.nvcsw_());
        let involuntary = scope.number(this.rusage.nivcsw_());
        ctx.put(scope, b"voluntary", voluntary);
        ctx.put(scope, b"involuntary", involuntary);
        Ok(ctx)
    }
}
