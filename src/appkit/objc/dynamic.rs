//! Messages chosen at run time: any selector on any object or class, typed
//! from the receiver's `NSMethodSignature` rather than from a binding line.
//! `NSInvocation` does the calling-convention work (struct and float returns
//! included), so nothing here depends on the CPU beyond the width of `BOOL`.
//!
//! The typed bindings in the sibling modules stay the way the crate itself
//! talks to AppKit; this is the escape hatch `bun:appkit` hands to scripts.

use core::cell::{Ref, RefCell};
use core::ffi::CStr;
use core::fmt;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use std::ffi::CString;

use super::foundation::{
    NSArray, NSDictionary, NSInvocation, NSMethodSignature, NSMutableArray, NSMutableDictionary,
    NSNull, NSNumber, NSObject, NSString, Upcast,
};
use super::{AutoreleasePool, Class, Id, NsStr, Obj, Object, Ptr, load, register_sel, rt};
use crate::error::{Error, Result};
use crate::geometry::{Insets, Point, Range, Rect, Size};
use bun_core::strings;

// ───────────────────────────────── receivers ─────────────────────────────────

enum Slot {
    Live(NSObject),
    /// `+alloc` asked for but not sent: the instance is only created once an
    /// `init…` follows with arguments that converted, so a failed or
    /// forgotten init never leaves a half-made object to deallocate.
    Allocated(DynClass),
    Consumed,
    Released,
}

/// Any Objective-C object, retained for as long as this value lives (or until
/// [`release`](DynObject::release)). Class objects can be held this way too.
pub struct DynObject {
    slot: RefCell<Slot>,
    addr: usize,
}

impl fmt::Debug for DynObject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &*self.slot.borrow() {
            Slot::Live(o) => fmt::Debug::fmt(o, f),
            Slot::Allocated(c) => write!(f, "allocated({c:?})"),
            Slot::Consumed => write!(f, "consumed({:#x})", self.addr),
            Slot::Released => write!(f, "released({:#x})", self.addr),
        }
    }
}

impl DynObject {
    fn wrap(object: NSObject) -> DynObject {
        DynObject {
            addr: object.as_obj() as usize,
            slot: RefCell::new(Slot::Live(object)),
        }
    }

    fn allocated(class: DynClass) -> DynObject {
        DynObject {
            addr: 0,
            slot: RefCell::new(Slot::Allocated(class)),
        }
    }

    /// The class an `init…` will allocate, while this is an unsent `alloc`.
    fn allocated_class(&self) -> Option<DynClass> {
        match &*self.slot.borrow() {
            Slot::Allocated(c) => Some(*c),
            _ => None,
        }
    }

    /// Another reference to an object the crate already holds typed.
    pub(crate) fn from_object<T: Object>(object: &T) -> DynObject {
        DynObject::wrap(object.upcast().clone())
    }

    /// # Safety
    /// `ptr` is nil or a live object; one reference is taken.
    unsafe fn retain(ptr: Obj) -> Option<DynObject> {
        // SAFETY: per contract; every object is an NSObject for our purposes.
        unsafe { Id::retain(ptr).map(|id| DynObject::wrap(NSObject::from_id(id))) }
    }

    /// # Safety
    /// `ptr` is nil or a +1 reference whose ownership moves here.
    unsafe fn from_retained(ptr: Obj) -> Option<DynObject> {
        // SAFETY: per contract.
        unsafe { Id::from_retained(ptr).map(|id| DynObject::wrap(NSObject::from_id(id))) }
    }

    fn unusable(slot: &Slot) -> Error {
        match slot {
            Slot::Allocated(_) => Error::NotInitialized,
            Slot::Consumed => Error::Consumed,
            _ => Error::ObjectReleased,
        }
    }

    fn live(&self) -> Result<Ref<'_, NSObject>> {
        Ref::filter_map(self.slot.borrow(), |slot| match slot {
            Slot::Live(o) => Some(o),
            _ => None,
        })
        .map_err(|slot| DynObject::unusable(&slot))
    }

    /// Hands the one reference this wrapper owns (allocating it now, for an
    /// unsent `alloc`) to an `init…` message.
    fn take_for_init(&self, method: &str) -> Result<ManuallyDrop<NSObject>> {
        let mut slot = self.slot.borrow_mut();
        match core::mem::replace(&mut *slot, Slot::Consumed) {
            Slot::Live(o) => Ok(ManuallyDrop::new(o)),
            Slot::Allocated(class) => match class.alloc_instance() {
                Some(o) => Ok(ManuallyDrop::new(o)),
                None => Err(Error::UnsupportedSignature {
                    method: method.to_owned(),
                    what: "+alloc returned nil".into(),
                }),
            },
            other => {
                let err = DynObject::unusable(&other);
                *slot = other;
                Err(err)
            }
        }
    }

    /// The object with a reference of its own, for the duration of a send.
    fn target(&self) -> Result<NSObject> {
        Ok(self.live()?.clone())
    }

    /// A second wrapper holding its own reference.
    pub fn try_clone(&self) -> Result<DynObject> {
        Ok(DynObject::wrap(self.target()?))
    }

    /// The object's address, kept after release for identity and debugging;
    /// 0 for an unsent `alloc`.
    pub fn address(&self) -> usize {
        self.addr
    }

    /// Drops this wrapper's reference now. Idempotent.
    pub fn release(&self) {
        let mut slot = self.slot.borrow_mut();
        if matches!(*slot, Slot::Live(_) | Slot::Allocated(_)) {
            *slot = Slot::Released;
        }
    }

    pub fn is_released(&self) -> bool {
        matches!(*self.slot.borrow(), Slot::Consumed | Slot::Released)
    }

    pub fn class_name(&self) -> Result<String> {
        if let Some(class) = self.allocated_class() {
            return Ok(class.name());
        }
        Ok(rt().class_name_of(self.live()?.as_obj()))
    }

    /// Whether the object is itself a class (or metaclass).
    pub fn is_class(&self) -> bool {
        match self.live() {
            // SAFETY: a live object.
            Ok(o) => unsafe { (rt().object_isClass)(o.as_obj()) }.get(),
            Err(_) => false,
        }
    }

    /// The object as a class, when it is one.
    pub fn as_class(&self) -> Option<DynClass> {
        if !self.is_class() {
            return None;
        }
        NonNull::new(self.live().ok()?.as_obj()).map(|p| DynClass(Class(p)))
    }

    /// `-description`, as UTF-16 for JavaScript; empty when it answers nil.
    pub fn description(&self) -> Result<Vec<u16>> {
        load()?;
        let _pool = pool_if_none();
        Ok(self
            .target()?
            .description()
            .map(|d| d.to_utf16())
            .unwrap_or_default())
    }

    /// A new `NSString`.
    pub fn string(text: NsStr<'_>) -> Result<DynObject> {
        load()?;
        Ok(DynObject::from_object(&NSString::from_str(text)))
    }

    /// A new `NSNumber`; see [`nsnumber`].
    pub fn number(value: f64) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&nsnumber(value)))
    }

    pub fn integer(value: i64) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSNumber::with_i64(value)))
    }

    pub fn boolean(value: bool) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSNumber::with_bool(value)))
    }

    /// `+[NSNull null]`.
    pub fn null() -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSNull::null()))
    }

    /// A new `NSMutableArray` holding `items` in order.
    pub fn array(items: &[DynObject]) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        let array = NSMutableArray::with_capacity(items.len());
        for item in items {
            array.add(&*item.live()?);
        }
        Ok(DynObject::from_object(&array))
    }

    /// A new `NSMutableDictionary` from `(key, value)` pairs; keys are
    /// usually `NSString`s from [`DynObject::string`].
    pub fn dictionary(entries: &[(DynObject, DynObject)]) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        let dict = NSMutableDictionary::with_capacity(entries.len());
        for (key, value) in entries {
            dict.insert(&*value.live()?, &*key.live()?);
        }
        Ok(DynObject::from_object(&dict))
    }

    /// The Foundation value classes as plain data; anything else, and
    /// anything nested deeper than [`PLAIN_DEPTH`], stays an object.
    pub fn to_plain(&self) -> Result<Plain> {
        load()?;
        let _pool = pool_if_none();
        Ok(plain(&self.target()?, 0))
    }
}

