use crate::api::bun::Rusage;
use crate::generated_bindgen::resource_usage::ResourceUsageClass;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, to_js};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

pub(crate) struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

fn without_prototype<'a, const N: usize>(
    heap: &JsHeap<'a>,
    members: [(&'static [u8], JSValue); N],
) -> JsLocal<'a> {
    // SAFETY: makes an object and defines its own properties.
    let global = unsafe { heap.global() };
    let object = JSValue::create_empty_object_with_null_prototype(global);
    for (name, value) in members {
        object.put(global, name, value);
    }
    JsLocal::new(heap, object)
}

fn counts<'a>(heap: &JsHeap<'a>, counts: [(&'static [u8], f64); 2]) -> JsLocal<'a> {
    without_prototype(
        heap,
        counts.map(|(name, count)| (name, JSValue::js_number(count))),
    )
}

impl ResourceUsageClass for ResourceUsage {
    type Error<'a> = bindgen::Error<'a>;

    fn context_switches<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        counts(
            heap,
            [
                (b"voluntary", self.rusage.nvcsw()),
                (b"involuntary", self.rusage.nivcsw()),
            ],
        )
    }

    fn cpu_time<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let microseconds = |sec: i64, usec: i64| (sec * 1_000_000 + usec) as u64;
        let user = microseconds(self.rusage.utime_sec(), self.rusage.utime_usec());
        let system = microseconds(self.rusage.stime_sec(), self.rusage.stime_usec());
        Ok(without_prototype(
            heap,
            [
                (b"user", to_js::u64_as_bigint(heap, user)?.to_js()),
                (b"system", to_js::u64_as_bigint(heap, system)?.to_js()),
                (b"total", to_js::u64_as_bigint(heap, user + system)?.to_js()),
            ],
        ))
    }

    fn max_rss(&self) -> f64 {
        self.rusage.maxrss()
    }

    fn messages<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        counts(
            heap,
            [
                (b"sent", self.rusage.msgsnd()),
                (b"received", self.rusage.msgrcv()),
            ],
        )
    }

    fn ops<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        counts(
            heap,
            [
                (b"in", self.rusage.inblock()),
                (b"out", self.rusage.oublock()),
            ],
        )
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
