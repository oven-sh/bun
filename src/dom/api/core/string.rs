//! The strings of the DOM are those of JavaScript.

use core::cell::{Cell, OnceCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use std::borrow::Cow;
use std::rc::Rc;

use bun_alloc::WTFStringImplStruct as Impl;
use bun_core::strings;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSString, JSValue};
use bun_web::net::body::SharedBytes;

use super::atom::Atom;
use super::atoms::Known;

unsafe extern "C" {
    safe fn Bun__DOM__emptyString() -> NonNull<Impl>;
    safe fn Bun__DOM__createLatin1(length: u32, characters: &mut *mut u8) -> NonNull<Impl>;
    safe fn Bun__DOM__createUTF16(length: u32, characters: &mut *mut u16) -> NonNull<Impl>;
    safe fn Bun__DOM__substring(of: &Impl, start: u32, length: u32) -> NonNull<Impl>;
    safe fn Bun__DOM__sharedPrefix(of: &Impl, length: u32) -> NonNull<Impl>;
    safe fn Bun__DOM__stringToJS(global: &JSGlobalObject, string: &Impl) -> JSValue;
    safe fn Bun__DOM__permanentString(global: &JSGlobalObject, string: &Impl) -> JSValue;
    fn Bun__DOM__copyRope(rope: JSValue, room: *mut u8, capacity: usize) -> usize;
    fn Bun__DOM__createEraser(
        global: &JSGlobalObject,
        values: *mut JSValue,
        count: usize,
    ) -> *mut c_void;
    fn Bun__DOM__destroyEraser(eraser: *mut c_void);
}

#[inline(always)]
pub(super) fn is_ascii(text: &[u8]) -> bool {
    let bits = match (
        text.first_chunk(),
        text.last_chunk(),
        text.first_chunk(),
        text.last_chunk(),
    ) {
        _ if text.len() > 16 => return text.is_ascii(),
        (Some(start), Some(end), ..) => u64::from_ne_bytes(*start) | u64::from_ne_bytes(*end),
        (.., Some(start), Some(end)) => {
            u64::from(u32::from_ne_bytes(*start) | u32::from_ne_bytes(*end))
        }
        _ => text.first().map_or(0, |it| {
            u64::from(it | text[text.len() / 2] | text[text.len() - 1])
        }),
    };
    bits & 0x8080_8080_8080_8080 == 0
}

/// A `WTF::String` that is not null.
#[repr(transparent)]
pub(crate) struct DomString(NonNull<Impl>);

impl Clone for DomString {
    #[inline]
    fn clone(&self) -> DomString {
        DomString::from_impl(self.as_impl())
    }
}

impl Drop for DomString {
    #[inline]
    fn drop(&mut self) {
        self.as_impl().deref();
    }
}

impl Default for DomString {
    fn default() -> DomString {
        DomString(Bun__DOM__emptyString())
    }
}

impl PartialEq for DomString {
    #[inline]
    fn eq(&self, other: &DomString) -> bool {
        self.0 == other.0 || self.len() == other.len() && self.has_units_of(other)
    }
}

impl Eq for DomString {}

impl core::hash::Hash for DomString {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        state.write(self.to_utf8().as_bytes());
    }
}

impl From<&str> for DomString {
    fn from(text: &str) -> DomString {
        DomString::from_utf8(text)
    }
}

pub(super) fn length_of<T>(text: &[T]) -> u32 {
    i32::try_from(text.len()).expect("a string is not that long") as u32
}

impl DomString {
    #[inline]
    pub(crate) fn has_newline(&self) -> bool {
        self.latin1().map_or_else(
            || self.units().any(|it| matches!(it, 10 | 13)),
            |it| strings::index_of_any(it, b"\r\n").is_some(),
        )
    }

    #[inline]
    pub(crate) fn from_impl(string: &Impl) -> DomString {
        string.r#ref();
        DomString(NonNull::from(string))
    }

    /// Without counting the reference.
    #[inline(always)]
    pub(crate) fn with_impl<R>(string: &Impl, read: impl FnOnce(&DomString) -> R) -> R {
        read(&core::mem::ManuallyDrop::new(DomString(NonNull::from(
            string,
        ))))
    }

    #[inline(always)]
    pub(crate) fn as_impl(&self) -> &Impl {
        // SAFETY: `self` holds a reference.
        unsafe { self.0.as_ref() }
    }

