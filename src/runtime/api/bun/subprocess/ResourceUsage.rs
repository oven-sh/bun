use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult};
use crate::api::bun::Rusage;

// ──────────────────────────────────────────────────────────────────────────
// Local FFI shims for `JSValue` helpers that haven't been ported to bun_jsc
// yet. These mirror src/jsc/JSValue.zig:1225-1233 exactly.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    fn JSC__JSValue__fromTimevalNoTruncate(
        global: *const JSGlobalObject,
        nsec: i64,
        sec: i64,
    ) -> JSValue;
    fn JSC__JSValue__bigIntSum(global: *const JSGlobalObject, a: JSValue, b: JSValue) -> JSValue;
}

#[inline]
fn from_timeval_no_truncate(global: &JSGlobalObject, nsec: i64, sec: i64) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global, || {
        // SAFETY: `global` is live for the duration of the call.
        unsafe { JSC__JSValue__fromTimevalNoTruncate(global, nsec, sec) }
    })
}

#[inline]
fn big_int_sum(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JSValue {
    // SAFETY: `global` is live; `a`/`b` are valid JSValues.
    unsafe { JSC__JSValue__bigIntSum(global, a, b) }
}

// ──────────────────────────────────────────────────────────────────────────
// `Rusage` is a per-platform alias (libc::rusage on most unix, a custom
// repr(C) struct on freebsd, WinRusage on windows) with divergent field
// names. Normalize via a private extension trait so the getters below stay
// cfg-free, matching the Zig source which sees uniform names.
// ──────────────────────────────────────────────────────────────────────────
trait RusageFields {
    fn utime_sec(&self) -> i64;
    fn utime_usec(&self) -> i64;
    fn stime_sec(&self) -> i64;
    fn stime_usec(&self) -> i64;
    fn maxrss_(&self) -> f64;
    fn ixrss_(&self) -> f64;
    fn nswap_(&self) -> f64;
    fn inblock_(&self) -> f64;
    fn oublock_(&self) -> f64;
    fn msgsnd_(&self) -> f64;
    fn msgrcv_(&self) -> f64;
    fn nsignals_(&self) -> f64;
    fn nvcsw_(&self) -> f64;
    fn nivcsw_(&self) -> f64;
}

#[cfg(all(unix, not(target_os = "freebsd")))]
impl RusageFields for Rusage {
    #[inline] fn utime_sec(&self) -> i64 { self.ru_utime.tv_sec as i64 }
    #[inline] fn utime_usec(&self) -> i64 { self.ru_utime.tv_usec as i64 }
    #[inline] fn stime_sec(&self) -> i64 { self.ru_stime.tv_sec as i64 }
    #[inline] fn stime_usec(&self) -> i64 { self.ru_stime.tv_usec as i64 }
    #[inline] fn maxrss_(&self) -> f64 { self.ru_maxrss as f64 }
    #[inline] fn ixrss_(&self) -> f64 { self.ru_ixrss as f64 }
    #[inline] fn nswap_(&self) -> f64 { self.ru_nswap as f64 }
    #[inline] fn inblock_(&self) -> f64 { self.ru_inblock as f64 }
    #[inline] fn oublock_(&self) -> f64 { self.ru_oublock as f64 }
    #[inline] fn msgsnd_(&self) -> f64 { self.ru_msgsnd as f64 }
    #[inline] fn msgrcv_(&self) -> f64 { self.ru_msgrcv as f64 }
    #[inline] fn nsignals_(&self) -> f64 { self.ru_nsignals as f64 }
    #[inline] fn nvcsw_(&self) -> f64 { self.ru_nvcsw as f64 }
    #[inline] fn nivcsw_(&self) -> f64 { self.ru_nivcsw as f64 }
}

#[cfg(target_os = "freebsd")]
impl RusageFields for Rusage {
    #[inline] fn utime_sec(&self) -> i64 { self.utime.tv_sec as i64 }
    #[inline] fn utime_usec(&self) -> i64 { self.utime.tv_usec as i64 }
    #[inline] fn stime_sec(&self) -> i64 { self.stime.tv_sec as i64 }
    #[inline] fn stime_usec(&self) -> i64 { self.stime.tv_usec as i64 }
    #[inline] fn maxrss_(&self) -> f64 { self.maxrss as f64 }
    #[inline] fn ixrss_(&self) -> f64 { self.ixrss as f64 }
    #[inline] fn nswap_(&self) -> f64 { self.nswap as f64 }
    #[inline] fn inblock_(&self) -> f64 { self.inblock as f64 }
    #[inline] fn oublock_(&self) -> f64 { self.oublock as f64 }
    #[inline] fn msgsnd_(&self) -> f64 { self.msgsnd as f64 }
    #[inline] fn msgrcv_(&self) -> f64 { self.msgrcv as f64 }
    #[inline] fn nsignals_(&self) -> f64 { self.nsignals as f64 }
    #[inline] fn nvcsw_(&self) -> f64 { self.nvcsw as f64 }
    #[inline] fn nivcsw_(&self) -> f64 { self.nivcsw as f64 }
}

#[cfg(windows)]
impl RusageFields for Rusage {
    #[inline] fn utime_sec(&self) -> i64 { self.utime.sec }
    #[inline] fn utime_usec(&self) -> i64 { self.utime.usec }
    #[inline] fn stime_sec(&self) -> i64 { self.stime.sec }
    #[inline] fn stime_usec(&self) -> i64 { self.stime.usec }
    #[inline] fn maxrss_(&self) -> f64 { self.maxrss as f64 }
    // Zig declares these as `u0` on Windows — always zero.
    #[inline] fn ixrss_(&self) -> f64 { 0.0 }
    #[inline] fn nswap_(&self) -> f64 { 0.0 }
    #[inline] fn inblock_(&self) -> f64 { self.inblock as f64 }
    #[inline] fn oublock_(&self) -> f64 { self.oublock as f64 }
    #[inline] fn msgsnd_(&self) -> f64 { 0.0 }
    #[inline] fn msgrcv_(&self) -> f64 { 0.0 }
    #[inline] fn nsignals_(&self) -> f64 { 0.0 }
    #[inline] fn nvcsw_(&self) -> f64 { 0.0 }
    #[inline] fn nivcsw_(&self) -> f64 { 0.0 }
}

#[bun_jsc::JsClass(no_construct)]
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

        let usr_time = from_timeval_no_truncate(global, rusage.utime_usec(), rusage.utime_sec())?;
        let sys_time = from_timeval_no_truncate(global, rusage.stime_usec(), rusage.stime_sec())?;

        cpu.put(global, b"user", usr_time);
        cpu.put(global, b"system", sys_time);
        cpu.put(global, b"total", big_int_sum(global, usr_time, sys_time));

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
        msgs.put(global, b"received", JSValue::js_number(this.rusage.msgrcv_()));
        msgs
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.rusage.nsignals_())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_context_switches(this: &Self, global: &JSGlobalObject) -> JSValue {
        let ctx = JSValue::create_empty_object_with_null_prototype(global);
        ctx.put(global, b"voluntary", JSValue::js_number(this.rusage.nvcsw_()));
        ctx.put(global, b"involuntary", JSValue::js_number(this.rusage.nivcsw_()));
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
//   notes:      .classes.ts-backed payload (noConstructor: true → no_construct);
//               toJS/fromJS aliases provided by #[bun_jsc::JsClass]; field
//               access normalized via local RusageFields trait across
//               libc::rusage / freebsd / WinRusage.
// ──────────────────────────────────────────────────────────────────────────
