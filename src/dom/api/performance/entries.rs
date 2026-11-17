//! What is on the timeline.

use core::cell::Cell;

use bun_alloc::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::ClassStructure;
use bun_jsc::{JSObject, Weak};
use bun_web::timing::{ResourceTiming, ServerTiming};

use super::*;

macro_rules! types {
    ($($variant:ident $name:literal,)*) => {
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub(super) enum Type { $($variant,)* }

        impl Type {
            pub(super) const ALL: [Type; [$($name),*].len()] = [$(Type::$variant),*];

            pub(super) fn name(self) -> &'static str {
                match self { $(Type::$variant => $name,)* }
            }
        }
    };
}
types! {
    Element "element",
    Event "event",
    FirstInput "first-input",
    LargestPaint "largest-contentful-paint",
    Mark "mark",
    Measure "measure",
    Navigation "navigation",
    Paint "paint",
    Resource "resource",
    Visibility "visibility-state",
}

impl Type {
    pub(super) fn is_supported(self, heap: &JsHeap<'_>) -> bool {
        heap.is_window() || matches!(self, Type::Mark | Type::Measure | Type::Resource)
    }

    pub(super) fn parse(heap: &JsHeap<'_>, name: &DomString) -> Option<Type> {
        Type::ALL
            .into_iter()
            .find(|it| name.eq_str(it.name()) && it.is_supported(heap))
    }

    pub(super) fn is_only_for_observers(self) -> bool {
        matches!(self, Type::Element | Type::Event | Type::LargestPaint)
    }

    pub(super) fn bit(self) -> u16 {
        1 << self as u16
    }
}

#[repr(C)]
pub(crate) struct Entry {
    pub(super) name: DomString,
    pub(super) start: f64,
    pub(super) duration: Cell<f64>,
    pub(super) kind: Type,
}

impl Entry {
    pub(super) fn new(kind: Type, name: impl Into<DomString>, start: f64, duration: f64) -> Entry {
        Entry {
            name: name.into(),
            start,
            duration: duration.into(),
            kind,
        }
    }

    pub(crate) fn get_name(&self) -> &DomString {
        &self.name
    }

    pub(crate) fn get_entry_type(&self) -> &'static [u8] {
        self.kind.name().as_bytes()
    }

    pub(crate) fn get_start_time(&self) -> f64 {
        self.start
    }

    pub(crate) fn get_duration(&self) -> f64 {
        self.duration.get()
    }
}

pub(crate) fn clone_detail<'a>(cx: Cx<'_, 'a>, detail: JsLocal<'a>) -> Result<'a, JSValue> {
    let detail = detail.to_js();
    if detail.is_undefined_or_null() {
        return Ok(JSValue::NULL);
    }
    Ok(bun_jsc::cpp::Bun__structuredClone(cx.global(), detail)?)
}

impl DomPerformanceMark {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: DomString,
        options: &PerformanceMarkOptions<'a>,
    ) -> Result<'a, &'a Self> {
        if cx.heap.is_window() && is_legacy_time(&name) {
            let message = format!(
                "'{}' is part of the PerformanceTiming interface, and cannot be used as a mark name.",
                name.to_utf8()
            );
            return Err(dom_error(&cx.heap, DomError::SyntaxError, &message));
        }
        let start = options
            .start_time
            .unwrap_or_else(|| Performance::get(&cx.heap).now());
        if start < 0.0 {
            return Err(cx
                .heap
                .type_error(format_args!("A mark cannot have a negative start time.")));
        }
        let detail = clone_detail(cx, options.detail)?;
        let made = structure.create(&cx.heap, Entry::new(Type::Mark, name, start, 0.0));
        js_DomPerformanceMark::set_detail(made, detail);
        Ok(made)
    }
}

// ───────────────────────────── resources ─────────────────────────────

#[repr(C)]
pub(crate) struct Metric(ServerTiming);

impl Metric {
    pub(crate) fn get_name(&self) -> &[u8] {
        &self.0.name
    }

    pub(crate) fn get_duration(&self) -> f64 {
        self.0.duration
    }

    pub(crate) fn get_description(&self) -> &[u8] {
        &self.0.description
    }
}

#[repr(C)]
pub(crate) struct Resource {
    pub(crate) base: Entry,
    pub(crate) fields: js_DomPerformanceResourceTiming::Fields,
    record: ResourceTiming,
    end: Cell<End>,
    /// In milliseconds since the epoch.
    origin: f64,
}

#[derive(Clone, Copy)]
struct End {
    time: f64,
    sizes: [u64; 3],
}

impl End {
    fn of(record: &ResourceTiming) -> End {
        End {
            time: record.response_end,
            sizes: [
                record.transfer_size,
                record.encoded_size,
                record.decoded_size,
            ],
        }
    }
}