/// `f64`s below this magnitude with no fraction convert to `i64` exactly.
const I64_EXACT_LIMIT: f64 = 9_223_372_036_854_775_808.0;

/// Integral values that fit `long long` keep an integer `objCType` (so they
/// print and compare as integers); everything else is a `double`.
fn nsnumber(value: f64) -> NSNumber {
    if value.fract() == 0.0 && value.abs() < I64_EXACT_LIMIT {
        NSNumber::with_i64(value as i64)
    } else {
        NSNumber::with_f64(value)
    }
}

/// How deep [`DynObject::to_plain`] unpacks nested arrays and dictionaries.
pub const PLAIN_DEPTH: usize = 32;

/// See [`DynObject::to_plain`].
#[derive(Debug)]
pub enum Plain {
    /// `NSNull`.
    Null,
    String(Vec<u16>),
    Number(f64),
    Boolean(bool),
    Array(Vec<Plain>),
    /// Keys are the `NSString` keys' text, or `-description` for other keys.
    Dictionary(Vec<(Vec<u16>, Plain)>),
    Other(DynObject),
}

fn plain(object: &NSObject, depth: usize) -> Plain {
    if object.is_kind_of::<NSString>() {
        return Plain::String(cast::<NSString>(object).to_utf16());
    }
    if object.is_kind_of::<NSNumber>() {
        if object.as_obj() == NSNumber::with_bool(true).as_obj() {
            return Plain::Boolean(true);
        }
        if object.as_obj() == NSNumber::with_bool(false).as_obj() {
            return Plain::Boolean(false);
        }
        return Plain::Number(cast::<NSNumber>(object).f64_value());
    }
    if object.is_kind_of::<NSNull>() {
        return Plain::Null;
    }
    if depth < PLAIN_DEPTH && object.is_kind_of::<NSArray>() {
        let array = cast::<NSArray>(object);
        return Plain::Array(array.iter().map(|item| plain(&item, depth + 1)).collect());
    }
    if depth < PLAIN_DEPTH && object.is_kind_of::<NSDictionary>() {
        let dict = cast::<NSDictionary>(object);
        let entries = dict
            .all_keys()
            .iter()
            .map(|key| {
                let name = if key.is_kind_of::<NSString>() {
                    cast::<NSString>(&key).to_utf16()
                } else {
                    key.description().map(|d| d.to_utf16()).unwrap_or_default()
                };
                let value = dict.get(&key).map_or(Plain::Null, |v| plain(&v, depth + 1));
                (name, value)
            })
            .collect();
        return Plain::Dictionary(entries);
    }
    Plain::Other(DynObject::wrap(object.clone()))
}

/// `object` typed as `T`, after the caller's `is_kind_of::<T>()` said yes.
fn cast<T: super::ClassType>(object: &NSObject) -> T {
    match object.clone().downcast::<T>() {
        Ok(t) => t,
        Err(_) => unreachable!("is_kind_of checked first"),
    }
}

/// A class, by name or from a `Class`-typed return.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct DynClass(Class);

impl fmt::Debug for DynClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.name())
    }
}

impl DynClass {
    pub fn name(&self) -> String {
        // SAFETY: a registered class; the name is a static C string.
        unsafe { CStr::from_ptr((rt().class_getName)(self.0.as_obj())) }
            .to_string_lossy()
            .into_owned()
    }

    pub fn address(&self) -> usize {
        self.0.as_obj() as usize
    }

    /// The class object held as an object, for `id`-typed uses.
    pub fn to_object(&self) -> DynObject {
        // SAFETY: a class is a live, never-deallocated object.
        match unsafe { DynObject::retain(self.0.as_obj()) } {
            Some(o) => o,
            None => unreachable!("Class is non-null"),
        }
    }

