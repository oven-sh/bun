//! <https://w3c.github.io/reporting/>

use bun_alloc::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::JsStringImpl;

use bun_jsc::JSGlobalObject;
use bun_web::exec;
use bun_web::reporting::{Members, ReportType};

use super::*;
use crate::api::events::swap_top_level;

const MOST_REPORTS: u32 = 100;
const TEXTS: [&str; 8] = [
    "documentURI",
    "referrer",
    "blockedURI",
    "sourceFile",
    "violatedDirective",
    "effectiveDirective",
    "originalPolicy",
    "sample",
];

#[repr(C)]
pub(crate) struct SecurityPolicyViolationEvent {
    pub(crate) base: Event,
    texts: [DomString; TEXTS.len()],
    line_number: u32,
    column_number: u32,
    status_code: u16,
    disposition: SecurityPolicyViolationEventDisposition,
}

impl SecurityPolicyViolationEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &SecurityPolicyViolationEventInit<'a>,
    ) -> &'a Self {
        let texts = [
            init.document_uri,
            init.referrer,
            init.blocked_uri,
            init.source_file,
            init.violated_directive,
            init.effective_directive,
            init.original_policy,
            init.sample,
        ];
        structure.create(
            heap,
            SecurityPolicyViolationEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
                texts: texts.map(Into::into),
                line_number: init.line_number,
                column_number: init.column_number,
                status_code: init.status_code,
                disposition: init.disposition,
            },
        )
    }

    fn of_report<'a>(cx: Cx<'_, 'a>, body: JSValue) -> Result<'a, &'a Self> {
        let names = [
            "documentURL",
            "referrer",
            "blockedURL",
            "sourceFile",
            "effectiveDirective",
            "effectiveDirective",
            "originalPolicy",
            "sample",
            "disposition",
        ];
        let mut texts = names.map(|_| DomString::default());
        for (text, name) in texts.iter_mut().zip(names) {
            if let Some(given) = body
                .get(cx.global(), name)?
                .and_then(|it| JsLocal::new(&cx.heap, it).as_string())
            {
                *text = DomString::from_js_string(&cx.heap, given)?;
            }
        }
        let mut number = |name: &str| {
            Ok::<_, bindgen::Error<'a>>(
                body.get(cx.global(), name)?
                    .and_then(JSValue::get_number)
                    .unwrap_or(0.0) as u32,
            )
        };
        let (line_number, column_number, status_code) = (
            number("lineNumber")?,
            number("columnNumber")?,
            number("statusCode")? as u16,
        );
        let [texts @ .., disposition] = texts;
        let disposition = if disposition.eq_str("report") {
            SecurityPolicyViolationEventDisposition::Report
        } else {
            SecurityPolicyViolationEventDisposition::Enforce
        };
        let base = Event::base(
            atom!("securitypolicyviolation"),
            EventInit {
                bubbles: true,
                cancelable: false,
                composed: true,
            },
            Trusted::Yes,
        );
        Ok(js_SecurityPolicyViolationEvent::create(
            &cx.heap,
            SecurityPolicyViolationEvent {
                base,
                texts,
                line_number,
                column_number,
                status_code,
                disposition,
            },
        ))
    }

    pub(crate) fn get_disposition(&self) -> SecurityPolicyViolationEventDisposition {
        self.disposition
    }

    pub(crate) fn get_status_code(&self) -> u16 {
        self.status_code
    }

    pub(crate) fn get_line_number(&self) -> u32 {
        self.line_number
    }

    pub(crate) fn get_column_number(&self) -> u32 {
        self.column_number
    }
}

impl ViolationText {
    pub(crate) fn get(&self, name: &Impl) -> &DomString {
        let event = self
            .downcast::<SecurityPolicyViolationEvent>()
            .expect("the receiver was checked");
        &event.texts[TEXTS
            .iter()
            .position(|it| it.as_bytes() == name.latin1_slice())
            .expect("the schema has these names")]
    }
}

fn list<'a>(field: Option<JSValue>) -> List<'a> {
    List::from_value(field.expect("set when it is made"))
}

impl Reports {
    fn get<'a>(realm: &JsHeap<'a>) -> &'a Reports {
        Reports::of_realm(realm).unwrap_or_else(|| {
            let made = js_Reports::create(realm, Default::default());
            made.set_of_realm(realm);
            for set in [
                js_Reports::set_reports,
                js_Reports::set_types,
                js_Reports::set_observers,
            ] {
                set(made, List::new(realm).to_js());
            }
            made
        })
    }
}

#[repr(C)]
pub(crate) struct ReportingObserver {
    types: Box<[DomString]>,
    is_buffered: Cell<bool>,
}

