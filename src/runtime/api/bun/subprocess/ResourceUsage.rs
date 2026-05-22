use crate::api::bun::Rusage;
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult};
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

    #[bun_jsc::host_fn(getter)]
    pub fn get_cpu_time(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let cpu = JSValue::create_empty_object_with_null_prototype(global);
        let rusage = &this.rusage;

        let usr_time =
            JSValue::from_timeval_no_truncate(global, rusage.utime_usec(), rusage.utime_sec())?;
        let sys_time =
            JSValue::from_timeval_no_truncate(global, rusage.stime_usec(), rusage.stime_sec())?;

        cpu.put(global, b"user", usr_time);
        cpu.put(global, b"system", sys_time);
        cpu.put(
            global,
            b"total",
            JSValue::big_int_sum(global, usr_time, sys_time),
        );

        Ok(cpu)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_max_rss(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.maxrss_())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_shared_memory_size(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.ixrss_())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_swap_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.nswap_())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ops(this: &Self, global: &JSGlobalObject) -> JSValue {
        let ops = JSValue::create_empty_object_with_null_prototype(global);
        ops.put(global, b"in", JSValue::js_number(this.rusage.inblock_()));
        ops.put(global, b"out", JSValue::js_number(this.rusage.oublock_()));
        ops
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_messages(this: &Self, global: &JSGlobalObject) -> JSValue {
        let msgs = JSValue::create_empty_object_with_null_prototype(global);
        msgs.put(global, b"sent", JSValue::js_number(this.rusage.msgsnd_()));
        msgs.put(
            global,
            b"received",
            JSValue::js_number(this.rusage.msgrcv_()),
        );
        msgs
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.nsignals_())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_context_switches(this: &Self, global: &JSGlobalObject) -> JSValue {
        let ctx = JSValue::create_empty_object_with_null_prototype(global);
        ctx.put(
            global,
            b"voluntary",
            JSValue::js_number(this.rusage.nvcsw_()),
        );
        ctx.put(
            global,
            b"involuntary",
            JSValue::js_number(this.rusage.nivcsw_()),
        );
        ctx
    }
}

// ported from: src/runtime/api/bun/subprocess/ResourceUsage.zig
