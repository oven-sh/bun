//! A [`Serialized`] value as it travels between processes. What arrives is checked here, so that the deserializer
//! only sees what the serializer could have written.

use core::ffi::c_void;

use super::*;
use crate::runtime::{self, LooseBlob};
use crate::wire::{Reader, Writer};

type BlobId = [u8; 16];

crate::wire! {
    #[derive(Clone)]
    struct Buffer {
        bytes: Vec<u8>,
        /// If it can be resized.
        most: Option<u64>,
    }

    #[derive(Clone, Default)]
    struct Parts {
        bytes: Vec<u8>,
        buffers: Vec<Buffer>,
        blobs: Vec<(BlobId, LooseBlob)>,
    }

    enum Sent {
        Undefined,
        Null,
        Boolean(bool),
        Number(f64),
        Parts(Parts),
        Unreadable,
    }
}

#[derive(Clone)]
pub(super) struct Flat {
    parts: Parts,
    found: Found,
}

#[derive(Clone, Default)]
struct Found {
    /// Where the id is, and which blob it is.
    blobs: Vec<(usize, usize)>,
    has_keys: bool,
}

#[repr(C)]
struct LentBuffer {
    bytes: *const u8,
    length: usize,
    most: u64,
}

type Append = unsafe extern "C" fn(*mut c_void, kind: u8, *const u8, usize, most: u64);

unsafe extern "C" {
    fn Bun__SerializedScriptValue__flatten(
        value: NonNull<SerializedScriptValue>,
        to: *mut c_void,
        append: Append,
    ) -> bool;
    fn Bun__SerializedScriptValue__deserializeFlat(
        global: &JSGlobalObject,
        bytes: *const u8,
        length: usize,
        buffers: *const LentBuffer,
        buffer_count: usize,
        objects: *const JSValue,
        object_count: usize,
    ) -> JSValue;
    safe fn Bun__isDesktopRealm(global: &JSGlobalObject) -> bool;
    safe fn Bun__Desktop__releaseBlob(id: &BlobId);
}

unsafe extern "C" fn append(to: *mut c_void, kind: u8, bytes: *const u8, length: usize, most: u64) {
    // SAFETY: what `flatten` has passed, and a span.
    let (to, bytes) = unsafe {
        (
            &mut *to.cast::<Parts>(),
            bun_core::ffi::slice(bytes, length),
        )
    };
    match kind {
        0 => to.bytes.extend_from_slice(bytes),
        1 => to.buffers.push(Buffer {
            bytes: bytes.to_vec(),
            most: (most != u64::MAX).then_some(most),
        }),
        _ => (to.blobs)
            .extend((bytes.first_chunk()).and_then(|id| Some((*id, runtime::loosen_blob(id)?)))),
    }
}

fn flatten(value: &Wire) -> Sent {
    let mut parts = Parts::default();
    // SAFETY: `append` takes it for what it is.
    match unsafe { Bun__SerializedScriptValue__flatten(value.0, (&raw mut parts).cast(), append) } {
        true => Sent::Parts(parts),
        false => Sent::Unreadable,
    }
}

pub(super) fn unreadable(global: &JSGlobalObject) -> bun_jsc::JsError {
    global.throw_dom_exception(
        bun_jsc::DOMExceptionCode::DataCloneError,
        format_args!("The object can not be cloned."),
    )
}

impl Flat {
    /// What the serializer has just written.
    pub(super) fn trusting(bytes: Vec<u8>) -> Flat {
        Flat {
            parts: Parts {
                bytes,
                ..Parts::default()
            },
            found: Found::default(),
        }
    }

    pub(super) fn deserialize(
        &self,
        global: &JSGlobalObject,
        objects: &[JSValue],
    ) -> JsResult<JSValue> {
        if self.found.has_keys && !Bun__isDesktopRealm(global) {
            return Err(unreadable(global));
        }
        let lend = |it: &Buffer| LentBuffer {
            bytes: it.bytes.as_ptr(),
            length: it.bytes.len(),
            most: it.most.unwrap_or(u64::MAX),
        };
        let buffers: Vec<_> = self.parts.buffers.iter().map(lend).collect();
        let retain = |it: &(BlobId, LooseBlob)| runtime::retain_blob(global, it.1.clone());
        let ids: Vec<_> = self.parts.blobs.iter().map(retain).collect();
        let mut bytes = std::borrow::Cow::from(&self.parts.bytes);
        for &(at, blob) in &self.found.blobs {
            bytes.to_mut()[at..at + 16].copy_from_slice(&ids[blob]);
        }
        // SAFETY: the pointers and the lengths are those of slices.
        let value = from_js_host_call(global, || unsafe {
            Bun__SerializedScriptValue__deserializeFlat(
                global,
                bytes.as_ptr(),
                bytes.len(),
                buffers.as_ptr(),
                buffers.len(),
                objects.as_ptr(),
                objects.len(),
            )
        });
        for id in &ids {
            Bun__Desktop__releaseBlob(id);
        }
        value
    }
}

