//! Messages chosen at run time: any selector on any object or class, typed
//! from the receiver's `NSMethodSignature` rather than from a binding line.
//! The calling-convention work (struct and float returns included) is
//! libffi's ([`ffi`]) for every type laid out here, so nothing in this file
//! depends on the CPU beyond the width of `BOOL` and which `objc_msgSend`
//! returns a struct. `NSInvocation` sends the same messages when
//! `BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI` turns libffi off, as the A/B
//! switch while the libffi path proves itself on every build; it is not a
//! per-type fallback (a type one cannot carry, the other cannot either).
//!
//! The typed bindings in the sibling modules stay the way the crate itself
//! talks to AppKit; this is what `bun:objc` hands to scripts.

use bun_collections::HashMap;
use bun_collections::smallvec::SmallVec;
use bun_threading::Guarded;
use core::cell::{Ref, RefCell};
use core::ffi::{CStr, c_void};
use core::fmt;
use core::mem::ManuallyDrop;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, Ordering};
use std::borrow::Cow;
use std::ffi::CString;
use std::rc::Rc;
use std::sync::{LazyLock, OnceLock};

use super::appkit::{NSBitmapImageRep, NSWindow};
use super::foundation::{
    NSArray, NSData, NSDate, NSDictionary, NSException, NSInvocation, NSMethodSignature,
    NSMutableArray, NSMutableDictionary, NSNull, NSNumber, NSObject, NSString, Upcast,
};
use super::{
    AutoreleasePool, Class, ClassType, Id, NsStr, Obj, Object, Ptr, block, ffi, load,
    main_thread_only, register_sel, rt, sdk,
};
use crate::error::{Error, Result};
use bun_core::strings;

// ───────────────────────────────── receivers ─────────────────────────────────

enum Slot {
    Live(NSObject),
    /// `+alloc` asked for on `class`, to be followed by an `init…`. Usually
    /// not sent until then, with arguments that converted, so a failed or
    /// forgotten init leaves nothing to deallocate; `instance` is the sent
    /// `+alloc`'s result for a class whose instances alone know their
    /// `init…` methods (see [`DynObject::allocate_now`]). Either way nothing
    /// but an `init…` may be sent to it.
    Allocated {
        class: DynClass,
        instance: Option<NSObject>,
    },
    Consumed,
    Released,
    /// The script is done with the object ([`DynObject::close`]) but the
    /// reference is kept until the wrapper goes, for what natively still
    /// calls into it. Answers like `Released`.
    Closed(NSObject),
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
            Slot::Allocated { class, .. } => write!(f, "allocated({class:?})"),
            Slot::Consumed => write!(f, "consumed({:#x})", self.addr),
            Slot::Released | Slot::Closed(_) => write!(f, "released({:#x})", self.addr),
        }
    }
}

/// Why an `init…` sent to a handle that did not come from `alloc()` is refused.
const ALREADY_INITIALIZED: &str =
    "this object is already initialized; an init… method goes to what alloc() returns, once";

thread_local! {
    /// The receivers of the script-defined `init…` methods running on this
    /// thread, innermost last: the objects an `init…` may still be sent to
    /// (up to the superclass's, or on to another of the class's own).
    static INITIALIZING: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}

/// Marks `receiver` as inside one of its script-defined `init…` methods
/// while the value lives; see [`INITIALIZING`].
pub(super) struct Initializing(usize);

impl Initializing {
    pub(super) fn enter(receiver: Obj) -> Initializing {
        INITIALIZING.with_borrow_mut(|stack| stack.push(receiver as usize));
        Initializing(receiver as usize)
    }

    fn contains(address: usize) -> bool {
        INITIALIZING.with_borrow(|stack| stack.contains(&address))
    }
}

impl Drop for Initializing {
    fn drop(&mut self) {
        INITIALIZING.with_borrow_mut(|stack| {
            if let Some(at) = stack.iter().rposition(|&a| a == self.0) {
                stack.remove(at);
            }
        });
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
            slot: RefCell::new(Slot::Allocated {
                class,
                instance: None,
            }),
        }
    }

    /// Sends the `+alloc` this wrapper stands for now rather than with the
    /// `init…`, for a class whose own method table lacks that `init…` (a
    /// class cluster whose concrete subclass has it), and returns the class
    /// of what came back, which is where the `init…` is looked up instead.
    /// The wrapper still counts as not initialised.
    fn allocate_now(&self, method: &str) -> Result<DynClass> {
        let mut slot = self.slot.borrow_mut();
        let Slot::Allocated { class, instance } = &mut *slot else {
            return Err(DynObject::unusable(&slot));
        };
        if instance.is_none() {
            *instance =
                Some(
                    class
                        .alloc_instance()?
                        .ok_or_else(|| Error::UnsupportedSignature {
                            method: method.to_owned(),
                            what: "+alloc returned nil".into(),
                        })?,
                );
        }
        let object = instance.as_ref().expect("just set");
        Ok(DynClass(rt().class_of(object.as_id())))
    }

    /// The class `alloc()` was called on, while no `init…` has been sent.
    fn allocated_class(&self) -> Option<DynClass> {
        match &*self.slot.borrow() {
            Slot::Allocated { class, .. } => Some(*class),
            _ => None,
        }
    }

    /// Another reference to an object the crate already holds typed.
    pub(crate) fn from_object<T: Object>(object: &T) -> DynObject {
        DynObject::wrap(object.upcast().clone())
    }

    /// # Safety
    /// `ptr` is nil or a live object; one reference is taken.
    pub(super) unsafe fn retain(ptr: Obj) -> Option<DynObject> {
        // SAFETY: per contract; every object is an NSObject for our purposes.
        unsafe { Id::retain(ptr).map(|id| DynObject::wrap(NSObject::from_id(id))) }
    }

    /// # Safety
    /// `ptr` is nil or a +1 reference whose ownership moves here.
    pub(super) unsafe fn from_retained(ptr: Obj) -> Option<DynObject> {
        // SAFETY: per contract.
        unsafe { Id::from_retained(ptr).map(|id| DynObject::wrap(NSObject::from_id(id))) }
    }

    fn unusable(slot: &Slot) -> Error {
        match slot {
            Slot::Allocated { .. } => Error::NotInitialized,
            Slot::Consumed => Error::Consumed,
            _ => Error::ObjectReleased,
        }
    }

    pub(super) fn live(&self) -> Result<Ref<'_, NSObject>> {
        Ref::filter_map(self.slot.borrow(), |slot| match slot {
            Slot::Live(o) => Some(o),
            _ => None,
        })
        .map_err(|slot| DynObject::unusable(&slot))
    }

    /// `f` applied to the object, which must be live. `f` gets a reference
    /// of its own, not a borrow of the wrapper's, so whatever it sends may
    /// run script code that releases this wrapper.
    pub(crate) fn with<R>(&self, f: impl FnOnce(&NSObject) -> R) -> Result<R> {
        Ok(f(&self.target()?))
    }

    /// Hands the one reference this wrapper owns (allocating it now, for an
    /// unsent `alloc`) to an `init…` message. Only what `alloc` gave takes
    /// one: an initialized object is not initialized again, except from
    /// inside its own class's `init…`, which hands it up to the
    /// superclass's or on to another of its initializers.
    fn take_for_init(&self, method: &str) -> Result<ManuallyDrop<NSObject>> {
        let mut slot = self.slot.borrow_mut();
        match core::mem::replace(&mut *slot, Slot::Consumed) {
            Slot::Allocated {
                instance: Some(o), ..
            } => Ok(ManuallyDrop::new(o)),
            Slot::Live(o) if Initializing::contains(self.addr) => Ok(ManuallyDrop::new(o)),
            live @ Slot::Live(_) => {
                *slot = live;
                Err(Error::InvalidState(ALREADY_INITIALIZED))
            }
            Slot::Allocated {
                class,
                instance: None,
            } => match class.alloc_instance()? {
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
    /// 0 for an `alloc` awaiting its `init…`.
    pub fn address(&self) -> usize {
        self.addr
    }

    /// Drops this wrapper's reference now. Idempotent.
    pub fn release(&self) {
        let object = {
            let mut slot = self.slot.borrow_mut();
            match core::mem::replace(&mut *slot, Slot::Released) {
                Slot::Live(object) | Slot::Closed(object) => Some(object),
                Slot::Allocated { instance, .. } => instance,
                other => {
                    *slot = other;
                    None
                }
            }
        };
        // The last release runs `dealloc`, which may autorelease, and may
        // send messages that come back to this wrapper; so it goes with the
        // slot no longer borrowed.
        if let Some(object) = object {
            let _pool = pool_if_none();
            drop(object);
        }
    }

    /// Ends the script's use of a live object like [`release`](DynObject::release)
    /// but keeps the reference until this value is dropped. Idempotent.
    pub fn close(&self) {
        let mut slot = self.slot.borrow_mut();
        *slot = match core::mem::replace(&mut *slot, Slot::Released) {
            Slot::Live(object) => Slot::Closed(object),
            other => other,
        };
    }

    pub fn is_released(&self) -> bool {
        matches!(
            *self.slot.borrow(),
            Slot::Consumed | Slot::Released | Slot::Closed(_)
        )
    }

    /// Whether dropping this value gives a reference back.
    pub fn holds_reference(&self) -> bool {
        matches!(
            *self.slot.borrow(),
            Slot::Live(_)
                | Slot::Closed(_)
                | Slot::Allocated {
                    instance: Some(_),
                    ..
                }
        )
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

    pub fn unsigned(value: u64) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSNumber::with_u64(value)))
    }

    pub fn boolean(value: bool) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSNumber::with_bool(value)))
    }

    /// A new `NSData` holding a copy of `bytes`.
    pub fn data(bytes: &[u8]) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSData::from_bytes(bytes)))
    }

    /// A new `NSDate`, from milliseconds since 1970 the way JavaScript counts.
    pub fn date(milliseconds: f64) -> Result<DynObject> {
        load()?;
        let _pool = pool_if_none();
        Ok(DynObject::from_object(&NSDate::with_seconds_since_1970(
            milliseconds / 1000.0,
        )))
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

    /// Which byte-owning class the object descends from; see [`Heavy`].
    pub fn heavy(&self) -> Heavy {
        match self.live() {
            Ok(object) => Heavy::of(&object),
            Err(_) => Heavy::Other,
        }
    }

    /// About how many bytes the object keeps alive beyond itself when it is
    /// of the `heavy` kind ([`DynObject::heavy`]'s answer for it): the bytes
    /// of an `NSData`, two per character of an `NSString`, the planes of an
    /// `NSBitmapImageRep`. A small constant for everything else (classes,
    /// proxies, unsent allocs and released handles included).
    pub fn estimated_size(&self, heavy: Heavy) -> usize {
        const OTHER: usize = 32;
        let (Ok(object), false) = (self.live(), heavy == Heavy::Other) else {
            return OTHER;
        };
        let _pool = pool_if_none();
        OTHER
            + match heavy {
                Heavy::MutableData | Heavy::Data => {
                    view_as::<NSData>(&object).map_or(0, |data| data.length())
                }
                Heavy::MutableString | Heavy::String => {
                    view_as::<NSString>(&object).map_or(0, |string| string.length() * 2)
                }
                Heavy::Bitmap => view_as::<NSBitmapImageRep>(&object).map_or(0, |rep| {
                    (rep.bytes_per_plane() * rep.number_of_planes()).max(0) as usize
                }),
                Heavy::Other => 0,
            }
    }
}

/// The classes whose instances own bytes the collector should know about,
/// as [`DynObject::estimated_size`] weighs them. The mutable kinds can grow
/// after the handle was made.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Heavy {
    MutableData,
    Data,
    MutableString,
    String,
    Bitmap,
    Other,
}

impl Heavy {
    /// One walk up `object`'s class chain (never a message, so proxies and
    /// classes are safe to ask about).
    fn of(object: &NSObject) -> Heavy {
        static CLASSES: OnceLock<[(usize, Heavy); 5]> = OnceLock::new();
        let classes = CLASSES.get_or_init(|| {
            let by_name =
                |name: &CStr| super::lookup_class(name).map_or(0, |c| c.as_obj() as usize);
            [
                (by_name(c"NSMutableData"), Heavy::MutableData),
                (NSData::class().as_obj() as usize, Heavy::Data),
                (by_name(c"NSMutableString"), Heavy::MutableString),
                (NSString::class().as_obj() as usize, Heavy::String),
                (NSBitmapImageRep::class().as_obj() as usize, Heavy::Bitmap),
            ]
        });
        for class in rt().class_chain(rt().class_of(object.as_id())) {
            let addr = class.as_obj() as usize;
            if let Some((_, heavy)) = classes.iter().find(|(c, _)| *c == addr) {
                return *heavy;
            }
        }
        Heavy::Other
    }

    /// Whether sends through a handle can change what it weighs.
    pub fn grows(self) -> bool {
        matches!(self, Heavy::MutableData | Heavy::MutableString)
    }
}

/// A reference of its own to a block or an instance of a script-defined
/// class, through which any thread may ask how many references there are:
/// how the collector learns that native code still holds what a wrapper's
/// functions answer for.
pub struct Kept {
    object: NonNull<c_void>,
    block: bool,
    /// The reference was given back early by [`Kept::let_go`].
    gone: AtomicBool,
}

// SAFETY: an address and two flags; retain counts are read and references
// given back thread-safely by the Objective-C runtime.
unsafe impl Send for Kept {}
// SAFETY: as above.
unsafe impl Sync for Kept {}

impl Kept {
    /// One more reference to `object`, which must be a block or descend
    /// from `NSObject` (whose `retainCount` is then the true count).
    pub fn new(object: &DynObject) -> Result<Kept> {
        let live = object.live()?;
        let class = rt().class_of(live.as_id());
        let block = block::is_block(class);
        if !block && is_proxy(&live) {
            return Err(Error::InvalidState("a proxy cannot carry script functions"));
        }
        let id = ManuallyDrop::new(live.clone());
        Ok(Kept {
            object: NonNull::new(id.as_obj()).expect("a live object is not nil"),
            block,
            gone: AtomicBool::new(false),
        })
    }

    /// Gives the reference back now rather than at drop, on the script's
    /// thread, so an object the script let go of does not keep a reference
    /// that a later wrapper for it would count as someone else's. After this
    /// the count reads as zero and the drop does nothing.
    pub fn let_go(&self) {
        if !self.gone.swap(true, Ordering::AcqRel) {
            // SAFETY: the reference `new` took, given back exactly once.
            unsafe { (rt().objc_release)(self.object.as_ptr()) };
        }
    }

    /// How many references to the object exist right now, this one included.
    pub fn retain_count(&self) -> usize {
        if self.gone.load(Ordering::Acquire) {
            return 0;
        }
        if self.block {
            // SAFETY: a live heap block this value holds a reference to.
            return unsafe { block::retain_count(self.object.as_ptr()) };
        }
        // SAFETY: a live NSObject this value holds a reference to;
        // `retainCount` is `Q@:` and thread-safe.
        unsafe { rt().send::<usize, _>(self.object.as_ptr(), super::sel!("retainCount"), ()) }
    }
}

impl Drop for Kept {
    fn drop(&mut self) {
        self.let_go();
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
    /// An `NSNumber` made from a signed integer type.
    Integer(i64),
    /// An `NSNumber` made from an unsigned integer type.
    Unsigned(u64),
    Boolean(bool),
    /// `NSData`'s bytes, copied.
    Data(Vec<u8>),
    /// `NSDate` as milliseconds since 1970.
    Date(f64),
    Array(Vec<Plain>),
    /// Keys are the `NSString` keys' text, or `-description` for other keys.
    Dictionary(Vec<(Vec<u16>, Plain)>),
    Other(DynObject),
}

/// Whether `object`'s class descends from `NSObject`. The one other root in
/// practice is `NSProxy`, whose instances forward nearly every message
/// (`respondsToSelector:` and `isKindOfClass:` included) to whatever they stand
/// for; `-[NSUndoManager prepareWithInvocationTarget:]`'s proxy even records
/// the first message it gets as the undo action. So a proxy is only ever sent
/// `methodSignatureForSelector:` and the message a script asked for.
fn is_proxy(object: &NSObject) -> bool {
    !rt().class_inherits(rt().class_of(object.as_id()), NSObject::class())
}

fn plain(object: &NSObject, depth: usize) -> Plain {
    if let Some(string) = view_as::<NSString>(object) {
        return Plain::String(string.to_utf16());
    }
    if let Some(number) = view_as::<NSNumber>(object) {
        if number.as_obj() == NSNumber::with_bool(true).as_obj() {
            return Plain::Boolean(true);
        }
        if number.as_obj() == NSNumber::with_bool(false).as_obj() {
            return Plain::Boolean(false);
        }
        return match number.objc_type().0.as_deref() {
            Some("c" | "s" | "i" | "l" | "q") => Plain::Integer(number.i64_value()),
            Some("C" | "S" | "I" | "L" | "Q") => Plain::Unsigned(number.u64_value()),
            _ => Plain::Number(number.f64_value()),
        };
    }
    if view_as::<NSNull>(object).is_some() {
        return Plain::Null;
    }
    if let Some(data) = view_as::<NSData>(object) {
        return Plain::Data(data.to_vec());
    }
    if let Some(date) = view_as::<NSDate>(object) {
        return Plain::Date(date.seconds_since_1970() * 1000.0);
    }
    if depth < PLAIN_DEPTH
        && let Some(array) = view_as::<NSArray>(object)
    {
        return Plain::Array(array.iter().map(|item| plain(&item, depth + 1)).collect());
    }
    if depth < PLAIN_DEPTH
        && let Some(dict) = view_as::<NSDictionary>(object)
    {
        let entries = dict
            .all_keys()
            .iter()
            .map(|key| {
                let name = match view_as::<NSString>(&key) {
                    Some(name) => name.to_utf16(),
                    None => key.description().map(|d| d.to_utf16()).unwrap_or_default(),
                };
                let value = dict.get(&key).map_or(Plain::Null, |v| plain(&v, depth + 1));
                (name, value)
            })
            .collect();
        return Plain::Dictionary(entries);
    }
    Plain::Other(DynObject::wrap(object.clone()))
}

/// `object` typed as `T` when its class is `T`'s or a subclass, read from the
/// runtime rather than asked with `isKindOfClass:` (the object may be a proxy,
/// which would forward the question).
pub(super) fn view_as<T: ClassType>(object: &NSObject) -> Option<T> {
    if !rt().class_inherits(rt().class_of(object.as_id()), T::class()) {
        return None;
    }
    let owned = ManuallyDrop::new(object.clone());
    // SAFETY: the class was just checked; the clone's one reference moves
    // into the `T`.
    Some(unsafe { T::from_id(ptr::read(owned.as_id())) })
}

/// A class, by name or from a `Class`-typed return.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct DynClass(pub(super) Class);

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

    /// Foundation's signature for `sel` from this class's method table (the
    /// class's own table for a class method), parsed by Foundation from the
    /// method's encoding, which also reads forms `signatureWithObjCTypes:`
    /// refuses, such as the nameless `{?}` x86_64 writes for a nested struct.
    fn method_signature(self, sel: super::Sel, class_method: bool) -> Option<NSMethodSignature> {
        if class_method {
            return self.target().method_signature_for_selector(sel);
        }
        // `+[NSObject instanceMethodSignatureForSelector:]`, a class method
        // of every class, so sent to this class object rather than bound on
        // a wrapper type.
        // SAFETY: a registered class responds to this root class method,
        // which is `@@::` and returns a +0 object or nil; retained here on
        // this thread.
        unsafe {
            let raw: Obj = rt().send(
                self.0.as_obj(),
                super::sel!("instanceMethodSignatureForSelector:"),
                (sel,),
            );
            Id::retain(raw).map(|id| NSMethodSignature::from_id(id))
        }
    }