    /// The class object as a message target: never dropped, so no `release`
    /// pairs with the `retain` that was never sent.
    fn target(self) -> ManuallyDrop<NSObject> {
        // SAFETY: class objects are immortal; see above for why the wrapper
        // must not drop.
        ManuallyDrop::new(unsafe { NSObject::from_id(Id(self.0.0)) })
    }

    /// `+alloc`, sent for real.
    fn alloc_instance(self) -> Option<NSObject> {
        // SAFETY: `+alloc` is `(Class) -> id` on every class and returns +1.
        unsafe {
            let raw = rt().send::<Obj, _>(self.0.as_obj(), super::sel!("alloc"), ());
            Id::from_retained(raw).map(|id| NSObject::from_id(id))
        }
    }

    /// The type encoding the runtime records for `sel` on this class's
    /// instances (or on the class itself), before Foundation parses it.
    fn raw_types(self, sel: super::Sel, class_method: bool) -> Option<String> {
        rt().class_method_types(self.0, sel, class_method)
    }
}

/// `objc_getClass`.
pub fn lookup_class(name: &str) -> Result<DynClass> {
    load()?;
    let c_name = CString::new(name).map_err(|_| Error::NoClass(name.to_owned()))?;
    super::lookup_class(&c_name)
        .map(DynClass)
        .ok_or_else(|| Error::NoClass(name.to_owned()))
}

/// What a message is sent to.
#[derive(Clone, Copy, Debug)]
pub enum Receiver<'a> {
    Object(&'a DynObject),
    Class(&'a DynClass),
}

impl Receiver<'_> {
    fn class_name(&self) -> Result<String> {
        match self {
            Receiver::Object(o) => o.class_name(),
            Receiver::Class(c) => Ok(c.name()),
        }
    }

    fn is_instance(&self) -> bool {
        match self {
            Receiver::Object(o) => !o.is_class(),
            Receiver::Class(_) => false,
        }
    }

    /// `-[NSWindow setTitle:]` / `+[NSString stringWithString:]`, for messages.
    fn method_name(&self, sel: &str) -> Result<String> {
        let sign = if self.is_instance() { '-' } else { '+' };
        Ok(format!("{sign}[{} {sel}]", self.class_name()?))
    }

    /// `f` gets its own reference rather than a borrow of the wrapper's, so
    /// a script releasing the wrapper from inside the send is harmless.
    fn with_target<R>(&self, f: impl FnOnce(&NSObject) -> R) -> Result<R> {
        match self {
            Receiver::Object(o) => Ok(f(&o.target()?)),
            Receiver::Class(c) => Ok(f(&c.target())),
        }
    }

    /// The receiver as a class, when it is one (held either way).
    fn as_class(&self) -> Option<DynClass> {
        match self {
            Receiver::Object(o) => o.as_class(),
            Receiver::Class(c) => Some(**c),
        }
    }

    fn allocated_class(&self) -> Option<DynClass> {
        match self {
            Receiver::Object(o) => o.allocated_class(),
            Receiver::Class(_) => None,
        }
    }

    /// Where the runtime keeps `sel`'s method for this receiver: (class,
    /// whether it is a class method).
    fn method_owner(&self) -> Result<(DynClass, bool)> {
        if let Some(class) = self.allocated_class() {
            return Ok((class, false));
        }
        if let Some(class) = self.as_class() {
            return Ok((class, true));
        }
        self.with_target(|t| {
            // SAFETY: a live object; its class is a registered, immortal class.
            let isa = unsafe { (rt().object_getClass)(t.as_obj()) };
            NonNull::new(isa).map(|p| (DynClass(Class(p)), false))
        })?
        .ok_or(Error::ObjectReleased)
    }
}

// ───────────────────────────────── encodings ─────────────────────────────────

/// One argument or return type, reduced from its `@encode` string to what
/// decides how a value is marshalled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Enc {
    Void,
    /// `@`
    Object,
    /// `@?`
    Block,
    /// `#`
    Class,
    /// `:`
    Sel,
    /// `B`, and `c` where that is what `BOOL` is (x86_64).
    Bool,
    Int {
        bits: u8,
        signed: bool,
    },
    F32,
    F64,
    /// `*`: a C string.
    CString,
    /// `^…`: any other pointer.
    Pointer,
    Struct(StructKind),
    /// Arrays, unions, bit-fields, `long double`, unknown structs: carried
    /// as the encoding text for the error message.
    Other(String),
}

/// The by-value structs the bridge can marshal. Adding one is a row in
/// [`STRUCTS`] plus its two conversions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StructKind {
    Rect,
    Point,
    Size,
    Range,
    Insets,
    Affine,
}

/// (name in the encoding, flattened field encodings, kind).
const STRUCTS: &[(&str, &str, StructKind)] = &[
    ("CGRect", "dddd", StructKind::Rect),
    ("NSRect", "dddd", StructKind::Rect),
    ("CGPoint", "dd", StructKind::Point),
    ("NSPoint", "dd", StructKind::Point),
    ("CGSize", "dd", StructKind::Size),
    ("NSSize", "dd", StructKind::Size),
    ("_NSRange", "QQ", StructKind::Range),
    ("NSRange", "QQ", StructKind::Range),
    ("NSEdgeInsets", "dddd", StructKind::Insets),
    ("CGAffineTransform", "dddddd", StructKind::Affine),
];

impl StructKind {
    fn encoding(self) -> &'static str {
        match self {
            StructKind::Rect => "{CGRect={CGPoint=dd}{CGSize=dd}}",
            StructKind::Point => "{CGPoint=dd}",
            StructKind::Size => "{CGSize=dd}",
            StructKind::Range => "{_NSRange=QQ}",
            StructKind::Insets => "{NSEdgeInsets=dddd}",
            StructKind::Affine => "{CGAffineTransform=dddddd}",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            StructKind::Rect => "CGRect",
            StructKind::Point => "CGPoint",
            StructKind::Size => "CGSize",
            StructKind::Range => "NSRange",
            StructKind::Insets => "NSEdgeInsets",
            StructKind::Affine => "CGAffineTransform",
        }
    }

    fn byte_len(self) -> usize {
        8 * match self {
            StructKind::Point | StructKind::Size | StructKind::Range => 2,
            StructKind::Rect | StructKind::Insets => 4,
            StructKind::Affine => 6,
        }
    }
}