    pub(crate) fn from_latin1(text: &[u8]) -> DomString {
        let mut characters = core::ptr::null_mut();
        let string = Bun__DOM__createLatin1(length_of(text), &mut characters);
        // SAFETY: there is room for as many.
        unsafe { core::ptr::copy_nonoverlapping(text.as_ptr(), characters, text.len()) };
        DomString(string)
    }

    /// Without a copy.
    pub(crate) fn from_shared_ascii(text: &SharedBytes) -> DomString {
        extern "C" fn free(owner: *mut SharedBytes, _: *mut core::ffi::c_void, _: usize) {
            // SAFETY: what was made below, once.
            drop(unsafe { bun_core::heap::take(owner) });
        }
        if text.is_empty() {
            return DomString::default();
        }
        // SAFETY: the clone keeps the bytes, which never change.
        let string = unsafe {
            bun_core::String::create_external(
                text,
                bun_core::heap::into_raw(Box::new(text.clone())),
                free,
            )
        };
        NonNull::new(string.leak_wtf_impl())
            .map(DomString)
            .unwrap_or_default()
    }

    pub(crate) fn from_integer(value: impl ToString + Copy) -> DomString {
        DomString::from_latin1(value.to_string().as_bytes())
    }

    pub(crate) fn from_utf16(text: &[u16]) -> DomString {
        let mut characters = core::ptr::null_mut();
        let string = Bun__DOM__createUTF16(length_of(text), &mut characters);
        // SAFETY: there is room for as many.
        unsafe { core::ptr::copy_nonoverlapping(text.as_ptr(), characters, text.len()) };
        DomString(string)
    }

    /// Of units that fit.
    pub(crate) fn from_narrow_utf16(text: &[u16]) -> DomString {
        let mut characters = core::ptr::null_mut();
        let string = Bun__DOM__createLatin1(length_of(text), &mut characters);
        for (index, unit) in text.iter().enumerate() {
            // SAFETY: there is room for as many.
            unsafe { characters.add(index).write(*unit as u8) };
        }
        DomString(string)
    }

    pub(crate) fn from_utf8(text: &str) -> DomString {
        if text.is_ascii() {
            return DomString::from_latin1(text.as_bytes());
        }
        let mut builder = StringBuilder::default();
        builder.push_str(text);
        builder.finish()
    }

    /// The string that `string` has, after a rope is resolved.
    #[inline]
    pub(crate) fn from_js_string<'a>(
        heap: &JsHeap<'a>,
        string: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, DomString> {
        Ok(DomString::from_impl(impl_of(heap, string)?))
    }