    /// `+alloc`, sent for real, under the catch frame: the class is the
    /// script's choice, and one that refuses to be allocated
    /// (`NSPasteboard`) raises.
    fn alloc_instance(self) -> Result<Option<NSObject>> {
        alloc_catching(self)
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

/// `objc_getProtocol`: the `Protocol` object, for `conformsToProtocol:` and the like.
pub fn lookup_protocol(name: &str) -> Result<DynObject> {
    load()?;
    let no_protocol = || Error::NoProtocol(name.to_owned());
    let c_name = CString::new(name).map_err(|_| no_protocol())?;
    let protocol = rt().protocol(&c_name).ok_or_else(no_protocol)?;
    // SAFETY: a registered protocol is a live, never-deallocated object.
    unsafe { DynObject::retain(protocol.as_ptr()) }.ok_or_else(no_protocol)
}

/// What a message is sent to.
#[derive(Clone, Copy, Debug)]
pub enum Receiver<'a> {
    Object(&'a DynObject),
    Class(&'a DynClass),
    /// The object (or class object), but answered by the superclass of this
    /// class: a `super` send from a method this class defines.
    Super(&'a DynObject, &'a DynClass),
}

impl Receiver<'_> {
    fn class_name(&self) -> Result<String> {
        match self {
            Receiver::Object(o) => o.class_name(),
            Receiver::Class(c) => Ok(c.name()),
            Receiver::Super(_, c) => Ok(rt()
                .superclass(c.0)
                .map_or_else(|| c.name(), |s| rt().class_name(s))),
        }
    }

    fn is_instance(&self) -> bool {
        match self {
            Receiver::Object(o) | Receiver::Super(o, _) => !o.is_class(),
            Receiver::Class(_) => false,
        }
    }

    /// For a `super` send: the class that answers it (the metaclass's
    /// methods are looked up as class methods of it).
    fn answering_superclass(&self) -> Option<DynClass> {
        match self {
            Receiver::Super(_, c) => rt().superclass(c.0).map(DynClass),
            _ => None,
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
            Receiver::Object(o) | Receiver::Super(o, _) => Ok(f(&o.target()?)),
            Receiver::Class(c) => Ok(f(&c.target())),
        }
    }

    /// The receiver as a class, when it is one (held either way).
    fn as_class(&self) -> Option<DynClass> {
        match self {
            Receiver::Object(o) | Receiver::Super(o, _) => o.as_class(),
            Receiver::Class(c) => Some(**c),
        }
    }

    fn allocated_class(&self) -> Option<DynClass> {
        match self {
            Receiver::Object(o) => o.allocated_class(),
            Receiver::Class(_) | Receiver::Super(..) => None,
        }
    }

    /// Where the runtime keeps `sel`'s method for this receiver: (class,
    /// whether it is a class method).
    fn method_owner(&self) -> Result<(DynClass, bool)> {
        if let Some(class) = self.allocated_class() {
            return Ok((class, false));
        }
        if let Some(superclass) = self.answering_superclass() {
            return Ok((superclass, !self.is_instance()));
        }
        if let Some(class) = self.as_class() {
            return Ok((class, true));
        }
        self.with_target(|t| (DynClass(rt().class_of(t.as_id())), false))
    }

    /// See [`is_proxy`]; class objects, unsent allocs and `super` are not.
    fn is_proxy(&self) -> Result<bool> {
        if !self.is_instance()
            || self.allocated_class().is_some()
            || self.answering_superclass().is_some()
        {
            return Ok(false);
        }
        self.with_target(is_proxy)
    }

    /// Whether the receiver is a block object (class objects and unsent
    /// allocs are not).
    pub fn is_block(&self) -> Result<bool> {
        if !self.is_instance() || self.allocated_class().is_some() {
            return Ok(false);
        }
        self.with_target(|t| block::is_block(rt().class_of(t.as_id())))
    }

    /// `respondsToSelector:`; answered from the class's method table for an
    /// unsent `alloc` or a proxy, which must not be messaged (see [`is_proxy`]).
    pub fn responds_to(&self, sel: &str) -> Result<bool> {
        load()?;
        let _pool = pool_if_none();
        let Ok(c_sel) = CString::new(sel) else {
            return Ok(false);
        };
        let raw_sel = register_sel(&c_sel);
        let (owner, class_method) = self.method_owner()?;
        if self.allocated_class().is_some()
            || self.answering_superclass().is_some()
            || self.is_proxy()?
        {
            return Ok(owner.raw_types(raw_sel, class_method).is_some());
        }
        self.with_target(|t| t.responds_to_selector(raw_sel))
    }

    /// The selectors the receiver's class and its superclasses implement for
    /// it (instance methods for an instance, class methods for a class),
    /// less the ones that start with `_` or `.`, sorted, each once.
    pub fn method_names(&self) -> Result<Vec<String>> {
        load()?;
        let (owner, class_method) = self.method_owner()?;
        // Class methods live on the metaclass, which is the class's class.
        let start = if class_method {
            // SAFETY: a class object is a live object.
            unsafe { rt().class_of_raw(owner.0.as_obj()) }
        } else {
            owner.0
        };
        let mut names: Vec<String> = rt()
            .class_chain(start)
            .flat_map(|c| rt().method_names(c))
            .filter(|n| !n.starts_with('_') && !n.starts_with('.'))
            .collect();
        names.sort_unstable();
        names.dedup();
        Ok(names)
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
    /// `^{CGColor=}`, `^{__CFString=}` and the other [`CFType`]s: a Core
    /// Foundation object, retained and released like any `id`, of that one
    /// type.
    CFObject(&'static CFType),
    /// `@?`
    Block,
    /// `#`
    Class,
    /// `:`
    Sel,
    /// `B`, and a [`Spelling::Runtime`] `c` where that is what `BOOL` is
    /// (x86_64).
    Bool,
    Int {
        bits: u8,
        signed: bool,
    },
    F32,
    F64,
    /// `r*`: a `const char *` C string.
    CString,
    /// `^@`, `^B`, `^q`, `^d`, `^{CGRect=…}`, …: a pointer to one value the
    /// bridge marshals, for a method to read and write back (`NSError **`,
    /// `BOOL *stop`, `NSRangePointer`).
    Out(Pointee),
    /// A C array the method reads or fills: `r^d` (`const CGFloat
    /// *components`), `*` without `r` (`char *buffer`), and the parameters
    /// [`sdk::ARRAY_PARAMS`] lists. Carries the encoding text. Takes the
    /// storage of an `ArrayBuffer` or typed array lent for the call (sized
    /// against the counting argument where the SDK names one), or NULL.
    Buffer(String),
    /// `^v`, `^{Opaque=}`, `^^@`, `^?`: any other pointer, carried as an
    /// address.
    Pointer,
    /// `{CGRect={CGPoint=dd}{CGSize=dd}}`, `{?=QQQ}`: a struct of scalars passed by value.
    Struct(&'static StructType),
    /// Arrays, unions, bit-fields, `long double`, vectors, and structs that
    /// contain any of those or a pointer: carried as the encoding text for
    /// the error message.
    Other(String),
}

/// A scalar member of a by-value struct.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scalar {
    Bool,
    Int { bits: u8, signed: bool },
    F32,
    F64,
}

impl Scalar {
    /// From one encoding character. A `c` member is a `char` on both
    /// architectures: no struct the SDK declares has a `BOOL` member, so
    /// the x86_64 spelling of `BOOL` never stands for one here.
    pub(super) fn of(c: char) -> Option<Scalar> {
        Some(match c {
            'B' => Scalar::Bool,
            'c' => Scalar::Int {
                bits: 8,
                signed: true,
            },
            'C' => Scalar::Int {
                bits: 8,
                signed: false,
            },
            's' => Scalar::Int {
                bits: 16,
                signed: true,
            },
            'S' => Scalar::Int {
                bits: 16,
                signed: false,
            },
            'i' | 'l' => Scalar::Int {
                bits: 32,
                signed: true,
            },
            'I' | 'L' => Scalar::Int {
                bits: 32,
                signed: false,
            },
            'q' => Scalar::Int {
                bits: 64,
                signed: true,
            },
            'Q' => Scalar::Int {
                bits: 64,
                signed: false,
            },
            'f' => Scalar::F32,
            'd' => Scalar::F64,
            _ => return None,
        })
    }

    /// Size in bytes, which is also the alignment for every scalar here.
    pub const fn size(self) -> usize {
        match self {
            Scalar::Bool => 1,
            Scalar::Int { bits, .. } => bits as usize / 8,
            Scalar::F32 => 4,
            Scalar::F64 => 8,
        }
    }

    pub fn enc(self) -> Enc {
        match self {
            Scalar::Bool => Enc::Bool,
            Scalar::Int { bits, signed } => Enc::Int { bits, signed },
            Scalar::F32 => Enc::F32,
            Scalar::F64 => Enc::F64,
        }
    }
}

/// One scalar member of a struct, flattened: where it sits and what it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Field {
    pub offset: usize,
    pub scalar: Scalar,
}

/// A struct passed by value, as its type encoding lays it out under C's
/// rules: `{CGRect={CGPoint=dd}{CGSize=dd}}` is four doubles at 0, 8, 16
/// and 24 in 32 bytes. Members of nested structs are flattened into
/// [`fields`](StructType::fields) with their offsets.
#[derive(Debug, PartialEq, Eq)]
pub struct StructType {
    /// `CGRect`, `_NSRange`; `?` for a struct the compiler left anonymous (a
    /// typedef of an unnamed struct, as `MTLSize` and `CMTime` are).
    pub name: &'static str,
    /// The encoding this was parsed from, qualifiers removed.
    pub encoding: &'static str,
    pub fields: &'static [Field],
    pub size: usize,
}

const fn f64_fields<const N: usize>() -> [Field; N] {
    let mut fields = [Field {
        offset: 0,
        scalar: Scalar::F64,
    }; N];
    let mut i = 0;
    while i < N {
        fields[i].offset = i * 8;
        i += 1;
    }
    fields
}

/// `NSRange`, for the block shims that take one.
pub static NS_RANGE: StructType = StructType {
    name: "_NSRange",
    encoding: "{_NSRange=QQ}",
    fields: &[
        Field {
            offset: 0,
            scalar: Scalar::Int {
                bits: 64,
                signed: false,
            },
        },
        Field {
            offset: 8,
            scalar: Scalar::Int {
                bits: 64,
                signed: false,
            },
        },
    ],
    size: 16,
};

/// `CGRect`, for the typed out-parameters and tests that name it.
pub static CG_RECT: StructType = StructType {
    name: "CGRect",
    encoding: "{CGRect={CGPoint=dd}{CGSize=dd}}",
    fields: &f64_fields::<4>(),
    size: 32,
};

impl StructType {
    /// The property names of the members when `bun:objc` presents this
    /// struct as an object (`{ x, y, width, height }`), in layout order;
    /// any other struct crosses as an array of its members.
    pub fn field_names(&self) -> Option<&'static [&'static str]> {
        let names: &'static [&'static str] = match self.name {
            "CGRect" | "NSRect" => &["x", "y", "width", "height"],
            "CGPoint" | "NSPoint" => &["x", "y"],
            "CGSize" | "NSSize" => &["width", "height"],
            "CGVector" => &["dx", "dy"],
            "_NSRange" | "NSRange" => &["location", "length"],
            "NSEdgeInsets" | "UIEdgeInsets" => &["top", "left", "bottom", "right"],
            "NSDirectionalEdgeInsets" => &["top", "leading", "bottom", "trailing"],
            "CGAffineTransform" => &["a", "b", "c", "d", "tx", "ty"],
            "CATransform3D" => &[
                "m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24", "m31", "m32", "m33", "m34",
                "m41", "m42", "m43", "m44",
            ],
            _ => return None,
        };
        (names.len() == self.fields.len()).then_some(names)
    }

    /// `CGRect`/`NSRect`, which also reads and writes as `{ origin, size }`.
    pub fn is_rect(&self) -> bool {
        matches!(self.name, "CGRect" | "NSRect") && self.fields.len() == 4
    }

    /// `encoding` (`{name=members}`, qualifiers already stripped) laid out,
    /// or `None` when a member is not a scalar or a struct of scalars, or
    /// the whole is empty or larger than a [`Frame`].
    fn parse(encoding: &str) -> Option<&'static StructType> {
        /// Every struct type any thread has met, by encoding: each is built
        /// and leaked once for the process (signatures and block shims on
        /// every thread point at it).
        static TYPES: LazyLock<Guarded<HashMap<Box<str>, Option<&'static StructType>>>> =
            LazyLock::new(Default::default);
        let mut types = TYPES.lock();
        if let Some(known) = types.get(encoding) {
            return *known;
        }
        let built = StructType::build(encoding);
        types.insert(encoding.into(), built);
        built
    }

    fn build(encoding: &str) -> Option<&'static StructType> {
        let mut chars = encoding.chars().peekable();
        let mut fields = Vec::new();
        let (name, size, _) = StructType::layout(&mut chars, 0, &mut fields)?;
        if chars.next().is_some() || fields.is_empty() || size > FRAME_SIZE {
            return None;
        }
        Some(Box::leak(Box::new(StructType {
            name: Box::leak(name.into_boxed_str()),
            encoding: Box::leak(encoding.to_owned().into_boxed_str()),
            fields: Box::leak(fields.into_boxed_slice()),
            size,
        })))
    }

    /// One `{name=members}` starting at `base`: appends its scalars to
    /// `fields` and returns (name, size, alignment). Each member sits at the
    /// next multiple of its alignment; a struct is aligned as its most
    /// aligned member and padded to a multiple of that.
    fn layout(
        chars: &mut core::iter::Peekable<core::str::Chars<'_>>,
        base: usize,
        fields: &mut Vec<Field>,
    ) -> Option<(String, usize, usize)> {
        if chars.next() != Some('{') {
            return None;
        }
        let mut name = String::new();
        loop {
            match chars.next()? {
                '=' => break,
                // `{CGColor}`: a name and no members says nothing about layout.
                '}' => return None,
                c => name.push(c),
            }
        }
        let (mut offset, mut align) = (0usize, 1usize);
        loop {
            match *chars.peek()? {
                '}' => {
                    chars.next();
                    let size = offset.next_multiple_of(align);
                    return Some((name, size, align));
                }
                '{' => {
                    let start = fields.len();
                    let (_, size, inner_align) = StructType::layout(chars, 0, fields)?;
                    let at = offset.next_multiple_of(inner_align);
                    for field in &mut fields[start..] {
                        field.offset += base + at;
                    }
                    offset = at + size;
                    align = align.max(inner_align);
                }
                c if is_qualifier(c) => {
                    chars.next();
                }
                c => {
                    chars.next();
                    let scalar = Scalar::of(c)?;
                    let at = offset.next_multiple_of(scalar.size());
                    fields.push(Field {
                        offset: base + at,
                        scalar,
                    });
                    offset = at + scalar.size();
                    align = align.max(scalar.size());
                }
            }
        }
    }

    /// What a script should pass, for messages.
    fn describe(&self) -> String {
        if self.is_rect() {
            return "a {origin, size} or {x, y, width, height} object".into();
        }
        match self.field_names() {
            Some(names) => format!("a {{{}}} object", names.join(", ")),
            None => format!("an array of {} numbers", self.fields.len()),
        }
    }
}

/// What an [`Enc::Out`] points at: the by-value types, less `void`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pointee {
    /// `^@`, `o^@` (`NSError **`): storage the callee fills and the caller
    /// need not initialise, so it is not read going in.
    Object,
    /// `N^@` (`inout id *`: KVC's `validateValue:forKey:error:`, a
    /// formatter's partial string): holds an object going in as well.
    InOutObject,
    /// `^^{__CFError}` (`CFErrorRef *`): storage for a [`CFType`] object,
    /// filled like [`Pointee::Object`] storage.
    CFObject(&'static CFType),
    Bool,
    Int {
        bits: u8,
        signed: bool,
    },
    F32,
    F64,
    Struct(&'static StructType),
}

impl Pointee {
    fn of(enc: &Enc) -> Option<Pointee> {
        Some(match enc {
            Enc::Object => Pointee::Object,
            Enc::CFObject(t) => Pointee::CFObject(t),
            Enc::Bool => Pointee::Bool,
            Enc::Int { bits, signed } => Pointee::Int {
                bits: *bits,
                signed: *signed,
            },
            Enc::F32 => Pointee::F32,
            Enc::F64 => Pointee::F64,
            Enc::Struct(t) => Pointee::Struct(t),
            _ => return None,
        })
    }

    /// The pointed-at type as a type of its own.
    pub fn enc(self) -> Enc {
        match self {
            Pointee::Object | Pointee::InOutObject => Enc::Object,
            Pointee::CFObject(t) => Enc::CFObject(t),
            Pointee::Bool => Enc::Bool,
            Pointee::Int { bits, signed } => Enc::Int { bits, signed },
            Pointee::F32 => Enc::F32,
            Pointee::F64 => Enc::F64,
            Pointee::Struct(t) => Enc::Struct(t),
        }
    }

    fn byte_len(self) -> usize {
        match self {
            Pointee::Object | Pointee::InOutObject | Pointee::CFObject(_) | Pointee::F64 => 8,
            Pointee::Bool => 1,
            Pointee::Int { bits, .. } => usize::from(bits / 8),
            Pointee::F32 => 4,
            Pointee::Struct(t) => t.size,
        }
    }
}

/// A Core Foundation style type ([`cf::CF_TYPES`](super::cf::CF_TYPES)) that
/// is an Objective-C object at run time (retained and released like any
/// `id`), so a `CGColorRef` argument or result crosses as an object handle:
/// what `-[NSColor CGColor]` returns is what `-[CALayer setBackgroundColor:]`
/// takes. Going in, the object's `CFGetTypeID` must be the type's, since the
/// callee reads the struct; a toll-free bridged one (`CFStringRef`) takes
/// what its class does.
#[derive(Debug, PartialEq, Eq)]
pub struct CFType {
    /// `CGColor`: the struct name in the encoding.
    pub name: &'static str,
    /// `CGColorGetTypeID`; `CVBufferGetTypeID`, `CVPixelBufferGetTypeID`, …
    /// when several typedefs share the struct.
    type_id_fns: &'static [&'static CStr],
    /// `NSString` for `CFStringRef`; empty for a type that is only ever a
    /// Core Foundation object.
    bridged: &'static CStr,
    type_ids: OnceLock<Vec<usize>>,
}

impl CFType {
    pub(super) const fn new(
        name: &'static str,
        type_id_fns: &'static [&'static CStr],
        bridged: &'static CStr,
    ) -> CFType {
        CFType {
            name,
            type_id_fns,
            bridged,
            type_ids: OnceLock::new(),
        }
    }

    /// The class this type is toll-free bridged to, if any: what an
    /// argument of the type may be given as.
    pub fn bridged(&self) -> Option<&'static str> {
        self.bridged.to_str().ok().filter(|name| !name.is_empty())
    }

    /// Whether `object` is one (`CFGetTypeID(object)` is `CGColorGetTypeID()`,
    /// or any of the type's when several typedefs share the struct).
    fn holds(&self, object: &NSObject) -> bool {
        let expected = self.type_ids.get_or_init(|| {
            self.type_id_fns
                .iter()
                .filter_map(|name| {
                    let f = rt().symbol(name)?;
                    // SAFETY: every `…GetTypeID` is `CFTypeID (*)(void)`.
                    Some(unsafe {
                        core::mem::transmute::<*mut c_void, extern "C" fn() -> usize>(f.as_ptr())()
                    })
                })
                .collect()
        });
        // `CFGetTypeID` sends `_cfTypeID` to an object that is not a CF
        // instance; NSObject answers it, NSProxy does not.
        // SAFETY: a live object rooted in NSObject.
        !expected.is_empty()
            && !is_proxy(object)
            && expected.contains(&unsafe { (rt().cf.CFGetTypeID)(object.as_obj().cast()) })
    }
}

/// `{CGColor=}` (the pointee of `^{CGColor=}`), or `{__CFError}` as the
/// runtime spells it one pointer down (`^^{__CFError}`): an opaque struct
/// named in [`cf::CF_TYPES`](super::cf::CF_TYPES).
fn cf_object(pointee: &str) -> Option<&'static CFType> {
    let name = pointee.strip_prefix('{')?.strip_suffix('}')?;
    let name = name.strip_suffix('=').unwrap_or(name);
    let table = &super::cf::CF_TYPES;
    table
        .binary_search_by(|t| t.name.cmp(name))
        .ok()
        .map(|i| &table[i])
}