impl ReportingObserver {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        callback: JsLocal<'a, Callable>,
        options: &ReportingObserverOptions<'a>,
    ) -> &'a Self {
        let types = options
            .types
            .iter()
            .map(|it: JsStringImpl<'_>| it.into())
            .collect();
        let this = structure.create(
            heap,
            ReportingObserver {
                types,
                is_buffered: options.buffered.into(),
            },
        );
        js_ReportingObserver::set_callback(this, callback.to_js());
        js_ReportingObserver::set_queue(this, List::new(heap).to_js());
        this
    }

    fn add<'a>(&'a self, realm: &JsHeap<'a>, kind: JSValue, report: JSValue) {
        let kind = JsLocal::new(realm, kind)
            .as_string()
            .and_then(|it| DomString::from_js_string(realm, it).ok());
        if !self.types.is_empty() && !self.types.iter().any(|it| Some(it) == kind.as_ref()) {
            return;
        }
        let queue = list(js_ReportingObserver::queue(self));
        queue.push(realm, report);
        if queue.len() == 1 {
            queue_task(realm, [self.to_js()], |cx, [this]| {
                if let Some(Err(error)) =
                    ReportingObserver::from_js(&cx.heap, this.to_js()).map(|it| it.deliver(cx))
                {
                    report_exception(cx, error);
                }
            });
        }
    }

    fn deliver<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        if !list(js_ReportingObserver::queue(self)).is_empty() {
            let reports = self.take_records(&cx.heap)?;
            js_ReportingObserver::callback(self)
                .expect("set when it is made")
                .call(cx.global(), self.to_js(), &[reports, self.to_js()])?;
        }
        Ok(())
    }

    pub(crate) fn observe<'a>(&'a self, heap: &JsHeap<'a>) {
        let realm = self.realm(heap);
        let all = Reports::get(realm);
        let observers = list(js_Reports::observers(all));
        if !observers.contains(self.to_js()) {
            observers.push(realm, self.to_js());
        }
        if self.is_buffered.take() {
            list(js_Reports::types(all))
                .values()
                .zip(list(js_Reports::reports(all)).values())
                .for_each(|(kind, report)| self.add(realm, kind, report));
        }
    }

    pub(crate) fn disconnect<'a>(&'a self, heap: &JsHeap<'a>) {
        list(js_Reports::observers(Reports::get(self.realm(heap)))).remove(heap, self.to_js());
    }

    pub(crate) fn take_records<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        let queue = list(js_ReportingObserver::queue(self));
        js_ReportingObserver::set_queue(self, List::new(heap).to_js());
        Ok(heap
            .create_array(queue.values(), |heap, it| Ok(JsLocal::new(heap, it)))?
            .to_js())
    }
}

/// `make` is called twice.
fn with_to_json<'a>(
    cx: Cx<'_, 'a>,
    mut make: impl FnMut(Cx<'_, 'a>) -> Result<'a, JSValue>,
) -> Result<'a, JSValue> {
    fn first<'a>(
        _: Cx<'_, 'a>,
        [json, _]: [JsLocal<'a>; 2],
        _: u64,
        _: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        Ok(json.to_js())
    }
    let (object, json) = (make(cx)?, make(cx)?);
    let to_json = cx
        .heap
        .create_callback(first, [json, JSValue::UNDEFINED], 0)
        .to_js();
    object.put_non_enumerable(cx.global(), b"toJSON", to_json);
    Ok(object)
}

#[unsafe(no_mangle)]
fn __bun_dom_deliver_report(
    realm: &JSGlobalObject,
    kind: ReportType,
    body: Members,
    element: JSValue,
) {
    let was_at_top_level = swap_top_level(true);
    exec::with_realm(realm, |cx| {
        let element = JsLocal::new(&cx.heap, element);
        let delivered = deliver_report(cx, kind, body, element);
        exec::report(cx, delivered);
    });
    swap_top_level(was_at_top_level);
}

fn deliver_report<'a>(
    cx: Cx<'_, 'a>,
    kind: ReportType,
    body: Members,
    element: JsLocal<'a>,
) -> Result<'a> {
    let (kind, body) = (
        DomString::from_latin1(kind.as_bytes()),
        bun_web::reporting::members_to_js(&cx.heap, body)?,
    );
    let (Some(client), Some(global)) = (client_of(&cx.heap), WindowTarget::of_realm(&cx.heap))
    else {
        return Ok(());
    };
    if kind.eq_str("csp-violation") {
        let node = Node::from_js(&cx.heap, element.to_js())
            .filter(|it| it.is_connected())
            .or_else(|| global.doc().map(|it| &**it));
        let event = SecurityPolicyViolationEvent::of_report(cx, body.to_js())?;
        dispatch(cx, node.map_or(&**global, |it| &**it), event);
    }
    let body = with_to_json(cx, |cx| crate::api::performance::clone_detail(cx, body))?;
    let (kind, url) = (
        kind.to_js(&cx.heap).to_js(),
        cx.heap
            .create_latin1_string(client.url().without_fragment())
            .to_js(),
    );
    let report = with_to_json(cx, |cx| {
        let report = cx.heap.create_empty_object().to_js();
        for (name, value) in [("type", kind), ("url", url), ("body", body)] {
            report.put(cx.global(), name.as_bytes(), value);
        }
        Ok(report)
    })?;
    let all = Reports::get(&cx.heap);
    for (list, value) in [
        (list(js_Reports::types(all)), kind),
        (list(js_Reports::reports(all)), report),
    ] {
        list.push(&cx.heap, value);
        if list.len() > MOST_REPORTS {
            list.remove_range(&cx.heap, 0, 1);
        }
    }
    list(js_Reports::observers(all))
        .values()
        .filter_map(|it| ReportingObserver::from_js(&cx.heap, it))
        .for_each(|it| it.add(&cx.heap, kind, report));
    Ok(())
}