    /// `ToString`
    pub(crate) fn from_js<'a>(
        cx: &mut JsScope<'a>,
        value: JsLocal<'a>,
    ) -> bindgen::Result<'a, DomString> {
        let string = match value.as_string() {
            Some(string) => string,
            None => {
                let converted = value.to_js().to_js_string(cx.global())?.to_js();
                JsLocal::new(&cx.heap, converted)
                    .as_string()
                    .expect("ToString gives a string")
            }
        };
        DomString::from_js_string(&cx.heap, string)
    }

    #[inline]
    pub(crate) fn to_js<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        impl_to_js(heap, self.as_impl())
    }

    /// In UTF-16 code units.
    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.as_impl().length()
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub(crate) fn latin1(&self) -> Option<&[u8]> {
        self.as_impl()
            .is_8bit()
            .then(|| self.as_impl().latin1_slice())
    }

    #[inline]
    pub(crate) fn utf16(&self) -> Option<&[u16]> {
        (!self.as_impl().is_8bit()).then(|| self.as_impl().utf16_slice())
    }

    /// If it is stored as such.
    /// Not just equal.
    #[inline(always)]
    pub(crate) fn is_same(&self, other: &DomString) -> bool {
        self.0 == other.0
    }

    #[inline(always)]
    pub(crate) fn ascii(&self) -> Option<&str> {
        // SAFETY: ASCII is UTF-8.
        self.latin1()
            .filter(|it| is_ascii(it))
            .map(|it| unsafe { core::str::from_utf8_unchecked(it) })
    }

    /// A lone surrogate becomes U+FFFD.
    pub(crate) fn to_utf8(&self) -> Cow<'_, str> {
        match (self.ascii(), self.latin1()) {
            (Some(ascii), _) => Cow::Borrowed(ascii),
            // SAFETY: that is what they make.
            (_, latin1) => Cow::Owned(unsafe {
                String::from_utf8_unchecked(
                    latin1
                        .and_then(strings::to_utf8_from_latin1)
                        .unwrap_or_else(|| strings::to_utf8_alloc(self.as_impl().utf16_slice())),
                )
            }),
        }
    }

    pub(crate) fn unit(&self, index: u32) -> u16 {
        match self.latin1() {
            Some(latin1) => latin1[index as usize].into(),
            None => self.as_impl().utf16_slice()[index as usize],
        }
    }

    pub(crate) fn units(&self) -> impl DoubleEndedIterator<Item = u16> + Clone + '_ {
        let (narrow, wide) = (
            self.latin1().unwrap_or_default(),
            self.utf16().unwrap_or_default(),
        );
        narrow
            .iter()
            .map(|it| u16::from(*it))
            .chain(wide.iter().copied())
    }

    fn has_units_of(&self, other: &DomString) -> bool {
        match (self.latin1(), other.latin1()) {
            (Some(a), Some(b)) => a == b,
            _ => self.units().eq(other.units()),
        }
    }

    /// Both are clamped.
    pub(crate) fn substring(&self, start: u32, length: u32) -> DomString {
        let start = start.min(self.len());
        DomString(Bun__DOM__substring(
            self.as_impl(),
            start,
            length.min(self.len() - start),
        ))
    }

    pub(crate) fn prefix(&self, end: u32) -> DomString {
        self.substring(0, end)
    }

    pub(crate) fn from_latin1_parts<'p>(
        parts: impl Iterator<Item = &'p [u8]> + Clone,
    ) -> DomString {
        let (length, mut at) = (
            i32::try_from(parts.clone().map(<[u8]>::len).sum::<usize>())
                .expect("a string is not that long"),
            core::ptr::null_mut(),
        );
        let all = DomString(Bun__DOM__createLatin1(length as u32, &mut at));
        for part in parts {
            // SAFETY: there is room for all of them.
            unsafe {
                core::ptr::copy_nonoverlapping(part.as_ptr(), at, part.len());
                at = at.add(part.len());
            }
        }
        all
    }

    pub(crate) fn concat(parts: &[&DomString]) -> DomString {
        let mut filled = parts.iter().filter(|it| !it.is_empty());
        if let (first, None) = (filled.next(), filled.next()) {
            return first.map_or_else(DomString::default, |it| (*it).clone());
        }
        if parts.iter().all(|it| it.latin1().is_some()) {
            return DomString::from_latin1_parts(parts.iter().filter_map(|it| it.latin1()));
        }
        let mut builder = StringBuilder::default();
        parts.iter().for_each(|it| builder.push(it));
        builder.finish()
    }

    pub(crate) fn eq_str(&self, other: &str) -> bool {
        match self.latin1() {
            Some(latin1) if other.is_ascii() => latin1 == other.as_bytes(),
            _ => self.units().eq(other.encode_utf16()),
        }
    }

    pub(crate) fn eq_ignore_ascii_case(&self, other: &str) -> bool {
        match self.latin1() {
            Some(latin1) if other.is_ascii() => latin1.eq_ignore_ascii_case(other.as_bytes()),
            _ => self.units().map(lower).eq(other.encode_utf16().map(lower)),
        }
    }

    fn mapped(&self, map: fn(u16) -> u16) -> DomString {
        if self.units().all(|it| map(it) == it) {
            return self.clone();
        }
        let mut builder = StringBuilder::default();
        self.units().for_each(|it| builder.push_unit(map(it)));
        builder.finish()
    }

    /// <https://webidl.spec.whatwg.org/#idl-USVString>
    pub(crate) fn into_well_formed(self) -> DomString {
        match self
            .utf16()
            .filter(|it| char::decode_utf16(it.iter().copied()).any(|it| it.is_err()))
        {
            Some(units) => DomString::from_utf8(&String::from_utf16_lossy(units)),
            None => self,
        }
    }

    pub(crate) fn to_ascii_lowercase(&self) -> DomString {
        self.mapped(lower)
    }

    pub(crate) fn to_ascii_uppercase(&self) -> DomString {
        self.mapped(|it| {
            if (0x61..=0x7a).contains(&it) {
                it - 0x20
            } else {
                it
            }
        })
    }

    /// <https://infra.spec.whatwg.org/#split-on-ascii-whitespace>, as start and length.
    pub(crate) fn token_ranges(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        let mut at = 0;
        core::iter::from_fn(move || {
            let start = (at..self.len()).find(|it| !is_ascii_whitespace(self.unit(*it)))?;
            at = (start..self.len())
                .find(|it| is_ascii_whitespace(self.unit(*it)))
                .unwrap_or(self.len());
            Some((start, at - start))
        })
    }

    pub(crate) fn has_token(&self, token: &DomString, ignores_case: bool) -> bool {
        match (self.latin1(), token.latin1()) {
            (Some(all), Some(token)) => {
                !token.is_empty()
                    && all.split(u8::is_ascii_whitespace).any(|it| {
                        if ignores_case {
                            it.eq_ignore_ascii_case(token)
                        } else {
                            it == token
                        }
                    })
            }
            _ if ignores_case => self
                .to_ascii_lowercase()
                .has_token(&token.to_ascii_lowercase(), false),
            _ => self.tokens().any(|it| it == *token),
        }
    }

    pub(crate) fn tokens(&self) -> impl Iterator<Item = DomString> + '_ {
        self.token_ranges()
            .map(|(start, length)| self.substring(start, length))
    }
}