/// Type qualifiers (`const`, `in`, `inout`, `out`, `bycopy`, `byref`,
/// `oneway`, `_Atomic`) and frame offsets that precede or follow a type.
fn is_qualifier(c: char) -> bool {
    matches!(c, 'r' | 'n' | 'N' | 'o' | 'O' | 'R' | 'V' | 'A') || c.is_ascii_digit()
}

impl Enc {
    /// Parses one type as `NSMethodSignature` reports it.
    pub fn parse(encoding: &str) -> Enc {
        let s = encoding.trim_start_matches(is_qualifier);
        let mut chars = s.chars();
        let Some(first) = chars.next() else {
            return Enc::Other(encoding.to_owned());
        };
        match first {
            'v' => Enc::Void,
            '@' => {
                if chars.next() == Some('?') {
                    Enc::Block
                } else {
                    Enc::Object
                }
            }
            '#' => Enc::Class,
            ':' => Enc::Sel,
            'B' => Enc::Bool,
            'c' if cfg!(target_arch = "x86_64") => Enc::Bool,
            'c' => Enc::Int {
                bits: 8,
                signed: true,
            },
            'C' => Enc::Int {
                bits: 8,
                signed: false,
            },
            's' => Enc::Int {
                bits: 16,
                signed: true,
            },
            'S' => Enc::Int {
                bits: 16,
                signed: false,
            },
            'i' | 'l' => Enc::Int {
                bits: 32,
                signed: true,
            },
            'I' | 'L' => Enc::Int {
                bits: 32,
                signed: false,
            },
            'q' => Enc::Int {
                bits: 64,
                signed: true,
            },
            'Q' => Enc::Int {
                bits: 64,
                signed: false,
            },
            'f' => Enc::F32,
            'd' => Enc::F64,
            '*' => Enc::CString,
            '^' => Enc::Pointer,
            '{' => Enc::parse_struct(s),
            _ => Enc::Other(s.to_owned()),
        }
    }

    /// `{Name=fields…}`: matched on the name and the flattened scalar fields,
    /// so a nested `{CGRect={CGPoint=dd}{CGSize=dd}}` reads as `CGRect`/`dddd`.
    fn parse_struct(s: &str) -> Enc {
        let mut name = String::new();
        let mut flat = String::new();
        let mut depth = 0usize;
        // Reading a struct name (the outer one at depth 0, a nested one above).
        let mut in_name = true;
        for c in s[1..].chars() {
            match c {
                '=' if in_name => in_name = false,
                '}' => {
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                    in_name = false;
                }
                '{' => {
                    depth += 1;
                    in_name = true;
                }
                _ if in_name => {
                    if depth == 0 {
                        name.push(c);
                    }
                }
                '"' | '(' | ')' | '[' | ']' | 'b' | '^' | '?' => {
                    return Enc::Other(s.to_owned());
                }
                c if is_qualifier(c) => {}
                c => flat.push(c),
            }
        }
        STRUCTS
            .iter()
            .find(|(n, f, _)| *n == name && *f == flat)
            .map_or_else(
                || Enc::Other(s.to_owned()),
                |(_, _, kind)| Enc::Struct(*kind),
            )
    }

    /// The canonical encoding, for messages.
    pub fn encoding(&self) -> &str {
        match self {
            Enc::Void => "v",
            Enc::Object => "@",
            Enc::Block => "@?",
            Enc::Class => "#",
            Enc::Sel => ":",
            Enc::Bool => "B",
            Enc::Int {
                bits: 8,
                signed: true,
            } => "c",
            Enc::Int {
                bits: 8,
                signed: false,
            } => "C",
            Enc::Int {
                bits: 16,
                signed: true,
            } => "s",
            Enc::Int {
                bits: 16,
                signed: false,
            } => "S",
            Enc::Int {
                bits: 32,
                signed: true,
            } => "i",
            Enc::Int {
                bits: 32,
                signed: false,
            } => "I",
            Enc::Int { signed: true, .. } => "q",
            Enc::Int { signed: false, .. } => "Q",
            Enc::F32 => "f",
            Enc::F64 => "d",
            Enc::CString => "*",
            Enc::Pointer => "^v",
            Enc::Struct(kind) => kind.encoding(),
            Enc::Other(s) => s,
        }
    }

    /// What a script should pass, for messages.
    pub fn describe(&self) -> &'static str {
        match self {
            Enc::Void => "nothing",
            Enc::Object => "an object, string, number, boolean or null",
            Enc::Block => "a block",
            Enc::Class => "a class",
            Enc::Sel => "a selector name",
            Enc::Bool => "a boolean",
            Enc::Int { .. } => "an integer",
            Enc::F32 | Enc::F64 => "a number",
            Enc::CString => "a string or null",
            Enc::Pointer => "a pointer",
            Enc::Struct(kind) => match kind {
                StructKind::Rect => "a {origin, size} or {x, y, width, height} object",
                StructKind::Point => "an {x, y} object",
                StructKind::Size => "a {width, height} object",
                StructKind::Range => "a {location, length} object",
                StructKind::Insets => "a {top, left, bottom, right} object",
                StructKind::Affine => "an {a, b, c, d, tx, ty} object",
            },
            Enc::Other(_) => "an unsupported type",
        }
    }
}

impl fmt::Display for Enc {
    /// `an integer (q)`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.describe(), self.encoding())
    }
}

/// The selector families whose object result the caller already owns, from
/// clang's rule: the first selector component, less leading underscores,
/// is the family name alone or followed by something other than a lowercase
/// letter (`newValue` is `new`; `newsstand` is not).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    None,
    Alloc,
    New,
    Copy,
    MutableCopy,
    /// Also consumes the receiver.
    Init,
}

