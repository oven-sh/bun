use crate::api::bun::Rusage;
use crate::generated_bindgen::resource_usage::ResourceUsageClass;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

pub(crate) struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

fn counts<'a>(
    this: JsWrapper<'a, ResourceUsage>,
    cx: &mut JsScope<'a>,
    counts: impl FnOnce(&Rusage) -> [(&'static [u8], f64); 2],
) -> JsLocal<'a> {
    let counts = this.with(&cx.payloads, |usage| counts(&usage.rusage));
    let global: &JSGlobalObject = cx.global();
    let object = JSValue::create_empty_object_with_null_prototype(global);
    for (name, count) in counts {
        object.put(global, name, JSValue::js_number(count));
    }
    JsLocal::new(&cx.heap, object)
}

impl ResourceUsageClass for ResourceUsage {
    type Error<'a> = JsError;

    fn context_switches<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> JsLocal<'a> {
        counts(this, cx, |rusage| {
            [
                (b"voluntary", rusage.nvcsw()),
                (b"involuntary", rusage.nivcsw()),
            ]
        })
    }

    fn cpu_time<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> JsResult<JsLocal<'a>> {
        let rusage = this.with(&cx.payloads, |usage| usage.rusage);
        let global = cx.global();
        let cpu = JSValue::create_empty_object_with_null_prototype(global);

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

        Ok(JsLocal::new(&cx.heap, cpu))
    }

    fn max_rss(&self) -> f64 {
        self.rusage.maxrss()
    }

    fn messages<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> JsLocal<'a> {
        counts(this, cx, |rusage| {
            [(b"sent", rusage.msgsnd()), (b"received", rusage.msgrcv())]
        })
    }

    fn ops<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> JsLocal<'a> {
        counts(this, cx, |rusage| {
            [(b"in", rusage.inblock()), (b"out", rusage.oublock())]
        })
    }

    fn shm_size(&self) -> f64 {
        self.rusage.ixrss()
    }

    fn signal_count(&self) -> f64 {
        self.rusage.nsignals()
    }

    fn swap_count(&self) -> f64 {
        self.rusage.nswap()
    }
}