fn since(origin: f64, time: f64) -> f64 {
    if time == 0.0 {
        0.0
    } else {
        coarse(time - origin).max(0.0)
    }
}

impl Resource {
    pub(super) fn new(kind: Type, record: ResourceTiming, origin: f64) -> Resource {
        let (start, end) = if kind == Type::Navigation {
            (0.0, 0.0)
        } else {
            (
                since(origin, record.timing.start),
                since(origin, record.response_end),
            )
        };
        let base = Entry::new(
            kind,
            DomString::from_utf8(crate::values::text(&record.name)),
            start,
            end - start,
        );
        Resource {
            base,
            fields: Default::default(),
            end: End::of(&record).into(),
            record,
            origin,
        }
    }

    pub(super) fn has_ended_like(&self, record: &ResourceTiming) {
        self.end.set(End::of(record));
    }

    fn allows_timing(&self) -> bool {
        self.record.allows_timing || self.kind == Type::Navigation
    }

    pub(super) fn number(&self, name: &[u8]) -> f64 {
        let (
            record,
            timing,
            End {
                time,
                sizes: [transferred, encoded, decoded],
            },
        ) = (&self.record, &self.record.timing, self.end.get());
        let detailed = |time| {
            if self.allows_timing() {
                since(self.origin, time)
            } else {
                0.0
            }
        };
        match name {
            b"redirectStart" if record.allows_timing && record.redirects > 0 => {
                detailed(timing.redirect_start).max(0.1)
            }
            b"redirectEnd" if record.allows_timing => detailed(timing.redirect_end),
            b"fetchStart" if !self.allows_timing() => self.start,
            b"secureConnectionStart" if record.is_secure => detailed(timing.fetch_start),
            b"fetchStart" | b"domainLookupStart" | b"domainLookupEnd" | b"connectStart"
            | b"connectEnd" => detailed(timing.fetch_start),
            b"requestStart" => detailed(timing.request_start),
            b"responseStart" | b"finalResponseHeadersStart" => detailed(timing.response_start),
            b"responseEnd" => since(self.origin, time),
            b"transferSize" if self.allows_timing() => transferred as f64,
            b"encodedBodySize" => encoded as f64,
            b"decodedBodySize" => decoded as f64,
            b"responseStatus" => record.status.into(),
            _ => 0.0,
        }
    }

    fn text(&self, name: &[u8]) -> &[u8] {
        let record = &self.record;
        match name {
            b"initiatorType" if self.kind == Type::Navigation => b"navigation",
            b"initiatorType" => record.initiator_type.as_bytes(),
            b"deliveryType" if self.allows_timing() && record.is_from_cache => b"cache",
            b"nextHopProtocol" if self.allows_timing() => record.protocol.as_bytes(),
            b"renderBlockingStatus" if record.blocks_rendering => b"blocking",
            b"renderBlockingStatus" => b"non-blocking",
            b"contentType" => &record.content_type,
            b"contentEncoding" => record.content_encoding,
            _ => b"",
        }
    }

    pub(crate) fn get_server_timing<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> impl Iterator<Item = &'a Metric> + use<'a> {
        let (realm, all) = (
            self.realm(heap),
            if self.allows_timing() {
                &self.record.server_timing[..]
            } else {
                &[]
            },
        );
        let made = List::from_fn(realm, all.len() as u32, |at| {
            js_DomPerformanceServerTiming::create(realm, Metric(all[at as usize].clone())).to_js()
        });
        // SAFETY: it was filled with these.
        made.values()
            .map(|it| unsafe { Metric::from_js_unchecked(it) })
    }
}

fn resource_of(entry: &Entry) -> &Resource {
    entry.downcast().expect("the receiver was checked")
}

impl ResourceNumber {
    pub(crate) fn get(&self, name: &Impl) -> f64 {
        resource_of(self).number(name.latin1_slice())
    }
}

impl ResourceText {
    pub(crate) fn get(&self, name: &Impl) -> &[u8] {
        resource_of(self).text(name.latin1_slice())
    }
}

impl Milestone {
    pub(crate) fn get(&self, heap: &JsHeap<'_>, name: &Impl) -> f64 {
        Performance::get(self.realm(heap)).milestone(name.latin1_slice())
    }
}

impl DomPerformanceNavigationTiming {
    pub(crate) fn get_type(&self, heap: &JsHeap<'_>) -> &'static [u8] {
        Performance::get(self.realm(heap))
            .navigation_type
            .get()
            .as_bytes()
    }

    pub(crate) fn get_redirect_count(&self) -> u16 {
        if self.record.allows_timing {
            self.record.redirects.into()
        } else {
            0
        }
    }

    pub(crate) fn get_not_restored_reasons(&self) -> Option<JsLocal<'_, JSObject>> {
        None
    }
}