/// Type qualifiers (`const`, `in`, `inout`, `out`, `bycopy`, `byref`,
/// `oneway`, `_Atomic`) and frame offsets that precede or follow a type.
pub(super) fn is_qualifier(c: char) -> bool {
    matches!(c, 'r' | 'n' | 'N' | 'o' | 'O' | 'R' | 'V' | 'A') || c.is_ascii_digit()
}

/// Who spelled a type encoding. The runtime (a class's method table, a
/// compiled block's signature) writes `BOOL` as the platform has it, `c`
/// on x86_64, where a `char` is `c` too; a script or the SDK tables
/// (`defineClass` types, `objc.block`, `objc.fn`, `objc.functions`,
/// `objc.constant`) write `BOOL` as `B` on both architectures, so their `c`
/// is a `char`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spelling {
    Runtime,
    Written,
}

impl Enc {
    /// Parses one type as `NSMethodSignature` reports it from the runtime.
    pub fn parse(encoding: &str) -> Enc {
        Enc::parse_as(encoding, Spelling::Runtime)
    }

    /// Parses one type a script or the SDK tables wrote.
    pub fn parse_written(encoding: &str) -> Enc {
        Enc::parse_as(encoding, Spelling::Written)
    }

    pub(super) fn parse_as(encoding: &str, spelling: Spelling) -> Enc {
        let s = encoding.trim_start_matches(is_qualifier);
        let qualified = |q: char| {
            encoding
                .chars()
                .take_while(|&c| is_qualifier(c))
                .any(|c| c == q)
        };
        // `r`: what is pointed at is `const`, so not storage for a result.
        let constant = qualified('r');
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
            'c' if cfg!(target_arch = "x86_64") && spelling == Spelling::Runtime => Enc::Bool,
            'c' => CHAR,
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
            '*' if constant => Enc::CString,
            '*' => Enc::Buffer(s.to_owned()),
            '^' => match Pointee::of(&Enc::parse_as(chars.as_str(), spelling)) {
                // `r^^{__CFData}` (`CFDataRef *`): the `const` is the
                // object's (an immutable CF type), not the storage's.
                Some(pointee @ Pointee::CFObject(_)) => Enc::Out(pointee),
                Some(_) if constant => Enc::Buffer(format!("r{s}")),
                // `N`: `inout`.
                Some(Pointee::Object) if qualified('N') => Enc::Out(Pointee::InOutObject),
                Some(pointee) => Enc::Out(pointee),
                None => cf_object(chars.as_str()).map_or(Enc::Pointer, Enc::CFObject),
            },
            '{' => Enc::parse_struct(s),
            _ => Enc::Other(s.to_owned()),
        }
    }

    /// `{Name=members…}`: see [`StructType`].
    fn parse_struct(s: &str) -> Enc {
        StructType::parse(s).map_or_else(|| Enc::Other(s.to_owned()), Enc::Struct)
    }

    /// The canonical encoding, for messages.
    pub fn encoding(&self) -> Cow<'_, str> {
        Cow::Borrowed(match self {
            Enc::Out(Pointee::InOutObject) => "N^@",
            Enc::Out(pointee) => return Cow::Owned(format!("^{}", pointee.enc().encoding())),
            Enc::CFObject(t) => return Cow::Owned(format!("^{{{}=}}", t.name)),
            Enc::Buffer(s) => s,
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
            Enc::CString => "r*",
            Enc::Pointer => "^v",
            Enc::Struct(t) => t.encoding,
            Enc::Other(s) => s,
        })
    }

    /// What a script should pass, for messages.
    pub fn describe(&self) -> Cow<'static, str> {
        Cow::Borrowed(match self {
            Enc::Void => "nothing",
            Enc::Object => "an object, string, number, boolean or null",
            Enc::CFObject(t) => return Cow::Owned(format!("a {}", t.name)),
            Enc::Block => "a function or a block made with objc.block()",
            Enc::Class => "a class",
            Enc::Sel => "a selector name",
            Enc::Bool => "a boolean",
            Enc::Int { .. } => "an integer",
            Enc::F32 | Enc::F64 => "a number",
            Enc::CString => "a string or null",
            Enc::Out(_) => "an objc.out() object to receive the value, or null",
            Enc::Buffer(_) => {
                "an ArrayBuffer or typed array (lent for the call), or null, since it is a C array the method reads or fills"
            }
            Enc::Pointer => "a pointer",
            Enc::Struct(t) => return Cow::Owned(t.describe()),
            Enc::Other(_) => "an unsupported type",
        })
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
    /// Core Foundation's Create Rule (`-[CIContext createCGImage:fromRect:]`):
    /// a family only for a method that returns a [`CFType`].
    Create,
    /// Declared `NS_RETURNS_RETAINED` (or the CF form) on a selector outside
    /// the naming families ([`sdk::OWNERSHIP`]).
    Retained,
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
            ("create", Family::Create),
            ("Create", Family::Create),
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

/// What the variable arguments of a method declared with `...` are, per the
/// SDK ([`sdk::VARIADIC`]); the type encoding stops at the last named one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variadic {
    /// A nil-terminated list of objects (`+[NSArray arrayWithObjects:]`).
    Objects,
    /// The values a format string, argument `.0`, refers to
    /// (`+[NSString stringWithFormat:]`, `+[NSPredicate predicateWithFormat:]`).
    Format(usize),
    /// A `va_list`, which only C code can build.
    VaList,
    /// Anything else: values typed by another argument
    /// (`-[NSCoder encodeValuesOfObjCTypes:]`), objects alternating with C
    /// values (`-[NSGradient initWithColorsAndLocations:]`).
    Other,
}

/// Where a C-array argument's element count is among the other arguments,
/// per the SDK ([`sdk::ARRAY_PARAMS`]), so the bytes a script lends for it
/// can be measured against what the method will read or write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Counted {
    /// Argument `.0` is the count.
    Count(usize),
    /// Argument `.0` is an `NSRange` whose length is the count.
    Range(usize),
}

/// What a [`Signature`] describes the arguments of, which decides what
/// leads them: the receiver and `_cmd` for a method, the block itself for a
/// block, nothing for a C function.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Callee {
    Method(super::Sel),
    Block,
    Function,
}

impl Callee {
    /// The type encodings of what leads the arguments.
    fn leading(self) -> &'static [&'static Enc] {
        match self {
            Callee::Method(_) => &[&Enc::Object, &Enc::Sel],
            Callee::Block => &[&Enc::Block],
            Callee::Function => &[],
        }
    }

    fn sel(self) -> Option<super::Sel> {
        match self {
            Callee::Method(sel) => Some(sel),
            _ => None,
        }
    }
}

/// A method's (or a block's, or a C function's) argument and return types.
pub struct Signature {
    pub args: Vec<Enc>,
    pub ret: Enc,
    pub family: Family,
    ns: NSMethodSignature,
    callee: Callee,
    ret_len: usize,
    method: String,
    /// (argument index, block type encoding) for the block arguments
    /// [`sdk::BLOCK_PARAMS`] lists for this method.
    blocks: Vec<(usize, &'static CStr)>,
    /// (argument index, where its element count is) for the C-array
    /// arguments [`sdk::ARRAY_PARAMS`] sizes for this method.
    counted: Vec<(usize, Counted)>,
    /// The object arguments the method takes over the caller's reference
    /// to, and whether it takes over the receiver's (an `init…` always
    /// does), per [`sdk::OWNERSHIP`].
    consumed: &'static [usize],
    consumes_self: bool,
    /// A C function named `Create` or `Copy`: Core Foundation's Create Rule
    /// makes what it stores in an object out-argument the caller's, whatever
    /// it returns (`CFStreamCreateBoundPair` returns nothing).
    create_rule: bool,
    /// The object out-arguments of a C function whose stored value is the
    /// caller's to release beyond that rule: declared `CF_RETURNS_RETAINED`
    /// on the parameter ([`sdk::FUNCTION_OWNERSHIP`]) or given to `objc.fn`.
    retained_outs: Vec<usize>,
    /// The setter of an object `@property` declared `assign` (neither weak,
    /// strong nor copy: `NSComboBox.dataSource`, `NSXMLParser.delegate`),
    /// whose receiver would otherwise be left pointing at freed memory once
    /// the value's last reference goes; see [`keep_assigned`].
    assigns: bool,
    /// A send that builds a window, which AppKit cannot do without a window
    /// server; see [`needs_window_server`].
    needs_display: bool,
    /// The libffi call interface for this shape of message, when every type
    /// in it is one [`ffi`] lays out; how [`invoke`] sends it then.
    call: Option<&'static ffi::Prepared>,
    /// For a method declared with `...`: what follows the named arguments.
    variadic: Option<Variadic>,
    /// A variadic method's call interfaces, by how many arguments follow
    /// the named ones, so a second send with that many finds it here.
    variadic_calls: RefCell<Vec<(usize, &'static ffi::Prepared)>>,
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
    /// `ns` parsed as `spelling` wrote it; `family` only holds for an object
    /// return.
    pub(super) fn new(
        ns: NSMethodSignature,
        sel: super::Sel,
        method: String,
        family: Family,
        spelling: Spelling,
    ) -> Signature {
        Signature::parsed(ns, Callee::Method(sel), method, family, spelling)
    }

    pub(super) fn parsed(
        ns: NSMethodSignature,
        callee: Callee,
        method: String,
        family: Family,
        spelling: Spelling,
    ) -> Signature {
        let first = callee.leading().len();
        let args: Vec<Enc> = (first..ns.number_of_arguments())
            .map(|i| Enc::parse_as(&ns.argument_type_at(i).0.unwrap_or_default(), spelling))
            .collect();
        let ret = Enc::parse_as(
            ns.method_return_type().0.as_deref().unwrap_or("v"),
            spelling,
        );
        let family = match (&ret, family) {
            (Enc::Object, Family::Create) => Family::None,
            (Enc::Object | Enc::CFObject(_), family) => family,
            _ => Family::None,
        };
        Signature {
            args,
            ret,
            family,
            ret_len: ns.method_return_length(),
            ns,
            callee,
            method,
            blocks: Vec::new(),
            counted: Vec::new(),
            consumed: &[],
            consumes_self: false,
            create_rule: false,
            retained_outs: Vec::new(),
            assigns: false,
            needs_display: false,
            call: None,
            variadic: None,
            variadic_calls: RefCell::new(Vec::new()),
        }
    }

    /// Decides how [`invoke`] sends this from the final argument types: the
    /// libffi call interface when it loaded and lays every one out. A
    /// variadic method's is built per argument count, in [`invoke`].
    pub(super) fn prepare(&mut self) {
        self.call = match self.variadic {
            None => prepared_call(&self.ret, self.callee, &self.args, None),
            Some(_) => None,
        };
    }

    /// The libffi call interface for exactly these arguments (what a
    /// closure standing in for the callee is entered through), once
    /// [`prepare`](Self::prepare) has run and libffi lays them out.
    pub(super) fn call_interface(&self) -> Option<&'static ffi::Prepared> {
        self.call
    }

    /// The invocation index of argument `index`.
    fn slot(&self, index: usize) -> isize {
        (index + self.callee.leading().len()) as isize
    }

    /// `-[NSWindow setTitle:]`, for messages.
    pub fn method(&self) -> &str {
        &self.method
    }

    /// What follows the named arguments, for a method declared with `...`.
    pub fn variadic(&self) -> Option<Variadic> {
        self.variadic
    }

    /// The bytes the return value takes (`methodReturnLength`).
    pub(super) fn ret_len(&self) -> usize {
        self.ret_len
    }

    /// The type encoding of the block argument `index` takes, when the
    /// bridge knows it for this method (so a bare function can be passed).
    pub fn block_types(&self, index: usize) -> Option<&'static CStr> {
        self.blocks
            .iter()
            .find_map(|(i, types)| (*i == index).then_some(*types))
    }

    /// Whether the encoding starts with the receiver and `_cmd` every
    /// method takes (one a script wrote may not).
    pub(super) fn has_self_and_cmd(&self) -> bool {
        self.ns.number_of_arguments() >= 2
            && Enc::parse(&self.ns.argument_type_at(0).0.unwrap_or_default()) == Enc::Object
            && Enc::parse(&self.ns.argument_type_at(1).0.unwrap_or_default()) == Enc::Sel
    }

    /// Refuses a return type a [`Frame`] cannot carry back.
    pub(super) fn check_return(&self) -> Result<()> {
        match &self.ret {
            Enc::Other(e) => Err(unsupported(
                &self.method,
                format!("return type {e} is not supported yet"),
            )),
            Enc::Struct(t) if t.size != self.ret_len => Err(unsupported(
                &self.method,
                format!(
                    "{} return is {} bytes here, expected {}",
                    t.encoding, self.ret_len, t.size
                ),
            )),
            _ if self.ret_len > core::mem::size_of::<Frame>() => Err(unsupported(
                &self.method,
                format!("a {}-byte return value is not supported", self.ret_len),
            )),
            _ => Ok(()),
        }
    }
}

/// Selectors whose effect the wrappers already account for; sending them by
/// hand unbalances the reference this crate holds.
const MANAGED_SELECTORS: &[&str] = &["retain", "release", "autorelease", "dealloc", "retainCount"];

pub(super) fn pool_if_none() -> Option<AutoreleasePool> {
    (AutoreleasePool::live_count() == 0).then(AutoreleasePool::new)
}

/// Drops `items` inside one autorelease pool: whatever holds Objective-C
/// references whose release may run a `dealloc` that autoreleases.
pub fn drop_pooled<T>(items: T) {
    let _pool = pool_if_none();
    drop(items);
}

/// `types` with every named struct given its `=` (`^^{__CFError}` as
/// `^^{__CFError=}`, what `@encode` writes one pointer down): the only
/// spelling `NSMethodSignature` keeps the name in, and the name is what
/// tells a CF object from a pointer.
fn named_structs(types: &str) -> String {
    let mut out = String::with_capacity(types.len() + 4);
    let mut open: Vec<(usize, bool)> = Vec::new();
    for c in types.chars() {
        match c {
            '{' | '(' => open.push((out.len(), false)),
            '=' => {
                if let Some(top) = open.last_mut() {
                    top.1 = true;
                }
            }
            '}' | ')' => {
                if let Some((at, named)) = open.pop()
                    && !named
                    && out.len() > at + 1
                {
                    out.push('=');
                }
            }
            _ => {}
        }
        out.push(c);
    }
    out
}

/// `+[NSMethodSignature signatureWithObjCTypes:]` for text that did not come
/// from the runtime, sent through the bridge because it raises for text it
/// cannot parse. `invalid` builds that error from `""` or ` (the reason)`.
pub(super) fn method_signature(
    types: &str,
    invalid: impl Fn(&dyn fmt::Display) -> Error,
) -> Result<NSMethodSignature> {
    let factory = DynClass(NSMethodSignature::class());
    let sent = send(
        Receiver::Class(&factory),
        "signatureWithObjCTypes:",
        &mut [DynValue::Str(named_structs(types))],
    );
    match sent {
        Ok(DynValue::Object(o)) => view_as::<NSMethodSignature>(&*o.live()?),
        Ok(_) => None,
        Err(Error::Exception { reason, .. }) => return Err(invalid(&format_args!(" ({reason})"))),
        Err(err) => return Err(err),
    }
    .ok_or_else(|| invalid(&""))
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

/// The rows of an [`sdk`] table (sorted by selector) that apply to `sel`
/// sent to `class`: those the SDK declares on it or a superclass, or in a
/// protocol (an empty class name), since the type encodings cannot tell.
fn sdk_rows<'t, Row>(
    table: &'t [Row],
    key: fn(&Row) -> (&str, &CStr),
    class: DynClass,
    sel: &'t str,
) -> impl Iterator<Item = &'t Row> + 't {
    table[table.partition_point(|row| key(row).0 < sel)..]
        .iter()
        .take_while(move |row| key(row).0 == sel)
        .filter(move |row| {
            let owner = key(row).1;
            owner.is_empty()
                || super::lookup_class(owner)
                    .is_some_and(|owner| rt().class_inherits(class.0, owner))
        })
}

/// What the SDK declares `sel` for `class` as reading after its named
/// arguments, when it takes a variable argument list.
fn variadic(class: DynClass, sel: &str) -> Option<Variadic> {
    sdk_rows(sdk::VARIADIC, |(s, c, _)| (s, c), class, sel)
        .next()
        .map(|(_, _, kind)| *kind)
}

impl Signature {
    /// Whether the method takes over the caller's reference to argument `index`.
    pub(super) fn consumes(&self, index: usize) -> bool {
        self.consumed.contains(&index)
    }

    /// Whether the method takes over the caller's reference to the receiver:
    /// an `init…`, or one declared `NS_REPLACES_RECEIVER`.
    pub(super) fn consumes_self(&self) -> bool {
        self.consumes_self || self.family == Family::Init
    }

    /// Takes the `char` slots of `written`, the signature a script defined
    /// this method with, where the runtime's spelling of it reads `BOOL`
    /// (x86_64); see [`Spelling`].
    fn adopt_chars(&mut self, written: &Signature) {
        if !cfg!(target_arch = "x86_64") || self.args.len() != written.args.len() {
            return;
        }
        let slots = core::iter::once((&mut self.ret, &written.ret))
            .chain(self.args.iter_mut().zip(&written.args));
        for (enc, written) in slots {
            if *enc == Enc::Bool && *written == CHAR {
                *enc = CHAR;
            }
        }
    }

    /// Whether what a C function stores in object out-argument `index` is
    /// the caller's to release: Core Foundation's Create Rule covers the
    /// out-parameters of a `Create`/`Copy` function and every `CFErrorRef *`
    /// (an error is always created for the caller), and a header or
    /// `objc.fn` may say so for the rest.
    fn retained_out(&self, index: usize, pointee: Pointee) -> bool {
        if self.callee != Callee::Function {
            return false;
        }
        match pointee {
            Pointee::Object | Pointee::InOutObject | Pointee::CFObject(_) => {}
            _ => return false,
        }
        self.create_rule
            || matches!(pointee, Pointee::CFObject(t) if t.name == "__CFError")
            || self.retained_outs.contains(&index)
    }
}

/// Applies what the headers say about `sel` on `class` handing references
/// over ([`sdk::OWNERSHIP`]): which arguments and whether the receiver are
/// taken over, and whether the result comes retained where the selector's
/// naming family says otherwise (a result that is not an object is never
/// owned).
pub(super) fn mark_ownership(class: DynClass, sel: &str, sig: &mut Signature) {
    for (_, _, consumed, consumes_self, returns_retained) in
        sdk_rows(sdk::OWNERSHIP, |(s, c, ..)| (s, c), class, sel)
    {
        sig.consumed = consumed;
        sig.consumes_self |= *consumes_self;
        if matches!(sig.ret, Enc::Object | Enc::CFObject(_)) {
            match returns_retained {
                Some(true) if !sig.family.returns_retained() => sig.family = Family::Retained,
                Some(false) => sig.family = Family::None,
                _ => {}
            }
        }
    }
}

/// Retypes the `BOOL *` arguments of `sel` on `class` ([`sdk::BOOL_PARAMS`])
/// on x86_64, where the runtime encodes one as a bare `*` (clang does not
/// tell a pointer to the signed char `BOOL` is there from a C string), so
/// an out-BOOL is one on both architectures; a `const BOOL *` is read-only
/// storage there, as `r^B` is on arm64.
pub(super) fn mark_bool_params(class: DynClass, sel: &str, sig: &mut Signature) {
    if !cfg!(target_arch = "x86_64") {
        return;
    }
    for (_, _, index) in sdk_rows(sdk::BOOL_PARAMS, |(s, c, _)| (s, c), class, sel) {
        let Some(enc) = sig.args.get_mut(*index) else {
            continue;
        };
        *enc = match enc {
            Enc::Buffer(s) if s == "*" => Enc::Out(Pointee::Bool),
            Enc::CString => Enc::Buffer("r^B".into()),
            _ => continue,
        };
    }
}

