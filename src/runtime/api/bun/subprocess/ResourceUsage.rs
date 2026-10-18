use crate::api::bun::Rusage;
use crate::generated_bindgen::resource_usage::ResourceUsageClass;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, to_js};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

pub(crate) struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

fn null_prototype_object<'a, const N: usize>(
    heap: &JsHeap<'a>,
    members: [(&'static [u8], JSValue); N],
) -> JsLocal<'a> {
    // SAFETY: the object is new and plain, and its properties are defined and not set.
    let global = unsafe { heap.global() };
    let object = JSValue::create_empty_object_with_null_prototype(global);
    for (name, value) in members {
        object.put(global, name, value);
    }
    JsLocal::new(heap, object)
}

impl ResourceUsageClass for ResourceUsage {
    type Error<'a> = bindgen::Error<'a>;

    fn context_switches<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        null_prototype_object(
            heap,
            [
                (b"voluntary", JSValue::js_number(self.rusage.nvcsw())),
                (b"involuntary", JSValue::js_number(self.rusage.nivcsw())),
            ],
        )
    }

    fn cpu_time<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let microseconds = |sec: i64, usec: i64| (sec * 1_000_000 + usec) as u64;
        let user = microseconds(self.rusage.utime_sec(), self.rusage.utime_usec());
        let system = microseconds(self.rusage.stime_sec(), self.rusage.stime_usec());
        Ok(null_prototype_object(
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
        null_prototype_object(
            heap,
            [
                (b"sent", JSValue::js_number(self.rusage.msgsnd())),
                (b"received", JSValue::js_number(self.rusage.msgrcv())),
            ],
        )
    }

    fn ops<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        null_prototype_object(
            heap,
            [
                (b"in", JSValue::js_number(self.rusage.inblock())),
                (b"out", JSValue::js_number(self.rusage.oublock())),
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