pub(super) fn is_legacy_time(name: &DomString) -> bool {
    name.ascii()
        .is_some_and(|it| js_LegacyTimes::NAMES.binary_search(&it).is_ok())
}

impl LegacyTime {
    pub(crate) fn get<'a>(&'a self, heap: &JsHeap<'a>, name: &Impl) -> f64 {
        let realm = self.realm(heap);
        Performance::get(realm).legacy_time(realm, name.latin1_slice())
    }
}

impl PerformanceNavigation {
    pub(crate) fn get_type(&self, heap: &JsHeap<'_>) -> u16 {
        Performance::get(self.realm(heap)).navigation_type.get() as u16
    }

    pub(crate) fn get_redirect_count(&self, heap: &JsHeap<'_>) -> u16 {
        let realm = self.realm(heap);
        Performance::get(realm)
            .navigation_entry(realm)
            .map_or(0, DomPerformanceNavigationTiming::get_redirect_count)
    }
}

// ───────────────────────────── what is painted ─────────────────────────────

impl DomPerformancePaintTiming {
    pub(crate) fn get_paint_time(&self) -> f64 {
        self.start
    }

    pub(crate) fn get_presentation_time(&self) -> f64 {
        self.start
    }
}

pub(super) struct WeakNode(Weak<()>);

impl WeakNode {
    pub(super) fn new(heap: &JsHeap<'_>, node: &Node) -> WeakNode {
        WeakNode(Weak::create_passive(node.to_js(), global_of(heap)))
    }

    pub(super) fn get<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Node> {
        Node::from_js(heap, self.0.get()?)
    }

    /// <https://w3c.github.io/paint-timing/#exposed-for-paint-timing>
    fn if_exposed<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Node> {
        let node = self.get(heap)?;
        (node.root() == &**node.doc()
            && node.doc().window().is_some()
            && !realm_of(heap).is_stopped())
        .then_some(node)
    }
}

#[repr(C)]
pub(crate) struct EventEntry {
    pub(crate) base: Entry,
    pub(super) processing: [f64; 2],
    pub(super) target: Option<WeakNode>,
    pub(super) interaction: u32,
    pub(super) is_cancelable: bool,
}

impl EventEntry {
    pub(crate) fn get_processing_start(&self) -> f64 {
        self.processing[0]
    }

    pub(crate) fn get_processing_end(&self) -> f64 {
        self.processing[1]
    }

    pub(crate) fn get_cancelable(&self) -> bool {
        self.is_cancelable
    }

    pub(crate) fn get_target<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Node> {
        self.target.as_ref()?.if_exposed(self.realm(heap))
    }

    pub(crate) fn get_interaction_id(&self) -> u32 {
        self.interaction
    }
}

#[repr(C)]
pub(crate) struct Painted {
    pub(crate) base: Entry,
    pub(crate) fields: js_Painted::Fields,
    element: WeakNode,
    load_time: f64,
    id: DomString,
    url: DomString,
    identifier: DomString,
    /// The natural width and height, or the area.
    size: [u32; 2],
}

impl PaintedMembers {
    pub(crate) fn get_render_time(&self) -> f64 {
        self.start
    }

    pub(crate) fn get_load_time(&self) -> f64 {
        self.load_time
    }

    pub(crate) fn get_id(&self) -> &DomString {
        &self.id
    }

    pub(crate) fn get_element<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Node> {
        self.element.if_exposed(self.realm(heap))
    }

    pub(crate) fn get_url(&self) -> &DomString {
        &self.url
    }

    pub(crate) fn get_presentation_time(&self) -> Option<f64> {
        None
    }
}

impl DomPerformanceElementTiming {
    pub(crate) fn get_identifier(&self) -> &DomString {
        &self.identifier
    }

    pub(crate) fn get_natural_width(&self) -> u32 {
        self.size[0]
    }

    pub(crate) fn get_natural_height(&self) -> u32 {
        self.size[1]
    }
}

impl DomLargestContentfulPaint {
    pub(crate) fn get_size(&self) -> u32 {
        self.size[0]
    }
}

impl Painted {
    pub(super) fn new(
        heap: &JsHeap<'_>,
        base: Entry,
        element: &Element,
        load_time: f64,
        url: DomString,
        size: [u32; 2],
    ) -> Painted {
        let [id, identifier] =
            [atom!("id"), atom!("elementtiming")].map(|it| element.attr(it).unwrap_or_default());
        Painted {
            base,
            fields: Default::default(),
            element: WeakNode::new(heap, element),
            load_time,
            id,
            url,
            identifier,
            size,
        }
    }
}