/// Retypes the `char` arguments and result of `sel` on `class`
/// ([`sdk::CHAR_SLOTS`]) on x86_64, where the runtime spells a `char` and a
/// `BOOL` both `c` and [`Enc::parse`] reads the far more common `BOOL`, so
/// `-[NSNumber charValue]` is the number it is on arm64.
pub(super) fn mark_char_slots(class: DynClass, sel: &str, sig: &mut Signature) {
    if !cfg!(target_arch = "x86_64") {
        return;
    }
    for (_, _, slot) in sdk_rows(sdk::CHAR_SLOTS, |(s, c, _)| (s, c), class, sel) {
        let enc = match slot {
            None => &mut sig.ret,
            Some(index) => match sig.args.get_mut(*index) {
                Some(enc) => enc,
                None => continue,
            },
        };
        if *enc == Enc::Bool {
            *enc = CHAR;
        }
    }
}

/// A `char` as the type encodings spell it (`c`), which is what a `BOOL`
/// reads as on x86_64.
pub(super) const CHAR: Enc = Enc::Int {
    bits: 8,
    signed: true,
};

/// Selector parts that give the element count of the array parameter just
/// before them; the rule `scripts/appkit-sdk-methods.ts` builds
/// [`sdk::ARRAY_PARAMS`] with, applied here to what that table does not
/// cover (a class outside the frameworks it was generated from).
const SIZING: &[&[u8]] = &[
    b"count",
    b"length",
    b"maxLength",
    b"maxCount",
    b"numIndices",
    b"capacity",
    b"range",
];

/// Retypes the arguments of `sel` on `class` the SDK declares as C arrays
/// (see [`Enc::Buffer`]) that their encoding alone left as a C string or a
/// pointer to one value, and notes which argument counts their elements.
/// Then the same for any pointer to a value that a sizing part follows
/// (`getCoordinates:range:`, `setVertices:count:`) on a class the table
/// was not generated from: storage for one value handed to a method that
/// fills `count` of them would be overrun.
fn mark_array_params(class: DynClass, sel: &str, sig: &mut Signature) {
    for (_, _, index, counted) in sdk_rows(sdk::ARRAY_PARAMS, |(s, c, ..)| (s, c), class, sel) {
        let Some(enc) = sig.args.get_mut(*index) else {
            continue;
        };
        if matches!(enc, Enc::CString | Enc::Out(_)) {
            *enc = Enc::Buffer(enc.encoding().into_owned());
        }
        if let (Enc::Buffer(_) | Enc::Pointer, Some(counted)) = (&*enc, counted)
            && !sig.counted.iter().any(|(i, _)| i == index)
        {
            sig.counted.push((*index, *counted));
        }
    }
    let mut parts = strings::split(sel.as_bytes(), b":");
    parts.next();
    for (index, part) in parts.enumerate().take(sig.args.len().saturating_sub(1)) {
        if !SIZING.contains(&part) {
            continue;
        }
        let sizing = index + 1;
        let range = matches!(&sig.args[sizing], Enc::Struct(t) if t.name == "_NSRange");
        let counted = match part {
            b"range" if range => Some(Counted::Range(sizing)),
            b"range" => None,
            _ if matches!(sig.args[sizing], Enc::Int { .. }) => Some(Counted::Count(sizing)),
            _ => None,
        };
        let enc = &mut sig.args[index];
        match enc {
            Enc::Out(pointee)
                if !matches!(
                    pointee,
                    Pointee::Object | Pointee::InOutObject | Pointee::CFObject(_)
                ) =>
            {
                *enc = Enc::Buffer(enc.encoding().into_owned());
            }
            Enc::Buffer(_) | Enc::Pointer => {}
            _ => continue,
        }
        if let Some(counted) = counted
            && !sig.counted.iter().any(|(i, _)| *i == index)
        {
            sig.counted.push((index, counted));
        }
    }
}

thread_local! {
    /// Signatures already looked up, by (class, selector, class method):
    /// a class's methods and their types do not change once it answers, and
    /// the lookup (two method-table walks, `methodSignatureForSelector:`,
    /// the SDK tables) costs more than the send it precedes.
    static SIGNATURES: RefCell<HashMap<(usize, usize, bool), Rc<Signature>>> =
        RefCell::new(HashMap::new());
}

/// For a `super` send: the receiver is an instance (or subclass, for a
/// class object) of the defining `class`, so what its superclass
/// implements is written for this object.
fn in_chain_of(receiver: &DynObject, class: DynClass) -> Result<()> {
    let own = match receiver.as_class() {
        Some(c) => c,
        None => DynClass(rt().class_of(receiver.live()?.as_id())),
    };
    if rt().class_inherits(own.0, class.0) {
        return Ok(());
    }
    Err(Error::NotASubclass {
        actual: match receiver.as_class() {
            Some(c) => format!("the class {}", c.name()),
            None => format!("a {}", own.name()),
        },
        class: class.name(),
    })
}

/// Looks the method up on the receiver. `Unrecognized` unless the receiver
/// responds to `sel`, so a typo is an error here rather than an exception
/// inside the send; [`Error::MainThreadOnly`] for a receiver AppKit keeps to
/// the main thread, anywhere else; [`Error::NotASubclass`] for a `super`
/// send whose receiver is not of the defining class.
pub fn signature(receiver: Receiver<'_>, sel: &str) -> Result<Rc<Signature>> {
    load()?;
    let _pool = AutoreleasePool::new();
    if let Receiver::Super(o, class) = receiver {
        in_chain_of(o, *class)?;
    }
    // A live, ordinary receiver's answer holds for every instance of its
    // class; an unsent `alloc` and a proxy are looked up their own way
    // below each time.
    let cacheable = receiver.allocated_class().is_none() && !receiver.is_proxy()?;
    let key = |owner: DynClass, raw_sel: super::Sel, class_method: bool| {
        (owner.address(), raw_sel.0.as_ptr() as usize, class_method)
    };
    if cacheable && let Ok(c_sel) = CString::new(sel) {
        let (owner, class_method) = receiver.method_owner()?;
        let key = key(owner, register_sel(&c_sel), class_method);
        if let Some(hit) = SIGNATURES.with_borrow(|cache| cache.get(&key).cloned()) {
            return Ok(hit);
        }
    }
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
    if receiver.class_name()? == "NSAutoreleasePool" {
        return Err(unsupported(
            "autorelease pools are managed by the bridge; every send already runs inside one",
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
    if let Receiver::Super(_, class) = receiver
        && rt().superclass(class.0).is_none()
    {
        return Err(unsupported("a root class has no superclass to send to"));
    }
    let (mut owner, class_method) = receiver.method_owner()?;
    // Nothing this refuses is ever put in the cache above, which is the
    // thread's own, so a hit there needed no check.
    main_thread_only(owner.0, Some(sel))?;
    // An `alloc` awaiting its `init…` is not messaged: its class's method
    // table answers for it (what `+instancesRespondToSelector:` reads too),
    // or, when the class leaves this `init…` to whatever `+alloc` returns,
    // that object's class's table.
    let mut types = owner.raw_types(raw_sel, class_method);
    if let (Some(_), None, Receiver::Object(o)) = (allocated, &types, receiver) {
        owner = o.allocate_now(&method)?;
        types = owner.raw_types(raw_sel, class_method);
    }
    // What answers a super send is the superclass's method table, read the
    // same way, never the object.
    let from_table = allocated.is_some() || receiver.answering_superclass().is_some();
    let proxy = !from_table && receiver.is_proxy()?;
    let responds = match () {
        () if from_table => types.is_some(),
        () if proxy => true,
        () => receiver.with_target(|t| t.responds_to_selector(raw_sel))?,
    };
    if !responds {
        return Err(unrecognized());
    }
    let variadic = variadic(owner, sel);
    match variadic {
        None => {}
        Some(Variadic::VaList) => {
            return Err(unsupported(
                "it takes a va_list, which only C code can build; use the variant that takes `...`",
            ));
        }
        Some(Variadic::Other) => {
            return Err(unsupported(
                "its variable arguments include C values (not only objects), which cannot be passed from JavaScript",
            ));
        }
        Some(Variadic::Objects | Variadic::Format(_)) if !ffi::available() => {
            return Err(unsupported(
                "variadic methods need /usr/lib/libffi.dylib, which did not load",
            ));
        }
        Some(Variadic::Objects | Variadic::Format(_)) => {}
    }
    // NSMethodSignature raises on encodings it cannot size (SIMD vectors,
    // `<2f>`), so those are refused from the runtime's copy first. A method
    // reached by forwarding has no copy there; Foundation's answer stands.
    if let Some(types) = &types
        && (types.is_empty() || strings::contains_char(types.as_bytes(), b'<'))
    {
        return Err(unsupported(&format!(
            "type encoding {types:?} is not supported"
        )));
    }
    let in_table = types.is_some();
    let ns = match () {
        () if from_table => types.and_then(|_| owner.method_signature(raw_sel, class_method)),
        () if proxy => proxy_method_signature(receiver, sel)?,
        () => receiver.with_target(|t| t.method_signature_for_selector(raw_sel))?,
    }
    .ok_or_else(unrecognized)?;
    let mut sig = Signature::new(ns, raw_sel, method, family, Spelling::Runtime);
    sig.variadic = variadic;
    mark_bool_params(owner, sel, &mut sig);
    mark_char_slots(owner, sel, &mut sig);
    if let Some(written) = super::script::written_signature(owner.0, raw_sel, class_method) {
        sig.adopt_chars(written);
    }
    mark_array_params(owner, sel, &mut sig);
    mark_ownership(owner, sel, &mut sig);
    sig.assigns = !class_method && sig.args == [Enc::Object] && sets_assign_property(owner, sel);
    sig.needs_display = builds_status_item(owner, sel);
    if sig.args.contains(&Enc::Block) {
        sig.blocks = sdk_rows(sdk::BLOCK_PARAMS, |(s, c, ..)| (s, c), owner, sel)
            .map(|(_, _, index, types)| (*index, *types))
            .collect();
    }
    sig.prepare();
    // `-[NSInvocation invokeWithTarget:]` calls a block target instead of
    // messaging it, whatever the selector; `objc_msgSend` messages it.
    if sig.path() == Path::Invocation && receiver.is_block()? {
        return Err(Error::UnsupportedSignature {
            method: sig.method,
            what: "the receiver is a block, which NSInvocation (BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI) would call rather than message; it can still be called with invoke(...args), passed as an argument or released".into(),
        });
    }
    // `performSelector:…` is declared to return an object whatever the
    // performed method returns; retaining a `BOOL` or a `void` would crash.
    if sig.ret == Enc::Object
        && strings::split(sel.as_bytes(), b":").next() == Some(b"performSelector")
    {
        return Err(Error::UnsupportedSignature {
            method: sig.method,
            what: "the result cannot be typed; send that selector itself (receiver.msgSend(name, ...args) for a name in a variable)".into(),
        });
    }
    let sig = Rc::new(sig);
    // A method only forwarding answers for has no entry in the class's
    // table and may be answered differently next time.
    if cacheable && in_table {
        SIGNATURES.with_borrow_mut(|cache| {
            cache.insert(key(owner, raw_sel, class_method), Rc::clone(&sig))
        });
    }
    Ok(sig)
}

/// The signature for calling `block` itself (through [`invoke`], which
/// `-[NSInvocation invokeWithTarget:]` does for a block target), read from
/// the type encoding the block was compiled with.
pub fn block_signature(block: &DynObject) -> Result<Signature> {
    load()?;
    let _pool = AutoreleasePool::new();
    let method = || format!("block of class {}", block.class_name().unwrap_or_default());
    if !Receiver::Object(block).is_block()? {
        return Err(unsupported(&method(), "is not a block"));
    }
    // SAFETY: a live block object (just checked).
    let Some(types) = (unsafe { block::signature_of(block.live()?.as_obj()) }) else {
        return Err(unsupported(
            &method(),
            "records no type signature, so it cannot be called from JavaScript",
        ));
    };
    let types = types.to_string_lossy();
    let ns = method_signature(&types, |why| {
        unsupported(
            &method(),
            format!("has a type signature {types:?} that is not valid{why}"),
        )
    })?;
    let name = format!("block {}", block::spelled(&ns));
    if ns.number_of_arguments() < 1
        || Enc::parse(&ns.argument_type_at(0).0.unwrap_or_default()) != Enc::Block
    {
        return Err(unsupported(&name, "does not take the block itself first"));
    }
    let mut sig = Signature::parsed(ns, Callee::Block, name, Family::None, Spelling::Runtime);
    sig.prepare();
    Ok(sig)
}

/// `-methodSignatureForSelector:` sent to a proxy the way a script's own
/// message is, since `NSProxy`'s implementation raises for a selector it has
/// no signature for.
fn proxy_method_signature(receiver: Receiver<'_>, sel: &str) -> Result<Option<NSMethodSignature>> {
    const QUERY: &str = "methodSignatureForSelector:";
    // `- (NSMethodSignature *)methodSignatureForSelector:(SEL)sel`
    let Some(ns) = NSMethodSignature::with_objc_types(c"@@::") else {
        return Ok(None);
    };
    let mut query = Signature::new(
        ns,
        selector(QUERY, receiver)?,
        receiver.method_name(QUERY)?,
        Family::None,
        Spelling::Runtime,
    );
    query.prepare();
    match invoke(receiver, &query, &mut [DynValue::Sel(sel.to_owned())])? {
        DynValue::Object(o) => Ok(view_as::<NSMethodSignature>(&*o.live()?)),
        _ => Ok(None),
    }
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
    /// A by-value struct as its scalar members in layout order (`Bool`,
    /// `I64`, `U64` or `F64` each).
    Struct(&'static StructType, Box<[DynValue]>),
    /// An opaque address: a pointer-typed return, or one a script hands
    /// back as a pointer argument.
    Pointer(usize),
    /// The storage of a script's `ArrayBuffer` or typed array, lent for one
    /// send as a C-array or raw-pointer argument: the address the callee
    /// gets and the bytes behind it. Whoever builds this keeps that storage
    /// alive and in place until the send returns.
    Bytes {
        address: usize,
        length: usize,
    },
    /// For an [`Enc::Out`] argument: what the pointed-at storage holds going
    /// in (`None` for zero / `nil`), replaced by what it holds coming out.
    Out(Option<Box<DynValue>>),
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
            DynValue::Struct(t, _) if t.name == "?" => "a struct",
            DynValue::Struct(t, _) => t.name,
            DynValue::Pointer(_) => "a pointer",
            DynValue::Bytes { .. } => "an ArrayBuffer",
            DynValue::Out(_) => "an objc.out() object",
            DynValue::Void => "undefined",
        }
    }
}

/// The largest by-value argument or return the bridge carries (a
/// `CATransform3D`, sixteen doubles); a struct type bigger than this parses
/// as unsupported.
const FRAME_SIZE: usize = 128;

/// One argument or return value in C layout, 16-aligned.
#[derive(Clone)]
#[repr(C, align(16))]
pub(super) struct Frame([u8; FRAME_SIZE]);

/// How many arguments a send (or a call into a script) lays out without
/// touching the heap.
pub(super) const INLINE_ARGS: usize = 6;

/// The argument frames of one call.
pub(super) type Frames = SmallVec<[Frame; INLINE_ARGS]>;

const _: () = assert!(
    cfg!(target_endian = "little"),
    "Frame reads and writes assume little endian"
);

impl Frame {
    pub(super) fn new() -> Frame {
        Frame([0; FRAME_SIZE])
    }

    /// For a message that reads the frame.
    pub(super) fn as_ptr(&self) -> Ptr {
        Ptr(self.0.as_ptr().cast())
    }

    /// For a message that fills the frame.
    pub(super) fn as_mut_ptr(&mut self) -> Ptr {
        Ptr(self.0.as_mut_ptr().cast_const().cast())
    }

    pub(super) fn put(&mut self, at: usize, bytes: &[u8]) {
        self.0[at..at + bytes.len()].copy_from_slice(bytes);
    }

    pub(super) fn word(&mut self, v: usize) {
        self.put(0, &v.to_ne_bytes());
    }

    pub(super) fn read_word(&self) -> usize {
        usize::from_ne_bytes(self.0[..8].try_into().expect("8 bytes"))
    }

    pub(super) fn read_u64(&self, i: usize) -> u64 {
        u64::from_ne_bytes(self.0[i * 8..i * 8 + 8].try_into().expect("8 bytes"))
    }

    /// `N` bytes at `at`.
    fn bytes<const N: usize>(&self, at: usize) -> [u8; N] {
        self.0[at..at + N].try_into().expect("in frame")
    }

    /// Writes `value` as `scalar` at byte `at`: `Ok(false)` when `value` is
    /// not that kind of scalar at all, `Err((min, max, got))` for an
    /// integer out of range. Integers convert to floating point; nothing
    /// converts to an integer or a boolean.
    fn put_scalar(
        &mut self,
        at: usize,
        scalar: Scalar,
        value: &DynValue,
    ) -> core::result::Result<bool, (i128, i128, i128)> {
        match (scalar, value) {
            (Scalar::Bool, DynValue::Bool(b)) => self.put(at, &[u8::from(*b)]),
            (Scalar::Int { bits, signed }, DynValue::I64(_) | DynValue::U64(_)) => {
                let v: i128 = match value {
                    DynValue::I64(v) => i128::from(*v),
                    DynValue::U64(v) => i128::from(*v),
                    _ => unreachable!(),
                };
                let (min, max) = if signed {
                    (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
                } else {
                    (0, (1i128 << bits) - 1)
                };
                if v < min || v > max {
                    return Err((min, max, v));
                }
                // Two's complement and little endian, so the low bytes are
                // the value at any width.
                self.put(at, &(v as i64).to_le_bytes()[..bits as usize / 8]);
            }
            (Scalar::F32, DynValue::F64(v)) => self.put(at, &(*v as f32).to_ne_bytes()),
            (Scalar::F32, DynValue::I64(v)) => self.put(at, &(*v as f32).to_ne_bytes()),
            (Scalar::F32, DynValue::U64(v)) => self.put(at, &(*v as f32).to_ne_bytes()),
            (Scalar::F64, DynValue::F64(v)) => self.put(at, &v.to_ne_bytes()),
            (Scalar::F64, DynValue::I64(v)) => self.put(at, &(*v as f64).to_ne_bytes()),
            (Scalar::F64, DynValue::U64(v)) => self.put(at, &(*v as f64).to_ne_bytes()),
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// The `scalar` at byte `at` as a `Bool`, `I64`, `U64` or `F64`.
    fn scalar(&self, at: usize, scalar: Scalar) -> DynValue {
        match scalar {
            Scalar::Bool => DynValue::Bool(self.0[at] != 0),
            Scalar::Int { bits, signed } => {
                // Only `bits` are the value's; shift them to the top and back
                // to sign- or zero-extend.
                let mut word = [0u8; 8];
                let len = bits as usize / 8;
                word[..len].copy_from_slice(&self.0[at..at + len]);
                let shift = 64 - u32::from(bits);
                let raw = u64::from_le_bytes(word) << shift;
                if signed {
                    DynValue::I64((raw as i64) >> shift)
                } else {
                    DynValue::U64(raw >> shift)
                }
            }
            Scalar::F32 => DynValue::F64(f64::from(f32::from_ne_bytes(self.bytes(at)))),
            Scalar::F64 => DynValue::F64(f64::from_ne_bytes(self.bytes(at))),
        }
    }
}

/// What must outlive the invoke: boxed objects and C strings the argument
/// frames point at, and the storage [`Enc::Out`] arguments point at (by
/// argument index).
#[derive(Default)]
pub(super) struct Keep {
    objects: Vec<NSObject>,
    strings: Vec<CString>,
    outs: Vec<(usize, Pointee, NonNull<Frame>)>,
}

impl Keep {
    /// Heap storage for [`Enc::Out`] argument `index`, starting as `initial`,
    /// that the method writes through the returned pointer; no Rust reference
    /// to it exists until [`Keep::outs`] reads it back.
    fn out(&mut self, index: usize, pointee: Pointee, initial: Frame) -> NonNull<Frame> {
        let cell = NonNull::from(Box::leak(Box::new(initial)));
        self.outs.push((index, pointee, cell));
        cell
    }

    /// (argument index, what the method left in that argument's storage).
    fn outs<'a>(
        &'a self,
        sig: &'a Signature,
    ) -> impl Iterator<Item = Result<(usize, DynValue)>> + 'a {
        self.outs.iter().map(move |(index, pointee, cell)| {
            // SAFETY: allocated by `out` and freed only by `drop`; the method
            // that wrote through the pointer has returned.
            let cell = unsafe { cell.as_ref() };
            let retained = sig.retained_out(*index, *pointee);
            Ok((*index, decode(&sig.method, &pointee.enc(), retained, cell)?))
        })
    }
}

impl Drop for Keep {
    fn drop(&mut self) {
        for (_, _, cell) in self.outs.drain(..) {
            // SAFETY: allocated by `out` with `Box::new`; nothing else frees it.
            drop(unsafe { Box::from_raw(cell.as_ptr()) });
        }
    }
}

/// [`signature`] then [`invoke`].
pub fn send(receiver: Receiver<'_>, sel: &str, args: &mut [DynValue]) -> Result<DynValue> {
    let sig = signature(receiver, sel)?;
    invoke(receiver, &sig, args)
}

/// How a message is sent once its arguments are laid out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    /// `objc_msgSend` (or the block's `invoke`) called through libffi.
    Libffi,
    /// `-[NSInvocation invokeWithTarget:]`.
    Invocation,
}

impl Signature {
    /// How [`invoke`] sends this: through libffi unless
    /// `BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI` turned it off (every argument
    /// and return type [`encode`] and [`Signature::check_return`] accept is
    /// one [`ffi`] lays out). A variadic method only ever goes through
    /// libffi (and has no signature without it).
    pub fn path(&self) -> Path {
        if self.call.is_some() || self.variadic.is_some() {
            Path::Libffi
        } else {
            Path::Invocation
        }
    }
}

/// The libffi call interface for a message, block call or function call
/// taking `args` and then, for a variadic one, `extra` more objects.
fn prepared_call(
    ret: &Enc,
    callee: Callee,
    args: &[Enc],
    extra: Option<usize>,
) -> Option<&'static ffi::Prepared> {
    let leading = callee.leading();
    let all: SmallVec<[&Enc; INLINE_ARGS]> = leading
        .iter()
        .copied()
        .chain(args.iter())
        .chain(core::iter::repeat_n(&Enc::Object, extra.unwrap_or(0)))
        .collect();
    let fixed = extra.map(|_| leading.len() + args.len());
    ffi::prepared(ret, &all, fixed)
}

impl Signature {
    /// [`prepared_call`] for `extra` variable arguments, kept for next time.
    fn variadic_call(&self, extra: usize) -> Option<&'static ffi::Prepared> {
        let known = self
            .variadic_calls
            .borrow()
            .iter()
            .find_map(|(n, call)| (*n == extra).then_some(*call));
        known.or_else(|| {
            let made = prepared_call(&self.ret, self.callee, &self.args, Some(extra))?;
            self.variadic_calls.borrow_mut().push((extra, made));
            Some(made)
        })
    }
}

