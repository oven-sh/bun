//! <https://html.spec.whatwg.org/#the-global-scope>

use bun_collections::HashMap;
use bun_jsc::{JSString, JsResult, from_js_host_call};
use bun_web::host::Host;
use bun_web::origin::Origin;
use bun_web::realm::Scope;
use bun_web::tasks::{self, TaskId, Work};
use bun_web::url::Url;

use super::*;
use crate::api::fonts::{FontFaceSet, fonts_of_worker};
use crate::api::on_behalf;

/// Nothing tells a worker when the display is drawn.
const FRAME_INTERVAL: f64 = 16.0;

#[repr(C)]
pub(crate) struct WorkerGlobalScope {
    pub(crate) base: WindowTarget,
    pub(crate) fields: js_WorkerGlobalScope::Fields,
    state: Box<State>,
}

struct State {
    url: Url,
    name: DomString,
    frames: RefCell<HashMap<u32, TaskId>>,
    last_frame: Cell<u32>,
}

impl WorkerGlobalScope {
    pub(crate) fn create<'a>(
        realm: &Realm,
        host: Host,
        time_origin: f64,
        name: DomString,
    ) -> Option<&'a WorkerGlobalScope> {
        let state = Box::new(State {
            url: realm.client()?.url(),
            name,
            frames: Default::default(),
            last_frame: 0.into(),
        });
        Some(WindowTarget::create(
            realm.global_this(),
            JSValue::UNDEFINED,
            host,
            time_origin,
            false,
            |heap, base| {
                let scope = WorkerGlobalScope {
                    base,
                    fields: Default::default(),
                    state,
                };
                match realm.scope() {
                    Scope::SharedWorker => &**js_SharedWorkerGlobalScope::create(heap, scope),
                    _ => &**js_DedicatedWorkerGlobalScope::create(heap, scope),
                }
            },
        ))
    }

    pub(super) fn url(&self) -> &Url {
        &self.state.url
    }

    pub(crate) fn get_itself(&self, _: &JsHeap<'_>) -> JSValue {
        self.window()
    }

    pub(crate) fn get_scheduler<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Scheduler {
        Scheduler::new(heap, self)
    }

    pub(crate) fn get_location<'a>(&'a self, heap: &JsHeap<'a>) -> &'a WorkerLocation {
        js_WorkerLocation::create(
            heap,
            WorkerLocation {
                url: self.state.url.clone(),
                origin: Origin::of(&self.state.url),
            },
        )
    }

    pub(crate) fn get_navigator<'a>(&'a self, heap: &JsHeap<'a>) -> &'a WorkerNavigator {
        let navigator = js_WorkerNavigator::create(heap, Default::default());
        js_AnyNavigator::set_scope(navigator, Some(self));
        navigator
    }
}

unsafe extern "C" {
    fn Bun__WebGlobalObject__callNative(
        global: &JSGlobalObject,
        name: *const core::ffi::c_char,
        argument: JSValue,
    ) -> JSValue;
}

/// The function of Bun's global object, which windows have as it is.
fn call_native<'a>(
    heap: &JsHeap<'a>,
    name: &'static core::ffi::CStr,
    argument: JSValue,
) -> Result<'a, JSValue> {
    let global = global_of(heap);
    // SAFETY: a literal.
    Ok(from_js_host_call(global, || unsafe {
        Bun__WebGlobalObject__callNative(global, name.as_ptr(), argument)
    })?)
}

impl WorkerGlobalScope {
    pub(crate) fn atob<'a>(
        &self,
        heap: &JsHeap<'a>,
        data: JsLocal<'a, JSString>,
    ) -> Result<'a, JSValue> {
        call_native(heap, c"atob", data.to_js())
    }

    pub(crate) fn btoa<'a>(
        &self,
        heap: &JsHeap<'a>,
        data: JsLocal<'a, JSString>,
    ) -> Result<'a, JSValue> {
        call_native(heap, c"btoa", data.to_js())
    }

    pub(crate) fn queue_microtask<'a>(
        &self,
        heap: &JsHeap<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> Result<'a> {
        call_native(heap, c"queueMicrotask", callback.to_js()).map(drop)
    }

    pub(crate) fn get_fonts<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, &'a FontFaceSet> {
        let (doc, scope) = (
            seams::current_document(cx)?,
            on_behalf::font_scope(&cx.heap),
        );
        Ok(fonts_of_worker(cx, doc, scope))
    }
}

impl NamedWorkerScope {
    pub(crate) fn get_name(&self, _: &JsHeap<'_>) -> &DomString {
        &self.state.name
    }
}

fn run_frame_callback(global: &JSGlobalObject, handle: u64, values: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<WorkerGlobalScope>(global, values[0], |cx, scope| {
        scope.state.frames.borrow_mut().remove(&(handle as u32));
        events::call_back(
            cx,
            Some(scope),
            values[1],
            scope.window(),
            &[JSValue::js_number(scope.coarse_time(events::now()))],
        );
    });
    Ok(())
}

impl DedicatedWorkerGlobalScope {
    pub(crate) fn request_animation_frame<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> u32 {
        let handle = self.state.last_frame.get() + 1;
        self.state.last_frame.set(handle);
        let work = Work::Function(run_frame_callback, handle.into());
        let task = tasks::post_delayed(
            global_of(heap),
            FRAME_INTERVAL,
            false,
            work,
            &[self.to_js(), callback.to_js()],
        );
        self.state.frames.borrow_mut().insert(handle, task);
        handle
    }

    pub(crate) fn cancel_animation_frame(&self, heap: &JsHeap<'_>, handle: u32) {
        let task = self.state.frames.borrow_mut().remove(&handle);
        if let Some(task) = task {
            tasks::cancel(global_of(heap), task);
        }
    }
}

pub(crate) struct WorkerLocation {
    url: Url,
    origin: Origin,
}

impl WorkerLocation {
    pub(crate) fn get_href(&self) -> &[u8] {
        self.url.href()
    }

    pub(crate) fn get_origin(&self) -> &[u8] {
        self.origin.as_bytes()
    }

    pub(crate) fn get_protocol(&self) -> &[u8] {
        self.url.protocol()
    }

    pub(crate) fn get_host(&self) -> &[u8] {
        self.url.host()
    }

    pub(crate) fn get_hostname(&self) -> &[u8] {
        self.url.hostname()
    }

    pub(crate) fn get_port(&self) -> String {
        self.url
            .port()
            .map_or_else(String::new, |it| it.to_string())
    }

    pub(crate) fn get_pathname(&self) -> &[u8] {
        self.url.path()
    }

    pub(crate) fn get_search(&self) -> &[u8] {
        self.url.search()
    }

    pub(crate) fn get_hash(&self) -> Vec<u8> {
        self.url
            .fragment()
            .filter(|it| !it.is_empty())
            .map_or_else(Vec::new, |it| [b"#", it].concat())
    }
}