impl Family {
    pub fn of(selector: &str) -> Family {
        let s = selector.trim_start_matches('_');
        for (prefix, family) in [
            ("alloc", Family::Alloc),
            ("new", Family::New),
            ("copy", Family::Copy),
            ("mutableCopy", Family::MutableCopy),
            ("init", Family::Init),
        ] {
            if let Some(rest) = s.strip_prefix(prefix)
                && !rest.starts_with(|c: char| c.is_ascii_lowercase())
            {
                return family;
            }
        }
        Family::None
    }

    pub fn returns_retained(self) -> bool {
        self != Family::None
    }
}

/// A method's argument and return types as the receiver reports them.
pub struct Signature {
    pub args: Vec<Enc>,
    pub ret: Enc,
    pub family: Family,
    ns: NSMethodSignature,
    sel: super::Sel,
    ret_len: usize,
    method: String,
}

impl fmt::Debug for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Signature")
            .field("method", &self.method)
            .field("args", &self.args)
            .field("ret", &self.ret)
            .field("family", &self.family)
            .finish()
    }
}

impl Signature {
    /// `-[NSWindow setTitle:]`, for messages.
    pub fn method(&self) -> &str {
        &self.method
    }
}

/// Selectors whose effect the wrappers already account for; sending them by
/// hand unbalances the reference this crate holds.
const MANAGED_SELECTORS: &[&str] = &["retain", "release", "autorelease", "dealloc", "retainCount"];

fn pool_if_none() -> Option<AutoreleasePool> {
    (AutoreleasePool::live_count() == 0).then(AutoreleasePool::new)
}

fn selector(name: &str, receiver: Receiver<'_>) -> Result<super::Sel> {
    match CString::new(name) {
        Ok(c) => Ok(register_sel(&c)),
        Err(_) => Err(Error::Unrecognized {
            class: receiver.class_name()?,
            sel: name.to_owned(),
            instance: receiver.is_instance(),
        }),
    }
}

/// `+instancesRespondToSelector:`.
fn instances_respond(class: DynClass, sel: &str) -> Result<bool> {
    match send(
        Receiver::Class(&class),
        "instancesRespondToSelector:",
        &[DynValue::Sel(sel.to_owned())],
    )? {
        DynValue::Bool(b) => Ok(b),
        _ => Ok(false),
    }
}

/// `+instanceMethodSignatureForSelector:`.
fn instance_method_signature(class: DynClass, sel: &str) -> Result<Option<NSMethodSignature>> {
    match send(
        Receiver::Class(&class),
        "instanceMethodSignatureForSelector:",
        &[DynValue::Sel(sel.to_owned())],
    )? {
        DynValue::Object(o) => Ok(o.target()?.downcast::<NSMethodSignature>().ok()),
        _ => Ok(None),
    }
}

/// Selectors that read a variable argument list after their last declared
/// argument. The runtime records nothing that tells them apart, so they are
/// known by name: Foundation and AppKit spell them `…WithFormat:`,
/// `…WithObjects:`, `…ObjectsAndKeys:` and a handful of one-offs.
fn is_variadic(sel: &str) -> bool {
    let components = || strings::tokenize(sel.as_bytes(), b":");
    let Some(last) = components().last() else {
        return false;
    };
    // `predicateWithFormat:argumentArray:` and `-[NSOpenGLContext
    // initWithFormat:shareContext:]` take their would-be arguments as objects.
    if matches!(last, b"argumentArray" | b"shareContext") {
        return false;
    }
    matches!(
        last,
        b"format" | b"appendFormat" | b"stringByAppendingFormat" | b"initWithColorsAndLocations"
    ) || last.ends_with(b"WithObjects")
        || last.ends_with(b"ObjectsAndKeys")
        || last.ends_with(b"ValuesOfObjCTypes")
        || components().any(|c| c.ends_with(b"WithFormat") || c.ends_with(b"ValidatedFormat"))
}

/// Looks the method up on the receiver. `Unrecognized` unless the receiver
/// responds to `sel`, so a typo is an error here rather than an exception
/// inside the send.
pub fn signature(receiver: Receiver<'_>, sel: &str) -> Result<Signature> {
    load()?;
    let _pool = pool_if_none();
    let method = receiver.method_name(sel)?;
    let unsupported = |what: &str| Error::UnsupportedSignature {
        method: method.clone(),
        what: what.into(),
    };
    if MANAGED_SELECTORS.contains(&sel) {
        return Err(unsupported(
            "reference counting is managed by the wrapper; use release() on it instead",
        ));
    }
    let family = Family::of(sel);
    let allocated = receiver.allocated_class();
    if allocated.is_some() && family != Family::Init {
        return Err(Error::NotInitialized);
    }
    if family == Family::Init && allocated.is_none() && !receiver.is_instance() {
        return Err(unsupported(
            "init on a class object; call alloc() (or new()) first",
        ));
    }
    let raw_sel = selector(sel, receiver)?;
    let unrecognized = || Error::Unrecognized {
        class: receiver.class_name().unwrap_or_default(),
        sel: sel.to_owned(),
        instance: receiver.is_instance(),
    };
    let responds = match allocated {
        Some(class) => instances_respond(class, sel)?,
        None => receiver.with_target(|t| t.responds_to_selector(raw_sel))?,
    };
    if !responds {
        return Err(unrecognized());
    }
    if is_variadic(sel) {
        return Err(unsupported("variadic methods are not supported"));
    }
    // NSMethodSignature raises on encodings it cannot size (SIMD vectors,
    // `<2f>`), so those are refused from the runtime's copy first. A method
    // reached by forwarding has no copy there; Foundation's answer stands.
    let (owner, class_method) = receiver.method_owner()?;
    if let Some(types) = owner.raw_types(raw_sel, class_method)
        && (types.is_empty() || strings::contains_char(types.as_bytes(), b'<'))
    {
        return Err(unsupported(&format!(
            "type encoding {types:?} is not supported"
        )));
    }
    let ns = match allocated {
        Some(class) => instance_method_signature(class, sel)?,
        None => receiver.with_target(|t| t.method_signature_for_selector(raw_sel))?,
    }
    .ok_or_else(unrecognized)?;
    let count = ns.number_of_arguments();
    let mut args = Vec::with_capacity(count.saturating_sub(2));
    let mut names = strings::split(sel.as_bytes(), b":");
    for i in 2..count {
        let enc = Enc::parse(&ns.argument_type_at(i).0.unwrap_or_default());
        // A `va_list` is a plain pointer (`char *` on arm64) as encoded; the
        // parameter name is all that gives it away.
        if names.next() == Some(b"arguments") && enc != Enc::Object {
            return Err(unsupported("methods taking a va_list are not supported"));
        }
        args.push(enc);
    }
    let ret = Enc::parse(ns.method_return_type().0.as_deref().unwrap_or("v"));
    let family = if matches!(ret, Enc::Object) {
        family
    } else {
        Family::None
    };
    Ok(Signature {
        args,
        ret,
        family,
        ret_len: ns.method_return_length(),
        ns,
        sel: raw_sel,
        method,
    })
}