impl wire::Wire for Serialized {
    fn write(self, to: &mut Writer) {
        match self.0 {
            Form::Immediate(bits) => match JSValue::from_encoded(bits) {
                it if it.is_null() => Sent::Null,
                it if it.is_boolean() => Sent::Boolean(it.to_boolean()),
                it => it.get_number().map_or(Sent::Undefined, Sent::Number),
            },
            Form::Wire(value) => flatten(&value),
            Form::Flat(value) => Sent::Parts(Arc::unwrap_or_clone(value).parts),
            Form::Unreadable => Sent::Unreadable,
        }
        .write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Serialized> {
        let immediate = |it: JSValue| Form::Immediate(it.encoded());
        Ok(Serialized(match Sent::read(from)? {
            Sent::Undefined => immediate(JSValue::UNDEFINED),
            Sent::Null => immediate(JSValue::NULL),
            Sent::Boolean(it) => immediate(it.into()),
            Sent::Number(it) if it.is_nan() => immediate(JSValue::js_number(f64::NAN)),
            Sent::Number(it) => immediate(JSValue::js_number(it)),
            Sent::Parts(parts) => check(&parts).map_or(Form::Unreadable, |found| {
                Form::Flat(Arc::new(Flat { parts, found }))
            }),
            Sent::Unreadable => Form::Unreadable,
        }))
    }
}

crate::wire! {
    enum Travelling {
        Port(Endpoint),
        ReadableStream(Endpoint),
        WritableStream(Endpoint),
        TransformStream { readable: Endpoint, writable: Endpoint },
        Lost,
    }
}

thread_local! {
    static REHEARSED: ManuallyDrop<RefCell<VecDeque<Transferred>>> = ManuallyDrop::default();
}

impl wire::Wire for Transferred {
    fn write(self, to: &mut Writer) {
        match self {
            Transferred::Port(it) => Travelling::Port(it),
            Transferred::ReadableStream(it) => Travelling::ReadableStream(it),
            Transferred::WritableStream(it) => Travelling::WritableStream(it),
            Transferred::TransformStream { readable, writable } => {
                Travelling::TransformStream { readable, writable }
            }
            canvas => {
                if to.peer().is_none() {
                    REHEARSED.with(|it| it.borrow_mut().push_back(canvas));
                }
                Travelling::Lost
            }
        }
        .write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Transferred> {
        Ok(match Travelling::read(from)? {
            Travelling::Port(it) => Transferred::Port(it),
            Travelling::ReadableStream(it) => Transferred::ReadableStream(it),
            Travelling::WritableStream(it) => Transferred::WritableStream(it),
            Travelling::TransformStream { readable, writable } => {
                Transferred::TransformStream { readable, writable }
            }
            Travelling::Lost => (from.peer().is_none())
                .then(|| REHEARSED.with(|it| it.borrow_mut().pop_front()))
                .flatten()
                .unwrap_or_else(|| Transferred::Canvas(Box::new(()))),
        })
    }
}

/// `SerializationTag`
mod tag {
    pub(super) const ARRAY: u8 = 1;
    pub(super) const OBJECT: u8 = 2;
    pub(super) const UNDEFINED: u8 = 3;
    pub(super) const NULL: u8 = 4;
    pub(super) const INT: u8 = 5;
    pub(super) const ZERO: u8 = 6;
    pub(super) const TRUE: u8 = 9;
    pub(super) const DOUBLE: u8 = 10;
    pub(super) const DATE: u8 = 11;
    pub(super) const STRING: u8 = 16;
    pub(super) const EMPTY_STRING: u8 = 17;
    pub(super) const REG_EXP: u8 = 18;
    pub(super) const OBJECT_REFERENCE: u8 = 19;
    pub(super) const HOST_OBJECT: u8 = 20;
    pub(super) const BUFFER: u8 = 21;
    pub(super) const VIEW: u8 = 22;
    pub(super) const TRANSFERRED_BUFFER: u8 = 23;
    pub(super) const TRUE_OBJECT: u8 = 24;
    pub(super) const FALSE_OBJECT: u8 = 25;
    pub(super) const STRING_OBJECT: u8 = 26;
    pub(super) const EMPTY_STRING_OBJECT: u8 = 27;
    pub(super) const NUMBER_OBJECT: u8 = 28;
    pub(super) const SET: u8 = 29;
    pub(super) const MAP: u8 = 30;
    pub(super) const END_OF_MAP: u8 = 31;
    pub(super) const END_OF_SET: u8 = 32;
    pub(super) const CRYPTO_KEY: u8 = 33;
    pub(super) const BIG_INT: u8 = 47;
    pub(super) const BIG_INT_OBJECT: u8 = 48;
    pub(super) const DOM_EXCEPTION: u8 = 51;
    pub(super) const RESIZABLE_BUFFER: u8 = 54;
    pub(super) const ERROR: u8 = 55;
    pub(super) const BLOB: u8 = 247;
    pub(super) const ERROR_WITH_CAUSE: u8 = 248;
    pub(super) const PLATFORM_OBJECT: u8 = 249;
}

const VERSION: u32 = 14;
const VERSION_WITH_LATER_TAGS: u32 = 15;
const TERMINATOR: u32 = !0;
const IN_POOL: u32 = !1;
const NO_MORE_INDICES: u32 = !2;
const IS_8_BIT: u32 = 1 << 31;
/// From this length on, nothing is allocated for the elements of an array before they are there.
const SPARSE: u32 = 1 << 27;
const SPARE_ELEMENTS: usize = 1 << 22;
const MOST_RESERVED: u64 = 8 << 30;
const MOST_IN_VIEW: u64 = 1 << 40;

#[derive(Clone, Copy)]
enum Inside {
    Array { length: u32 },
    Members,
    Map { has_key: bool },
    Set,
}

struct Check<'a> {
    parts: &'a Parts,
    rest: &'a [u8],
    strings: usize,
    objects: usize,
    elements_left: usize,
    reserved: u64,
    found: Found,
}

impl<'a> Check<'a> {
    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let (taken, rest) = self.rest.split_first_chunk()?;
        self.rest = rest;
        Some(*taken)
    }