fn lower(unit: u16) -> u16 {
    if (0x41..=0x5a).contains(&unit) {
        unit + 0x20
    } else {
        unit
    }
}

pub(crate) fn is_ascii_whitespace(unit: u16) -> bool {
    matches!(unit, 9 | 10 | 12 | 13 | 32)
}

const IS_ROPE: usize = 1;

#[inline]
pub(crate) fn impl_of<'a>(
    heap: &JsHeap<'a>,
    string: JsLocal<'a, JSString>,
) -> bindgen::Result<'a, &'a Impl> {
    // SAFETY: `JSString::m_fiber` follows the header of the cell.
    let fiber = || unsafe { (string.to_js().encoded() as *const usize).add(1).read() };
    if fiber() & IS_ROPE != 0 {
        resolve(heap, string)?;
    }
    // SAFETY: what is no rope has a `StringImpl` there, which it holds. Only atomizing replaces it, and the heap keeps the old one
    // until the next collection.
    Ok(unsafe { &*(fiber() as *const Impl) })
}

#[cold]
fn resolve<'a>(heap: &JsHeap<'a>, string: JsLocal<'a, JSString>) -> bindgen::Result<'a, ()> {
    unsafe extern "C" {
        safe fn Bun__DOM__resolveRope(global: &JSGlobalObject, string: JSValue) -> JSValue;
    }
    // SAFETY: it allocates, or throws for lack of memory.
    let global = unsafe { heap.global() };
    bun_jsc::call_zero_is_throw(global, || Bun__DOM__resolveRope(global, string.to_js()))?;
    Ok(())
}

const RECENT: usize = 2048;

/// The strings that scripts were given.
struct Cells {
    /// Since the last collection, by the address of the `StringImpl`.
    recent: [Cell<JSValue>; RECENT],
    /// Of each `Known`, as it is and in uppercase, after its number. They stay. The first and the last are empty.
    known: [[Cell<JSValue>; 2]; Known::Other as usize + 2],
    eraser: Cell<*mut c_void>,
}

#[thread_local]
static CELLS: Cell<Option<&'static Cells>> = Cell::new(None);

impl Cells {
    #[cold]
    fn new(heap: &JsHeap<'_>) -> &'static Cells {
        bun_ui::at_end_of_worker(|| {
            let Some(cells) = CELLS.take() else { return };
            // SAFETY: what is made below. The VM is gone.
            unsafe {
                Bun__DOM__destroyEraser(cells.eraser.get());
                bun_core::heap::destroy(core::ptr::from_ref(cells).cast_mut());
            }
        });
        // SAFETY: empty values, and a null pointer.
        let cells: &Cells = bun_core::heap::release(unsafe { Box::new_zeroed().assume_init() });
        // SAFETY: they outlive the VM, whose collector writes them while this thread is stopped.
        cells.eraser.set(unsafe {
            Bun__DOM__createEraser(
                heap.global(),
                cells.recent.as_ptr().cast_mut().cast(),
                RECENT,
            )
        });
        CELLS.set(Some(cells));
        cells
    }

    #[inline(always)]
    fn place_of(&self, string: &Impl) -> &Cell<JSValue> {
        &self.recent[(core::ptr::from_ref(string).addr() >> 4) % RECENT]
    }
}

#[inline(always)]
pub(super) fn impl_to_js<'a>(heap: &JsHeap<'a>, string: &Impl) -> JsLocal<'a, JSString> {
    let recent = CELLS
        .get()
        .map_or(JSValue::ZERO, |it| it.place_of(string).get());
    // SAFETY: a string that was not swept. `JSString::m_fiber` follows its header.
    let is_it = !recent.is_empty()
        && unsafe { (recent.encoded() as *const *const Impl).add(1).read() } == string;
    // SAFETY: a string.
    unsafe {
        JsLocal::from_extern(
            if is_it {
                recent
            } else {
                new_cell(heap, string)
            },
            heap,
        )
    }
}