// ─────────────────────────────────── values ──────────────────────────────────

/// A value crossing the bridge in either direction.
#[derive(Debug)]
pub enum DynValue {
    Nil,
    Object(DynObject),
    Class(DynClass),
    Sel(String),
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(f64),
    /// A C string in, a copied C string out; also boxed to `NSString` for an `@` argument.
    Str(String),
    Rect(Rect),
    Point(Point),
    Size(Size),
    Range(Range),
    Insets(Insets),
    /// `CGAffineTransform` as `[a, b, c, d, tx, ty]`.
    Affine([f64; 6]),
    /// An opaque address from a pointer-typed return.
    Pointer(usize),
    /// A `void` return.
    Void,
}

impl DynValue {
    /// What kind of value this is, for messages.
    pub fn kind(&self) -> &'static str {
        match self {
            DynValue::Nil => "null",
            DynValue::Object(_) => "an object",
            DynValue::Class(_) => "a class",
            DynValue::Sel(_) => "a selector name",
            DynValue::Bool(_) => "a boolean",
            DynValue::I64(_) | DynValue::U64(_) => "an integer",
            DynValue::F64(_) => "a number",
            DynValue::Str(_) => "a string",
            DynValue::Rect(_) => "a CGRect",
            DynValue::Point(_) => "a CGPoint",
            DynValue::Size(_) => "a CGSize",
            DynValue::Range(_) => "an NSRange",
            DynValue::Insets(_) => "an NSEdgeInsets",
            DynValue::Affine(_) => "a CGAffineTransform",
            DynValue::Pointer(_) => "a pointer",
            DynValue::Void => "undefined",
        }
    }
}

/// One argument or return value in C layout. 16-aligned and as large as the
/// biggest supported struct (`CGAffineTransform`, 48 bytes).
#[repr(C, align(16))]
struct Frame([u8; 64]);

const _: () = assert!(
    cfg!(target_endian = "little"),
    "Frame reads and writes assume little endian"
);

impl Frame {
    fn new() -> Frame {
        Frame([0; 64])
    }