/// What may follow the named arguments of the variadic method `sig`
/// ([`Variadic::Objects`] or [`Variadic::Format`]; [`signature`] refused the
/// others), given all of `args`: only objects, and for a format only `%@`
/// (and `%K`) conversions, since a C value of the type any other conversion
/// reads cannot be told from a script's number. A nil-terminated list takes
/// no nil among its variable arguments: the method would stop reading there,
/// and the bridge adds the terminator itself. `Ok` is how many trailing nil
/// arguments to add.
fn check_variadic(sig: &Signature, kind: Variadic, args: &[DynValue]) -> Result<usize> {
    let refuse = |what: &str| -> Result<usize> { Err(unsupported(&sig.method, what)) };
    for (index, value) in args.iter().enumerate().skip(sig.args.len()) {
        let accepted = match value {
            DynValue::Nil => kind != Variadic::Objects,
            DynValue::Object(_)
            | DynValue::Class(_)
            | DynValue::Str(_)
            | DynValue::Bool(_)
            | DynValue::I64(_)
            | DynValue::U64(_)
            | DynValue::F64(_) => true,
            _ => false,
        };
        if !accepted {
            return Err(Error::ArgType {
                method: sig.method.clone(),
                index,
                expected: if matches!(value, DynValue::Nil) {
                    "an object as a variable argument (null would end the list; leave it out)"
                        .to_owned()
                } else {
                    format!("{} as a variable argument", Enc::Object)
                },
                got: value.kind().to_owned(),
            });
        }
    }
    let format_index = match kind {
        Variadic::Format(index) => index,
        Variadic::Objects => return Ok(1),
        Variadic::VaList | Variadic::Other => {
            unreachable!("refused when the signature was looked up")
        }
    };
    let format: Cow<'_, str> = match args.get(format_index) {
        Some(DynValue::Str(s)) => Cow::Borrowed(s),
        Some(DynValue::Object(o)) => match view_as::<NSString>(&*o.live()?) {
            Some(s) => Cow::Owned(s.to_string_lossy()),
            None => return refuse("the format argument is not a string"),
        },
        Some(DynValue::Nil) => Cow::Borrowed(""),
        _ => return refuse("the format argument is not a string"),
    };
    // How many values the format reads: one per `%@` / `%K` in sequence,
    // or up to the highest `n` a positional `%n$@` names.
    let mut sequential = 0;
    let mut highest_position = 0;
    let mut rest = format.as_bytes();
    while let Some(at) = strings::index_of_char_usize(rest, b'%') {
        rest = &rest[at + 1..];
        let digits = rest.iter().take_while(|b| b.is_ascii_digit()).count();
        let position = match (digits, rest.get(digits)) {
            (0, _) => None,
            (_, Some(b'$')) => core::str::from_utf8(&rest[..digits])
                .ok()
                .and_then(|n| n.parse::<usize>().ok())
                .filter(|n| *n > 0),
            _ => return refuse("a field width is not supported; only %@, %K, %n$@ and %%"),
        };
        let conversion = digits + usize::from(position.is_some());
        match (rest.get(conversion), position) {
            (Some(b'%'), None) => {}
            (Some(b'@' | b'K'), Some(n)) => highest_position = highest_position.max(n),
            (Some(b'@' | b'K'), None) => sequential += 1,
            _ => {
                return refuse(
                    "only %@ (and %K) conversions can be given values from JavaScript, each an object, string, number, boolean or null; format numbers with %@",
                );
            }
        }
        rest = &rest[conversion + 1..];
    }
    let needed = sequential.max(highest_position);
    if needed > args.len() - sig.args.len() {
        return Err(Error::ArgCount {
            method: sig.method.clone(),
            expected: sig.args.len() + needed,
            got: args.len(),
        });
    }
    Ok(0)
}

/// Sends the message `sig` was looked up for with `args`, which must match
/// `sig.args` one for one (followed, for a variadic method, by its variable
/// arguments). Object results are retained (or adopted, for the owning
/// families). `alloc…` on a class is not sent: its result allocates when an
/// `init…` reaches it, and that init consumes it (as it does any object
/// receiver), which reads as [`Error::Consumed`] from then on. An exception
/// raised inside the method is [`Error::Exception`] once
/// [`catch_exceptions_with`] has run, and ends the process before. Each
/// [`DynValue::Out`] in `args` holds what the method left there afterwards.
pub fn invoke(receiver: Receiver<'_>, sig: &Signature, args: &mut [DynValue]) -> Result<DynValue> {
    needs_window_server(sig)?;
    perform(Target::Receiver(receiver), sig, args)
}

/// Whether `sel` on `owner` is `-[NSStatusBar statusItemWithLength:]` (or
/// the private `_statusItemWithLength:…` it calls), which builds a window;
/// decided once per signature.
fn builds_status_item(owner: DynClass, sel: &str) -> bool {
    let status_item = sel == "statusItemWithLength:" || sel.starts_with("_statusItemWithLength:");
    if !status_item {
        return false;
    }
    let Some(status_bar) = super::lookup_class(c"NSStatusBar") else {
        return false;
    };
    rt().class_chain(owner.0).any(|c| c == status_bar)
}

/// A send that builds a window without a window server makes AppKit
/// `_exit(0)` from inside the send, past every exit hook a script has.
/// Refused first, on the predicate `app.hasDisplay` reads, each time, so a
/// display attached later is seen.
fn needs_window_server(sig: &Signature) -> Result<()> {
    if !sig.needs_display || crate::app::has_display() {
        return Ok(());
    }
    Err(Error::NoDisplay(sig.method.clone()))
}

/// For each C-array argument whose element count the SDK places in another
/// argument ([`Signature::counted`]) and that a script lent bytes for: the
/// bytes must cover that many elements, or the callee would read or write
/// past them. An element type of unknown size is not checked.
fn check_lent_bytes(sig: &Signature, args: &[DynValue]) -> Result<()> {
    for &(index, counted) in &sig.counted {
        let Some(DynValue::Bytes { length, .. }) = args.get(index) else {
            continue;
        };
        let encoding = match sig.args.get(index) {
            Some(Enc::Buffer(encoding)) => encoding.as_str(),
            Some(Enc::Pointer) => "^v",
            _ => continue,
        };
        let element = encoding.trim_start_matches(is_qualifier);
        let element = match element.strip_prefix('^') {
            // `void *bytes`: `length:` counts bytes.
            Some("v") => 1,
            Some(pointee) => Enc::parse(pointee).value_size(),
            // `*`: a `char` buffer.
            None => 1,
        };
        if element == 0 {
            continue;
        }
        let whole = |n: f64| (n >= 0.0 && n.fract() == 0.0).then_some(n as usize);
        let count = match (
            counted,
            args.get(match counted {
                Counted::Count(i) | Counted::Range(i) => i,
            }),
        ) {
            (Counted::Count(_), Some(DynValue::I64(n))) => usize::try_from(*n).ok(),
            (Counted::Count(_), Some(DynValue::U64(n))) => usize::try_from(*n).ok(),
            (Counted::Count(_), Some(DynValue::F64(n))) => whole(*n),
            (Counted::Range(_), Some(DynValue::Struct(t, members))) if t.name == "_NSRange" => {
                match members.get(1) {
                    Some(DynValue::I64(n)) => usize::try_from(*n).ok(),
                    Some(DynValue::U64(n)) => usize::try_from(*n).ok(),
                    Some(DynValue::F64(n)) => whole(*n),
                    _ => None,
                }
            }
            _ => None,
        };
        let Some(count) = count else { continue };
        let needed = count.saturating_mul(element);
        if needed > *length {
            return Err(Error::ArgType {
                method: sig.method.clone(),
                index,
                expected: format!(
                    "{encoding}: at least {needed} bytes for {count} element{} of {element}",
                    if count == 1 { "" } else { "s" }
                ),
                got: format!("an ArrayBuffer of {length}"),
            });
        }
    }
    Ok(())
}

/// What [`perform`] calls: a method on a receiver, or a C function.
#[derive(Clone, Copy)]
enum Target<'a> {
    Receiver(Receiver<'a>),
    Function(NonNull<c_void>),
}

/// [`invoke`], for either kind of [`Target`].
fn perform(target: Target<'_>, sig: &Signature, args: &mut [DynValue]) -> Result<DynValue> {
    load()?;
    // A pool of the send's own, whatever encloses it: everything the method
    // autoreleases (and the invocation itself) goes when the send returns,
    // and what comes back below is retained or copied first.
    let _pool = AutoreleasePool::new();
    let arg_count = |expected| Error::ArgCount {
        method: sig.method.clone(),
        expected,
        got: args.len(),
    };
    let (call, nils) = match sig.variadic {
        None if args.len() != sig.args.len() => return Err(arg_count(sig.args.len())),
        None => (sig.call, 0),
        Some(_) if args.len() < sig.args.len() => return Err(arg_count(sig.args.len())),
        Some(kind) => {
            let nils = check_variadic(sig, kind, args)?;
            let call = sig
                .variadic_call(args.len() - sig.args.len() + nils)
                .ok_or_else(|| unsupported(&sig.method, "libffi cannot lay out its arguments"))?;
            (Some(call), nils)
        }
    };
    sig.check_return()?;
    check_lent_bytes(sig, args)?;

    let mut keep = Keep::default();
    let mut frames: Frames = SmallVec::with_capacity(args.len() + nils);
    for (index, value) in args.iter().enumerate() {
        let enc = sig.args.get(index).unwrap_or(&Enc::Object);
        let mut frame = Frame::new();
        encode(&sig.method, index, enc, value, &mut frame, &mut keep)?;
        if let (Enc::Block, DynValue::Object(o), Some(expected)) =
            (enc, value, sig.block_types(index))
        {
            block::check_block_signature(&sig.method, index, o, expected)?;
        }
        frames.push(frame);
    }
    frames.extend((0..nils).map(|_| Frame::new()));
    let receiver = match target {
        Target::Receiver(receiver) => Some(receiver),
        Target::Function(_) => None,
    };
    // A reference the method takes over is one more than the wrapper's,
    // which keeps its own: the callee gets a +1 of its own to keep or let go.
    for &index in sig.consumed {
        if let Some(frame) = frames.get(index)
            && !(frame.read_word() as Obj).is_null()
        {
            // SAFETY: an object `encode` just put in an object slot.
            unsafe { (rt().objc_retain)(frame.read_word() as Obj) };
        }
    }
    if sig.consumes_self
        && let Some(receiver) = receiver
    {
        // SAFETY: the live receiver; `with_target` refuses a dead one.
        receiver.with_target(|t| unsafe { (rt().objc_retain)(t.as_obj()) })?;
    }
    if sig.family == Family::Alloc
        && let Some(class) = receiver.and_then(|r| r.as_class())
    {
        return Ok(DynValue::Object(DynObject::allocated(class)));
    }

    let mut ret = Frame::new();
    match (call, target) {
        (Some(call), _) => invoke_ffi(target, sig, call, &mut frames, &mut ret)?,
        (None, Target::Receiver(receiver)) => invoke_invocation(receiver, sig, &frames, &mut ret)?,
        (None, Target::Function(_)) => {
            return Err(unsupported(
                &sig.method,
                "C functions need /usr/lib/libffi.dylib, which did not load",
            ));
        }
    }
    if sig.assigns
        && let Some(receiver) = receiver
    {
        receiver.with_target(|t| keep_assigned(t, sig, frames[0].read_word()))?;
    }
    for out in keep.outs(sig) {
        let (index, value) = out?;
        args[index] = DynValue::Out(Some(Box::new(value)));
    }
    drop(keep);
    let result = decode(&sig.method, &sig.ret, sig.family.returns_retained(), &ret)?;
    if let Some(receiver) = receiver {
        keep_window_past_close(receiver, sig, &result)?;
    }
    Ok(result)
}

/// `struct objc_super`: what `objc_msgSendSuper2` takes in place of the
/// receiver, naming the class whose superclass's implementation is wanted.
#[repr(C)]
struct ObjcSuper {
    receiver: Obj,
    class: Obj,
}

/// [`perform`] through libffi: `objc_msgSend` (`_stret` where the result
/// wants it), `objc_msgSendSuper2` for a [`Receiver::Super`], the block's own
/// `invoke` function, or the C function, called with what leads the
/// arguments (receiver and selector, the super struct and selector, the
/// block, nothing) and `frames`, the result left in `ret`.
fn invoke_ffi(
    target: Target<'_>,
    sig: &Signature,
    call: &ffi::Prepared,
    frames: &mut [Frame],
    ret: &mut Frame,
) -> Result<()> {
    struct Perform<'a> {
        call: &'a ffi::Prepared,
        frames: &'a mut [Frame],
        ret: &'a mut Frame,
    }
    impl Perform<'_> {
        fn with(&mut self, function: *const c_void, leading: &mut [usize]) -> Result<()> {
            let mut argv: SmallVec<[*mut c_void; INLINE_ARGS + 2]> =
                SmallVec::with_capacity(self.frames.len() + leading.len());
            argv.extend(leading.iter_mut().map(|word| ptr::from_mut(word).cast()));
            argv.extend(self.frames.iter_mut().map(|f| f.as_mut_ptr().0.cast_mut()));
            // SAFETY: `call` was prepared from this signature: what leads the
            // arguments for this kind of callee, then one value per frame,
            // each laid out by `encode` as the type at that position, variable
            // arguments as objects; `function` has that C signature (the
            // method's own through `objc_msgSend`, the block's, the C
            // function's); `ret` is a whole `Frame`.
            let sent = unsafe {
                self.call.call(
                    CATCH_FRAMES.get().map(|f| f.call),
                    function,
                    self.ret.as_mut_ptr().0.cast_mut(),
                    argv.as_mut_ptr(),
                )
            };
            // SAFETY: on `Err` the frame stored nil or a +1 reference to the
            // thrown object, which is an Objective-C object of some class.
            sent.map_err(|thrown| exception(unsafe { caught(thrown) }))
        }
    }
    let rt = rt();
    #[cfg(target_arch = "x86_64")]
    let (msg_send, msg_send_super) = if call.stret {
        (rt.objc_msgSend_stret, rt.objc_msgSendSuper2_stret)
    } else {
        (rt.objc_msgSend, rt.objc_msgSendSuper2)
    };
    #[cfg(not(target_arch = "x86_64"))]
    let (msg_send, msg_send_super) = (rt.objc_msgSend, rt.objc_msgSendSuper2);
    let sel_word = sig.callee.sel().map_or(0, |sel| sel.0.as_ptr() as usize);
    let mut perform = Perform { call, frames, ret };
    let mut message =
        |target: &NSObject| perform.with(msg_send, &mut [target.as_obj() as usize, sel_word]);
    match (target, sig.callee) {
        (Target::Function(function), _) => perform.with(function.as_ptr(), &mut []),
        (Target::Receiver(receiver), Callee::Block) => receiver.with_target(|block| {
            // SAFETY: `signature()` only gives a block signature for a block,
            // whose literal starts with the fields `invoke_of` reads.
            let invoke = unsafe { block::invoke_of(block.as_obj()) };
            perform.with(invoke, &mut [block.as_obj() as usize])
        })?,
        (Target::Receiver(Receiver::Super(o, class)), _) => {
            // init consumes the reference the receiver's wrapper owned and
            // hands one back with its result, so that wrapper ends here.
            let held;
            let live;
            let target: &NSObject = if sig.family == Family::Init {
                held = o.take_for_init(&sig.method)?;
                &held
            } else {
                live = o.target()?;
                &live
            };
            // A class method is answered from the defining class's
            // metaclass (not the receiver's: a subclass inheriting this
            // method would find it again from its own).
            // SAFETY: a live object.
            let class_method = unsafe { (rt.object_isClass)(target.as_obj()) }.get();
            let current = if class_method {
                // SAFETY: a class object is a live object.
                unsafe { rt.class_of_raw(class.0.as_obj()) }
            } else {
                class.0
            };
            let mut sup = ObjcSuper {
                receiver: target.as_obj(),
                class: current.as_obj(),
            };
            perform.with(msg_send_super, &mut [(&raw mut sup) as usize, sel_word])
        }
        (Target::Receiver(Receiver::Object(o)), _) if sig.family == Family::Init => {
            // init takes over the reference this wrapper owned and may hand
            // back a different object, so the receiver is never released here.
            let target = o.take_for_init(&sig.method)?;
            message(&target)
        }
        (Target::Receiver(receiver), _) => receiver.with_target(message)?,
    }
}

/// [`invoke`] through `-[NSInvocation invokeWithTarget:]`.
fn invoke_invocation(
    receiver: Receiver<'_>,
    sig: &Signature,
    frames: &[Frame],
    ret: &mut Frame,
) -> Result<()> {
    if let Receiver::Super(..) = receiver {
        return Err(unsupported(
            &sig.method,
            "a super send needs /usr/lib/libffi.dylib, which did not load (or BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI is set)",
        ));
    }
    let invocation = NSInvocation::with_method_signature(&sig.ns);
    if let Some(sel) = sig.callee.sel() {
        invocation.set_selector(sel);
    }
    for (index, frame) in frames.iter().enumerate() {
        invocation.set_argument_raw(frame.as_ptr(), sig.slot(index));
    }
    match receiver {
        Receiver::Object(o) if sig.family == Family::Init => {
            // As in `invoke_ffi`.
            let target = o.take_for_init(&sig.method)?;
            invoke_catching(&invocation, &target)?;
        }
        _ => receiver.with_target(|t| invoke_catching(&invocation, t))??,
    }
    if sig.ret != Enc::Void && sig.ret_len > 0 {
        invocation.get_return_value_raw(ret.as_mut_ptr());
    }
    Ok(())
}

