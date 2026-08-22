use crate::api::bun::Rusage;
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult, Local, Scope};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

// `#[repr(C)]` only to satisfy the `improper_ctypes` lint on the generated
// `extern "C" fn(..., *mut ResourceUsage)` shims — C++ never reads this layout
// (it round-trips `m_ctx` as `void*`).
#[bun_jsc::JsClass(no_construct, no_constructor)]
#[repr(C)]
pub struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

impl ResourceUsage {
    pub(crate) fn create(rusage: &Rusage, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(Box::new(ResourceUsage { rusage: *rusage }).to_js(global))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_cpu_time<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
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
    pub(crate) fn get_max_rss<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.maxrss()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_shared_memory_size<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
    ) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.ixrss()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_swap_count<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.nswap()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_ops<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let ops = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let inblock = scope.number(this.rusage.inblock());
        let oublock = scope.number(this.rusage.oublock());
        ops.put(scope, b"in", inblock);
        ops.put(scope, b"out", oublock);
        Ok(ops)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_messages<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let msgs = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let sent = scope.number(this.rusage.msgsnd());
        let received = scope.number(this.rusage.msgrcv());
        msgs.put(scope, b"sent", sent);
        msgs.put(scope, b"received", received);
        Ok(msgs)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_signal_count<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.rusage.nsignals()))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_context_switches<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
    ) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let ctx = scope.local(JSValue::create_empty_object_with_null_prototype(global));
        let voluntary = scope.number(this.rusage.nvcsw());
        let involuntary = scope.number(this.rusage.nivcsw());
        ctx.put(scope, b"voluntary", voluntary);
        ctx.put(scope, b"involuntary", involuntary);
        Ok(ctx)
    }
}
