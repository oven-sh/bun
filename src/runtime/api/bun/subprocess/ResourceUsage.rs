use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_str::ZigString;
use bun_spawn::Rusage;

#[bun_jsc::JsClass]
pub struct ResourceUsage {
    pub rusage: Rusage,
}

impl ResourceUsage {
    pub fn create(rusage: &Rusage, global: &JSGlobalObject) -> JsResult<JSValue> {
        Box::new(ResourceUsage { rusage: *rusage }).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_cpu_time(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let cpu = JSValue::create_empty_object_with_null_prototype(global);
        let rusage = this.rusage;

        let usr_time = JSValue::from_timeval_no_truncate(global, rusage.utime.usec, rusage.utime.sec)?;
        let sys_time = JSValue::from_timeval_no_truncate(global, rusage.stime.usec, rusage.stime.sec)?;

        cpu.put(global, ZigString::static_str("user"), usr_time);
        cpu.put(global, ZigString::static_str("system"), sys_time);
        cpu.put(global, ZigString::static_str("total"), JSValue::big_int_sum(global, usr_time, sys_time));

        Ok(cpu)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_max_rss(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.maxrss)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_shared_memory_size(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.ixrss)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_swap_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.nswap)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ops(this: &Self, global: &JSGlobalObject) -> JSValue {
        let ops = JSValue::create_empty_object_with_null_prototype(global);
        ops.put(global, ZigString::static_str("in"), JSValue::js_number(this.rusage.inblock));
        ops.put(global, ZigString::static_str("out"), JSValue::js_number(this.rusage.oublock));
        ops
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_messages(this: &Self, global: &JSGlobalObject) -> JSValue {
        let msgs = JSValue::create_empty_object_with_null_prototype(global);
        msgs.put(global, ZigString::static_str("sent"), JSValue::js_number(this.rusage.msgsnd));
        msgs.put(global, ZigString::static_str("received"), JSValue::js_number(this.rusage.msgrcv));
        msgs
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.nsignals)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_context_switches(this: &Self, global: &JSGlobalObject) -> JSValue {
        let ctx = JSValue::create_empty_object_with_null_prototype(global);
        ctx.put(global, ZigString::static_str("voluntary"), JSValue::js_number(this.rusage.nvcsw));
        ctx.put(global, ZigString::static_str("involuntary"), JSValue::js_number(this.rusage.nivcsw));
        ctx
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` was allocated via Box::new in `create` and ownership was
        // transferred to the JS wrapper; finalize is called exactly once by the GC
        // on the mutator thread during lazy sweep.
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/ResourceUsage.zig (74 lines)
//   confidence: high
//   todos:      0
//   notes:      .classes.ts-backed payload; toJS/fromJS aliases dropped (provided by #[bun_jsc::JsClass]); ZigString::static_str name may need adjusting in Phase B
// ──────────────────────────────────────────────────────────────────────────