// ───────────────────────────────── C functions ────────────────────────────────

/// An exported C function (`NSBeep`, `NSStringFromClass`,
/// `CGColorCreateGenericRGB`) found with `dlsym` and called through libffi
/// by the type encoding a script (or the generated table) gave for it.
pub struct Function {
    symbol: NonNull<c_void>,
    sig: Signature,
}

impl fmt::Debug for Function {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.sig, f)
    }
}

/// What a script says about who owns a C function's object results, in
/// `objc.fn(name, { returnsRetained, retainedOuts })`; either unsaid leaves
/// it to the SDK's [`sdk::FUNCTION_OWNERSHIP`] row and the rules in
/// [`function`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ownership {
    pub returns_retained: Option<bool>,
    pub retained_outs: Vec<usize>,
}

/// The exported function `name` typed as `types` (return type, then one
/// encoding per argument: `"v"` for `NSBeep`, `"@#"` for
/// `NSStringFromClass`); `format` is the index of the format argument of
/// one declared with `...` whose variable arguments a format string names
/// (`NSLog` is `"v@"` with 0). An object result is adopted rather than
/// retained when the header declares it `CF_RETURNS_RETAINED` /
/// `NS_RETURNS_RETAINED` (the SDK table, or `ownership` for a function
/// typed by hand), or when it is a Core Foundation type from a function
/// named `Create` or `Copy` (the Create Rule); an Objective-C object from
/// any other function is retained, as a method's result is, whatever the
/// name says (`NSCreateFilenamePboardType` returns a +0 string).
pub fn function(
    name: &str,
    types: &str,
    format: Option<usize>,
    ownership: Ownership,
) -> Result<Function> {
    load()?;
    let _pool = AutoreleasePool::new();
    let method = format!("{name}()");
    let no_symbol = || Error::NoSymbol(name.to_owned());
    let c_name = CString::new(name).map_err(|_| no_symbol())?;
    let symbol = rt().symbol(&c_name).ok_or_else(no_symbol)?;
    if !is_function(symbol) {
        return Err(unsupported(
            &method,
            "is an exported constant, not a function; read it with objc.constants",
        ));
    }
    if !ffi::available() {
        return Err(unsupported(
            &method,
            "C functions need /usr/lib/libffi.dylib, which did not load",
        ));
    }
    let ns = method_signature(types, |why| {
        unsupported(
            &method,
            format!("type encoding {types:?} is not valid{why}"),
        )
    })?;
    let mut sig = Signature::parsed(
        ns,
        Callee::Function,
        method,
        Family::None,
        Spelling::Written,
    );
    let declared = sdk::FUNCTION_OWNERSHIP
        .binary_search_by(|(n, ..)| (*n).cmp(name))
        .ok()
        .map(|i| &sdk::FUNCTION_OWNERSHIP[i]);
    let named_create = strings::contains(name.as_bytes(), b"Create")
        || strings::contains(name.as_bytes(), b"Copy");
    let returns_retained = ownership
        .returns_retained
        .or_else(|| declared.and_then(|(_, retained, _)| *retained));
    sig.family = match (&sig.ret, returns_retained) {
        (Enc::Object | Enc::CFObject(_), Some(true)) => Family::Retained,
        (Enc::CFObject(_), None) if named_create => Family::Create,
        _ => Family::None,
    };
    sig.create_rule = named_create;
    sig.retained_outs = ownership.retained_outs;
    if let Some((_, _, outs)) = declared {
        sig.retained_outs.extend_from_slice(outs);
    }
    if let Some(index) = sig
        .retained_outs
        .iter()
        .find(|&&i| !matches!(sig.args.get(i), Some(Enc::Out(_))))
    {
        return Err(unsupported(
            &sig.method,
            format!("retainedOuts names argument {index}, which is not an out-parameter"),
        ));
    }
    if let Some(index) = format {
        if sig.args.get(index) != Some(&Enc::Object) {
            return Err(unsupported(
                &sig.method,
                format!("argument {index} is not an object, so it cannot be the format"),
            ));
        }
        sig.variadic = Some(Variadic::Format(index));
    }
    for (index, enc) in sig.args.iter().enumerate() {
        if let Enc::Other(e) = enc {
            return Err(unsupported(
                &sig.method,
                format!("argument {index} type {e} is not supported"),
            ));
        }
    }
    if manages_references(name, &sig.args) {
        return Err(unsupported(
            &sig.method,
            "reference counting is managed by the wrapper, which releases what it holds by itself; use release() on a handle to let go early",
        ));
    }
    sig.check_return()?;
    sig.prepare();
    if sig.variadic.is_none() && sig.call.is_none() {
        return Err(unsupported(
            &sig.method,
            "libffi cannot lay out its arguments",
        ));
    }
    Ok(Function { symbol, sig })
}

/// Whether the function `name` taking `args` retains, releases, allocates
/// or deallocates an object (`CGColorRelease`, `CGPathRetain`, `CFRelease`,
/// `NSDeallocateObject`), which would unbalance the reference a handle owns,
/// as the [`MANAGED_SELECTORS`] would. `CGDisplayRelease` (a display
/// number) does not.
fn manages_references(name: &str, args: &[Enc]) -> bool {
    let counted =
        matches!(
            args,
            [Enc::Object
                | Enc::CFObject(_)
                | Enc::Block
                | Enc::Pointer
                | Enc::Out(_)
                | Enc::Buffer(_)]
        );
    let name = name.as_bytes();
    (counted
        && (name.ends_with(b"Retain")
            || name.ends_with(b"Release")
            || name.ends_with(b"Autorelease")))
        || matches!(
            name,
            b"NSAllocateObject"
                | b"NSDeallocateObject"
                | b"NSIncrementExtraRefCount"
                | b"NSDecrementExtraRefCountWasZero"
        )
}

impl Function {
    pub fn signature(&self) -> &Signature {
        &self.sig
    }

    /// Calls the function with `args`, matched and converted as [`invoke`]
    /// does a method's.
    pub fn call(&self, args: &mut [DynValue]) -> Result<DynValue> {
        perform(Target::Function(self.symbol), &self.sig, args)
    }
}

// ──────────────────────────────── exceptions ─────────────────────────────────

/// `[invocation invokeWithTarget:target]` sent through `msg_send` under a
/// catch frame: `true` when it returned, `false` with a +1 reference (taken
/// with `retain`) to the thrown object in `exception` when it raised.
pub type InvocationFrame = unsafe extern "C" fn(
    msg_send: *const c_void,
    retain: unsafe extern "C" fn(Obj) -> Obj,
    invocation: *mut c_void,
    invoke_with_target: *const c_void,
    target: *mut c_void,
    exception: *mut *mut c_void,
) -> bool;

pub use ffi::CallFrame;

/// `object` thrown with `objc_throw` (`objc_exception_throw`) and caught
/// again: `true` when the catch frames recognise it as that object.
pub type ProbeFrame =
    unsafe extern "C" fn(objc_throw: unsafe extern "C" fn(Obj), object: Obj) -> bool;

/// The catch frames in `src/jsc/bindings/darwin/objc-try-invoke.cpp`.
/// Only the full `bun` link has them, so nothing in this crate names them:
/// the runtime crate hands them to [`catch_exceptions_with`], and this
/// crate's own test binaries link without them.
#[derive(Clone, Copy)]
pub struct CatchFrames {
    pub invocation: InvocationFrame,
    pub call: CallFrame,
    /// Run once when the runtime loads: the frames tell an Objective-C
    /// exception from any other by where objc4 puts its type_info, and
    /// this throws one to see that they still can.
    pub probe: ProbeFrame,
}

unsafe extern "C" {
    /// [`CatchFrames::probe`].
    pub fn Bun__objc__recognizesException(
        objc_throw: unsafe extern "C" fn(Obj),
        object: Obj,
    ) -> bool;
    /// [`CatchFrames::invocation`].
    pub fn Bun__NSInvocation__tryInvoke(
        msg_send: *const c_void,
        retain: unsafe extern "C" fn(Obj) -> Obj,
        invocation: *mut c_void,
        invoke_with_target: *const c_void,
        target: *mut c_void,
        exception: *mut *mut c_void,
    ) -> bool;
    /// [`CatchFrames::call`].
    pub fn Bun__ffi__tryCall(
        call: *const c_void,
        retain: unsafe extern "C" fn(Obj) -> Obj,
        cif: *mut c_void,
        function: *const c_void,
        rvalue: *mut c_void,
        avalue: *mut *mut c_void,
        exception: *mut *mut c_void,
    ) -> bool;
}

static CATCH_FRAMES: OnceLock<CatchFrames> = OnceLock::new();

/// From now on an Objective-C exception raised inside [`invoke`] comes back as
/// [`Error::Exception`] instead of ending the process. See [`CatchFrames`]
/// for why the caller passes them.
pub fn catch_exceptions_with(frames: CatchFrames) {
    CATCH_FRAMES.get_or_init(|| frames);
}

/// Once the runtime is open: whether the installed catch frames (if any)
/// recognise an Objective-C exception this runtime throws. `Err` keeps the
/// bridge from loading, since a caught exception would otherwise be taken
/// for a foreign one and end the process.
pub(super) fn probe_catch_frames(rt: &super::Runtime) -> core::result::Result<(), String> {
    let Some(frames) = CATCH_FRAMES.get() else {
        return Ok(());
    };
    let _pool = AutoreleasePool::new();
    let Some(root) = super::lookup_class(c"NSObject") else {
        return Err("no NSObject class".into());
    };
    // SAFETY: `+[NSObject new]` on the root class: a fresh +1 object.
    let object = unsafe { rt.send::<Obj, _>(root.as_obj(), super::sel!("new"), ()) };
    if object.is_null() {
        return Err("+[NSObject new] returned nil".into());
    }
    // SAFETY: `frames.probe` is `Bun__objc__recognizesException`; it throws
    // `object` with the runtime's own `objc_exception_throw` under its own
    // catch, which retains and releases it in balance; ours goes after.
    let recognised = unsafe {
        let recognised = (frames.probe)(rt.objc_exception_throw, object);
        (rt.objc_release)(object);
        recognised
    };
    match recognised {
        true => Ok(()),
        false => Err(
            "this Objective-C runtime lays out a thrown exception differently than the bridge expects, so exceptions could not be caught".into(),
        ),
    }
}

/// What a catch frame stored: nil, or a +1 reference to the thrown object.
///
/// # Safety
/// `thrown` came out of one of the [`CatchFrames`] returning `false`.
unsafe fn caught(thrown: Obj) -> Option<NSObject> {
    // SAFETY: per contract, nil or an owned reference to an object of some class.
    unsafe { Id::from_retained(thrown).map(|id| NSObject::from_id(id)) }
}

/// `-[NSInvocation invokeWithTarget:]`, through the catching frame when one is installed.
fn invoke_catching(invocation: &NSInvocation, target: &NSObject) -> Result<()> {
    let Some(frames) = CATCH_FRAMES.get() else {
        invocation.invoke_with_target(target);
        return Ok(());
    };
    let mut thrown: Obj = ptr::null_mut();
    let rt = rt();
    // SAFETY: `frames.invocation` is `Bun__NSInvocation__tryInvoke`, whose
    // parameters these are: the runtime's own send and retain entry points,
    // and two objects live for the call.
    if unsafe {
        (frames.invocation)(
            rt.objc_msgSend,
            rt.objc_retain,
            invocation.as_obj(),
            super::sel!("invokeWithTarget:").0.as_ptr().cast_const(),
            target.as_obj(),
            &raw mut thrown,
        )
    } {
        return Ok(());
    }
    // SAFETY: the frame returned `false`.
    Err(exception(unsafe { caught(thrown) }))
}

/// `[receiver sel:argument]` (or `[receiver sel]`, with `argument` nil)
/// returning nothing, under the catch frame when one is installed: what
/// raises while AppKit dispatches (a view's event handler under
/// `sendEvent:`) comes back as [`Error::Exception`] instead of ending the
/// process. For the run loop, whose sends have no script frame above them.
pub(crate) fn send_catching(receiver: &impl Object, sel: super::Sel, argument: Obj) -> Result<()> {
    let rt = rt();
    let Some(frames) = CATCH_FRAMES.get() else {
        // SAFETY: caller contract as for any typed binding: `sel` on
        // `receiver` takes one object (or none; a spare register is not read)
        // and returns void.
        unsafe { rt.send::<(), _>(receiver.as_obj(), sel, (Ptr(argument.cast_const()),)) };
        return Ok(());
    };
    let mut thrown: Obj = ptr::null_mut();
    // SAFETY: `frames.invocation` is `Bun__NSInvocation__tryInvoke`, which is
    // `msg_send(receiver, sel, argument)` under `@try`: the runtime's own send
    // and retain, a live receiver, a registered selector, nil or a live object.
    if unsafe {
        (frames.invocation)(
            rt.objc_msgSend,
            rt.objc_retain,
            receiver.as_obj(),
            sel.0.as_ptr().cast_const(),
            argument,
            &raw mut thrown,
        )
    } {
        return Ok(());
    }
    // SAFETY: the frame returned `false`.
    Err(exception(unsafe { caught(thrown) }))
}

/// `+[class alloc]` under the catch frame when one is installed (through
/// libffi when it lays the call out, `NSInvocation` otherwise), the plain
/// send when none is: the one typed send whose receiver a script picks.
/// (Every other `rt().send` in the bridge carries constant arguments to a
/// receiver the bridge chose; a send a script can steer goes through
/// [`invoke`] or a helper like this one.) The +1 result, nil when the class
/// returned none.
fn alloc_catching(class: DynClass) -> Result<Option<NSObject>> {
    static CALL: OnceLock<Option<&'static ffi::Prepared>> = OnceLock::new();
    let prepared =
        CALL.get_or_init(|| ffi::prepared(&Enc::Object, &[&Enc::Object, &Enc::Sel], None));
    let rt = rt();
    let sel = super::sel!("alloc");
    let Some(frames) = CATCH_FRAMES.get() else {
        // SAFETY: `+alloc` is `(Class) -> id` on every class and returns +1.
        return Ok(unsafe {
            let raw = rt.send::<Obj, _>(class.0.as_obj(), sel, ());
            Id::from_retained(raw).map(|id| NSObject::from_id(id))
        });
    };
    let Some(prepared) = *prepared else {
        let Some(ns) = NSMethodSignature::with_objc_types(c"@@:") else {
            return Err(Error::InvalidState(
                "NSMethodSignature refused the type of +alloc",
            ));
        };
        let invocation = NSInvocation::with_method_signature(&ns);
        invocation.set_selector(sel);
        invoke_catching(&invocation, &class.target())?;
        let mut result = Frame::new();
        invocation.get_return_value_raw(result.as_mut_ptr());
        // SAFETY: `+alloc` returns +1, or nil.
        return Ok(unsafe {
            Id::from_retained(result.read_word() as Obj).map(|id| NSObject::from_id(id))
        });
    };
    let mut receiver = class.0.as_obj();
    let mut sel = sel.0.as_ptr();
    let mut argv: [*mut c_void; 2] = [(&raw mut receiver).cast(), (&raw mut sel).cast()];
    let mut result = Frame::new();
    // SAFETY: `prepared` is the cif for `id (id, SEL)`, which is `+alloc`'s
    // C signature; each `argv` slot points at a value of that type live
    // across the call, and `result` has room.
    unsafe {
        prepared.call(
            Some(frames.call),
            rt.objc_msgSend,
            result.as_mut_ptr().0.cast_mut(),
            argv.as_mut_ptr(),
        )
    }
    // SAFETY: the frame returned `false`.
    .map_err(|thrown| exception(unsafe { caught(thrown) }))?;
    // SAFETY: `+alloc` returns +1, or nil.
    Ok(unsafe { Id::from_retained(result.read_word() as Obj).map(|id| NSObject::from_id(id)) })
}

/// `-[NSApplication nextEventMatchingMask:untilDate:inMode:dequeue:YES]`
/// under the catch frame when one is installed and libffi lays the call
/// out: a timer, a display link or a dispatched block that raises inside the
/// wait comes back as [`Error::Exception`]. The plain send otherwise.
pub(crate) fn next_event_catching(
    app: &super::appkit::NSApplication,
    mask: u64,
    until: &NSDate,
    mode: &NSString,
) -> Result<Option<super::appkit::NSEvent>> {
    static CALL: OnceLock<Option<&'static ffi::Prepared>> = OnceLock::new();
    const U64: Enc = Enc::Int {
        bits: 64,
        signed: false,
    };
    let prepared = CALL.get_or_init(|| {
        ffi::prepared(
            &Enc::Object,
            &[
                &Enc::Object,
                &Enc::Sel,
                &U64,
                &Enc::Object,
                &Enc::Object,
                &Enc::Bool,
            ],
            None,
        )
    });
    let (Some(frames), Some(prepared)) = (CATCH_FRAMES.get(), *prepared) else {
        return Ok(app.next_event(mask, Some(until), mode, true));
    };
    let rt = rt();
    let mut receiver = app.as_obj();
    let mut sel = super::sel!("nextEventMatchingMask:untilDate:inMode:dequeue:")
        .0
        .as_ptr();
    let mut mask = mask;
    let mut until = until.as_obj();
    let mut mode = mode.as_obj();
    let mut dequeue = super::Bool::YES;
    let mut argv: [*mut c_void; 6] = [
        (&raw mut receiver).cast(),
        (&raw mut sel).cast(),
        (&raw mut mask).cast(),
        (&raw mut until).cast(),
        (&raw mut mode).cast(),
        (&raw mut dequeue).cast(),
    ];
    let mut result = Frame::new();
    // SAFETY: `prepared` is the cif for `id (id, SEL, NSUInteger, id, id,
    // BOOL)`, which is this method's C signature; each `argv` slot points at
    // a value of that type live across the call, and `result` has room.
    unsafe {
        prepared.call(
            Some(frames.call),
            rt.objc_msgSend,
            result.as_mut_ptr().0.cast_mut(),
            argv.as_mut_ptr(),
        )
    }
    // SAFETY: the frame returned `false`.
    .map_err(|thrown| exception(unsafe { caught(thrown) }))?;
    // SAFETY: the +0 (autoreleased) `NSEvent *` result, nil for none.
    Ok(unsafe {
        Id::retain(result.read_word() as Obj).map(|id| super::appkit::NSEvent::from_id(id))
    })
}

/// [`Error::Exception`] for a caught object.
fn exception(object: Option<NSObject>) -> Error {
    let Some(object) = object else {
        return Error::Exception {
            name: "nil".into(),
            reason: "nil was thrown".into(),
            user_info: None,
            object: None,
        };
    };
    let described = |o: &NSObject| {
        o.description()
            .map(|d| d.to_string_lossy())
            .unwrap_or_default()
    };
    let class_name = || rt().class_name_of(object.as_obj());
    let (name, reason, user_info) = match view_as::<NSException>(&object) {
        Some(e) => (
            e.name().map_or_else(class_name, |n| n.to_string_lossy()),
            e.reason().map(|r| r.to_string_lossy()).unwrap_or_default(),
            e.user_info().map(|d| described(d.upcast())),
        ),
        None => (class_name(), described(&object), None),
    };
    Error::Exception {
        name,
        reason,
        user_info,
        object: Some(DynObject::wrap(object)),
    }
}