#[inline(never)]
fn new_cell(heap: &JsHeap<'_>, string: &Impl) -> JSValue {
    // SAFETY: it only allocates.
    let cell = Bun__DOM__stringToJS(unsafe { heap.global() }, string);
    CELLS
        .get()
        .unwrap_or_else(|| Cells::new(heap))
        .place_of(string)
        .set(cell);
    cell
}

#[inline(always)]
pub(super) fn known_to_js<'a>(
    heap: &JsHeap<'a>,
    known: Known,
    is_uppercase: bool,
) -> JsLocal<'a, JSString> {
    let cell = CELLS.get().map_or(JSValue::ZERO, |it| {
        it.known[known as usize + 1][usize::from(is_uppercase)].get()
    });
    // SAFETY: a string.
    unsafe {
        JsLocal::from_extern(
            if cell.is_empty() {
                new_known_cell(heap, known, is_uppercase)
            } else {
                cell
            },
            heap,
        )
    }
}

/// `Cells::known`
pub(super) fn cells_of_names(global: &JSGlobalObject) -> *const c_void {
    CELLS
        .get()
        .unwrap_or_else(|| Cells::new(JsHeap::from_global(global)))
        .known
        .as_ptr()
        .cast()
}

#[cold]
#[inline(never)]
fn new_known_cell(heap: &JsHeap<'_>, known: Known, is_uppercase: bool) -> JSValue {
    let atom = if is_uppercase {
        Atom::of(known).to_ascii_uppercase()
    } else {
        Atom::of(known)
    };
    // SAFETY: it only allocates.
    let cell = Bun__DOM__permanentString(unsafe { heap.global() }, atom.as_impl());
    CELLS.get().unwrap_or_else(|| Cells::new(heap)).known[known as usize + 1]
        [usize::from(is_uppercase)]
    .set(cell);
    cell
}

/// The characters of a rope, which stays one, if they have 8 bits and there is room.
#[inline]
pub(super) fn short_rope<'r>(
    string: JsLocal<'_, JSString>,
    room: &'r mut [u8],
) -> Option<&'r [u8]> {
    // SAFETY: as in `impl_of`.
    let is_rope =
        unsafe { (string.to_js().encoded() as *const usize).add(1).read() } & IS_ROPE != 0;
    // SAFETY: the pointer and the length are of one slice.
    let length = is_rope
        .then(|| unsafe { Bun__DOM__copyRope(string.to_js(), room.as_mut_ptr(), room.len()) })?;
    room.get(..length)
}

/// It has 8 bits per character for as long as it can.
#[derive(Default)]
pub(crate) struct StringBuilder {
    narrow: Vec<u8>,
    wide: Vec<u16>,
}