    fn byte(&mut self) -> Option<u8> {
        self.take().map(u8::from_le_bytes)
    }

    fn u32(&mut self) -> Option<u32> {
        self.take().map(u32::from_le_bytes)
    }

    fn u64(&mut self) -> Option<u64> {
        self.take().map(u64::from_le_bytes)
    }

    fn skip(&mut self, length: u64) -> Option<()> {
        self.rest = self.rest.get(usize::try_from(length).ok()?..)?;
        Some(())
    }

    fn takes(&mut self, tag: u8) -> bool {
        let rest = self.rest.strip_prefix(&[tag]);
        rest.map(|it| self.rest = it).is_some()
    }

    fn index_in(&mut self, pool: usize) -> Option<()> {
        let index = match pool {
            ..=0xff => self.byte()?.into(),
            0x100..=0xffff => self.take().map(u16::from_le_bytes)?.into(),
            _ => self.u32()?,
        };
        ((index as usize) < pool).then_some(())
    }

    /// False at the end of the members of an object.
    fn string_or_end(&mut self) -> Option<bool> {
        match self.u32()? {
            TERMINATOR => return Some(false),
            IN_POOL => self.index_in(self.strings)?,
            length => {
                let width = if length & IS_8_BIT == 0 { 2 } else { 1 };
                self.skip(u64::from(length & !IS_8_BIT) * width)?;
                self.strings += 1;
            }
        }
        Some(true)
    }

    fn string(&mut self) -> Option<()> {
        self.string_or_end()?.then_some(())
    }

    fn nullable_string(&mut self) -> Option<()> {
        match self.u32()? {
            0 => self.string(),
            1 => Some(()),
            _ => None,
        }
    }

    fn big_int(&mut self) -> Option<()> {
        (self.byte()? <= 1).then_some(())?;
        let digits = self.u32()?;
        self.skip(u64::from(digits) * 8)
    }

    fn reserve(&mut self, length: u64, most: u64) -> Option<()> {
        self.reserved = self.reserved.checked_add(most)?;
        (length <= most && self.reserved <= MOST_RESERVED).then_some(())
    }

    fn error(&mut self) -> Option<()> {
        (self.byte()? <= 6).then_some(())?;
        self.nullable_string()?;
        self.skip(8)?;
        self.nullable_string()?;
        self.nullable_string()
    }

    fn view(&mut self) -> Option<()> {
        let (kind, offset, length) = (self.byte()?, self.u64()?, self.u64()?);
        let is_of_buffer = matches!(
            *self.rest.first()?,
            tag::BUFFER | tag::RESIZABLE_BUFFER | tag::TRANSFERRED_BUFFER | tag::OBJECT_REFERENCE
        );
        (kind <= 12
            && offset <= MOST_IN_VIEW
            && (length <= MOST_IN_VIEW || length == u64::MAX)
            && is_of_buffer)
            .then_some(())?;
        self.value().map(drop)
    }