/// Whether `-[owner sel]` (a one-argument `set…:`) is the setter of a
/// delegate-like property the SDK declares `assign` ([`sdk::ASSIGN_PROPERTIES`]):
/// typed `id <SomeProtocol>` with none of weak, strong, retain or copy. The
/// row of the nearest class in `owner`'s chain decides, so a subclass that
/// redeclares the property weak (`NSTextView.delegate` over
/// `NSText.delegate`) is left alone. A property typed as a concrete class
/// (`nextResponder`, `NSMenuItem.menu`) or plain `id` is a back-pointer to
/// something that owns the receiver, and holding it would be a cycle; the
/// table has none of those.
fn sets_assign_property(owner: DynClass, sel: &str) -> bool {
    if !sel.starts_with("set") {
        return false;
    }
    let mut nearest: Option<(Class, bool)> = None;
    for (_, class, assign) in sdk_rows(sdk::ASSIGN_PROPERTIES, |(s, c, _)| (s, c), owner, sel) {
        let Some(class) = super::lookup_class(class) else {
            continue;
        };
        if nearest.is_none_or(|(best, _)| rt().class_inherits(class, best)) {
            nearest = Some((class, *assign));
        }
    }
    nearest.is_some_and(|(_, assign)| assign)
}

/// After an `assign` property's setter ran with the object (or nil) at
/// `value`: has the receiver hold it, keyed by the selector, so the property
/// cannot outlive what it points at. AppKit declares nearly every delegate,
/// data source and target zeroing-weak; this covers the few it still does
/// not.
fn keep_assigned(target: &NSObject, sig: &Signature, value: usize) {
    let key = sig
        .callee
        .sel()
        .map_or(ptr::null(), |s| s.0.as_ptr().cast_const());
    // SAFETY: the receiver just answered the send; `value` is the object
    // pointer (or nil) `encode` wrote, whose object `Keep` still holds.
    unsafe { rt().associate_retained(target.as_obj(), key, value as Obj) };
}

/// A window made in code releases itself when it closes unless told not to;
/// that release, on top of the one the returned wrapper owes, would free the
/// object under the wrapper. So a window that comes back from `init…`, `new…`
/// or a class method of a window class is told not to.
fn keep_window_past_close(
    receiver: Receiver<'_>,
    sig: &Signature,
    result: &DynValue,
) -> Result<()> {
    let DynValue::Object(object) = result else {
        return Ok(());
    };
    let is_window = |class: Class| rt().class_inherits(class, NSWindow::class());
    let created = matches!(sig.family, Family::Init | Family::New)
        || receiver.as_class().is_some_and(|c| is_window(c.0));
    if created && let Some(window) = view_as::<NSWindow>(&*object.live()?) {
        window.set_released_when_closed(false);
    }
    Ok(())
}

pub(super) fn unsupported(method: &str, what: impl Into<String>) -> Error {
    Error::UnsupportedSignature {
        method: method.to_owned(),
        what: what.into(),
    }
}

/// Lays `value` out in `frame` as the C type `enc`; whatever the frame ends
/// up pointing at goes in `keep`. `method` and `index` are for messages. An
/// object in a block slot must be a block; whether its signature fits the
/// slot is for the caller (see [`block::check_block_signature`]).
pub(super) fn encode(
    method: &str,
    index: usize,
    enc: &Enc,
    value: &DynValue,
    frame: &mut Frame,
    keep: &mut Keep,
) -> Result<()> {
    let mismatch = || Error::ArgType {
        method: method.to_owned(),
        index,
        expected: enc.to_string(),
        got: value.kind().to_owned(),
    };
    let c_string = |s: &str| {
        CString::new(s).map_err(|_| Error::ArgType {
            method: method.to_owned(),
            index,
            expected: enc.to_string(),
            got: "a string containing a NUL character".into(),
        })
    };
    let mut object = |o: NSObject, frame: &mut Frame| {
        frame.word(o.as_obj() as usize);
        keep.objects.push(o);
    };
    let cf_holds = |t: &CFType, o: &NSObject| match t.holds(o) {
        true => Ok(()),
        false => Err(Error::ArgType {
            method: method.to_owned(),
            index,
            expected: enc.to_string(),
            got: format!("a {}", rt().class_name_of(o.as_obj())),
        }),
    };
    match (enc, value) {
        (
            Enc::Object
            | Enc::CFObject(_)
            | Enc::Block
            | Enc::Class
            | Enc::Sel
            | Enc::CString
            | Enc::Out(_)
            | Enc::Buffer(_)
            | Enc::Pointer,
            DynValue::Nil,
        )
        | (Enc::Pointer, DynValue::Pointer(0)) => frame.word(0),
        (Enc::Pointer, DynValue::Pointer(address))
        | (Enc::Pointer | Enc::Buffer(_), DynValue::Bytes { address, .. }) => frame.word(*address),
        (Enc::Out(pointee), DynValue::Out(initial)) => {
            let mut cell = Frame::new();
            if let Some(initial) = initial {
                encode(method, index, &pointee.enc(), initial, &mut cell, keep)?;
            }
            frame.word(keep.out(index, *pointee, cell).as_ptr() as usize);
        }
        (Enc::Object, DynValue::Object(o)) => object(o.live()?.clone(), frame),
        (Enc::Object, DynValue::Class(c)) => frame.word(c.address()),
        (Enc::Block, DynValue::Object(o)) => {
            let o = o.live()?;
            if !block::is_block(rt().class_of(o.as_id())) {
                return Err(Error::ArgType {
                    method: method.to_owned(),
                    index,
                    expected: enc.to_string(),
                    got: format!("an object of class {}", rt().class_name_of(o.as_obj())),
                });
            }
            object(o.clone(), frame);
        }
        (Enc::CFObject(t), DynValue::Object(o)) => {
            let o = o.live()?;
            cf_holds(t, &o)?;
            object(o.clone(), frame);
        }
        // Boxed the way an `id` argument is; a toll-free bridged CF type
        // (`CFStringRef`, `CFNumberRef`) takes the box when it is one.
        (
            Enc::Object | Enc::CFObject(_),
            DynValue::Str(_)
            | DynValue::Bool(_)
            | DynValue::F64(_)
            | DynValue::I64(_)
            | DynValue::U64(_),
        ) => {
            let boxed: NSObject = match value {
                DynValue::Str(s) => NSString::from_str(NsStr::Utf8(s)).upcast().clone(),
                DynValue::Bool(b) => NSNumber::with_bool(*b).upcast().clone(),
                DynValue::F64(n) => nsnumber(*n).upcast().clone(),
                DynValue::I64(n) => NSNumber::with_i64(*n).upcast().clone(),
                DynValue::U64(n) => NSNumber::with_u64(*n).upcast().clone(),
                _ => unreachable!(),
            };
            if let Enc::CFObject(t) = enc {
                cf_holds(t, &boxed)?;
            }
            object(boxed, frame);
        }
        (Enc::Class, DynValue::Class(c)) => frame.word(c.address()),
        (Enc::Class, DynValue::Object(o)) if o.is_class() => {
            frame.word(o.live()?.as_obj() as usize)
        }
        (Enc::Sel, DynValue::Sel(name) | DynValue::Str(name)) => {
            frame.word(register_sel(&c_string(name)?).0.as_ptr() as usize);
        }
        (Enc::Bool | Enc::Int { .. } | Enc::F32 | Enc::F64, _) => {
            let scalar = match enc {
                Enc::Bool => Scalar::Bool,
                Enc::Int { bits, signed } => Scalar::Int {
                    bits: *bits,
                    signed: *signed,
                },
                Enc::F32 => Scalar::F32,
                _ => Scalar::F64,
            };
            match frame.put_scalar(0, scalar, value) {
                Ok(true) => {}
                Ok(false) => return Err(mismatch()),
                Err((min, max, got)) => {
                    return Err(Error::ArgType {
                        method: method.to_owned(),
                        index,
                        expected: format!("{enc} from {min} to {max}"),
                        got: got.to_string(),
                    });
                }
            }
        }
        (Enc::CString, DynValue::Str(s)) => {
            let c = c_string(s)?;
            frame.word(c.as_ptr() as usize);
            keep.strings.push(c);
        }
        (Enc::Struct(t), DynValue::Struct(vt, values))
            if vt.fields.len() == t.fields.len() && values.len() == t.fields.len() =>
        {
            for (i, (field, v)) in t.fields.iter().zip(values.iter()).enumerate() {
                let member = || match t.field_names() {
                    Some(names) => names[i].to_owned(),
                    None => format!("[{i}]"),
                };
                match frame.put_scalar(field.offset, field.scalar, v) {
                    Ok(true) => {}
                    Ok(false) => {
                        return Err(Error::ArgType {
                            method: method.to_owned(),
                            index,
                            expected: format!("{enc} with {} {}", member(), field.scalar.enc()),
                            got: format!("{} there", v.kind()),
                        });
                    }
                    Err((min, max, got)) => {
                        return Err(Error::ArgType {
                            method: method.to_owned(),
                            index,
                            expected: format!("{enc} with {} from {min} to {max}", member()),
                            got: got.to_string(),
                        });
                    }
                }
            }
        }
        (Enc::Other(e), _) => {
            return Err(unsupported(
                method,
                format!("argument type {e} is not supported yet"),
            ));
        }
        _ => return Err(mismatch()),
    }
    Ok(())
}

