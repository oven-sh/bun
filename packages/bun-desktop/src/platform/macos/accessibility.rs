//! Between `accessibility::cocoa` and accessibility.m.

use std::ffi::{c_char, c_void};
use std::ptr::null_mut;

use super::borrow;
use crate::abi::Rect;
use crate::accessibility::cocoa::{self, Parameter, Value};
use crate::accessibility::text::Position;
use crate::accessibility::{self, Event, Id, read};
use crate::guard;

/// Retained.
type Object = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct Marker {
    node: u64,
    offset: u32,
    is_upstream: u32,
}

impl From<Position> for Marker {
    fn from(it: Position) -> Marker {
        Marker {
            node: it.node.bits(),
            offset: it.offset as u32,
            is_upstream: it.is_upstream.into(),
        }
    }
}

impl From<Marker> for Position {
    fn from(it: Marker) -> Position {
        Position {
            node: Id::from_bits(it.node),
            offset: it.offset as usize,
            is_upstream: it.is_upstream != 0,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy)]
#[expect(dead_code, reason = "accessibility.m makes them")]
enum Kind {
    Nothing,
    Number,
    TwoNumbers,
    Span,
    Point,
    Area,
    Text,
    Element,
    OneMarker,
    TwoMarkers,
    Replacement,
    Search,
}

#[repr(C)]
struct Given {
    kind: Kind,
    numbers: [f64; 4],
    markers: [Marker; 2],
    text: *const c_char,
    keys: *const c_char,
}

impl Given {
    /// # Safety
    /// The strings of its kind are terminated.
    unsafe fn decode(&self) -> Option<Parameter> {
        let ([a, b, c, d], element) = (self.numbers, Id::from_bits(self.markers[0].node));
        // SAFETY: the caller's contract.
        let string = |it| unsafe { borrow(it) }.into_owned();
        let span = a as usize..(a as usize).saturating_add(b as usize);
        Some(match self.kind {
            Kind::Nothing => return None,
            Kind::Number => Parameter::Number(a),
            Kind::TwoNumbers => Parameter::Numbers(vec![a, b]),
            Kind::Span => Parameter::Range(span),
            Kind::Point => Parameter::Point([a as f32, b as f32]),
            Kind::Area => Parameter::Rect(Rect {
                x: a as f32,
                y: b as f32,
                width: c as f32,
                height: d as f32,
            }),
            Kind::Text => Parameter::Text(string(self.text)),
            Kind::Element => Parameter::Element(element),
            Kind::OneMarker => Parameter::Marker(self.markers[0].into()),
            Kind::TwoMarkers => Parameter::Markers(self.markers.map(Position::from)),
            Kind::Replacement => Parameter::Replacement(span, string(self.text)),
            Kind::Search => Parameter::Search {
                keys: string(self.keys),
                start: (element != Id::default()).then_some(element),
                is_backwards: a != 0.,
                limit: if b < 0. { usize::MAX } else { b as usize },
                text: string(self.text),
                only_visible: c != 0.,
                only_children: d != 0.,
            },
        })
    }
}

#[repr(u8)]
enum TextKind {
    Plain,
    Link,
    Attributed,
}

#[repr(u8)]
enum PlaceKind {
    Frame,
    Position,
    Size,
}

unsafe extern "C" {
    safe fn bd_has_screen_reader() -> bool;
    safe fn bd_make_number(value: f64, is_boolean: bool) -> Object;
    safe fn bd_make_range(start: usize, length: usize) -> Object;
    safe fn bd_make_view(window: u32, is_window: bool) -> Object;
    safe fn bd_make_marker(marker: Marker) -> Object;
    safe fn bd_make_marker_range(start: Marker, end: Marker) -> Object;
    safe fn bd_make_color(rgba: u32) -> Object;
    safe fn bd_make_element(node: u64) -> Object;
    safe fn bd_make_place(window: u32, rect: Rect, kind: PlaceKind) -> Object;
    safe fn bd_forget_element(node: u64);
    safe fn bd_is_known(node: u64) -> bool;
    fn bd_make_text(units: *const u16, length: usize, kind: TextKind) -> Object;
    fn bd_make_role_description(phrase: Object, role: Object, subrole: Object) -> Object;
    fn bd_make_list(items: *const Object, count: usize) -> Object;
    fn bd_make_dictionary(keys: Object, values: Object) -> Object;
    fn bd_add_attribute(text: Object, name: Object, value: Object, start: usize, length: usize);
    fn bd_unless_null(value: Object) -> Object;
    fn bd_post(name: Object, target: Object, info: Object, is_delayed: bool);
}

pub fn has_screen_reader() -> bool {
    bd_has_screen_reader()
}

/// What decodes UTF-8 there drops a U+FEFF at the start.
fn text(it: &str, kind: TextKind) -> Object {
    let it: Vec<_> = it.encode_utf16().collect();
    // SAFETY: a live slice with its length.
    unsafe { bd_make_text(it.as_ptr(), it.len(), kind) }
}

fn list(items: impl Iterator<Item = Object>) -> Object {
    let items: Vec<_> = items.collect();
    // SAFETY: as above, of objects that nothing else releases.
    unsafe { bd_make_list(items.as_ptr(), items.len()) }
}

fn make(value: &Value) -> Object {
    let plain = |it| text(it, TextKind::Plain);
    match value {
        Value::Bool(it) => bd_make_number((*it).into(), true),
        Value::Number(it) => bd_make_number(*it, false),
        Value::Text(it) => plain(it),
        Value::Url(it) => text(it, TextKind::Link),
        // SAFETY: strings that nothing else releases.
        Value::RoleDescription(phrase, role, subrole) => unsafe {
            bd_make_role_description(
                phrase.map_or(null_mut(), plain),
                plain(role),
                subrole.map_or(null_mut(), plain),
            )
        },
        Value::Color(it) => bd_make_color(*it),
        Value::Element(it) => bd_make_element(it.bits()),
        Value::View(it) => bd_make_view(*it, false),
        Value::Window(it) => bd_make_view(*it, true),
        Value::List(it) => list(it.iter().map(make)),
        // SAFETY: two arrays of the same length.
        Value::Dictionary(it) => unsafe {
            bd_make_dictionary(
                list(it.iter().map(|it| plain(it.0))),
                list(it.iter().map(|it| make(&it.1))),
            )
        },
        Value::Rect(window, it) => bd_make_place(*window, *it, PlaceKind::Frame),
        Value::Position(window, it) => bd_make_place(*window, *it, PlaceKind::Position),
        Value::Size(it) => bd_make_place(0, *it, PlaceKind::Size),
        Value::Range(it) => bd_make_range(it.start, it.len()),
        Value::Marker(it) => bd_make_marker((*it).into()),
        Value::MarkerRange([start, end]) => bd_make_marker_range((*start).into(), (*end).into()),
        Value::Attributed(string, attributes) => {
            let made = text(string, TextKind::Attributed);
            for (range, name, value) in attributes {
                // SAFETY: the range is in the string.
                unsafe {
                    bd_add_attribute(made, plain(name), make(value), range.start, range.len())
                };
            }
            made
        }
    }
}

fn answer(value: impl FnOnce() -> Option<Value>) -> Object {
    // SAFETY: it has just been made.
    guard("error", None, value).map_or(null_mut(), |it| unsafe { bd_unless_null(make(&it)) })
}

pub fn post(events: &[Event]) {
    for it in read(|forest| cocoa::notifications(forest, events)) {
        match (it.name, &it.target) {
            ("AXUIElementDestroyed", Value::Element(id)) => bd_forget_element(id.bits()),
            ("AXTitleChanged" | "AXValueChanged", Value::Element(id))
                if !bd_is_known(id.bits()) => {}
            // SAFETY: they have just been made.
            _ => unsafe {
                bd_post(
                    text(it.name, TextKind::Plain),
                    make(&it.target),
                    it.info.as_ref().map_or(null_mut(), make),
                    it.is_delayed,
                )
            },
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_clients(is_enhanced: bool, has_screen_reader: bool) {
    guard("error", (), || {
        accessibility::set_clients(is_enhanced || has_screen_reader, has_screen_reader)
    });
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_was_used(window: u32) {
    guard("error", (), || {
        accessibility::note_use();
        if window != 0 {
            accessibility::wait_for_trees(window);
        }
    });
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_window(node: u64) -> u32 {
    read(|it| cocoa::window_of(it, Id::from_bits(node))).unwrap_or(0)
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_roots(window: u32) -> Object {
    answer(|| read(|it| Some(cocoa::roots(it, window))))
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_focus(window: u32) -> Object {
    answer(|| read(|it| cocoa::focus(it, window)))
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_hit(window: u32, within: u64, x: f32, y: f32) -> Object {
    answer(|| {
        read(|it| {
            cocoa::hit(
                it,
                (within != 0).then(|| Id::from_bits(within)),
                window,
                [x, y],
            )
        })
    })
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_custom_description(node: u64) -> Object {
    answer(|| read(|it| cocoa::custom_description(it, Id::from_bits(node))))
}

#[unsafe(no_mangle)]
extern "C" fn bd_accessibility_names(node: u64, kind: u8) -> Object {
    let names = [
        cocoa::attribute_names,
        cocoa::parameterized_names,
        cocoa::action_names,
    ][usize::from(kind)];
    let names = guard("error", Vec::new(), || {
        read(|it| names(it, Id::from_bits(node)))
    });
    list(names.into_iter().map(|it| text(it, TextKind::Plain)))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_accessibility_value(
    node: u64,
    name: *const c_char,
    parameter: Option<&Given>,
) -> Object {
    accessibility::note_use();
    // SAFETY: a string.
    let (id, name) = (Id::from_bits(node), unsafe { borrow(name) });
    answer(|| match parameter {
        // SAFETY: `decode` of accessibility.m made it.
        Some(it) => read(|forest| cocoa::value_for(forest, id, &name, unsafe { it.decode() }?)),
        None => read(|forest| cocoa::value(forest, id, &name)),
    })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_accessibility_is_settable(node: u64, name: *const c_char) -> bool {
    // SAFETY: a string.
    read(|it| cocoa::is_settable(it, Id::from_bits(node), &unsafe { borrow(name) }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_accessibility_set(node: u64, name: *const c_char, to: &Given) -> bool {
    // SAFETY: as in `bd_accessibility_value`.
    let (name, to) = unsafe { (borrow(name), to.decode()) };
    guard("error", false, || {
        to.is_some_and(|to| cocoa::set(Id::from_bits(node), &name, to))
    })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bd_accessibility_act(node: u64, name: *const c_char) {
    // SAFETY: a string.
    let name = unsafe { borrow(name) };
    guard("error", (), || cocoa::act(Id::from_bits(node), &name));
}