    fn put(&mut self, at: usize, bytes: &[u8]) {
        self.0[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn word(&mut self, v: usize) {
        self.put(0, &v.to_ne_bytes());
    }

    fn f64s(&mut self, values: &[f64]) {
        for (i, v) in values.iter().enumerate() {
            self.put(i * 8, &v.to_ne_bytes());
        }
    }

    fn read_word(&self) -> usize {
        usize::from_ne_bytes(self.0[..8].try_into().expect("8 bytes"))
    }

    fn read_f64(&self, i: usize) -> f64 {
        f64::from_ne_bytes(self.0[i * 8..i * 8 + 8].try_into().expect("8 bytes"))
    }

    fn read_u64(&self, i: usize) -> u64 {
        u64::from_ne_bytes(self.0[i * 8..i * 8 + 8].try_into().expect("8 bytes"))
    }
}

/// What must outlive the invoke: boxed objects and C strings the argument
/// frames point at.
#[derive(Default)]
struct Keep {
    objects: Vec<NSObject>,
    strings: Vec<CString>,
}

/// [`signature`] then [`invoke`].
pub fn send(receiver: Receiver<'_>, sel: &str, args: &[DynValue]) -> Result<DynValue> {
    let sig = signature(receiver, sel)?;
    invoke(receiver, &sig, args)
}

/// Sends the message `sig` was looked up for with `args`, which must match
/// `sig.args` one for one. Object results are retained (or adopted, for the
/// owning families). `alloc…` on a class is not sent: its result allocates
/// when an `init…` reaches it, and that init consumes it (as it does any
/// object receiver), which reads as [`Error::Consumed`] from then on. An
/// exception raised inside the method is not caught.
pub fn invoke(receiver: Receiver<'_>, sig: &Signature, args: &[DynValue]) -> Result<DynValue> {
    load()?;
    let _pool = pool_if_none();
    if args.len() != sig.args.len() {
        return Err(Error::ArgCount {
            method: sig.method.clone(),
            expected: sig.args.len(),
            got: args.len(),
        });
    }
    match &sig.ret {
        Enc::Other(e) => {
            return Err(Error::UnsupportedSignature {
                method: sig.method.clone(),
                what: format!("return type {e} is not supported yet"),
            });
        }
        Enc::Struct(kind) if kind.byte_len() != sig.ret_len => {
            return Err(Error::UnsupportedSignature {
                method: sig.method.clone(),
                what: format!(
                    "{} return is {} bytes here, expected {}",
                    kind.name(),
                    sig.ret_len,
                    kind.byte_len()
                ),
            });
        }
        _ if sig.ret_len > core::mem::size_of::<Frame>() => {
            return Err(Error::UnsupportedSignature {
                method: sig.method.clone(),
                what: format!("a {}-byte return value is not supported", sig.ret_len),
            });
        }
        _ => {}
    }

    let invocation = NSInvocation::with_method_signature(&sig.ns);
    invocation.set_selector(sig.sel);
    let mut keep = Keep::default();
    for (index, (enc, value)) in sig.args.iter().zip(args).enumerate() {
        let mut frame = Frame::new();
        encode(sig, index, enc, value, &mut frame, &mut keep)?;
        invocation.set_argument_raw(Ptr(frame.0.as_ptr().cast()), (index + 2) as isize);
    }
    if sig.family == Family::Alloc
        && let Some(class) = receiver.as_class()
    {
        return Ok(DynValue::Object(DynObject::allocated(class)));
    }

    let mut ret = Frame::new();
    match receiver {
        Receiver::Object(o) if sig.family == Family::Init => {
            // init takes over the reference this wrapper owned and may hand
            // back a different object, so the receiver is never released here.
            let target = o.take_for_init(&sig.method)?;
            invocation.invoke_with_target(&target);
        }
        _ => receiver.with_target(|t| invocation.invoke_with_target(t))?,
    }
    if sig.ret != Enc::Void && sig.ret_len > 0 {
        invocation.get_return_value_raw(Ptr(ret.0.as_mut_ptr().cast_const().cast()));
    }
    drop(keep);
    decode(sig, &ret)
}

fn arg_type(sig: &Signature, index: usize, enc: &Enc, value: &DynValue) -> Error {
    Error::ArgType {
        method: sig.method.clone(),
        index,
        expected: enc.to_string(),
        got: value.kind().to_owned(),
    }
}

fn unsupported(sig: &Signature, what: impl Into<String>) -> Error {
    Error::UnsupportedSignature {
        method: sig.method.clone(),
        what: what.into(),
    }
}

/// Lays `value` out in `frame` as the C type `enc`; whatever the frame ends
/// up pointing at goes in `keep`.
fn encode(
    sig: &Signature,
    index: usize,
    enc: &Enc,
    value: &DynValue,
    frame: &mut Frame,
    keep: &mut Keep,
) -> Result<()> {
    let mismatch = || arg_type(sig, index, enc, value);
    let c_string = |s: &str| {
        CString::new(s).map_err(|_| Error::ArgType {
            method: sig.method.clone(),
            index,
            expected: enc.to_string(),
            got: "a string containing a NUL character".into(),
        })
    };
    let mut object = |o: NSObject, frame: &mut Frame| {
        frame.word(o.as_obj() as usize);
        keep.objects.push(o);
    };
    match (enc, value) {
        (
            Enc::Object | Enc::Block | Enc::Class | Enc::Sel | Enc::CString | Enc::Pointer,
            DynValue::Nil,
        )
        | (Enc::Pointer, DynValue::Pointer(0)) => frame.word(0),
        (Enc::Object, DynValue::Object(o)) => object(o.live()?.clone(), frame),
        (Enc::Object, DynValue::Class(c)) => frame.word(c.address()),
        (Enc::Object, DynValue::Str(s)) => {
            object(NSString::from_str(NsStr::Utf8(s)).upcast().clone(), frame)
        }
        (Enc::Object, DynValue::Bool(b)) => object(NSNumber::with_bool(*b).upcast().clone(), frame),
        (Enc::Object, DynValue::F64(n)) => object(nsnumber(*n).upcast().clone(), frame),
        (Enc::Object, DynValue::I64(n)) => object(NSNumber::with_i64(*n).upcast().clone(), frame),
        (Enc::Object, DynValue::U64(n)) => match i64::try_from(*n) {
            Ok(n) => object(NSNumber::with_i64(n).upcast().clone(), frame),
            Err(_) => object(NSNumber::with_f64(*n as f64).upcast().clone(), frame),
        },
        (Enc::Block, _) => return Err(unsupported(sig, "block arguments are not supported yet")),
        (Enc::Class, DynValue::Class(c)) => frame.word(c.address()),
        (Enc::Class, DynValue::Object(o)) if o.is_class() => {
            frame.word(o.live()?.as_obj() as usize)
        }
        (Enc::Sel, DynValue::Sel(name) | DynValue::Str(name)) => {
            frame.word(register_sel(&c_string(name)?).0.as_ptr() as usize);
        }
        (Enc::Bool, DynValue::Bool(b)) => frame.put(0, &[u8::from(*b)]),
        (Enc::Int { bits, signed }, DynValue::I64(_) | DynValue::U64(_)) => {
            let v: i128 = match value {
                DynValue::I64(v) => i128::from(*v),
                DynValue::U64(v) => i128::from(*v),
                _ => unreachable!(),
            };
            let (min, max) = if *signed {
                (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
            } else {
                (0, (1i128 << bits) - 1)
            };
            if v < min || v > max {
                return Err(Error::ArgType {
                    method: sig.method.clone(),
                    index,
                    expected: format!("{enc} from {min} to {max}"),
                    got: v.to_string(),
                });
            }
            // Two's complement and little endian, so the low bytes are the
            // value at any width.
            frame.put(0, &(v as i64).to_le_bytes()[..usize::from(*bits / 8)]);
        }
        (Enc::F32, DynValue::F64(v)) => frame.put(0, &(*v as f32).to_ne_bytes()),
        (Enc::F32, DynValue::I64(v)) => frame.put(0, &(*v as f32).to_ne_bytes()),
        (Enc::F32, DynValue::U64(v)) => frame.put(0, &(*v as f32).to_ne_bytes()),
        (Enc::F64, DynValue::F64(v)) => frame.f64s(&[*v]),
        (Enc::F64, DynValue::I64(v)) => frame.f64s(&[*v as f64]),
        (Enc::F64, DynValue::U64(v)) => frame.f64s(&[*v as f64]),
        (Enc::CString, DynValue::Str(s)) => {
            let c = c_string(s)?;
            frame.word(c.as_ptr() as usize);
            keep.strings.push(c);
        }
        (Enc::Pointer, _) => {
            return Err(unsupported(sig, "pointer arguments are not supported yet"));
        }
        (Enc::Struct(StructKind::Rect), DynValue::Rect(r)) => {
            frame.f64s(&[r.origin.x, r.origin.y, r.size.width, r.size.height]);
        }
        (Enc::Struct(StructKind::Point), DynValue::Point(p)) => frame.f64s(&[p.x, p.y]),
        (Enc::Struct(StructKind::Size), DynValue::Size(s)) => frame.f64s(&[s.width, s.height]),
        (Enc::Struct(StructKind::Insets), DynValue::Insets(i)) => {
            frame.f64s(&[i.top, i.left, i.bottom, i.right]);
        }
        (Enc::Struct(StructKind::Affine), DynValue::Affine(m)) => frame.f64s(m),
        (Enc::Struct(StructKind::Range), DynValue::Range(r)) => {
            frame.put(0, &(r.location as u64).to_ne_bytes());
            frame.put(8, &(r.length as u64).to_ne_bytes());
        }
        (Enc::Other(e), _) => {
            return Err(unsupported(
                sig,
                format!("argument type {e} is not supported yet"),
            ));
        }
        _ => return Err(mismatch()),
    }
    Ok(())
}

/// Reads the return value out of `frame` as `sig.ret`.
fn decode(sig: &Signature, frame: &Frame) -> Result<DynValue> {
    Ok(match &sig.ret {
        Enc::Void => DynValue::Void,
        Enc::Object | Enc::Block => {
            let raw = frame.read_word() as Obj;
            // SAFETY: the method's declared object result, just returned on
            // this thread; owned already when the selector family says so,
            // otherwise +0 and retained before any pool can drain.
            let object = unsafe {
                if sig.family.returns_retained() {
                    DynObject::from_retained(raw)
                } else {
                    DynObject::retain(raw)
                }
            };
            object.map_or(DynValue::Nil, DynValue::Object)
        }
        Enc::Class => NonNull::new(frame.read_word() as Obj)
            .map_or(DynValue::Nil, |p| DynValue::Class(DynClass(Class(p)))),
        Enc::Sel => match NonNull::new(frame.read_word() as Obj) {
            Some(p) => DynValue::Sel(rt().sel_name(super::Sel(p))),
            None => DynValue::Nil,
        },
        Enc::Bool => DynValue::Bool(frame.0[0] != 0),
        Enc::Int { bits, signed } => {
            // The value is the low `bits` of the first word; shift it to the
            // top and back to sign- or zero-extend.
            let shift = 64 - u32::from(*bits);
            let raw = frame.read_u64(0) << shift;
            if *signed {
                DynValue::I64((raw as i64) >> shift)
            } else {
                DynValue::U64(raw >> shift)
            }
        }
        Enc::F32 => DynValue::F64(f64::from(f32::from_ne_bytes(
            frame.0[..4].try_into().expect("4 bytes"),
        ))),
        Enc::F64 => DynValue::F64(frame.read_f64(0)),
        Enc::CString => {
            let p = frame.read_word() as *const core::ffi::c_char;
            if p.is_null() {
                DynValue::Nil
            } else {
                // SAFETY: a `char *` result is NUL-terminated and valid at
                // least until the current pool drains; copied now.
                DynValue::Str(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned())
            }
        }
        Enc::Pointer => DynValue::Pointer(frame.read_word()),
        Enc::Struct(StructKind::Rect) => DynValue::Rect(Rect::new(
            frame.read_f64(0),
            frame.read_f64(1),
            frame.read_f64(2),
            frame.read_f64(3),
        )),
        Enc::Struct(StructKind::Point) => DynValue::Point(Point {
            x: frame.read_f64(0),
            y: frame.read_f64(1),
        }),
        Enc::Struct(StructKind::Size) => DynValue::Size(Size {
            width: frame.read_f64(0),
            height: frame.read_f64(1),
        }),
        Enc::Struct(StructKind::Insets) => DynValue::Insets(Insets {
            top: frame.read_f64(0),
            left: frame.read_f64(1),
            bottom: frame.read_f64(2),
            right: frame.read_f64(3),
        }),
        Enc::Struct(StructKind::Affine) => {
            DynValue::Affine(core::array::from_fn(|i| frame.read_f64(i)))
        }
        Enc::Struct(StructKind::Range) => DynValue::Range(Range {
            location: frame.read_u64(0) as usize,
            length: frame.read_u64(1) as usize,
        }),
        Enc::Other(e) => {
            return Err(unsupported(
                sig,
                format!("return type {e} is not supported yet"),
            ));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{Enc, Family, StructKind};

    #[test]
    fn encodings() {
        assert_eq!(Enc::parse("@"), Enc::Object);
        assert_eq!(Enc::parse("@?"), Enc::Block);
        assert_eq!(Enc::parse("r*"), Enc::CString);
        assert_eq!(Enc::parse("^{CGColor=}"), Enc::Pointer);
        assert_eq!(
            Enc::parse("Q"),
            Enc::Int {
                bits: 64,
                signed: false
            }
        );
        assert_eq!(
            Enc::parse("{CGRect={CGPoint=dd}{CGSize=dd}}"),
            Enc::Struct(StructKind::Rect)
        );
        assert_eq!(Enc::parse("{_NSRange=QQ}"), Enc::Struct(StructKind::Range));
        assert_eq!(
            Enc::parse("{CGAffineTransform=dddddd}"),
            Enc::Struct(StructKind::Affine)
        );
        assert!(matches!(Enc::parse("{Foo=ii}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("(?=iq)"), Enc::Other(_)));
    }

    #[test]
    fn families() {
        assert_eq!(Family::of("alloc"), Family::Alloc);
        assert_eq!(Family::of("newValue"), Family::New);
        assert_eq!(Family::of("newsstand"), Family::None);
        assert_eq!(Family::of("_initWithFrame:"), Family::Init);
        assert_eq!(Family::of("initialize"), Family::None);
        assert_eq!(Family::of("copyright"), Family::None);
        assert_eq!(Family::of("mutableCopy"), Family::MutableCopy);
        assert_eq!(Family::of("copy:"), Family::Copy);
    }
}