impl StringBuilder {
    pub(crate) fn with_capacity(capacity: usize) -> StringBuilder {
        StringBuilder {
            narrow: Vec::with_capacity(capacity),
            wide: Vec::new(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.narrow.len() + self.wide.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn widened(&mut self) -> &mut Vec<u16> {
        if self.wide.is_empty() {
            self.wide
                .extend(core::mem::take(&mut self.narrow).into_iter().map(u16::from));
        }
        &mut self.wide
    }

    #[inline]
    pub(crate) fn push_latin1(&mut self, text: &[u8]) {
        match self.wide.is_empty() {
            true => self.narrow.extend_from_slice(text),
            false => self.wide.extend(text.iter().map(|it| u16::from(*it))),
        }
    }

    pub(crate) fn push_utf16(&mut self, text: &[u16]) {
        if !text.is_empty() {
            self.widened().extend_from_slice(text);
        }
    }

    #[inline]
    pub(crate) fn push_unit(&mut self, unit: u16) {
        match u8::try_from(unit) {
            Ok(narrow) if self.wide.is_empty() => self.narrow.push(narrow),
            _ => self.widened().push(unit),
        }
    }

    #[inline]
    pub(crate) fn push_str(&mut self, text: &str) {
        match text.is_ascii() {
            true => self.push_latin1(text.as_bytes()),
            false => text.encode_utf16().for_each(|it| self.push_unit(it)),
        }
    }

    #[inline]
    pub(crate) fn push(&mut self, text: &DomString) {
        match text.latin1() {
            Some(latin1) => self.push_latin1(latin1),
            None => self.push_utf16(text.as_impl().utf16_slice()),
        }
    }

    pub(crate) fn finish(self) -> DomString {
        match self.wide.is_empty() {
            true => DomString::from_latin1(&self.narrow),
            false => DomString::from_utf16(&self.wide),
        }
    }
}

/// A string of the tree, which scripts read as it is and the engine as UTF-8.
#[derive(Clone)]
pub(crate) enum StoredText {
    Ascii(DomString),
    Other(Rc<(DomString, OnceCell<Box<str>>)>),
    Growing(Rc<Growing>),
}

/// The start of a longer string, whose rest no one has seen.
pub(crate) struct Growing {
    string: DomString,
    room: DomString,
    characters: *mut u8,
    /// Unless it is ASCII.
    utf8: Option<String>,
}

impl Growing {
    fn new(start: &StoredText, more: &DomString) -> Growing {
        let (string, mut characters) = (start.string(), core::ptr::null_mut::<u8>());
        let capacity =
            ((string.len() as usize + more.len() as usize) * 3 / 2).min(i32::MAX as usize) as u32;
        let room = DomString(match string.latin1().and_then(|_| more.latin1()) {
            Some(_) => Bun__DOM__createLatin1(capacity, &mut characters),
            None => {
                let mut wide = core::ptr::null_mut();
                let room = Bun__DOM__createUTF16(capacity, &mut wide);
                characters = wide.cast();
                room
            }
        });
        let utf8 = string.ascii().is_none().then(|| String::from(&**start));
        let mut made = Growing {
            string: DomString::default(),
            room,
            characters,
            utf8,
        };
        made.write(string);
        made
    }

    fn fits(&self, more: &DomString) -> bool {
        more.len() <= self.room.len() - self.string.len()
            && (self.room.as_impl().is_8bit() <= more.as_impl().is_8bit())
    }

    /// It has to fit.
    fn write(&mut self, more: &DomString) {
        let (at, length) = (self.string.len() as usize, more.len() as usize);
        // SAFETY: there is room for them, and no string has what is there.
        unsafe {
            match (self.room.as_impl().is_8bit(), more.latin1()) {
                (true, narrow) => core::ptr::copy_nonoverlapping(
                    narrow.unwrap_or_default().as_ptr(),
                    self.characters.add(at),
                    length,
                ),
                (false, Some(narrow)) => narrow.iter().enumerate().for_each(|(index, it)| {
                    self.characters
                        .cast::<[u8; 2]>()
                        .add(at + index)
                        .write(u16::from(*it).to_ne_bytes())
                }),
                (false, None) => core::ptr::copy_nonoverlapping(
                    more.as_impl().utf16_slice().as_ptr().cast(),
                    self.characters.add(at * 2),
                    length * 2,
                ),
            }
        }
        self.string = DomString(Bun__DOM__sharedPrefix(
            self.room.as_impl(),
            (at + length) as u32,
        ));
    }

    fn push(&mut self, more: &DomString) {
        let at = self.string.len();
        let completes_pair = (0xd800..0xdc00).contains(&self.string.unit(at - 1));
        let ascii = self.utf8.is_none().then(|| self.string.clone());
        self.write(more);
        match (&mut self.utf8, more.to_utf8()) {
            (Some(utf8), _) if completes_pair => {
                utf8.pop();
                utf8.push_str(&self.string.substring(at - 1, u32::MAX).to_utf8());
            }
            (Some(utf8), more) => utf8.push_str(&more),
            (None, Cow::Borrowed(_)) if self.room.as_impl().is_8bit() => {}
            (None, more) => {
                self.utf8 = Some(ascii.unwrap_or_default().to_utf8().into_owned() + &more)
            }
        }
    }
}

/// How much UTF-16 the characters take that start in a little UTF-8.
#[inline]
fn units_in(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .fold(0u8, |all, it| {
            all + u8::from(*it as i8 >= -0x40) + u8::from(*it >= 0xf0)
        })
        .into()
}

impl Default for StoredText {
    #[inline]
    fn default() -> StoredText {
        StoredText::Ascii(DomString::default())
    }
}

impl StoredText {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.string().is_empty()
    }

    #[inline]
    pub(crate) fn string(&self) -> &DomString {
        match self {
            StoredText::Ascii(string) => string,
            StoredText::Other(both) => &both.0,
            StoredText::Growing(it) => &it.string,
        }
    }

    /// From UTF-16. The second half of a pair is where the first one is.
    pub(crate) fn offset_in_utf8(&self, offset: u32) -> u32 {
        let (text, mut left, mut at) = (&**self, offset as usize, 0);
        if text.len() == self.string().len() as usize {
            return offset.min(text.len() as u32);
        }
        for chunk in text.as_bytes().as_chunks::<64>().0 {
            let units = units_in(chunk);
            if units >= left {
                break;
            }
            (left, at) = (left - units, at + 64);
        }
        let at = text.ceil_char_boundary(at);
        let found = text[at..].char_indices().find(|it| {
            let is_it = it.1.len_utf16() > left;
            left = left.saturating_sub(it.1.len_utf16());
            is_it
        });
        found.map_or(text.len(), |it| at + it.0) as u32
    }

    pub(crate) fn offset_in_utf16(&self, offset: u32) -> u32 {
        let text = self.as_bytes();
        let before = &text[..text.len().min(offset as usize)];
        if text.len() == self.string().len() as usize {
            before.len() as u32
        } else {
            before.chunks(64).map(units_in).sum::<usize>() as u32
        }
    }

    /// A little more at the end of a long text tends to be followed by more.
    pub(crate) fn push(&mut self, more: &DomString) {
        const LONG: u32 = 128;
        if let StoredText::Growing(it) = self
            && let Some(it) = Rc::get_mut(it).filter(|it| it.fits(more))
        {
            return it.push(more);
        }
        let length = self.string().len();
        if length < LONG || more.len() > length / 4 || length > i32::MAX as u32 / 2 {
            return *self = DomString::concat(&[self.string(), more]).into();
        }
        let mut growing = Growing::new(self, more);
        growing.push(more);
        *self = StoredText::Growing(Rc::new(growing));
    }
}

impl From<DomString> for StoredText {
    #[inline]
    fn from(string: DomString) -> StoredText {
        if string.ascii().is_some() {
            StoredText::Ascii(string)
        } else {
            StoredText::Other(Rc::new((string, OnceCell::new())))
        }
    }
}

impl From<&str> for StoredText {
    fn from(text: &str) -> StoredText {
        let string = DomString::from_utf8(text);
        if text.is_ascii() {
            StoredText::Ascii(string)
        } else {
            StoredText::Other(Rc::new((string, Box::<str>::from(text).into())))
        }
    }
}

impl core::ops::Deref for StoredText {
    type Target = str;
    #[inline]
    fn deref(&self) -> &str {
        match self {
            // SAFETY: it is ASCII, in 8 bits.
            StoredText::Ascii(string) => unsafe {
                core::str::from_utf8_unchecked(string.as_impl().latin1_slice())
            },
            StoredText::Other(both) => both.1.get_or_init(|| both.0.to_utf8().into()),
            // SAFETY: as above.
            StoredText::Growing(it) => it.utf8.as_deref().unwrap_or_else(|| unsafe {
                core::str::from_utf8_unchecked(it.string.as_impl().latin1_slice())
            }),
        }
    }
}

impl From<bindgen::JsStringImpl<'_>> for DomString {
    #[inline]
    fn from(string: bindgen::JsStringImpl<'_>) -> DomString {
        DomString::from_impl(string.get())
    }
}

impl From<bindgen::JsAtom<'_>> for super::Atom {
    #[inline]
    fn from(atom: bindgen::JsAtom<'_>) -> super::Atom {
        super::Atom::from_impl(atom.get())
    }
}

macro_rules! into_js_string {
    ($($type:ty),*) => {$(
        impl<'a> bindgen::IntoJsString<'a> for $type {
            #[inline]
            fn into_js_string(self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
                self.to_js(heap)
            }
        }
    )*};
}
into_js_string!(DomString, &DomString, super::Atom, &super::Atom);

impl<'a> bindgen::IntoJsString<'a> for super::Known {
    #[inline]
    fn into_js_string(self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        super::Atom::of(self).to_js(heap)
    }
}
