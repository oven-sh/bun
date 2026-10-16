//! XML for `bun:dom`. The parser's events go to C++ as one flat list, and `XMLDocumentParser.cpp` in `src/jsc/bindings/webcore/xml/parser` resolves the namespaces and builds the nodes.

use bun_alloc::Arena;
use bun_ast::{Loc, Log, Source};

use super::{ExternalId, HtmlEntityLookup, InputEncoding, Options, Parser, Sink};

// ─── The C ABI, which `BunXMLParser.h` next to `XMLDocumentParser.cpp` mirrors ───

/// A part of the `strings` of the list, in UTF-16 code units.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct StringRange {
    offset: u32,
    length: u32,
}

#[repr(u8)]
#[derive(Clone, Copy)]
enum EventKind {
    /// `first` is the qualified name. The `Attribute`s of the element follow, those that the DTD defaults last.
    StartElement = 0,
    /// `first` is the qualified name, `second` the normalized value.
    Attribute = 1,
    EndElement = 2,
    /// `first` is the data, also of the next two.
    Text = 3,
    CdataSection = 4,
    Comment = 5,
    /// `first` is the target, `second` the data.
    ProcessingInstruction = 6,
    /// Only the place of the doctype. Its strings are in the list.
    DocumentType = 7,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Event {
    kind: EventKind,
    /// `StartElement`: where the tag starts, in code units of the input.
    position: u32,
    first: StringRange,
    second: StringRange,
}

#[repr(u8)]
#[derive(Clone, Copy)]
enum Standalone {
    Unspecified = 0,
    No = 1,
    Yes = 2,
}

/// Owns the three arrays.
#[repr(C)]
struct EventList {
    events: *mut Event,
    event_count: usize,
    strings: *mut u16,
    strings_length: usize,
    /// UTF-8, and empty if the input is well-formed. Otherwise `events` is what came before the error.
    error_message: *mut u8,
    error_message_length: usize,
    /// In code units of the input.
    error_position: usize,
    xml_version: StringRange,
    xml_encoding: StringRange,
    doctype_name: StringRange,
    doctype_public_id: StringRange,
    doctype_system_id: StringRange,
    has_xml_declaration: bool,
    standalone: Standalone,
}

/// Returns whether `input` (UTF-16, only read during the call) is well-formed XML 1.0, namespaces aside. Always writes `result`, which the caller gives back to `Bun__XML__DOM__freeEventList`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__XML__DOM__parse(
    input: *const u16,
    input_length: usize,
    html_entities: Option<HtmlEntityLookup<u16>>,
    result: *mut EventList,
) -> bool {
    let input: &[u16] = if input_length == 0 {
        &[]
    } else {
        // SAFETY: the caller passes a valid pointer and length.
        unsafe { core::slice::from_raw_parts(input, input_length) }
    };
    let list = parse(input, html_entities);
    let is_well_formed = list.error_message_length == 0;
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe { result.write(list) };
    is_well_formed
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__XML__DOM__freeEventList(list: *mut EventList) {
    // SAFETY: the caller gives the list back, and does not use it again.
    drop(unsafe { list.read() });
}

// ─── The parser ───

fn parse(input: &[u16], html_entities: Option<HtmlEntityLookup<u16>>) -> EventList {
    let arena = Arena::new();
    let mut log = Log::init();
    // As for `XML::parse_utf16`, the source is only what the length limit is checked on.
    let source = Source::init_path_string(b"document.xml", bytemuck::cast_slice::<u16, u8>(input));
    let is_parseable = source.check_parseable_len(&mut log, "XML document").is_ok();
    let (sink, is_well_formed, error_position) = if is_parseable {
        let options = Options {
            compact: false,
            encoding: InputEncoding::Text,
        };
        let sink = DomSink::new(input.len());
        let mut parser = Parser::new(&source, input, &mut log, &arena, options, sink);
        parser.scanner.for_dom = true;
        parser.scanner.html_entities = html_entities;
        let is_well_formed = parser.parse_document().is_ok();
        (parser.sink, is_well_formed, parser.scanner.error_pos)
    } else {
        (DomSink::new(0), false, 0)
    };
    let error_message: &[u8] = if sink.is_too_large {
        b"XML document is too large"
    } else if is_well_formed {
        b""
    } else {
        match log.msgs.first() {
            Some(message) => message.data.text.as_ref(),
            None => b"XML document is not well-formed",
        }
    };
    EventList::new(sink, error_message, error_position)
}

/// The longest string that C++ can make.
const MAX_STRINGS_LENGTH: usize = i32::MAX as usize;

struct DomSink {
    events: Vec<Event>,
    strings: Vec<u16>,
    xml_version: StringRange,
    xml_encoding: StringRange,
    doctype_name: StringRange,
    doctype_public_id: StringRange,
    doctype_system_id: StringRange,
    has_xml_declaration: bool,
    standalone: Standalone,
    /// `strings` is full. Nothing is recorded from then on.
    is_too_large: bool,
}

impl DomSink {
    fn new(input_length: usize) -> DomSink {
        DomSink {
            events: Vec::with_capacity(input_length / 16),
            strings: Vec::with_capacity(input_length),
            xml_version: StringRange::default(),
            xml_encoding: StringRange::default(),
            doctype_name: StringRange::default(),
            doctype_public_id: StringRange::default(),
            doctype_system_id: StringRange::default(),
            has_xml_declaration: false,
            standalone: Standalone::Unspecified,
            is_too_large: false,
        }
    }

    fn string(&mut self, units: &[u16]) -> StringRange {
        if self.is_too_large || units.len() > MAX_STRINGS_LENGTH - self.strings.len() {
            self.is_too_large = true;
            return StringRange::default();
        }
        let offset = self.strings.len() as u32;
        self.strings.extend_from_slice(units);
        StringRange {
            offset,
            length: units.len() as u32,
        }
    }

    fn event(&mut self, kind: EventKind, position: usize, first: &[u16], second: &[u16]) {
        let first = self.string(first);
        let second = self.string(second);
        if !self.is_too_large {
            self.events.push(Event {
                kind,
                position: position as u32,
                first,
                second,
            });
        }
    }
}

impl<'a> Sink<'a, u16> for DomSink {
    type Output = ();

    fn begin_element(&mut self, name: &'a [u16], _loc: Loc, pos: usize) {
        self.event(EventKind::StartElement, pos, name, &[]);
    }

    fn attribute(&mut self, name: &'a [u16], value: &'a [u16]) {
        self.event(EventKind::Attribute, 0, name, value);
    }

    fn text(&mut self, text: &'a [u16], _loc: Loc) {
        self.event(EventKind::Text, 0, text, &[]);
    }

    fn cdata(&mut self, text: &'a [u16]) {
        self.event(EventKind::CdataSection, 0, text, &[]);
    }

    fn comment(&mut self, text: &'a [u16], _loc: Loc) {
        self.event(EventKind::Comment, 0, text, &[]);
    }

    fn pi(&mut self, target: &'a [u16], data: &'a [u16], _loc: Loc) {
        self.event(EventKind::ProcessingInstruction, 0, target, data);
    }

    fn end_element(&mut self) {
        self.event(EventKind::EndElement, 0, &[], &[]);
    }

    fn end_leaf(&mut self, text: &'a [u16], loc: Loc) {
        if !text.is_empty() {
            self.text(text, loc);
        }
        self.end_element();
    }

    fn xml_declaration(
        &mut self,
        version: &'a [u16],
        encoding: Option<&'a [u16]>,
        standalone: Option<bool>,
    ) {
        self.has_xml_declaration = true;
        self.xml_version = self.string(version);
        self.xml_encoding = self.string(encoding.unwrap_or_default());
        self.standalone = match standalone {
            None => Standalone::Unspecified,
            Some(false) => Standalone::No,
            Some(true) => Standalone::Yes,
        };
    }

    fn doctype(&mut self, name: &'a [u16], external_id: ExternalId<'a, u16>) {
        self.doctype_name = self.string(name);
        self.doctype_public_id = self.string(external_id.public_id);
        self.doctype_system_id = self.string(external_id.system_id);
        self.event(EventKind::DocumentType, 0, &[], &[]);
    }

    fn misc_comment(&mut self, text: &'a [u16]) {
        self.event(EventKind::Comment, 0, text, &[]);
    }

    fn misc_pi(&mut self, target: &'a [u16], data: &'a [u16]) {
        self.event(EventKind::ProcessingInstruction, 0, target, data);
    }

    fn finish(&mut self) {}
}

// ─── Ownership ───

fn into_raw_parts<T>(items: Vec<T>) -> (*mut T, usize) {
    let items = items.into_boxed_slice();
    let length = items.len();
    (Box::into_raw(items).cast::<T>(), length)
}

/// # Safety
/// The two are what `into_raw_parts` returned, and are not used again.
unsafe fn free_raw_parts<T>(pointer: *mut T, length: usize) {
    // SAFETY: the caller's contract.
    drop(unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(pointer, length)) });
}

impl EventList {
    fn new(sink: DomSink, error_message: &[u8], error_position: usize) -> EventList {
        let (events, event_count) = into_raw_parts(sink.events);
        let (strings, strings_length) = into_raw_parts(sink.strings);
        let (error_message, error_message_length) = into_raw_parts(error_message.to_vec());
        EventList {
            events,
            event_count,
            strings,
            strings_length,
            error_message,
            error_message_length,
            error_position,
            xml_version: sink.xml_version,
            xml_encoding: sink.xml_encoding,
            doctype_name: sink.doctype_name,
            doctype_public_id: sink.doctype_public_id,
            doctype_system_id: sink.doctype_system_id,
            has_xml_declaration: sink.has_xml_declaration,
            standalone: sink.standalone,
        }
    }
}

impl Drop for EventList {
    fn drop(&mut self) {
        // SAFETY: `new` made all three with `into_raw_parts`.
        unsafe {
            free_raw_parts(self.events, self.event_count);
            free_raw_parts(self.strings, self.strings_length);
            free_raw_parts(self.error_message, self.error_message_length);
        }
    }
}