    fn blob(&mut self) -> Option<()> {
        let (at, id) = (self.parts.bytes.len() - self.rest.len(), self.take()?);
        let blob = self.parts.blobs.iter().position(|it| it.0 == id)?;
        self.found.blobs.push((at, blob));
        Some(())
    }

    /// What it has opened, if anything.
    fn value(&mut self) -> Option<Option<Inside>> {
        let mut opened = None;
        match self.byte()? {
            tag::UNDEFINED | tag::NULL | tag::ZERO..=tag::TRUE | tag::EMPTY_STRING => {
                return Some(None);
            }
            tag::INT | tag::HOST_OBJECT => return self.skip(4).map(|()| None),
            tag::DOUBLE => return self.skip(8).map(|()| None),
            tag::STRING => return self.string().map(|()| None),
            tag::BIG_INT => return self.big_int().map(|()| None),
            tag::OBJECT_REFERENCE => return self.index_in(self.objects).map(|()| None),
            tag::TRANSFERRED_BUFFER => {
                return ((self.u32()? as usize) < self.parts.buffers.len()).then_some(None);
            }
            tag::ARRAY => {
                let length = self.u32()?;
                if length < SPARSE {
                    self.elements_left = self.elements_left.checked_sub(length as usize)?;
                }
                opened = Some(Inside::Array { length });
            }
            tag::OBJECT | tag::PLATFORM_OBJECT => opened = Some(Inside::Members),
            tag::MAP => opened = Some(Inside::Map { has_key: false }),
            tag::SET => opened = Some(Inside::Set),
            tag::ERROR_WITH_CAUSE => {
                self.takes(tag::ERROR).then_some(())?;
                self.error()?;
                opened = Some(Inside::Members);
            }
            tag::TRUE_OBJECT | tag::FALSE_OBJECT | tag::EMPTY_STRING_OBJECT => {}
            tag::DATE | tag::NUMBER_OBJECT => self.skip(8)?,
            tag::STRING_OBJECT => self.string()?,
            tag::BIG_INT_OBJECT => self.big_int()?,
            tag::REG_EXP | tag::DOM_EXCEPTION => {
                self.string()?;
                self.string()?;
            }
            tag::ERROR => self.error()?,
            tag::BUFFER => {
                let length = self.u64()?;
                self.skip(length)?;
            }
            tag::RESIZABLE_BUFFER => {
                let (length, most) = (self.u64()?, self.u64()?);
                self.reserve(length, most)?;
                self.skip(length)?;
            }
            tag::VIEW => self.view()?,
            tag::CRYPTO_KEY => {
                let length = self.u32()?;
                self.skip(length.into())?;
                self.found.has_keys = true;
            }
            tag::BLOB => self.blob()?,
            _ => return None,
        }
        self.objects += 1;
        Some(opened)
    }
}

fn check(parts: &Parts) -> Option<Found> {
    let mut it = Check {
        parts,
        rest: &parts.bytes,
        strings: 0,
        objects: 0,
        elements_left: parts.bytes.len() + SPARE_ELEMENTS,
        reserved: 0,
        found: Found::default(),
    };
    for buffer in &parts.buffers {
        if let Some(most) = buffer.most {
            it.reserve(buffer.bytes.len() as u64, most)?;
        }
    }
    (VERSION..=VERSION_WITH_LATER_TAGS)
        .contains(&it.u32()?)
        .then_some(())?;
    let mut open = Vec::from_iter(it.value()?);
    while let Some(inside) = open.last_mut() {
        let has_value = match *inside {
            Inside::Array { length } => match it.u32()? {
                TERMINATOR => false,
                NO_MORE_INDICES => {
                    *inside = Inside::Members;
                    continue;
                }
                index => (index < length).then_some(true)?,
            },
            Inside::Members => it.string_or_end()?,
            Inside::Map { has_key: false } if it.takes(tag::END_OF_MAP) => {
                *inside = Inside::Members;
                continue;
            }
            Inside::Map { has_key } => {
                *inside = Inside::Map { has_key: !has_key };
                true
            }
            Inside::Set if it.takes(tag::END_OF_SET) => {
                *inside = Inside::Members;
                continue;
            }
            Inside::Set => true,
        };
        match has_value {
            true => open.extend(it.value()?),
            false => drop(open.pop()),
        }
    }
    it.rest.is_empty().then_some(it.found)
}