/// Reads a value of C type `enc` out of `frame`. An object in it is a
/// reference the caller owns when `retained`, else borrowed (+0).
pub(super) fn decode(method: &str, enc: &Enc, retained: bool, frame: &Frame) -> Result<DynValue> {
    Ok(match enc {
        Enc::Void => DynValue::Void,
        Enc::Object | Enc::CFObject(_) | Enc::Block => {
            let raw = frame.read_word() as Obj;
            // SAFETY: an object of the declared type, live on this thread
            // (just returned, or an argument being delivered); owned already
            // when `retained`, otherwise retained before any pool can drain.
            // A block lent for the call may live on the caller's stack, so
            // the reference taken to one is to its heap copy.
            let object = unsafe {
                if retained {
                    DynObject::from_retained(raw)
                } else if *enc == Enc::Block {
                    block::own(raw)
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
        Enc::Bool => frame.scalar(0, Scalar::Bool),
        Enc::Int { bits, signed } => frame.scalar(
            0,
            Scalar::Int {
                bits: *bits,
                signed: *signed,
            },
        ),
        Enc::F32 => frame.scalar(0, Scalar::F32),
        Enc::F64 => frame.scalar(0, Scalar::F64),
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
        Enc::Out(_) | Enc::Buffer(_) | Enc::Pointer => DynValue::Pointer(frame.read_word()),
        Enc::Struct(t) => DynValue::Struct(
            t,
            t.fields
                .iter()
                .map(|f| frame.scalar(f.offset, f.scalar))
                .collect(),
        ),
        Enc::Other(e) => {
            return Err(unsupported(
                method,
                format!("return type {e} is not supported yet"),
            ));
        }
    })
}

/// What the script behind a block or a script-class method answered.
pub struct Reply {
    /// Already shaped for the return type; `None` (the function threw, or
    /// returned something that does not fit, both of which were reported)
    /// leaves the caller a zero / `nil` result.
    pub value: Option<DynValue>,
    /// Values to store through [`Enc::Out`] arguments, by argument index.
    pub outs: Vec<(usize, DynValue)>,
}

/// The value an [`Enc::Out`] argument being delivered to a script points
/// at (zero for a NULL pointer). `frame` holds the pointer. Out-only object
/// storage is not read: a caller passing `NSError **` need not initialise
/// it, so what is there may not be an object, and the script starts from
/// `nil`; an `inout` object is read and retained.
pub(super) fn read_out(method: &str, pointee: Pointee, frame: &Frame) -> Result<DynValue> {
    let ptr = frame.read_word() as *const u8;
    let mut cell = Frame::new();
    if !ptr.is_null() && !matches!(pointee, Pointee::Object | Pointee::CFObject(_)) {
        // SAFETY: a non-NULL out-parameter the caller passed for the callee to
        // read and write during the call: valid for the pointee's size.
        unsafe { ptr::copy_nonoverlapping(ptr, cell.0.as_mut_ptr(), pointee.byte_len()) };
    }
    decode(method, &pointee.enc(), false, &cell)
}

/// Stores `value` through the [`Enc::Out`] argument pointer in `frame`, if
/// it is not NULL. An object stored this way is autoreleased, as a method
/// filling an `NSError **` does.
pub(super) fn write_out(
    method: &str,
    index: usize,
    pointee: Pointee,
    frame: &Frame,
    value: &DynValue,
) -> Result<()> {
    let ptr = frame.read_word() as *mut u8;
    if ptr.is_null() {
        return Ok(());
    }
    let mut cell = Frame::new();
    let mut keep = Keep::default();
    encode(method, index, &pointee.enc(), value, &mut cell, &mut keep)?;
    if let Pointee::Object | Pointee::InOutObject | Pointee::CFObject(_) = pointee {
        let object = cell.read_word() as Obj;
        if !object.is_null() {
            // SAFETY: `encode` just stored a live object (held by `keep`, or a
            // class); the reference taken here is the caller's pool's.
            unsafe { (rt().objc_autorelease)((rt().objc_retain)(object)) };
        }
    }
    // SAFETY: a non-NULL out-parameter the caller passed for the callee to
    // write during the call: valid for the pointee's size.
    unsafe { ptr::copy_nonoverlapping(cell.0.as_ptr(), ptr, pointee.byte_len()) };
    Ok(())
}

impl Enc {
    /// The bytes a value of this type takes where a closure finds its
    /// arguments and leaves its result: a struct's size, a scalar's width,
    /// a word for everything that crosses as an address, none for `void`.
    pub(super) fn value_size(&self) -> usize {
        match self {
            Enc::Void => 0,
            Enc::Bool => 1,
            Enc::Int { bits, .. } => *bits as usize / 8,
            Enc::F32 => 4,
            Enc::F64 => 8,
            Enc::Struct(t) => t.size,
            Enc::Other(_) => 0,
            Enc::Object
            | Enc::CFObject(_)
            | Enc::Block
            | Enc::Class
            | Enc::Sel
            | Enc::CString
            | Enc::Out(_)
            | Enc::Buffer(_)
            | Enc::Pointer => core::mem::size_of::<usize>(),
        }
    }

    /// Why an argument of this type cannot be handed over to another thread
    /// for later (it points into memory the caller may have freed by then);
    /// `None` for one carried by value or by reference count.
    fn not_handed_over(&self) -> Option<&'static str> {
        match self {
            Enc::CString => Some("it takes a C string argument"),
            Enc::Out(_) | Enc::Buffer(_) | Enc::Pointer => Some("it takes a pointer argument"),
            Enc::Other(_) => Some("it takes an argument of unsupported type"),
            _ => None,
        }
    }
}

/// The argument frames of one call read out of where a libffi closure
/// finds them.
///
/// # Safety
/// `args` has one pointer per entry of `params`, each to a value of that type.
pub(super) unsafe fn frames_of(params: &[Enc], args: *mut *mut c_void) -> Frames {
    params
        .iter()
        .enumerate()
        .map(|(i, enc)| {
            let mut frame = Frame::new();
            // SAFETY: per contract; a value is at most a `Frame` long
            // (`StructType` refuses bigger ones).
            unsafe {
                ptr::copy_nonoverlapping(
                    (*args.add(i)).cast::<u8>(),
                    frame.0.as_mut_ptr(),
                    enc.value_size().min(FRAME_SIZE),
                )
            };
            frame
        })
        .collect()
}

/// Encodes what a script function returned as the `ret`-typed result of the
/// block or method `name` into `out`, and, for an object, gives the caller
/// the reference it expects with it: its own to release when the selector's
/// family says the result comes retained, else one in its autorelease pool.
pub(super) fn encode_result(
    name: &str,
    ret: &Enc,
    family: Family,
    value: &DynValue,
    out: &mut Frame,
) -> Result<()> {
    let mut keep = Keep::default();
    encode(name, 0, ret, value, out, &mut keep).map_err(|err| match err {
        Error::ArgType {
            method,
            expected,
            got,
            ..
        } => Error::ReturnType {
            method,
            expected,
            got,
        },
        err => err,
    })?;
    if let Enc::Object | Enc::CFObject(_) | Enc::Block = ret {
        let object = out.read_word() as Obj;
        if !object.is_null() {
            // SAFETY: `encode` just stored a live object (held by `keep`, by
            // `value`, or a class), so it can be retained before `keep` goes.
            unsafe {
                let object = (rt().objc_retain)(object);
                if !family.returns_retained() {
                    (rt().objc_autorelease)(object);
                }
            }
        }
    }
    Ok(())
}

/// Leaves `result`, laid out as `ret`, where a libffi closure's caller reads
/// it: a whole register for a scalar, the struct's bytes for a struct.
///
/// # Safety
/// `out` is the return pointer the closure was entered with for a `ret` result.
pub(super) unsafe fn leave_result(ret: &Enc, result: &Frame, out: *mut c_void) {
    let len = match ret {
        Enc::Void => 0,
        Enc::Struct(t) => t.size,
        _ => core::mem::size_of::<u64>(),
    };
    // SAFETY: per contract; libffi's return area holds at least a register.
    unsafe { ptr::copy_nonoverlapping(result.0.as_ptr(), out.cast::<u8>(), len) };
}

/// A call that arrived on a thread other than the one its script function
/// runs on, with everything it needs to be made later on that thread: the
/// receiver (or block) and every object argument retained, blocks among
/// them copied to the heap, the rest of the arguments by value.
pub(super) struct HandedOver {
    pub(super) receiver: Obj,
    pub(super) frames: Vec<Frame>,
    /// The references taken for `frames`, let go when this is dropped.
    retained: Vec<Obj>,
}

// SAFETY: raw Objective-C references this value owns, and plain bytes;
// made on one thread to be used and dropped on another, which is what
// retaining them is for.
unsafe impl Send for HandedOver {}

impl HandedOver {
    /// Why a call to `what`, returning `ret` and taking `params`, cannot be
    /// handed over; `None` when it can.
    pub(super) fn refused(ret: &Enc, params: &[Enc]) -> Option<&'static str> {
        if *ret != Enc::Void {
            return Some("it returns a value");
        }
        params.iter().find_map(Enc::not_handed_over)
    }

    /// Takes the references. `receiver` is already retained (+1) by the
    /// caller and becomes this value's.
    ///
    /// # Safety
    /// `frames` hold values of `params`' types, live on this thread now;
    /// [`refused`](Self::refused) said `None` for them.
    pub(super) unsafe fn new(receiver: Obj, params: &[Enc], frames: &[Frame]) -> HandedOver {
        let mut frames = frames.to_vec();
        let mut retained = Vec::with_capacity(frames.len() + 1);
        retained.push(receiver);
        for (enc, frame) in params.iter().zip(frames.iter_mut()) {
            let word = frame.read_word() as Obj;
            if word.is_null() {
                continue;
            }
            match enc {
                Enc::Object | Enc::CFObject(_) => {
                    // SAFETY: per contract, a live object; CF types answer objc_retain.
                    retained.push(unsafe { (rt().objc_retain)(word) })
                }
                Enc::Block => {
                    // SAFETY: per contract, a live block, maybe on the
                    // caller's stack: the heap copy is what is kept.
                    let copy = unsafe { block::copy_raw(word) };
                    frame.word(copy as usize);
                    if !copy.is_null() {
                        retained.push(copy);
                    }
                }
                _ => {}
            }
        }
        HandedOver {
            receiver,
            frames,
            retained,
        }
    }
}

impl Drop for HandedOver {
    fn drop(&mut self) {
        let _pool = pool_if_none();
        for object in self.retained.drain(..) {
            // SAFETY: a reference `new` took (or was handed).
            unsafe { (rt().objc_release)(object) };
        }
    }
}

/// Structs the frameworks pass by value, named and anonymous, nested and
/// padded, whose layout `verify_bindings` checks three ways.
pub(super) const VERIFIED_STRUCTS: [&CStr; 12] = [
    c"{CGRect={CGPoint=dd}{CGSize=dd}}",
    c"{_NSRange=QQ}",
    c"{NSEdgeInsets=dddd}",
    c"{CGAffineTransform=dddddd}",
    c"{CATransform3D=dddddddddddddddd}",
    c"{?=qiIq}",
    c"{?={?=QQQ}{?=QQQ}}",
    c"{?=dddd}",
    c"{outer={inner=dc}c}",
    c"{s=cs}",
    c"{b=fB}",
    c"{m=Cq}",
];

/// Part of `verify_bindings`: the generated tables [`sdk_rows`] and
/// [`cf_object`] binary-search are sorted the way `str::cmp` orders, or
/// rows are silently missed.
pub(super) fn verify_sdk_tables(problems: &mut Vec<String>) {
    let mut check = |name: &str, sorted: bool| {
        if !sorted {
            problems.push(format!("{name} is not sorted for binary search"));
        }
    };
    check(
        "sdk::VARIADIC",
        sdk::VARIADIC.is_sorted_by_key(|(s, c, _)| (*s, *c)),
    );
    check(
        "sdk::ARRAY_PARAMS",
        sdk::ARRAY_PARAMS.is_sorted_by_key(|(s, c, i, _)| (*s, *c, *i)),
    );
    check(
        "sdk::ASSIGN_PROPERTIES",
        sdk::ASSIGN_PROPERTIES.is_sorted_by_key(|(s, c, _)| (*s, *c)),
    );
    check(
        "sdk::PROTOCOLS",
        sdk::PROTOCOLS.is_sorted_by_key(|p| p.name),
    );
    check(
        "sdk::BOOL_PARAMS",
        sdk::BOOL_PARAMS.is_sorted_by_key(|(s, c, i)| (*s, *c, *i)),
    );
    check(
        "sdk::OWNERSHIP",
        sdk::OWNERSHIP.is_sorted_by_key(|(s, c, ..)| (*s, *c)),
    );
    check(
        "sdk::CHAR_SLOTS",
        sdk::CHAR_SLOTS.is_sorted_by_key(|(s, c, i)| (*s, *c, *i)),
    );
    check(
        "sdk::FUNCTION_OWNERSHIP",
        sdk::FUNCTION_OWNERSHIP.is_sorted_by_key(|(n, ..)| *n),
    );
    check(
        "cf::CF_TYPES",
        super::cf::CF_TYPES.is_sorted_by_key(|t| t.name),
    );
}

/// Part of `verify_bindings`: the signature of a method the runtime spells
/// with a nameless struct (`{?}` on x86_64 for `NSDecimal`) still resolves,
/// since it is read from the class through Foundation rather than handed to
/// `signatureWithObjCTypes:`, which refuses that spelling.
pub(super) fn verify_signatures(problems: &mut Vec<String>) {
    for (class, sel, class_method) in [
        ("NSDecimalNumber", c"decimalNumberWithDecimal:", true),
        ("NSDecimalNumber", c"initWithDecimal:", false),
        ("NSNumber", c"decimalValue", false),
    ] {
        let Ok(cls) = lookup_class(class) else {
            problems.push(format!("{class}: class not found"));
            continue;
        };
        if cls
            .method_signature(register_sel(sel), class_method)
            .is_none()
        {
            problems.push(format!(
                "{}[{class} {}]: Foundation gave no method signature",
                if class_method { '+' } else { '-' },
                sel.to_string_lossy()
            ));
        }
    }
}

/// Part of `verify_bindings`: the layout [`StructType`] computes from an
/// encoding agrees with Foundation's `NSGetSizeAndAlignment` for
/// [`VERIFIED_STRUCTS`].
pub(super) fn verify_struct_layouts(problems: &mut Vec<String>) {
    type SizeAndAlignment = unsafe extern "C" fn(
        *const core::ffi::c_char,
        *mut usize,
        *mut usize,
    ) -> *const core::ffi::c_char;
    let Some(symbol) = rt().symbol(c"NSGetSizeAndAlignment") else {
        problems.push("NSGetSizeAndAlignment is not exported by Foundation".into());
        return;
    };
    // SAFETY: Foundation's `NSGetSizeAndAlignment`, which has this signature.
    let size_and_alignment: SizeAndAlignment = unsafe { core::mem::transmute(symbol.as_ptr()) };
    for encoding in VERIFIED_STRUCTS {
        let text = encoding.to_string_lossy();
        let Enc::Struct(t) = Enc::parse(&text) else {
            problems.push(format!("{text} does not parse as a struct"));
            continue;
        };
        let (mut size, mut align) = (0usize, 0usize);
        // SAFETY: a NUL-terminated encoding and two words to fill.
        unsafe { size_and_alignment(encoding.as_ptr(), &raw mut size, &raw mut align) };
        if t.size != size {
            problems.push(format!(
                "{text}: laid out as {} bytes, Foundation says {size}",
                t.size
            ));
        }
        if let Some(last) = t.fields.last()
            && last.offset + last.scalar.size() > size
        {
            problems.push(format!(
                "{text}: last member ends past Foundation's {size} bytes"
            ));
        }
    }
}

/// The exported global `name` (`NSString *const NSFontAttributeName`,
/// `const CGFloat NSFontWeightBold`) read as the C type `types` encodes:
/// an object, `BOOL`, an integer, `float`/`double`, or one of the structs.
pub fn constant(name: &str, types: &str) -> Result<DynValue> {
    load()?;
    let no_symbol = || Error::NoSymbol(name.to_owned());
    let c_name = CString::new(name).map_err(|_| no_symbol())?;
    let symbol = rt().symbol(&c_name).ok_or_else(no_symbol)?;
    if is_function(symbol) {
        return Err(Error::NotAConstant(name.to_owned()));
    }
    let enc = Enc::parse_written(types);
    let Some(pointee) = Pointee::of(&enc) else {
        return Err(Error::UnsupportedSignature {
            method: format!("constant {name}"),
            what: format!("cannot be read as {enc}"),
        });
    };
    let mut cell = Frame::new();
    // SAFETY: the symbol is a variable of the type `types` says, per the
    // caller; its bytes are copied out.
    unsafe {
        ptr::copy_nonoverlapping(
            symbol.as_ptr().cast::<u8>(),
            cell.0.as_mut_ptr(),
            pointee.byte_len(),
        )
    };
    if matches!(pointee, Pointee::Object | Pointee::CFObject(_)) && !holds_object(cell.read_word())
    {
        return Err(Error::NotAnObject(name.to_owned()));
    }
    decode(name, &pointee.enc(), false, &cell)
}

unsafe extern "C" {
    /// `<mach/mach_init.h>`: the calling task's own port.
    static mach_task_self_: u32;
    /// `<mach/mach_vm.h>`: copies `size` bytes at `address` in `target_task`
    /// to `data`, or fails (rather than faulting) when they are not mapped
    /// readable.
    fn mach_vm_read_overwrite(
        target_task: u32,
        address: u64,
        size: u64,
        data: u64,
        outsize: *mut u64,
    ) -> i32;
}

/// Whether `word`, read from a global taken to hold an object, plausibly
/// does: nil, a tagged pointer of a registered class, or the aligned address
/// of readable memory whose first word, masked the way the runtime masks an
/// isa, is a class the runtime has registered. A `double`, a
/// `CGAffineTransform` or a table of callbacks read this way fails the test
/// instead of crashing in `objc_retain` (or in `object_getClass`, which traps
/// on a corrupt isa rather than answering).
fn holds_object(word: usize) -> bool {
    if word == 0 {
        return true;
    }
    #[cfg(target_arch = "aarch64")]
    let tagged = word >> 63 == 1;
    #[cfg(target_arch = "x86_64")]
    let tagged = word & 1 == 1;
    let class = if tagged {
        // SAFETY: for a tagged pointer `object_getClass` indexes the tag
        // table by the tag bits and dereferences nothing; an unused tag
        // answers Nil.
        unsafe { (rt().object_getClass)(word as Obj) as usize }
    } else {
        if !word.is_multiple_of(8) {
            return false;
        }
        let mut isa = 0usize;
        let mut got = 0u64;
        // SAFETY: reads our own address space through the kernel, which
        // answers an error for an unmapped or unreadable range; `isa` is 8
        // writable bytes.
        let readable = unsafe {
            mach_vm_read_overwrite(
                mach_task_self_,
                word as u64,
                8,
                (&raw mut isa) as u64,
                &raw mut got,
            ) == 0
                && got == 8
        };
        if !readable {
            return false;
        }
        static ISA_MASK: OnceLock<Option<usize>> = OnceLock::new();
        let mask = ISA_MASK.get_or_init(|| {
            // SAFETY: `objc_debug_isa_class_mask` is the `uintptr_t` libobjc
            // exports for debuggers to do exactly this with.
            rt().symbol(c"objc_debug_isa_class_mask")
                .map(|p| unsafe { p.cast::<usize>().read() })
        });
        match mask {
            Some(mask) => isa & mask,
            None => return false,
        }
    };
    class != 0 && is_registered_class(class)
}

thread_local! {
    /// Sorted addresses of every class the runtime had registered when last asked.
    static CLASSES: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}

/// Whether `address` is a registered class, re-reading the class list once
/// on a miss (an image loaded since may have added it).
fn is_registered_class(address: usize) -> bool {
    let known = |refresh: bool| {
        CLASSES.with_borrow_mut(|classes| {
            if refresh || classes.is_empty() {
                *classes = rt()
                    .class_list()
                    .into_iter()
                    .map(|c| c.as_obj() as usize)
                    .collect();
                classes.sort_unstable();
            }
            classes.binary_search(&address).is_ok()
        })
    };
    known(false) || known(true)
}

unsafe extern "C" {
    /// `<mach-o/getsect.h>`: the address and `size` of section `sectname` of
    /// segment `segname` in the loaded image whose Mach header is at `mhp`.
    fn getsectiondata(
        mhp: *const c_void,
        segname: *const core::ffi::c_char,
        sectname: *const core::ffi::c_char,
        size: *mut core::ffi::c_ulong,
    ) -> *mut u8;
}

/// Whether `symbol` lies in the machine code (`__TEXT,__text`) of the image
/// that defines it: it names a function rather than a variable.
fn is_function(symbol: NonNull<c_void>) -> bool {
    let mut info = core::mem::MaybeUninit::<libc::Dl_info>::uninit();
    // SAFETY: `dladdr` accepts any address and fills `info` when it returns
    // non-zero.
    let info = unsafe {
        if libc::dladdr(symbol.as_ptr(), info.as_mut_ptr()) == 0 {
            return false;
        }
        info.assume_init()
    };
    let mut size: core::ffi::c_ulong = 0;
    // SAFETY: `dli_fbase` is the Mach header of the loaded image containing
    // `symbol`; the names are NUL-terminated.
    let text = unsafe {
        getsectiondata(
            info.dli_fbase,
            c"__TEXT".as_ptr(),
            c"__text".as_ptr(),
            &raw mut size,
        )
    };
    let start = text as usize;
    !text.is_null() && (start..start + size as usize).contains(&(symbol.as_ptr() as usize))
}

#[cfg(test)]
mod tests {
    use super::super::cf::CF_TYPES;
    use super::{CG_RECT, CHAR, Enc, Family, NS_RANGE, Pointee, Scalar, StructType, named_structs};

    #[test]
    fn encodings() {
        assert_eq!(Enc::parse("@"), Enc::Object);
        assert_eq!(Enc::parse("@?"), Enc::Block);
        assert_eq!(Enc::parse("r*"), Enc::CString);
        assert_eq!(Enc::parse("*"), Enc::Buffer("*".into()));
        assert_eq!(Enc::parse("r^d"), Enc::Buffer("r^d".into()));
        let cf = |name: &str| CF_TYPES.iter().find(|t| t.name == name).unwrap();
        assert_eq!(Enc::parse("^{CGColor=}"), Enc::CFObject(cf("CGColor")));
        assert_eq!(Enc::parse("r^{CGPath=}"), Enc::CFObject(cf("CGPath")));
        assert_eq!(
            Enc::parse("^{__CFString=}"),
            Enc::CFObject(cf("__CFString"))
        );
        assert_eq!(cf("__CFString").bridged(), Some("NSString"));
        assert_eq!(cf("CGColor").bridged(), None);
        assert!(CF_TYPES.is_sorted_by_key(|t| t.name));
        assert_eq!(Enc::parse("^{CGPath=}").encoding(), "^{CGPath=}");
        assert_eq!(
            Enc::parse("^^{CGImage=}"),
            Enc::Out(Pointee::CFObject(cf("CGImage")))
        );
        assert_eq!(
            Enc::parse("^^{__CFError}"),
            Enc::Out(Pointee::CFObject(cf("__CFError")))
        );
        assert_eq!(Enc::parse("^^{__CFError}").encoding(), "^^{__CFError=}");
        assert_eq!(
            Enc::parse("r^^{__CFData}"),
            Enc::Out(Pointee::CFObject(cf("__CFData")))
        );
        assert_eq!(Enc::parse("^{_NSZone=}"), Enc::Pointer);
        assert_eq!(Enc::parse("^v"), Enc::Pointer);
        assert_eq!(Enc::parse("^^@"), Enc::Pointer);
        assert_eq!(Enc::parse("o^@"), Enc::Out(Pointee::Object));
        assert_eq!(Enc::parse("N^@"), Enc::Out(Pointee::InOutObject));
        assert_eq!(Enc::Out(Pointee::InOutObject).encoding(), "N^@");
        assert_eq!(Enc::parse("^B"), Enc::Out(Pointee::Bool));
        assert_eq!(
            Enc::parse("^{CGRect={CGPoint=dd}{CGSize=dd}}"),
            Enc::Out(Pointee::Struct(&CG_RECT))
        );
        assert!(matches!(
            Enc::parse("r^{CGRect={CGPoint=dd}{CGSize=dd}}"),
            Enc::Buffer(_)
        ));
        assert_eq!(Enc::Out(Pointee::F64).encoding(), "^d");
        assert_eq!(
            Enc::parse("Q"),
            Enc::Int {
                bits: 64,
                signed: false
            }
        );
        assert_eq!(
            Enc::parse("{CGRect={CGPoint=dd}{CGSize=dd}}"),
            Enc::Struct(&CG_RECT)
        );
        assert_eq!(Enc::parse("{_NSRange=QQ}"), Enc::Struct(&NS_RANGE));
        assert_eq!(Enc::parse("r{_NSRange=QQ}"), Enc::Struct(&NS_RANGE));
        assert!(matches!(Enc::parse("(?=iq)"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{?=b8b4}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{?=i^v}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{?=[4d]}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{CGColor}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{?=}"), Enc::Other(_)));
        assert!(matches!(Enc::parse("{?=dd"), Enc::Other(_)));
        // Larger than a Frame.
        assert!(matches!(
            Enc::parse("{big=dddddddddddddddddd}"),
            Enc::Other(_)
        ));
    }

    /// Offsets and sizes as clang lays the same structs out.
    #[test]
    fn struct_layout() {
        let layout = |encoding: &str| -> (Vec<usize>, usize, &'static str) {
            match Enc::parse(encoding) {
                Enc::Struct(t) => (t.fields.iter().map(|f| f.offset).collect(), t.size, t.name),
                other => panic!("{encoding} parsed as {other:?}"),
            }
        };
        assert_eq!(
            layout("{CGAffineTransform=dddddd}"),
            (vec![0, 8, 16, 24, 32, 40], 48, "CGAffineTransform")
        );
        assert_eq!(layout("{CATransform3D=dddddddddddddddd}").1, 128);
        // CMTime: { int64_t value; int32_t timescale; uint32_t flags; int64_t epoch; }
        assert_eq!(layout("{?=qiIq}"), (vec![0, 8, 12, 16], 24, "?"));
        // MTLRegion: two anonymous structs of three NSUIntegers.
        assert_eq!(
            layout("{?={?=QQQ}{?=QQQ}}"),
            (vec![0, 8, 16, 24, 32, 40], 48, "?")
        );
        // Trailing padding of an inner struct, then a byte, then tail padding.
        assert_eq!(layout("{outer={inner=dc}c}"), (vec![0, 8, 16], 24, "outer"));
        assert_eq!(layout("{s=cs}"), (vec![0, 2], 4, "s"));
        assert_eq!(layout("{b=fB}"), (vec![0, 4], 8, "b"));
        let Enc::Struct(cm_time) = Enc::parse("{?=qiIq}") else {
            unreachable!()
        };
        assert_eq!(
            cm_time.fields[2].scalar,
            Scalar::Int {
                bits: 32,
                signed: false
            }
        );
        assert_eq!(cm_time.field_names(), None);
        assert_eq!(
            CG_RECT.field_names(),
            Some(&["x", "y", "width", "height"][..])
        );
        let Enc::Struct(insets) = Enc::parse("{NSDirectionalEdgeInsets=dddd}") else {
            unreachable!()
        };
        assert_eq!(
            insets.field_names(),
            Some(&["top", "leading", "bottom", "trailing"][..])
        );
        // Interned: the same encoding is the same type.
        assert!(core::ptr::eq::<StructType>(cm_time, {
            let Enc::Struct(again) = Enc::parse("{?=qiIq}") else {
                unreachable!()
            };
            again
        }));
    }

    /// `partition_point` needs the selectors sorted the way `str` orders
    /// (`verify_sdk_tables`); these find known rows that way.
    #[test]
    fn sdk_tables_are_sorted() {
        let mut problems = Vec::new();
        super::verify_sdk_tables(&mut problems);
        assert!(problems.is_empty(), "{problems:?}");
        let table = super::sdk::VARIADIC;
        let at = table.partition_point(|(s, ..)| *s < "initWithObjects:");
        assert_eq!(table[at].0, "initWithObjects:");
        assert!(
            table[at..]
                .iter()
                .take_while(|(s, ..)| *s == "initWithObjects:")
                .count()
                > 1
        );
        let table = super::sdk::ARRAY_PARAMS;
        let at = table.partition_point(|(s, ..)| *s < "getObjects:range:");
        assert_eq!(
            table[at],
            (
                "getObjects:range:",
                c"NSArray",
                0,
                Some(super::Counted::Range(1))
            )
        );
        let table = super::sdk::BLOCK_PARAMS;
        let at = table.partition_point(|(s, ..)| *s < "enumerateObjectsUsingBlock:");
        let (sel, class, index, types) = table[at];
        assert_eq!(
            (sel, class, index),
            ("enumerateObjectsUsingBlock:", c"NSArray", 0)
        );
        // `BOOL *stop`: the table is written with `B` for BOOL on both architectures.
        assert_eq!(types, c"v@?@Q^B");
        let table = super::sdk::CHAR_SLOTS;
        let at = table.partition_point(|(s, ..)| *s < "charValue");
        assert_eq!(table[at], ("charValue", c"NSNumber", None));
        let table = super::sdk::FUNCTION_OWNERSHIP;
        let at = table.partition_point(|(n, ..)| *n < "NSCopyMapTableWithZone");
        assert_eq!(table[at], ("NSCopyMapTableWithZone", Some(true), &[][..]));
    }

    #[test]
    fn named_structs_get_their_equals() {
        assert_eq!(
            named_structs("C^{__CFURL=}^^{__CFError}"),
            "C^{__CFURL=}^^{__CFError=}"
        );
        assert_eq!(named_structs("v^^{}"), "v^^{}");
        assert_eq!(named_structs("{a={b}}(c)"), "{a={b=}}(c=)");
        assert_eq!(named_structs("{_NSRange=QQ}"), "{_NSRange=QQ}");
    }

    #[test]
    fn spellings() {
        let char = CHAR;
        assert_eq!(Enc::parse_written("c"), char);
        assert_eq!(Enc::parse_written("B"), Enc::Bool);
        assert_eq!(
            Enc::parse_written("^c"),
            Enc::Out(Pointee::Int {
                bits: 8,
                signed: true
            })
        );
        if cfg!(target_arch = "x86_64") {
            assert_eq!(Enc::parse("c"), Enc::Bool);
            assert_eq!(Enc::parse("^c"), Enc::Out(Pointee::Bool));
        } else {
            assert_eq!(Enc::parse("c"), char);
        }
        // A struct member `c` is a char everywhere.
        let Enc::Struct(t) = Enc::parse("{?=cc}") else {
            panic!("not a struct");
        };
        assert_eq!(
            t.fields[1].scalar,
            Scalar::Int {
                bits: 8,
                signed: true
            }
        );
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
        assert_eq!(Family::of("createCGImage:fromRect:"), Family::Create);
        assert_eq!(
            Family::of("CGImageForProposedRect:context:hints:"),
            Family::None
        );
    }
}
