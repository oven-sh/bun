//! The Objective-C runtime, loaded with `dlopen`, behind a safe typed API.
//!
//! This module and [`crate::run_loop`] are the only places in the crate that
//! contain `unsafe`. Everything AppKit-facing elsewhere goes through the
//! wrapper types generated here by [`objc_class!`] and [`objc_methods!`]:
//! each generated method is one `objc_msgSend` cast to the concrete C
//! signature written in the binding, so the compiler emits the right calling
//! convention on arm64 and x86_64 and there is no runtime signature parsing.
//! The soundness of a binding therefore rests on its declared signature
//! matching Apple's header. Debug builds keep a table of every compiled
//! binding with the Objective-C type encoding its Rust signature implies, and
//! [`verify_bindings`] compares that table against what the loaded frameworks
//! declare (`method_getTypeEncoding`), so a wrong integer width, a misspelt
//! selector or a struct passed by the wrong layout fails a test instead of
//! review.
//!
//! Only bindings that something calls are compiled; lines already transcribed
//! from the headers but not needed yet are kept as `//` comments in place, so
//! using one is a matter of uncommenting it.
//!
//! [`dynamic`] is the one place that types a send at run time: it reads the
//! types from `NSMethodSignature` and makes the call through libffi
//! ([`ffi`]), which is how scripts reach any selector or C function this
//! crate has no binding for; `NSInvocation` remains only as the fallback a
//! feature flag selects. [`script`] and [`block`] go the other way: the
//! methods of a script-defined class and the bodies of blocks are libffi
//! closures typed the same way.
//!
//! Nothing here is linked into `bun`: `otool -L` stays as it was.

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_void};
use core::marker::PhantomData;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, OnceLock};

use crate::error::{Error, Result};

pub(crate) mod appkit;
pub mod block;
// The tables scripts/appkit-generate.ts writes from the macOS SDK at build
// time (scripts/build/codegen.ts); `BUN_CODEGEN_DIR` comes from build.rs.
mod cf {
    include!(concat!(env!("BUN_CODEGEN_DIR"), "/appkit/cf.rs"));
}
mod define;
pub(crate) mod delegate;
pub mod dynamic;
mod ffi;
pub(crate) mod foundation;
pub mod handoff;
pub(crate) mod metal;
pub mod script;
mod sdk {
    include!(concat!(env!("BUN_CODEGEN_DIR"), "/appkit/sdk.rs"));
}

pub(crate) use define::Delegate;
use define::{ClassBuilder, DelegateClass, This};
pub(crate) use delegate::MetalViewEvents;
pub use dynamic::{DynClass, DynObject, DynValue};
pub use foundation::NsStr;

// ─────────────────────────────── raw types ─────────────────────────────────

/// A raw object pointer (`id`). Only this module traffics in these.
pub(crate) type Obj = *mut c_void;

/// `SEL`.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Sel(NonNull<c_void>);

/// `Class`.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Class(NonNull<c_void>);

// SAFETY: an immutable runtime handle.
unsafe impl Send for Class {}
// SAFETY: as above.
unsafe impl Sync for Class {}

/// `BOOL`: C `bool` on arm64, `signed char` on x86_64.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Bool(
    #[cfg(target_arch = "aarch64")] bool,
    #[cfg(not(target_arch = "aarch64"))] i8,
);

impl Bool {
    pub(crate) const YES: Bool = Bool::new(true);
    pub(crate) const NO: Bool = Bool::new(false);

    #[inline]
    pub(crate) const fn new(v: bool) -> Bool {
        #[cfg(target_arch = "aarch64")]
        return Bool(v);
        #[cfg(not(target_arch = "aarch64"))]
        return Bool(v as i8);
    }

    #[inline]
    pub(crate) const fn get(self) -> bool {
        #[cfg(target_arch = "aarch64")]
        return self.0;
        #[cfg(not(target_arch = "aarch64"))]
        return self.0 != 0;
    }
}

/// The Objective-C `@encode` string of a C type as it appears in a method
/// signature. Used to build the type string of IMPs this crate registers
/// ([`define`]) and the debug binding table.
///
/// # Safety
/// `ENCODING` describes exactly `Self`'s C layout.
pub(crate) unsafe trait Encode {
    const ENCODING: &'static str;
}
macro_rules! encode {
    ($($t:ty => $e:expr),* $(,)?) => {$(
        // SAFETY: the string is Apple's @encode for that C type.
        unsafe impl Encode for $t {
            const ENCODING: &'static str = $e;
        }
    )*};
}
encode! {
    // As an IMP parameter a raw pointer is always an object.
    Obj => "@",
    Sel => ":",
    Bool => if cfg!(target_arch = "aarch64") { "B" } else { "c" },
    i8 => "c", u8 => "C", i16 => "s", u16 => "S", i32 => "i", u32 => "I", i64 => "q", u64 => "Q",
    isize => "q", usize => "Q", f32 => "f", f64 => "d",
    () => "v",
    crate::geometry::Point => "{CGPoint=dd}",
    crate::geometry::Size => "{CGSize=dd}",
    crate::geometry::Rect => "{CGRect={CGPoint=dd}{CGSize=dd}}",
    crate::geometry::Range => "{_NSRange=QQ}",
    crate::geometry::ClearColor => "{MTLClearColor=dddd}",
    crate::geometry::Origin3 => "{MTLOrigin=QQQ}",
    crate::geometry::Size3 => "{MTLSize=QQQ}",
    crate::geometry::Region => "{MTLRegion={MTLOrigin=QQQ}{MTLSize=QQQ}}",
    crate::geometry::Viewport => "{MTLViewport=dddddd}",
    crate::geometry::ScissorRect => "{MTLScissorRect=QQQQ}",
}

/// Reduces a method type encoding to what decides the calling convention:
/// drops the frame offsets, argument qualifiers (`r` const, `n N o O R V`) and
/// struct/union names, so `{CGRect={CGPoint=dd}{CGSize=dd}}56@0:8` and
/// `{?={?=dd}{?=dd}}@:` compare equal.
fn normalize_encoding(encoding: &str) -> String {
    let mut out = String::with_capacity(encoding.len());
    let mut chars = encoding.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '0'..='9' | 'r' | 'n' | 'N' | 'o' | 'O' | 'R' | 'V' => {}
            '{' | '(' => {
                out.push(c);
                let close = if c == '{' { '}' } else { ')' };
                while let Some(&next) = chars.peek() {
                    if next == '=' {
                        chars.next();
                        break;
                    }
                    if next == close {
                        break;
                    }
                    chars.next();
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// Reduces a method type encoding further than [`normalize_encoding`] to
/// what decides how arguments are passed: every pointer-like type (`@`,
/// `@?`, `#`, `:`, `*`, `^…`) becomes `^`, so `v@:@` and `v@:@?` compare
/// equal while `v@:{CGRect={CGPoint=dd}{CGSize=dd}}` and `v@:@` do not;
/// and `c` is `B` where `BOOL` is a signed char (x86_64), so a script's
/// `B@:` matches what the runtime declares there.
fn calling_shape(encoding: &str) -> String {
    fn skip_type(chars: &mut core::iter::Peekable<core::str::Chars<'_>>) {
        match chars.next() {
            Some(open @ ('{' | '(' | '[')) => {
                let close = match open {
                    '{' => '}',
                    '(' => ')',
                    _ => ']',
                };
                let mut depth = 1usize;
                for c in chars.by_ref() {
                    if c == open {
                        depth += 1;
                    } else if c == close {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                }
            }
            Some('^') => skip_type(chars),
            Some('@') => {
                if chars.peek() == Some(&'?') {
                    chars.next();
                }
            }
            _ => {}
        }
    }
    let normalized = normalize_encoding(encoding);
    let mut out = String::with_capacity(normalized.len());
    let mut chars = normalized.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            '@' | '#' | ':' | '*' | '^' => {
                skip_type(&mut chars);
                out.push('^');
            }
            '{' | '(' | '[' => {
                let start = normalized.len() - chars.clone().count();
                skip_type(&mut chars);
                let end = normalized.len() - chars.clone().count();
                out.push_str(&normalized[start..end]);
            }
            'c' if cfg!(target_arch = "x86_64") => {
                chars.next();
                out.push('B');
            }
            _ => {
                chars.next();
                out.push(c);
            }
        }
    }
    out
}

#[cfg(test)]
mod shape_tests {
    use super::calling_shape;

    #[test]
    fn pointers_and_bool() {
        assert_eq!(calling_shape("v@:@"), calling_shape("v@:@?"));
        assert_ne!(
            calling_shape("v@:@"),
            calling_shape("v@:{CGRect={CGPoint=dd}{CGSize=dd}}")
        );
        assert_eq!(
            calling_shape("B@:@") == calling_shape("c@:@"),
            cfg!(target_arch = "x86_64")
        );
    }
}

// ───────────────────────────── owned references ─────────────────────────────

/// An owned (+1) reference to some Objective-C object. Dropping it sends
/// `release`; cloning retains.
#[repr(transparent)]
pub(crate) struct Id(NonNull<c_void>);

impl Id {
    #[inline]
    pub(crate) fn as_obj(&self) -> Obj {
        self.0.as_ptr()
    }

    /// Takes ownership of a +1 pointer (`alloc`, `copy`, `CF…Create…`).
    #[inline]
    unsafe fn from_retained(ptr: Obj) -> Option<Id> {
        NonNull::new(ptr).map(Id)
    }

    /// Retains a borrowed (+0) pointer such as an autoreleased return value.
    #[inline]
    unsafe fn retain(ptr: Obj) -> Option<Id> {
        let ptr = NonNull::new(ptr)?;
        // SAFETY: caller says `ptr` is a live object.
        unsafe { (rt().objc_retain)(ptr.as_ptr()) };
        Some(Id(ptr))
    }
}

impl Clone for Id {
    #[inline]
    fn clone(&self) -> Id {
        // SAFETY: `self` proves the object is alive.
        unsafe { (rt().objc_retain)(self.0.as_ptr()) };
        Id(self.0)
    }
}

impl Drop for Id {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: an `Id` always owns one reference to a live object.
        unsafe { (rt().objc_release)(self.0.as_ptr()) };
    }
}

impl PartialEq for Id {
    fn eq(&self, other: &Id) -> bool {
        self.0 == other.0
    }
}
impl Eq for Id {}

impl core::fmt::Debug for Id {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}({:p})", rt().class_name_of(self.as_obj()), self.0)
    }
}

/// Where a wrapper type's methods are declared: an Objective-C class, or a
/// protocol (`id<MTLDevice>`) whose concrete classes are private.
#[derive(Clone, Copy)]
pub(crate) enum Receiver {
    Class(&'static str),
    Protocol(&'static str),
}

/// Implemented by every wrapper type generated with [`objc_class!`] or
/// [`objc_protocol!`]: a `#[repr(transparent)]` newtype over [`Id`] that can be
/// retained, passed and returned.
///
/// # Safety
/// `Self` must be `#[repr(transparent)]` over `Id` (the macros guarantee it).
pub(crate) unsafe trait Object: Sized {
    /// What the bindings on this type are checked against.
    const RECEIVER: Receiver;

    /// # Safety
    /// `id` must be an instance of the class (or conform to the protocol)
    /// this wrapper's bindings are written against; nothing checks it.
    #[doc(hidden)]
    unsafe fn from_id(id: Id) -> Self;
    #[doc(hidden)]
    fn as_id(&self) -> &Id;

    #[doc(hidden)]
    #[inline]
    fn as_obj(&self) -> Obj {
        self.as_id().as_obj()
    }

    /// Whether the object is an instance of `T`'s class (`isKindOfClass:`).
    fn is_kind_of<T: ClassType>(&self) -> bool {
        // SAFETY: -[NSObject isKindOfClass:] on a live object.
        unsafe { rt().send::<Bool, _>(self.as_obj(), sel!("isKindOfClass:"), (T::class(),)) }.get()
    }

    /// Checked downcast.
    fn downcast<T: ClassType>(self) -> core::result::Result<T, Self> {
        if self.is_kind_of::<T>() {
            let me = core::mem::ManuallyDrop::new(self);
            // SAFETY: `isKindOfClass:` just said yes; ownership of the one
            // reference moves out of `me`.
            Ok(unsafe { T::from_id(ptr::read(me.as_id())) })
        } else {
            Err(self)
        }
    }
}

/// An [`Object`] wrapper that binds a real class, so it can be allocated,
/// subclassed and used as a downcast target. Protocol wrappers
/// ([`objc_protocol!`]) do not implement this: their instances only ever
/// arrive from a binding whose header names the protocol.
///
/// # Safety
/// `class()` is the class the type's bindings were transcribed from.
pub(crate) unsafe trait ClassType: Object {
    fn class() -> Class;
}

thread_local! {
    /// How many [`AutoreleasePool`] guards are live on this thread.
    static POOL_DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// `objc_autoreleasePoolPush` / `Pop` as a guard. Pools are a per-thread
/// stack; every guard is a `_pool` local, so drops are in order by
/// construction (debug builds check).
#[must_use = "the pool pops when the guard drops; bind it to a `_pool` local"]
pub(crate) struct AutoreleasePool {
    token: *mut c_void,
    depth: u32,
    _not_send: PhantomData<*mut ()>,
}

impl AutoreleasePool {
    /// Whether this guard is the newest live pool this crate pushed on the
    /// thread, i.e. dropping it now pops in order.
    #[inline]
    pub(crate) fn is_innermost(&self) -> bool {
        POOL_DEPTH.get() == self.depth + 1
    }

    /// Pools this crate currently holds open on the thread.
    #[inline]
    pub(crate) fn live_count() -> u32 {
        POOL_DEPTH.get()
    }

    #[inline]
    pub(crate) fn new() -> AutoreleasePool {
        let depth = POOL_DEPTH.get();
        POOL_DEPTH.set(depth + 1);
        // SAFETY: balanced by `Drop` on the same thread.
        let token = unsafe { (rt().objc_autoreleasePoolPush)() };
        AutoreleasePool {
            token,
            depth,
            _not_send: PhantomData,
        }
    }
}

impl Default for AutoreleasePool {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for AutoreleasePool {
    #[inline]
    fn drop(&mut self) {
        debug_assert!(
            self.is_innermost(),
            "AutoreleasePool dropped while a pool created after it is still live"
        );
        POOL_DEPTH.set(self.depth);
        // SAFETY: `token` came from the matching push on this thread; popping
        // it also pops any pool pushed after it.
        unsafe { (rt().objc_autoreleasePoolPop)(self.token) };
    }
}

// ─────────────────────────── argument marshalling ───────────────────────────

/// A Rust value that can be passed as an Objective-C argument. The value
/// stays alive until the send returns.
///
/// # Safety
/// `Raw` must be exactly the C type the method expects for this argument and
/// `ENCODING` its `@encode`.
pub(crate) unsafe trait Arg {
    type Raw;
    const ENCODING: &'static str;
    fn to_raw(&self) -> Self::Raw;
    /// Runs right after `objc_msgSend` returns, before anything else can.
    ///
    /// # Safety
    /// Called once, by [`Args::send`], straight after the send this value was
    /// marshalled for.
    #[inline]
    unsafe fn after_send(&self) {}
}

/// A Rust value produced from an Objective-C return value.
///
/// # Safety
/// `Raw` must be exactly the C return type of the method and `ENCODING` its
/// `@encode`.
pub(crate) unsafe trait Ret {
    type Raw;
    const ENCODING: &'static str;
    /// What the generated method returns. Differs from `Self` for object
    /// returns, where the binding's spelling (`T`, `Retained<T>`, …) names the
    /// ownership and nullability and the method yields `T` or `Option<T>`.
    type Out;
    /// `binding` names the method (`-[NSFont fontDescriptor]`) for the panic
    /// when a nonnull binding yields nil.
    ///
    /// # Safety
    /// `raw` was just returned by a message send with the declared type.
    unsafe fn from_raw(raw: Self::Raw, binding: &'static str) -> Self::Out;
}

macro_rules! plain_abi {
    ($($t:ty),* $(,)?) => {$(
        // SAFETY: passed and returned as themselves.
        unsafe impl Arg for $t {
            type Raw = $t;
            const ENCODING: &'static str = <$t as Encode>::ENCODING;
            #[inline] fn to_raw(&self) -> $t { *self }
        }
        // SAFETY: as above.
        unsafe impl Ret for $t {
            type Raw = $t;
            const ENCODING: &'static str = <$t as Encode>::ENCODING;
            type Out = $t;
            #[inline] unsafe fn from_raw(raw: $t, _: &'static str) -> $t { raw }
        }
    )*};
}
plain_abi!(i8, u8, i16, u16, i32, u32, i64, u64, isize, usize, f32, f64);
plain_abi!(
    crate::geometry::Point,
    crate::geometry::Size,
    crate::geometry::Rect,
    crate::geometry::Range,
    crate::geometry::ClearColor,
    crate::geometry::Origin3,
    crate::geometry::Size3,
    crate::geometry::Region,
    crate::geometry::Viewport,
    crate::geometry::ScissorRect,
);

/// Passes a fieldless `#[repr($raw)]` enum as its discriminant.
macro_rules! enum_abi {
    ($($raw:ty => [$($t:ty),* $(,)?]),* $(,)?) => {$($(
        // SAFETY: a fieldless repr($raw) enum is passed as its discriminant.
        unsafe impl Arg for $t {
            type Raw = $raw;
            const ENCODING: &'static str = <$raw as Encode>::ENCODING;
            #[inline] fn to_raw(&self) -> $raw { *self as $raw }
        }
    )*)*};
}
enum_abi!(
    isize => [
        appkit::Orientation,
    ],
    usize => [
        metal::PixelFormat,
        metal::PrimitiveType,
        metal::LoadAction,
        metal::StoreAction,
        metal::IndexType,
        metal::StorageMode,
        metal::CullMode,
        metal::Winding,
        metal::CompareFunction,
        metal::BlendFactor,
        metal::BlendOperation,
        metal::SamplerMinMagFilter,
        metal::SamplerMipFilter,
        metal::SamplerAddressMode,
        metal::VertexFormat,
        metal::VertexStepFunction,
    ],
);

/// Passes an `NS_OPTIONS` newtype over `usize` as its bits, and reads one back.
macro_rules! options_abi {
    ($($t:ty),* $(,)?) => {$(
        // SAFETY: repr(transparent) over NSUInteger.
        unsafe impl Arg for $t {
            type Raw = usize;
            const ENCODING: &'static str = <usize as Encode>::ENCODING;
            #[inline] fn to_raw(&self) -> usize { self.bits() }
        }
        // SAFETY: as above; every bit pattern is a valid value.
        unsafe impl Ret for $t {
            type Raw = usize;
            const ENCODING: &'static str = <usize as Encode>::ENCODING;
            type Out = $t;
            #[inline] unsafe fn from_raw(raw: usize, _: &'static str) -> $t { <$t>::from_bits(raw) }
        }
    )*};
}
options_abi!(
    metal::ResourceOptions,
    metal::TextureUsage,
    metal::ColorWriteMask
);

/// An `NSError **` (or any `T **`) out-parameter. Pass `&out` to the binding,
/// then [`take`](Out::take) the object the callee stored, if any. The object
/// is retained as part of the send, so the `Out` owns it from then on.
pub(crate) struct Out<T: Object> {
    slot: Cell<Obj>,
    _t: PhantomData<T>,
}

impl<T: Object> Out<T> {
    #[inline]
    pub(crate) fn new() -> Out<T> {
        Out {
            slot: Cell::new(ptr::null_mut()),
            _t: PhantomData,
        }
    }

    /// The object the callee wrote, if any.
    #[inline]
    pub(crate) fn take(self) -> Option<T> {
        // SAFETY: the slot is nil or the +1 reference `after_send` took, of
        // the out-parameter type the binding declared.
        unsafe { Id::from_retained(self.slot.replace(ptr::null_mut())).map(|id| T::from_id(id)) }
    }
}

impl<T: Object> Drop for Out<T> {
    fn drop(&mut self) {
        // SAFETY: as in `take`.
        drop(unsafe { Id::from_retained(self.slot.get()) });
    }
}

// SAFETY: `T **`; the slot lives as long as the borrow, which spans the call.
unsafe impl<T: Object> Arg for &Out<T> {
    type Raw = *mut Obj;
    const ENCODING: &'static str = "^@";
    #[inline]
    fn to_raw(&self) -> *mut Obj {
        // SAFETY: anything a previous send left here is a +1 reference of ours.
        drop(unsafe { Id::from_retained(self.slot.replace(ptr::null_mut())) });
        self.slot.as_ptr()
    }
    #[inline]
    unsafe fn after_send(&self) {
        let stored = self.slot.get();
        if !stored.is_null() {
            // SAFETY: the callee just stored a +0 (autoreleased) object; take
            // our own reference before any pool can drain.
            unsafe { (rt().objc_retain)(stored) };
        }
    }
}

// SAFETY: BOOL.
unsafe impl Arg for bool {
    type Raw = Bool;
    const ENCODING: &'static str = <Bool as Encode>::ENCODING;
    #[inline]
    fn to_raw(&self) -> Bool {
        Bool::new(*self)
    }
}
// SAFETY: BOOL.
unsafe impl Ret for bool {
    type Raw = Bool;
    const ENCODING: &'static str = <Bool as Encode>::ENCODING;
    type Out = bool;
    #[inline]
    unsafe fn from_raw(raw: Bool, _: &'static str) -> bool {
        raw.get()
    }
}
// SAFETY: void.
unsafe impl Ret for () {
    type Raw = ();
    const ENCODING: &'static str = <() as Encode>::ENCODING;
    type Out = ();
    #[inline]
    unsafe fn from_raw((): (), _: &'static str) {}
}
// SAFETY: Class.
unsafe impl Arg for Class {
    type Raw = *mut c_void;
    const ENCODING: &'static str = "#";
    #[inline]
    fn to_raw(&self) -> *mut c_void {
        self.0.as_ptr()
    }
}
// SAFETY: SEL.
unsafe impl Arg for Sel {
    type Raw = *mut c_void;
    const ENCODING: &'static str = <Sel as Encode>::ENCODING;
    #[inline]
    fn to_raw(&self) -> *mut c_void {
        self.0.as_ptr()
    }
}
// SAFETY: SEL or NULL.
unsafe impl Arg for Option<Sel> {
    type Raw = *mut c_void;
    const ENCODING: &'static str = <Sel as Encode>::ENCODING;
    #[inline]
    fn to_raw(&self) -> *mut c_void {
        self.map_or(ptr::null_mut(), |s| s.0.as_ptr())
    }
}
// SAFETY: SEL or NULL.
unsafe impl Ret for Option<Sel> {
    type Raw = *mut c_void;
    const ENCODING: &'static str = <Sel as Encode>::ENCODING;
    type Out = Option<Sel>;
    #[inline]
    unsafe fn from_raw(raw: *mut c_void, _: &'static str) -> Option<Sel> {
        NonNull::new(raw).map(Sel)
    }
}
// SAFETY: an object pointer, kept alive by the borrow for the call.
unsafe impl<T: Object> Arg for &T {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    #[inline]
    fn to_raw(&self) -> Obj {
        self.as_obj()
    }
}
// SAFETY: an object pointer or nil.
unsafe impl<T: Object> Arg for Option<&T> {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    #[inline]
    fn to_raw(&self) -> Obj {
        self.map_or(ptr::null_mut(), |o| o.as_obj())
    }
}
/// nil came back from a binding whose header says nonnull: a binding bug or
/// a broken framework, not something a caller can act on.
#[cold]
#[inline(never)]
pub(super) fn nil_from_nonnull(binding: &str, ownership: &str) -> ! {
    panic!("{binding} returned nil from a binding declared nonnull ({ownership})")
}

/// A borrowed (+0, usually autoreleased) object return the header declares
/// nonnull, retained into an owned wrapper. Bindings spell it `-> T`.
// SAFETY: id return.
unsafe impl<T: Object> Ret for T {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    type Out = T;
    #[inline]
    unsafe fn from_raw(raw: Obj, binding: &'static str) -> T {
        // SAFETY: a +0 object just returned to us on this thread, by a
        // binding whose declared return type is `T`.
        match unsafe { Id::retain(raw) } {
            // SAFETY: as above; the binding types the return as `T`.
            Some(id) => unsafe { T::from_id(id) },
            None => nil_from_nonnull(binding, "+0"),
        }
    }
}
/// A borrowed (+0) nullable object return. nil becomes `None`.
// SAFETY: id return.
unsafe impl<T: Object> Ret for Option<T> {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    type Out = Option<T>;
    #[inline]
    unsafe fn from_raw(raw: Obj, _: &'static str) -> Option<T> {
        // SAFETY: a +0 object just returned to us on this thread, typed by the binding.
        unsafe { Id::retain(raw).map(|id| T::from_id(id)) }
    }
}

/// Marks a return value the caller already owns (+1): `alloc`, `init…`,
/// `new`, `copy`, `mutableCopy`. `Retained<T>` is declared nonnull and the
/// method returns `T`; `Retained<Option<T>>` is nullable and returns
/// `Option<T>`.
pub(crate) struct Retained<T>(PhantomData<T>);

// SAFETY: id return at +1.
unsafe impl<T: Object> Ret for Retained<T> {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    type Out = T;
    #[inline]
    unsafe fn from_raw(raw: Obj, binding: &'static str) -> T {
        // SAFETY: ownership of one reference transfers to us, from a
        // binding whose declared return type is `T`.
        match unsafe { Id::from_retained(raw) } {
            // SAFETY: as above; the binding types the return as `T`.
            Some(id) => unsafe { T::from_id(id) },
            None => nil_from_nonnull(binding, "+1"),
        }
    }
}
// SAFETY: id return at +1, or nil.
unsafe impl<T: Object> Ret for Retained<Option<T>> {
    type Raw = Obj;
    const ENCODING: &'static str = "@";
    type Out = Option<T>;
    #[inline]
    unsafe fn from_raw(raw: Obj, _: &'static str) -> Option<T> {
        // SAFETY: ownership of one reference (if any) transfers to us, typed by the binding.
        unsafe { Id::from_retained(raw).map(|id| T::from_id(id)) }
    }
}

/// A `const char *` parameter (`signatureWithObjCTypes:`).
// SAFETY: passed as a pointer to a NUL-terminated string that outlives the call.
unsafe impl Arg for &CStr {
    type Raw = *const c_char;
    const ENCODING: &'static str = "*";
    #[inline]
    fn to_raw(&self) -> *const c_char {
        self.as_ptr()
    }
}

/// A raw pointer for the few C-pointer parameters and returns (`-bytes`,
/// `dataWithBytes:length:`). The field is private to this module, so typed
/// code elsewhere cannot make one; the bindings that take or return it are
/// private to the file that wraps them in a slice-checked method.
#[derive(Clone, Copy)]
pub(crate) struct Ptr(*const c_void);
// SAFETY: passed as a pointer.
unsafe impl Arg for Ptr {
    type Raw = *const c_void;
    const ENCODING: &'static str = "^v";
    #[inline]
    fn to_raw(&self) -> *const c_void {
        self.0
    }
}
/// A raw pointer return (`-bytes`).
// SAFETY: pointer return.
unsafe impl Ret for Ptr {
    type Raw = *const c_void;
    const ENCODING: &'static str = "^v";
    type Out = Ptr;
    #[inline]
    unsafe fn from_raw(raw: *const c_void, _: &'static str) -> Ptr {
        Ptr(raw)
    }
}

/// A `char *` return (`-methodReturnType`, `-UTF8String`): NUL-terminated
/// and owned by the receiver or the current autorelease pool, so it is copied
/// out at once. NULL becomes `None`.
pub(crate) struct CChars(pub(crate) Option<String>);
// SAFETY: `char *` return.
unsafe impl Ret for CChars {
    type Raw = *const c_char;
    const ENCODING: &'static str = "*";
    type Out = CChars;
    #[inline]
    unsafe fn from_raw(raw: *const c_char, _: &'static str) -> CChars {
        if raw.is_null() {
            return CChars(None);
        }
        // SAFETY: a non-NULL `char *` return is a NUL-terminated string that
        // lives at least until the current pool drains.
        CChars(Some(
            unsafe { CStr::from_ptr(raw) }
                .to_string_lossy()
                .into_owned(),
        ))
    }
}

/// Argument tuples. Implemented up to arity 12.
///
/// # Safety
/// See [`Runtime::send`].
pub(crate) unsafe trait Args {
    /// The `@encode` of each element, in order.
    const ENCODINGS: &'static [&'static str];
    /// # Safety
    /// See [`Runtime::send`].
    unsafe fn send<R>(imp: *const c_void, receiver: Obj, sel: Sel, args: Self) -> R;
}

macro_rules! impl_args {
    ($($name:ident),*) => {
        // SAFETY: the transmute target is a C function type whose parameters
        // are the receiver, the selector and each tuple field's `Raw` type.
        unsafe impl<$($name: Arg),*> Args for ($($name,)*) {
            const ENCODINGS: &'static [&'static str] = &[$(<$name as Arg>::ENCODING),*];
            #[inline(always)]
            #[allow(non_snake_case, clippy::unused_unit)]
            unsafe fn send<R>(imp: *const c_void, receiver: Obj, sel: Sel, args: Self) -> R {
                let ($($name,)*) = &args;
                let f: unsafe extern "C" fn(Obj, Sel $(, <$name as Arg>::Raw)*) -> R =
                    // SAFETY: `imp` is objc_msgSend (or _stret), which takes any
                    // signature; `Runtime::send`'s caller vouches for this one.
                    unsafe { core::mem::transmute::<*const c_void, _>(imp) };
                // SAFETY: as above.
                let r = unsafe { f(receiver, sel $(, $name.to_raw())*) };
                // SAFETY: straight after the send each value was marshalled for.
                $( unsafe { $name.after_send() }; )*
                r
            }
        }
    };
}
impl_args!();
impl_args!(A);
impl_args!(A, B);
impl_args!(A, B, C);
impl_args!(A, B, C, D);
impl_args!(A, B, C, D, E);
impl_args!(A, B, C, D, E, F);
impl_args!(A, B, C, D, E, F, G);
impl_args!(A, B, C, D, E, F, G, H);
impl_args!(A, B, C, D, E, F, G, H, I);
impl_args!(A, B, C, D, E, F, G, H, I, J);
impl_args!(A, B, C, D, E, F, G, H, I, J, K);
impl_args!(A, B, C, D, E, F, G, H, I, J, K, L);

// ──────────────────────────────── runtime ───────────────────────────────────

/// `struct objc_method_description`.
#[repr(C)]
struct MethodDescription {
    name: *mut c_void,
    types: *const c_char,
}

/// The loaded runtime. Lives for the rest of the process once created.
#[allow(non_snake_case)]
pub(crate) struct Runtime {
    objc_msgSend: *const c_void,
    #[cfg(target_arch = "x86_64")]
    objc_msgSend_stret: *const c_void,
    /// `objc_msgSendSuper2(struct objc_super *, SEL, ...)`: the method as
    /// the superclass of the class named in the struct implements it.
    objc_msgSendSuper2: *const c_void,
    #[cfg(target_arch = "x86_64")]
    objc_msgSendSuper2_stret: *const c_void,
    objc_retain: unsafe extern "C" fn(Obj) -> Obj,
    objc_release: unsafe extern "C" fn(Obj),
    objc_exception_throw: unsafe extern "C" fn(Obj),
    objc_autorelease: unsafe extern "C" fn(Obj) -> Obj,
    objc_autoreleasePoolPush: unsafe extern "C" fn() -> *mut c_void,
    objc_autoreleasePoolPop: unsafe extern "C" fn(*mut c_void),
    objc_getClass: unsafe extern "C" fn(*const c_char) -> Obj,
    objc_getProtocol: unsafe extern "C" fn(*const c_char) -> Obj,
    sel_registerName: unsafe extern "C" fn(*const c_char) -> Obj,
    sel_getName: unsafe extern "C" fn(Sel) -> *const c_char,
    objc_allocateClassPair: unsafe extern "C" fn(Obj, *const c_char, usize) -> Obj,
    objc_registerClassPair: unsafe extern "C" fn(Obj),
    objc_disposeClassPair: unsafe extern "C" fn(Obj),
    /// The IMP that enters the forwarding machinery (`forwardInvocation:`).
    _objc_msgForward: *const c_void,
    #[cfg(target_arch = "x86_64")]
    _objc_msgForward_stret: *const c_void,
    class_addMethod: unsafe extern "C" fn(Obj, Sel, *const c_void, *const c_char) -> Bool,
    class_addIvar: unsafe extern "C" fn(Obj, *const c_char, usize, u8, *const c_char) -> Bool,
    class_addProtocol: unsafe extern "C" fn(Obj, Obj) -> Bool,
    class_getInstanceVariable: unsafe extern "C" fn(Obj, *const c_char) -> *mut c_void,
    class_getInstanceMethod: unsafe extern "C" fn(Obj, Sel) -> *mut c_void,
    class_getClassMethod: unsafe extern "C" fn(Obj, Sel) -> *mut c_void,
    class_getMethodImplementation: unsafe extern "C" fn(Obj, Sel) -> *const c_void,
    imp_implementationWithBlock: unsafe extern "C" fn(*const c_void) -> *const c_void,
    class_getSuperclass: unsafe extern "C" fn(Obj) -> Obj,
    class_copyProtocolList: unsafe extern "C" fn(Obj, *mut u32) -> *mut Obj,
    class_getName: unsafe extern "C" fn(Obj) -> *const c_char,
    object_getClass: unsafe extern "C" fn(Obj) -> Obj,
    object_isClass: unsafe extern "C" fn(Obj) -> Bool,
    ivar_getOffset: unsafe extern "C" fn(*mut c_void) -> isize,
    method_getTypeEncoding: unsafe extern "C" fn(*mut c_void) -> *const c_char,
    method_getName: unsafe extern "C" fn(*mut c_void) -> Sel,
    class_copyMethodList: unsafe extern "C" fn(Obj, *mut u32) -> *mut *mut c_void,
    protocol_getMethodDescription: unsafe extern "C" fn(Obj, Sel, Bool, Bool) -> MethodDescription,
    protocol_copyMethodDescriptionList:
        unsafe extern "C" fn(Obj, Bool, Bool, *mut u32) -> *mut MethodDescription,
    objc_copyClassList: unsafe extern "C" fn(*mut u32) -> *mut Obj,
    objc_copyProtocolList: unsafe extern "C" fn(*mut u32) -> *mut Obj,
    protocol_getName: unsafe extern "C" fn(Obj) -> *const c_char,
    objc_allocateProtocol: unsafe extern "C" fn(*const c_char) -> Obj,
    objc_registerProtocol: unsafe extern "C" fn(Obj),
    protocol_addMethodDescription: unsafe extern "C" fn(Obj, Sel, *const c_char, Bool, Bool),
    protocol_addProtocol: unsafe extern "C" fn(Obj, Obj),
    objc_setAssociatedObject: unsafe extern "C" fn(Obj, *const c_void, Obj, usize),
    pub(crate) cf: CoreFoundation,
    /// The AppKit `dlopen` handle (which brings Foundation), for [`FrameworkGlobal`].
    frameworks: *mut c_void,
}

/// CoreFoundation entry points used by [`crate::run_loop`] and string
/// conversion.
#[allow(non_snake_case)]
pub(crate) struct CoreFoundation {
    pub CFRetain: unsafe extern "C" fn(*const c_void) -> *const c_void,
    pub CFRelease: unsafe extern "C" fn(*const c_void),
    pub CFGetTypeID: unsafe extern "C" fn(*const c_void) -> usize,
    pub CFStringCreateWithBytes:
        unsafe extern "C" fn(*const c_void, *const u8, isize, u32, Bool) -> Obj,
    pub CFStringCreateWithCharacters: unsafe extern "C" fn(*const c_void, *const u16, isize) -> Obj,
    pub CFStringGetLength: unsafe extern "C" fn(Obj) -> isize,
    pub CFStringGetCharactersPtr: unsafe extern "C" fn(Obj) -> *const u16,
    pub CFStringGetCharacters: unsafe extern "C" fn(Obj, CFRange, *mut u16),
    pub CFRunLoopGetMain: unsafe extern "C" fn() -> *mut c_void,
    pub CFRunLoopAddSource: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_void),
    pub CFFileDescriptorCreate: unsafe extern "C" fn(
        *const c_void,
        i32,
        Bool,
        unsafe extern "C" fn(*mut c_void, usize, *mut c_void),
        *const CFFileDescriptorContext,
    ) -> *mut c_void,
    pub CFFileDescriptorEnableCallBacks: unsafe extern "C" fn(*mut c_void, usize),
    pub CFFileDescriptorCreateRunLoopSource:
        unsafe extern "C" fn(*const c_void, *mut c_void, isize) -> *mut c_void,
    pub CFAbsoluteTimeGetCurrent: unsafe extern "C" fn() -> f64,
    pub CFRunLoopTimerCreate: unsafe extern "C" fn(
        *const c_void,
        f64,
        f64,
        usize,
        isize,
        CFRunLoopTimerCallBack,
        *const CFRunLoopTimerContext,
    ) -> *mut c_void,
    pub CFRunLoopTimerSetNextFireDate: unsafe extern "C" fn(*mut c_void, f64),
    pub CFRunLoopAddTimer: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_void),
    pub CFRunLoopObserverCreate: unsafe extern "C" fn(
        *const c_void,
        usize,
        Bool,
        isize,
        CFRunLoopObserverCallBack,
        *const c_void,
    ) -> *mut c_void,
    pub CFRunLoopAddObserver: unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_void),
}

pub(crate) type CFRunLoopTimerCallBack =
    unsafe extern "C" fn(timer: *mut c_void, info: *mut c_void);
pub(crate) type CFRunLoopObserverCallBack =
    unsafe extern "C" fn(observer: *mut c_void, activity: usize, info: *mut c_void);

/// `CFRunLoopTimerContext`; same layout as [`CFFileDescriptorContext`].
pub(crate) type CFRunLoopTimerContext = CFFileDescriptorContext;

#[repr(C)]
pub(crate) struct CFRange {
    pub location: isize,
    pub length: isize,
}

#[repr(C)]
pub(crate) struct CFFileDescriptorContext {
    pub version: isize,
    pub info: *mut c_void,
    pub retain: *const c_void,
    pub release: *const c_void,
    pub copy_description: *const c_void,
}

// SAFETY: function pointers and a never-closed dlopen handle, written once
// and only read afterwards; the runtime's own entry points are callable from
// any thread. Storage in a OnceLock needs these.
unsafe impl Send for Runtime {}
// SAFETY: as above.
unsafe impl Sync for Runtime {}

/// The `Err` is the raw cause: dlerror text, the library path, or `symbol <name>`.
static RUNTIME: OnceLock<core::result::Result<Runtime, String>> = OnceLock::new();

/// Whether this is the process main thread, which is the only thread AppKit's
/// windows, views, menus and application object may be used from.
#[inline]
pub(crate) fn is_main_thread() -> bool {
    // SAFETY: plain libc query with no preconditions.
    unsafe { libc::pthread_main_np() == 1 }
}

/// `Ok` on the process main thread, [`Error::WrongThread`] anywhere else:
/// the gate for the application, the Metal view and `gpu`.
#[inline]
pub(crate) fn main_thread() -> Result<()> {
    if is_main_thread() {
        Ok(())
    } else {
        Err(Error::WrongThread)
    }
}

/// Set once [`load`] has succeeded in this process. The terminate handler
/// (src/jsc/bindings/darwin/objc-uncaught-exception.cpp) reads it to tell an
/// Objective-C exception a script let escape through the bridge, which ends
/// the process like an uncaught JavaScript error, from one raised anywhere
/// else, which is a crash.
static BRIDGE_LOADED: AtomicBool = AtomicBool::new(false);

#[unsafe(no_mangle)]
extern "C" fn Bun__objcBridgeLoaded() -> bool {
    BRIDGE_LOADED.load(Ordering::Acquire)
}

/// Loads the frameworks on first call, once for the process, from any thread.
pub(crate) fn load() -> Result<&'static Runtime> {
    let rt = match RUNTIME.get_or_init(Runtime::open) {
        Ok(rt) => rt,
        Err(cause) => return Err(Error::Load(cause.clone())),
    };
    static MULTITHREADED: Once = Once::new();
    MULTITHREADED.call_once(enter_multithreaded_mode);
    static EXCEPTIONS: OnceLock<core::result::Result<(), String>> = OnceLock::new();
    if let Err(cause) = EXCEPTIONS.get_or_init(|| dynamic::probe_catch_frames(rt)) {
        return Err(Error::Load(cause.clone()));
    }
    BRIDGE_LOADED.store(true, Ordering::Release);
    Ok(rt)
}

/// Scripts run on POSIX threads Foundation did not start, and Cocoa only
/// takes its locks once some `NSThread` has been started
/// (`+[NSThread isMultiThreaded]`); so one that does nothing is, if none was.
fn enter_multithreaded_mode() {
    let _pool = AutoreleasePool::new();
    if !foundation::NSThread::is_multi_threaded() {
        foundation::NSThread::init(alloc::<foundation::NSThread>()).start();
    }
}

/// Classes kept to the main thread besides the ones the AppKit headers mark
/// ([`sdk::MAIN_THREAD_CLASSES`]): each builds or drives user interface
/// that AppKit only touches on the main thread, without saying so in its
/// declaration.
const MAIN_THREAD_CLASSES: [&CStr; 7] = [
    // The menu bar and its items are laid out and drawn by the main thread.
    c"NSMenu",
    c"NSMenuItem",
    // Creates status items, whose buttons are views.
    c"NSStatusBar",
    c"NSStatusItem",
    // Instantiating either builds windows and views.
    c"NSNib",
    c"NSStoryboard",
    // Draws into the Dock through a view.
    c"NSDockTile",
];

/// What any thread may ask any object: identity, class membership and
/// description, which read nothing AppKit keeps to the main thread.
const INTROSPECTION: [&str; 13] = [
    "class",
    "superclass",
    "self",
    "hash",
    "isEqual:",
    "isKindOfClass:",
    "isMemberOfClass:",
    "respondsToSelector:",
    "conformsToProtocol:",
    "isProxy",
    "className",
    "description",
    "debugDescription",
];

/// When the calling thread is not the main thread and `cls` is or inherits
/// a class AppKit keeps to the main thread (the headers' list plus
/// [`MAIN_THREAD_CLASSES`]): the [`Error::MainThreadOnly`] naming both,
/// unless `sel` is one of the [`INTROSPECTION`] selectors. Only the receiver
/// is looked at, never a message's arguments or result.
pub(crate) fn main_thread_only(cls: Class, sel: Option<&str>) -> Result<()> {
    if is_main_thread() || sel.is_some_and(|sel| INTROSPECTION.contains(&sel)) {
        return Ok(());
    }
    static CLASSES: OnceLock<Vec<Class>> = OnceLock::new();
    let classes = CLASSES.get_or_init(|| {
        sdk::MAIN_THREAD_CLASSES
            .iter()
            .chain(MAIN_THREAD_CLASSES.iter())
            .filter_map(|name| lookup_class(name))
            .collect()
    });
    let rt = rt();
    match rt.class_chain(cls).find(|c| classes.contains(c)) {
        None => Ok(()),
        Some(root) => Err(Error::MainThreadOnly {
            class: rt.class_name(cls),
            kind: (root != cls).then(|| rt.class_name(root)),
        }),
    }
}

/// The runtime, which must already be loaded. Wrapper objects can only exist
/// after a successful [`load`], so their methods use this.
#[inline]
pub(crate) fn rt() -> &'static Runtime {
    match RUNTIME.get() {
        Some(Ok(rt)) => rt,
        _ => unreachable!("Objective-C runtime used before objc::load()"),
    }
}

/// Metal and MetalKit, loaded on first use on top of [`Runtime`].
pub(crate) struct MetalRuntime {
    /// Never closed; kept so the intent (frameworks stay loaded) is explicit.
    _metal: *mut c_void,
    _metalkit: *mut c_void,
    create_system_default_device: unsafe extern "C" fn() -> Obj,
}

// SAFETY: a function pointer and never-closed dlopen handles, written once
// and only read afterwards (on the main thread: `metal()` enforces it).
unsafe impl Send for MetalRuntime {}
// SAFETY: as above.
unsafe impl Sync for MetalRuntime {}

static METAL: OnceLock<core::result::Result<MetalRuntime, String>> = OnceLock::new();

/// Loads Metal.framework and MetalKit.framework on first call (after AppKit).
/// Classes such as `MTKView` only resolve once this has succeeded. Main
/// thread only, like the view and `gpu` built on it.
pub(crate) fn metal() -> Result<&'static MetalRuntime> {
    main_thread()?;
    load()?;
    match METAL.get_or_init(MetalRuntime::open) {
        Ok(m) => Ok(m),
        Err(cause) => Err(Error::Load(cause.clone())),
    }
}

impl MetalRuntime {
    fn open() -> core::result::Result<MetalRuntime, String> {
        // SAFETY: dlopen/dlsym with constant NUL-terminated names; the one
        // symbol is assigned to a field typed as its C signature
        // (`id MTLCreateSystemDefaultDevice(void)`).
        unsafe {
            let open = |path: &CStr| -> core::result::Result<*mut c_void, String> {
                let h = libc::dlopen(path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL);
                if h.is_null() {
                    let err = libc::dlerror();
                    return Err(if err.is_null() {
                        path.to_string_lossy().into_owned()
                    } else {
                        CStr::from_ptr(err).to_string_lossy().into_owned()
                    });
                }
                Ok(h)
            };
            let metal = open(c"/System/Library/Frameworks/Metal.framework/Metal")?;
            let metalkit = open(c"/System/Library/Frameworks/MetalKit.framework/MetalKit")?;
            let sym = libc::dlsym(metal, c"MTLCreateSystemDefaultDevice".as_ptr());
            if sym.is_null() {
                return Err("symbol MTLCreateSystemDefaultDevice".into());
            }
            Ok(MetalRuntime {
                _metal: metal,
                _metalkit: metalkit,
                create_system_default_device: fn_from_symbol(sym),
            })
        }
    }
}

/// `MTLCreateSystemDefaultDevice()`. `None` when Metal cannot be loaded or
/// there is no device (a VM, a sandbox without GPU access).
pub(crate) fn system_default_device() -> Option<metal::MTLDevice> {
    let m = metal().ok()?;
    // SAFETY: no preconditions; the result is a +1 (`NS_RETURNS_RETAINED`)
    // `id<MTLDevice>` or nil.
    unsafe { Id::from_retained((m.create_system_default_device)()).map(|id| Object::from_id(id)) }
}

/// Reinterprets a `dlsym` result as the function pointer type `F`.
///
/// # Safety
/// `F` is the symbol's C signature.
unsafe fn fn_from_symbol<F: Copy>(symbol: *mut c_void) -> F {
    const { assert!(core::mem::size_of::<F>() == core::mem::size_of::<*mut c_void>()) };
    // SAFETY: per contract; a function pointer is pointer-sized.
    unsafe { core::mem::transmute_copy::<*mut c_void, F>(&symbol) }
}

impl Runtime {
    fn open() -> core::result::Result<Runtime, String> {
        // SAFETY: dlopen/dlsym with constant NUL-terminated names; handles are
        // never closed. Each symbol is assigned to a field whose type is its C
        // signature per Apple's headers.
        unsafe {
            let open = |path: &CStr| -> core::result::Result<*mut c_void, String> {
                let h = libc::dlopen(path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL);
                if h.is_null() {
                    let err = libc::dlerror();
                    let msg = if err.is_null() {
                        path.to_string_lossy().into_owned()
                    } else {
                        CStr::from_ptr(err).to_string_lossy().into_owned()
                    };
                    return Err(msg);
                }
                Ok(h)
            };
            let objc = open(c"/usr/lib/libobjc.A.dylib")?;
            // AppKit brings Foundation, CoreFoundation and CoreGraphics; dlsym on
            // this handle searches those dependencies too.
            let appkit = open(c"/System/Library/Frameworks/AppKit.framework/AppKit")?;

            let addr =
                |handle: *mut c_void, name: &CStr| -> core::result::Result<*mut c_void, String> {
                    let p = libc::dlsym(handle, name.as_ptr());
                    if p.is_null() {
                        return Err(format!("symbol {}", name.to_string_lossy()));
                    }
                    Ok(p)
                };
            macro_rules! sym {
                ($handle:expr, $name:literal) => {
                    fn_from_symbol(addr($handle, $name)?)
                };
            }

            Ok(Runtime {
                objc_msgSend: addr(objc, c"objc_msgSend")?.cast_const(),
                #[cfg(target_arch = "x86_64")]
                objc_msgSend_stret: addr(objc, c"objc_msgSend_stret")?.cast_const(),
                objc_msgSendSuper2: addr(objc, c"objc_msgSendSuper2")?.cast_const(),
                #[cfg(target_arch = "x86_64")]
                objc_msgSendSuper2_stret: addr(objc, c"objc_msgSendSuper2_stret")?.cast_const(),
                objc_retain: sym!(objc, c"objc_retain"),
                objc_release: sym!(objc, c"objc_release"),
                objc_exception_throw: sym!(objc, c"objc_exception_throw"),
                objc_autorelease: sym!(objc, c"objc_autorelease"),
                objc_autoreleasePoolPush: sym!(objc, c"objc_autoreleasePoolPush"),
                objc_autoreleasePoolPop: sym!(objc, c"objc_autoreleasePoolPop"),
                objc_getClass: sym!(objc, c"objc_getClass"),
                objc_getProtocol: sym!(objc, c"objc_getProtocol"),
                sel_registerName: sym!(objc, c"sel_registerName"),
                sel_getName: sym!(objc, c"sel_getName"),
                objc_allocateClassPair: sym!(objc, c"objc_allocateClassPair"),
                objc_registerClassPair: sym!(objc, c"objc_registerClassPair"),
                objc_disposeClassPair: sym!(objc, c"objc_disposeClassPair"),
                _objc_msgForward: addr(objc, c"_objc_msgForward")?.cast_const(),
                #[cfg(target_arch = "x86_64")]
                _objc_msgForward_stret: addr(objc, c"_objc_msgForward_stret")?.cast_const(),
                class_addMethod: sym!(objc, c"class_addMethod"),
                class_addIvar: sym!(objc, c"class_addIvar"),
                class_addProtocol: sym!(objc, c"class_addProtocol"),
                class_getInstanceVariable: sym!(objc, c"class_getInstanceVariable"),
                class_getInstanceMethod: sym!(objc, c"class_getInstanceMethod"),
                class_getClassMethod: sym!(objc, c"class_getClassMethod"),
                class_getMethodImplementation: sym!(objc, c"class_getMethodImplementation"),
                imp_implementationWithBlock: sym!(objc, c"imp_implementationWithBlock"),
                class_getSuperclass: sym!(objc, c"class_getSuperclass"),
                class_copyProtocolList: sym!(objc, c"class_copyProtocolList"),
                class_getName: sym!(objc, c"class_getName"),
                object_getClass: sym!(objc, c"object_getClass"),
                object_isClass: sym!(objc, c"object_isClass"),
                ivar_getOffset: sym!(objc, c"ivar_getOffset"),
                method_getTypeEncoding: sym!(objc, c"method_getTypeEncoding"),
                method_getName: sym!(objc, c"method_getName"),
                class_copyMethodList: sym!(objc, c"class_copyMethodList"),
                protocol_getMethodDescription: sym!(objc, c"protocol_getMethodDescription"),
                protocol_copyMethodDescriptionList: sym!(
                    objc,
                    c"protocol_copyMethodDescriptionList"
                ),
                objc_copyClassList: sym!(objc, c"objc_copyClassList"),
                objc_copyProtocolList: sym!(objc, c"objc_copyProtocolList"),
                protocol_getName: sym!(objc, c"protocol_getName"),
                objc_allocateProtocol: sym!(objc, c"objc_allocateProtocol"),
                objc_registerProtocol: sym!(objc, c"objc_registerProtocol"),
                protocol_addMethodDescription: sym!(objc, c"protocol_addMethodDescription"),
                protocol_addProtocol: sym!(objc, c"protocol_addProtocol"),
                objc_setAssociatedObject: sym!(objc, c"objc_setAssociatedObject"),
                cf: CoreFoundation {
                    CFRetain: sym!(appkit, c"CFRetain"),
                    CFRelease: sym!(appkit, c"CFRelease"),
                    CFGetTypeID: sym!(appkit, c"CFGetTypeID"),
                    CFStringCreateWithBytes: sym!(appkit, c"CFStringCreateWithBytes"),
                    CFStringCreateWithCharacters: sym!(appkit, c"CFStringCreateWithCharacters"),
                    CFStringGetLength: sym!(appkit, c"CFStringGetLength"),
                    CFStringGetCharactersPtr: sym!(appkit, c"CFStringGetCharactersPtr"),
                    CFStringGetCharacters: sym!(appkit, c"CFStringGetCharacters"),
                    CFRunLoopGetMain: sym!(appkit, c"CFRunLoopGetMain"),
                    CFRunLoopAddSource: sym!(appkit, c"CFRunLoopAddSource"),
                    CFFileDescriptorCreate: sym!(appkit, c"CFFileDescriptorCreate"),
                    CFFileDescriptorEnableCallBacks: sym!(
                        appkit,
                        c"CFFileDescriptorEnableCallBacks"
                    ),
                    CFFileDescriptorCreateRunLoopSource: sym!(
                        appkit,
                        c"CFFileDescriptorCreateRunLoopSource"
                    ),
                    CFAbsoluteTimeGetCurrent: sym!(appkit, c"CFAbsoluteTimeGetCurrent"),
                    CFRunLoopTimerCreate: sym!(appkit, c"CFRunLoopTimerCreate"),
                    CFRunLoopTimerSetNextFireDate: sym!(appkit, c"CFRunLoopTimerSetNextFireDate"),
                    CFRunLoopAddTimer: sym!(appkit, c"CFRunLoopAddTimer"),
                    CFRunLoopObserverCreate: sym!(appkit, c"CFRunLoopObserverCreate"),
                    CFRunLoopAddObserver: sym!(appkit, c"CFRunLoopAddObserver"),
                },
                frameworks: appkit,
            })
        }
    }

    /// `objc_msgSend`, typed by the caller.
    ///
    /// # Safety
    /// `R` and the `Raw` types of `A` must match the method's C signature, and
    /// `receiver` must be nil or a live object (or class) responding to `sel`.
    #[inline(always)]
    pub(crate) unsafe fn send<R, A: Args>(&self, receiver: Obj, sel: Sel, args: A) -> R {
        #[cfg(target_arch = "x86_64")]
        if core::mem::size_of::<R>() > 16 {
            // SAFETY: caller contract; large aggregates return via the hidden
            // pointer objc_msgSend_stret expects on x86_64.
            return unsafe { A::send::<R>(self.objc_msgSend_stret, receiver, sel, args) };
        }
        // SAFETY: caller contract.
        unsafe { A::send::<R>(self.objc_msgSend, receiver, sel, args) }
    }

    fn class_name_of(&self, obj: Obj) -> String {
        if obj.is_null() {
            return "nil".into();
        }
        // SAFETY: obj is live, so it has a class.
        self.class_name(unsafe { self.class_of_raw(obj) })
    }

    fn class_name(&self, cls: Class) -> String {
        // SAFETY: a registered class; class_getName returns a static C string.
        unsafe { CStr::from_ptr((self.class_getName)(cls.as_obj())) }
            .to_string_lossy()
            .into_owned()
    }

    fn sel_name(&self, sel: Sel) -> String {
        // SAFETY: a registered selector; the name is a static C string.
        unsafe { CStr::from_ptr((self.sel_getName)(sel)) }
            .to_string_lossy()
            .into_owned()
    }

    /// The `Protocol` object for `name`: the one a loaded framework
    /// registered, else one registered here from [`sdk::PROTOCOLS`] (with
    /// the protocols it incorporates), which has every protocol the bridged
    /// frameworks' headers declare: a framework registers only the ones its
    /// own code names, and which those are varies by macOS version.
    fn protocol(&self, name: &CStr) -> Option<NonNull<c_void>> {
        // SAFETY: NUL-terminated name.
        if let Some(p) = NonNull::new(unsafe { (self.objc_getProtocol)(name.as_ptr()) }) {
            return Some(p);
        }
        let at = sdk::PROTOCOLS.binary_search_by(|p| p.name.cmp(name)).ok()?;
        let described = &sdk::PROTOCOLS[at];
        // SAFETY: a fresh protocol under construction until registered; the
        // names, selectors and type strings are static; an incorporated
        // protocol is registered (by a framework or, recursively, here)
        // before it is added.
        unsafe {
            let p = NonNull::new((self.objc_allocateProtocol)(name.as_ptr()))?;
            for adopted in described.adopts {
                if let Some(a) = self.protocol(adopted) {
                    (self.protocol_addProtocol)(p.as_ptr(), a.as_ptr());
                }
            }
            for &(sel, types, required, instance) in described.methods {
                (self.protocol_addMethodDescription)(
                    p.as_ptr(),
                    register_sel(sel),
                    types.as_ptr(),
                    Bool::new(required),
                    Bool::new(instance),
                );
            }
            (self.objc_registerProtocol)(p.as_ptr());
            Some(p)
        }
    }

    /// The type encoding `protocol` declares for instance method `sel`
    /// (required or optional), searching the protocols it adopts too.
    fn protocol_method_types(&self, protocol: NonNull<c_void>, sel: Sel) -> Option<String> {
        [Bool::YES, Bool::NO].into_iter().find_map(|required| {
            // SAFETY: a live Protocol and a registered selector.
            let d = unsafe {
                (self.protocol_getMethodDescription)(protocol.as_ptr(), sel, required, Bool::YES)
            };
            (!d.types.is_null()).then(|| {
                // SAFETY: a non-NULL `types` is a static C string in the image.
                unsafe { CStr::from_ptr(d.types) }
                    .to_string_lossy()
                    .into_owned()
            })
        })
    }

    /// Every protocol any loaded image registers that declares instance
    /// method `sel`, as (protocol name, type encoding).
    fn protocols_declaring(&self, sel: Sel) -> Vec<(String, String)> {
        let mut count: u32 = 0;
        // SAFETY: the result is NULL or a malloc'd array of `count` live
        // Protocol objects, ours to free; their names are static C strings.
        unsafe {
            let list = (self.objc_copyProtocolList)(&raw mut count);
            if list.is_null() {
                return Vec::new();
            }
            let found = core::slice::from_raw_parts(list, count as usize)
                .iter()
                .filter_map(|&p| {
                    let types = self.protocol_method_types(NonNull::new(p)?, sel)?;
                    let name = CStr::from_ptr((self.protocol_getName)(p))
                        .to_string_lossy()
                        .into_owned();
                    Some((name, types))
                })
                .collect();
            libc::free(list.cast());
            found
        }
    }

    /// What a protocol `cls` or a class up its chain adopts declares for
    /// instance method `sel` (protocols those incorporate included), as
    /// (protocol name, type encoding): the nearest class's first.
    fn class_protocol_method_types(&self, cls: Class, sel: Sel) -> Option<(String, String)> {
        self.class_chain(cls).find_map(|c| {
            let mut count: u32 = 0;
            // SAFETY: a registered class; the result is NULL or a malloc'd
            // array of `count` live Protocol objects, ours to free; their
            // names are static C strings.
            unsafe {
                let list = (self.class_copyProtocolList)(c.as_obj(), &raw mut count);
                if list.is_null() {
                    return None;
                }
                let found = core::slice::from_raw_parts(list, count as usize)
                    .iter()
                    .find_map(|&p| {
                        let types = self.protocol_method_types(NonNull::new(p)?, sel)?;
                        let name = CStr::from_ptr((self.protocol_getName)(p))
                            .to_string_lossy()
                            .into_owned();
                        Some((name, types))
                    });
                libc::free(list.cast());
                found
            }
        })
    }

    /// The instance methods `protocol` itself marks `@required`.
    fn protocol_required_methods(&self, protocol: NonNull<c_void>) -> Vec<Sel> {
        let mut count: u32 = 0;
        // SAFETY: a live Protocol; the result is NULL or a malloc'd array of
        // `count` descriptions whose `name` is a registered selector, ours to free.
        unsafe {
            let list = (self.protocol_copyMethodDescriptionList)(
                protocol.as_ptr(),
                Bool::YES,
                Bool::YES,
                &raw mut count,
            );
            if list.is_null() {
                return Vec::new();
            }
            let sels = core::slice::from_raw_parts(list, count as usize)
                .iter()
                .filter_map(|d| NonNull::new(d.name).map(Sel))
                .collect();
            libc::free(list.cast());
            sels
        }
    }

    /// Makes `owner` hold a reference to `value` under `key` until it is
    /// given another value (or nil) for that key or deallocates.
    ///
    /// # Safety
    /// `owner` is a live object and `value` is nil or a live object.
    unsafe fn associate_retained(&self, owner: Obj, key: *const c_void, value: Obj) {
        const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;
        // SAFETY: per contract.
        unsafe {
            (self.objc_setAssociatedObject)(owner, key, value, OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }

    /// Every class registered with the runtime right now, without messaging
    /// any of them.
    fn class_list(&self) -> Vec<Class> {
        // SAFETY: `objc_copyClassList` returns NULL or a malloc'd array of
        // `count` classes that we free after copying.
        unsafe {
            let mut count = 0u32;
            let list = (self.objc_copyClassList)(&raw mut count);
            if list.is_null() {
                return Vec::new();
            }
            let out = (0..count as usize)
                .filter_map(|i| NonNull::new(*list.add(i)).map(Class))
                .collect();
            libc::free(list.cast());
            out
        }
    }

    /// Whether `cls` is `ancestor` or has it up its superclass chain, read
    /// from the runtime rather than asked with `isKindOfClass:` (a proxy
    /// would forward that question to whatever it stands for).
    fn class_inherits(&self, cls: Class, ancestor: Class) -> bool {
        self.class_chain(cls).any(|c| c == ancestor)
    }

    /// `cls`'s superclass; `None` for a root class.
    fn superclass(&self, cls: Class) -> Option<Class> {
        // SAFETY: class_getSuperclass on a registered class; Nil ends the chain.
        NonNull::new(unsafe { (self.class_getSuperclass)(cls.as_obj()) }).map(Class)
    }

    /// `cls`, its superclass, and so on up to the root.
    fn class_chain(&self, cls: Class) -> impl Iterator<Item = Class> + '_ {
        core::iter::successors(Some(cls), |c| self.superclass(*c))
    }

    /// The IMP a message `sel` to an instance of `cls` would run (the
    /// forwarding trampoline when nothing implements it).
    fn method_implementation(&self, cls: Class, sel: Sel) -> *const c_void {
        // SAFETY: a registered class and selector.
        unsafe { (self.class_getMethodImplementation)(cls.as_obj(), sel) }
    }

    /// The class of the object at `obj` (the metaclass, for a class object).
    ///
    /// # Safety
    /// `obj` points at an object that has not finished deallocating.
    pub(super) unsafe fn class_of_raw(&self, obj: Obj) -> Class {
        // SAFETY: per contract; such an object always has a class.
        match NonNull::new(unsafe { (self.object_getClass)(obj) }) {
            Some(c) => Class(c),
            None => unreachable!("object without a class"),
        }
    }

    /// The class of `obj` (the metaclass, for a class object).
    fn class_of(&self, obj: &Id) -> Class {
        // SAFETY: an `Id` is a live object.
        unsafe { self.class_of_raw(obj.as_obj()) }
    }

    /// The exported global `name`: first in AppKit and what it links
    /// (Foundation, CoreFoundation, CoreGraphics, QuartzCore, …), so those
    /// win over a same-named symbol elsewhere, then in any image the process
    /// has loaded (a framework brought in with `NSBundle`, say).
    fn symbol(&self, name: &CStr) -> Option<NonNull<c_void>> {
        // SAFETY: dlsym on the never-closed AppKit handle, then the global
        // scope, with a NUL-terminated name.
        NonNull::new(unsafe { libc::dlsym(self.frameworks, name.as_ptr()) })
            .or_else(|| NonNull::new(unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) }))
    }

    /// The names of the methods `cls` itself implements (not its superclasses).
    fn method_names(&self, cls: Class) -> Vec<String> {
        let mut count: u32 = 0;
        // SAFETY: a registered class; the result is NULL or a malloc'd array
        // of `count` Methods, ours to free, each with a registered selector.
        unsafe {
            let list = (self.class_copyMethodList)(cls.as_obj(), &raw mut count);
            if list.is_null() {
                return Vec::new();
            }
            let names = core::slice::from_raw_parts(list, count as usize)
                .iter()
                .map(|m| self.sel_name((self.method_getName)(*m)))
                .collect();
            libc::free(list.cast());
            names
        }
    }

    /// The type encoding of `sel` as implemented by `cls` or a superclass
    /// (`class_method` picks `+` over `-`).
    fn class_method_types(&self, cls: Class, sel: Sel, class_method: bool) -> Option<String> {
        // SAFETY: a live class and a registered selector.
        let m = unsafe {
            if class_method {
                (self.class_getClassMethod)(cls.as_obj(), sel)
            } else {
                (self.class_getInstanceMethod)(cls.as_obj(), sel)
            }
        };
        if m.is_null() {
            return None;
        }
        // SAFETY: `m` is a Method. Its encoding is NULL (registered without
        // one) or a C string that lives as long as the class does.
        let types = unsafe { (self.method_getTypeEncoding)(m) };
        if types.is_null() {
            return Some(String::new());
        }
        // SAFETY: non-NULL, see above.
        Some(
            unsafe { CStr::from_ptr(types) }
                .to_string_lossy()
                .into_owned(),
        )
    }
}

// ─────────────────────────── cached lookups ────────────────────────────────

/// A selector registered on first use. Backs the [`sel!`] macro.
pub(crate) struct CachedSel {
    name: &'static CStr,
    sel: OnceLock<Sel>,
}

// SAFETY: Sel is an immutable runtime handle.
unsafe impl Sync for CachedSel {}

impl CachedSel {
    pub(crate) const fn new(name: &'static CStr) -> CachedSel {
        CachedSel {
            name,
            sel: OnceLock::new(),
        }
    }

    #[inline]
    pub(crate) fn get(&'static self) -> Sel {
        *self.sel.get_or_init(|| register_sel(self.name))
    }
}

fn register_sel(name: &CStr) -> Sel {
    // SAFETY: NUL-terminated; sel_registerName never returns NULL.
    let p = unsafe { (rt().sel_registerName)(name.as_ptr()) };
    Sel(NonNull::new(p).expect("sel_registerName"))
}

pub(crate) fn lookup_class(name: &CStr) -> Option<Class> {
    // SAFETY: NUL-terminated name.
    NonNull::new(unsafe { (rt().objc_getClass)(name.as_ptr()) }).map(Class)
}

/// A class looked up on first use. Backs [`objc_class!`].
pub(crate) struct CachedClass {
    name: &'static CStr,
    class: OnceLock<Option<Class>>,
}

// SAFETY: Class is an immutable runtime handle.
unsafe impl Sync for CachedClass {}

impl CachedClass {
    pub(crate) const fn new(name: &'static CStr) -> CachedClass {
        CachedClass {
            name,
            class: OnceLock::new(),
        }
    }

    /// Panics if the class does not exist in the loaded frameworks, which is a
    /// binding bug (every bound class ships with macOS 11+) that
    /// [`verify_bindings`] reports.
    #[inline]
    pub(crate) fn get(&'static self) -> Class {
        self.try_get().unwrap_or_else(|| {
            panic!(
                "Objective-C class {} not found",
                self.name.to_string_lossy()
            )
        })
    }

    pub(crate) fn try_get(&'static self) -> Option<Class> {
        *self.class.get_or_init(|| lookup_class(self.name))
    }
}

/// An object a framework exports as a global (`NSString *const NSFoo`),
/// resolved and retained on first use. Backs [`objc_global!`].
pub(crate) struct FrameworkGlobal<T> {
    name: &'static CStr,
    value: OnceLock<Id>,
    _t: PhantomData<fn() -> T>,
}

// SAFETY: Id of an immortal constant, written once; retaining it again from
// any thread is all `get` does with it.
unsafe impl<T> Sync for FrameworkGlobal<T> {}

impl<T: Object> FrameworkGlobal<T> {
    pub(crate) const fn new(name: &'static CStr) -> FrameworkGlobal<T> {
        FrameworkGlobal {
            name,
            value: OnceLock::new(),
            _t: PhantomData,
        }
    }

    /// Panics if the symbol is missing, which like a missing class is a
    /// binding bug.
    #[inline]
    pub(crate) fn get(&'static self) -> T {
        let id = self.value.get_or_init(|| {
            let p = rt()
                .symbol(self.name)
                .unwrap_or_else(|| panic!("{} not found", self.name.to_string_lossy()));
            // SAFETY: the symbol is a `T *const` variable, so read one pointer
            // through it and retain the object it names.
            unsafe {
                Id::retain(*p.as_ptr().cast::<Obj>())
                    .unwrap_or_else(|| panic!("{} is nil", self.name.to_string_lossy()))
            }
        });
        // SAFETY: the `objc_global!` line declares the constant's type.
        unsafe { T::from_id(id.clone()) }
    }
}

/// `objc_global!(pub(crate) fn name() -> NSString = "NSSymbolName");` → a
/// function returning that framework constant, via a [`FrameworkGlobal`].
macro_rules! objc_global {
    ($(#[$meta:meta])* $vis:vis fn $name:ident() -> $t:ty = $sym:literal) => {
        $(#[$meta])*
        #[inline]
        $vis fn $name() -> $t {
            static G: $crate::objc::FrameworkGlobal<$t> = $crate::objc::FrameworkGlobal::new(
                match ::core::ffi::CStr::from_bytes_with_nul(concat!($sym, "\0").as_bytes()) {
                    Ok(s) => s,
                    Err(_) => panic!("NUL inside symbol name"),
                },
            );
            G.get()
        }
    };
}
pub(crate) use objc_global;

/// `sel!("setTitle:")` → a cached [`Sel`].
macro_rules! sel {
    ($name:literal) => {{
        static SEL: $crate::objc::CachedSel = $crate::objc::CachedSel::new(
            match ::core::ffi::CStr::from_bytes_with_nul(concat!($name, "\0").as_bytes()) {
                Ok(s) => s,
                Err(_) => panic!("NUL inside selector name"),
            },
        );
        SEL.get()
    }};
}
pub(crate) use sel;

// ─────────────────────────── the binding table ──────────────────────────────

/// One compiled line of [`objc_methods!`]: where the selector should be
/// declared and the encoding the Rust signature implies (return type first,
/// then `self` and `_cmd`, then the arguments, as `method_getTypeEncoding`
/// spells it).
pub(crate) struct Binding {
    pub(crate) receiver: Receiver,
    pub(crate) selector: &'static str,
    pub(crate) class_method: bool,
    pub(crate) ret: &'static str,
    pub(crate) args: &'static [&'static str],
}

impl Binding {
    fn encoding(&self) -> String {
        let mut s = String::from(self.ret);
        s.push_str("@:");
        for a in self.args {
            s.push_str(a);
        }
        s
    }
}

impl core::fmt::Display for Binding {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let sign = if self.class_method { '+' } else { '-' };
        match self.receiver {
            Receiver::Class(name) => write!(f, "{sign}[{name} {}]", self.selector),
            Receiver::Protocol(name) => write!(f, "{sign}[id<{name}> {}]", self.selector),
        }
    }
}

/// Every [`Binding`] in the build. Each generated method contributes one
/// `static` to a dedicated Mach-O section (what the `linkme` crate does), so
/// the table needs no central list to fall out of date. The section name
/// starts with `__objc_` because AddressSanitizer leaves those alone; padded
/// with red zones the rows would no longer be contiguous.
fn bindings() -> &'static [Binding] {
    unsafe extern "C" {
        #[link_name = "\u{1}section$start$__DATA$__objc_bunbind"]
        static START: usize;
        #[link_name = "\u{1}section$end$__DATA$__objc_bunbind"]
        static STOP: usize;
    }
    const _: () = assert!(core::mem::align_of::<Binding>() == core::mem::align_of::<usize>());
    // An empty section would leave both symbols undefined at link time, so a
    // build that compiles zero binding rows does not link; that is the
    // intended signal.
    let start = (&raw const START).cast::<Binding>();
    let bytes = &raw const STOP as usize - start as usize;
    debug_assert!(bytes.is_multiple_of(core::mem::size_of::<Binding>()));
    let len = bytes / core::mem::size_of::<Binding>();
    // SAFETY: the linker lays the section out as consecutive `Binding`
    // statics (all the same size and alignment) between these two symbols.
    unsafe { core::slice::from_raw_parts(start, len) }
}

/// Adds one generated method to the [`Binding`] table.
macro_rules! binding_row {
    ($ty:ty, $sel:literal, $class_method:expr, $ret:ty, [$($argty:ty),*]) => {
        {
            #[used]
            #[unsafe(link_section = "__DATA,__objc_bunbind,regular,no_dead_strip")]
            static ROW: $crate::objc::Binding = $crate::objc::Binding {
                receiver: <$ty as $crate::objc::Object>::RECEIVER,
                selector: $sel,
                class_method: $class_method,
                ret: <$ret as $crate::objc::Ret>::ENCODING,
                args: <($($argty,)*) as $crate::objc::Args>::ENCODINGS,
            };
        }
        #[cfg(not(debug_assertions))]
        {
            const _: (&str, &[&str]) = (
                <$ret as $crate::objc::Ret>::ENCODING,
                <($($argty,)*) as $crate::objc::Args>::ENCODINGS,
            );
        }
    };
}
pub(crate) use binding_row;

/// Checks every compiled binding against the loaded frameworks: the class or
/// protocol exists, it declares the selector, and the declared type encoding
/// matches the Rust signature once [`normalize_encoding`] has removed what does
/// not affect the calling convention. Returns one line per problem. Also
/// registers the run-time classes in [`delegate`], whose IMPs are asserted
/// against their declarations as they are added (a mismatch there panics).
/// [`verify_bindings`] plus the checks that go through a script's own send
/// path; only bun links what those need.
pub(crate) fn verify_bindings_in_bun() -> Result<Vec<String>> {
    let mut problems = verify_bindings()?;
    dynamic::verify_send_signatures(&mut problems);
    Ok(problems)
}

pub(crate) fn verify_bindings() -> Result<Vec<String>> {
    let rt = load()?;
    metal()?;
    delegate::register_all();
    let mut problems = define::take_registration_problems();
    block::verify(&mut problems);
    dynamic::verify_sdk_tables(&mut problems);
    dynamic::verify_struct_layouts(&mut problems);
    dynamic::verify_signatures(&mut problems);
    ffi::verify(&mut problems);
    for b in bindings() {
        let c_sel = std::ffi::CString::new(b.selector).expect("selector literal");
        let sel = register_sel(&c_sel);
        let declared = match b.receiver {
            Receiver::Class(name) => {
                let c_name = std::ffi::CString::new(name).expect("class literal");
                let Some(cls) = lookup_class(&c_name) else {
                    problems.push(format!("{b}: class not found"));
                    continue;
                };
                rt.class_method_types(cls, sel, b.class_method).or_else(|| {
                    // Metal descriptor classes are clusters whose public class
                    // implements nothing; a concrete subclass does.
                    concrete_subclasses(cls)
                        .into_iter()
                        .find_map(|sub| rt.class_method_types(sub, sel, b.class_method))
                })
            }
            Receiver::Protocol(name) => {
                let c_name = std::ffi::CString::new(name).expect("protocol literal");
                let Some(p) = rt.protocol(&c_name) else {
                    problems.push(format!("{b}: protocol not found"));
                    continue;
                };
                rt.protocol_method_types(p, sel)
            }
        };
        let Some(declared) = declared else {
            problems.push(format!("{b}: selector not found"));
            continue;
        };
        let ours = b.encoding();
        if normalize_encoding(&declared) != normalize_encoding(&ours) {
            problems.push(format!("{b}: declared {declared}, bound as {ours}"));
        }
    }
    Ok(problems)
}

/// Registered classes whose superclass chain reaches `cls`, without sending
/// any of them a message.
fn concrete_subclasses(cls: Class) -> Vec<Class> {
    static ALL: OnceLock<Vec<Class>> = OnceLock::new();
    let all = ALL.get_or_init(|| rt().class_list());
    all.iter()
        .copied()
        .filter(|&candidate| candidate != cls && rt().class_inherits(candidate, cls))
        .collect()
}

// ─────────────────────────── binding generators ─────────────────────────────

/// Declares an owned wrapper type for an Objective-C class.
///
/// ```ignore
/// objc_class!(pub struct NSButton: NSControl = "NSButton");
/// ```
/// generates a `#[repr(transparent)]` newtype over [`Id`] that implements
/// [`Object`] and [`ClassType`], `Clone` (retain), `Debug`, and `Deref` to the
/// superclass wrapper so inherited methods are callable directly.
macro_rules! objc_class {
    ($(#[$meta:meta])* $vis:vis struct $name:ident $(: $parent:ty)? = $cls:literal) => {
        $crate::objc::objc_wrapper!($(#[$meta])* $vis struct $name $(: $parent)? = Class($cls));

        // SAFETY: the bindings on this type are transcribed from this class.
        unsafe impl $crate::objc::ClassType for $name {
            #[inline]
            fn class() -> $crate::objc::Class {
                static CLASS: $crate::objc::CachedClass = $crate::objc::CachedClass::new(
                    match ::core::ffi::CStr::from_bytes_with_nul(concat!($cls, "\0").as_bytes()) {
                        Ok(s) => s,
                        Err(_) => panic!("NUL inside class name"),
                    },
                );
                CLASS.get()
            }
        }
    };
}
pub(crate) use objc_class;

/// Declares an owned wrapper type for `id<Protocol>`: like [`objc_class!`]
/// but without [`ClassType`], since the concrete class is not ours to name.
///
/// ```ignore
/// objc_protocol!(pub struct MTLBuffer: MTLResource = "MTLBuffer");
/// ```
macro_rules! objc_protocol {
    ($(#[$meta:meta])* $vis:vis struct $name:ident $(: $parent:ty)? = $proto:literal) => {
        $crate::objc::objc_wrapper!($(#[$meta])* $vis struct $name $(: $parent)? = Protocol($proto));
    };
}
pub(crate) use objc_protocol;

/// The part [`objc_class!`] and [`objc_protocol!`] share.
macro_rules! objc_wrapper {
    ($(#[$meta:meta])* $vis:vis struct $name:ident $(: $parent:ty)? = $kind:ident($lit:literal)) => {
        $(#[$meta])*
        #[repr(transparent)]
        #[derive(Clone, PartialEq, Eq)]
        #[allow(unreachable_pub)]
        $vis struct $name($crate::objc::Id);

        // SAFETY: repr(transparent) over Id, as the trait requires.
        unsafe impl $crate::objc::Object for $name {
            const RECEIVER: $crate::objc::Receiver = $crate::objc::Receiver::$kind($lit);
            #[inline]
            unsafe fn from_id(id: $crate::objc::Id) -> Self { $name(id) }
            #[inline]
            fn as_id(&self) -> &$crate::objc::Id { &self.0 }
        }

        impl ::core::fmt::Debug for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                ::core::fmt::Debug::fmt(&self.0, f)
            }
        }

        $(
            impl ::core::ops::Deref for $name {
                type Target = $parent;
                #[inline]
                fn deref(&self) -> &$parent {
                    // SAFETY: both are repr(transparent) over Id and the class
                    // really is a subclass (or the protocol incorporates the
                    // parent), so every parent method applies.
                    unsafe { &*::core::ptr::from_ref(self).cast::<$parent>() }
                }
            }
        )?
    };
}
pub(crate) use objc_wrapper;

/// Declares methods on a wrapper type. Each line names the Rust signature and
/// the selector; argument types must implement [`Arg`] and the return type
/// [`Ret`]. Instance methods take `&self`; class methods are written `fn
/// name(...)` without a receiver and are sent to [`ClassType::class`].
///
/// Object returns are spelt by ownership and nullability: `T` is a +0
/// nonnull return, `Option<T>` +0 nullable, `Retained<T>` +1 nonnull and
/// `Retained<Option<T>>` +1 nullable. The generated method returns `T` or
/// `Option<T>` accordingly; nil from a nonnull binding panics naming the
/// binding (`-[NSFont fontDescriptor]`). `Retained` is matched by the macro,
/// not imported.
///
/// ```ignore
/// objc_methods! { impl NSControl {
///     pub fn set_enabled(&self, enabled: bool) = "setEnabled:";
///     pub fn string_value(&self) -> NSString = "stringValue";
///     pub fn current_editor(&self) -> Option<NSTextView> = "currentEditor";
///     pub fn label(text: &NSString) -> NSTextField = "labelWithString:";   // class method
///     pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<Self> = "initWithFrame:";
/// }}
/// ```
macro_rules! objc_methods {
    (impl $ty:ty { $($body:tt)* }) => {
        impl $ty { $crate::objc::objc_methods!(@methods [$ty] $($body)*); }
    };
    (@methods [$ty:ty]) => {};
    // Resolve the return spelling to the type the method yields first, so the
    // generated signature names `T` / `Option<T>` rather than `<_ as Ret>::Out`.
    (@methods [$ty:ty] $(#[$meta:meta])* $vis:vis fn $name:ident $args:tt -> Retained<Option<$t:ty>> = $sel:literal; $($rest:tt)*) => {
        $crate::objc::objc_methods!(@emit [$ty] [$(#[$meta])*] $vis $name $args
            [::core::option::Option<$t>] [$crate::objc::Retained<::core::option::Option<$t>>] $sel);
        $crate::objc::objc_methods!(@methods [$ty] $($rest)*);
    };
    (@methods [$ty:ty] $(#[$meta:meta])* $vis:vis fn $name:ident $args:tt -> Retained<$t:ty> = $sel:literal; $($rest:tt)*) => {
        $crate::objc::objc_methods!(@emit [$ty] [$(#[$meta])*] $vis $name $args [$t] [$crate::objc::Retained<$t>] $sel);
        $crate::objc::objc_methods!(@methods [$ty] $($rest)*);
    };
    (@methods [$ty:ty] $(#[$meta:meta])* $vis:vis fn $name:ident $args:tt -> $t:ty = $sel:literal; $($rest:tt)*) => {
        $crate::objc::objc_methods!(@emit [$ty] [$(#[$meta])*] $vis $name $args [$t] [$t] $sel);
        $crate::objc::objc_methods!(@methods [$ty] $($rest)*);
    };
    (@methods [$ty:ty] $(#[$meta:meta])* $vis:vis fn $name:ident $args:tt = $sel:literal; $($rest:tt)*) => {
        $crate::objc::objc_methods!(@emit [$ty] [$(#[$meta])*] $vis $name $args [()] [()] $sel);
        $crate::objc::objc_methods!(@methods [$ty] $($rest)*);
    };
    // instance method
    (@emit [$ty:ty] [$(#[$meta:meta])*] $vis:vis $name:ident (&self $(, $arg:ident : $argty:ty)* $(,)?) [$out:ty] [$ret:ty] $sel:literal) => {
        $(#[$meta])*
        #[inline]
        #[allow(unreachable_pub, clippy::too_many_arguments)]
        $vis fn $name(&self $(, $arg: $argty)*) -> $out {
            $crate::objc::binding_row!($ty, $sel, false, $ret, [$($argty),*]);
            // SAFETY: the binding declares this selector's signature; see the
            // module docs for what that promise rests on.
            unsafe {
                let raw = $crate::objc::rt().send::<<$ret as $crate::objc::Ret>::Raw, _>(
                    $crate::objc::Object::as_obj(self), $crate::objc::sel!($sel), ($($arg,)*));
                <$ret as $crate::objc::Ret>::from_raw(raw, concat!("-[", stringify!($ty), " ", $sel, "]"))
            }
        }
    };
    // initialiser: consumes an `Allocated<Self>`
    (@emit [$ty:ty] [$(#[$meta:meta])*] $vis:vis $name:ident (this: Allocated<Self> $(, $arg:ident : $argty:ty)* $(,)?) [$out:ty] [$ret:ty] $sel:literal) => {
        $(#[$meta])*
        #[inline]
        #[allow(unreachable_pub, clippy::too_many_arguments)]
        $vis fn $name(this: $crate::objc::Allocated<Self> $(, $arg: $argty)*) -> $out {
            $crate::objc::binding_row!($ty, $sel, false, $ret, [$($argty),*]);
            // SAFETY: as above; `this` is a +1 uninitialised instance whose
            // ownership passes to init (which may return a different object).
            unsafe {
                let receiver = this.into_obj();
                let raw = $crate::objc::rt().send::<<$ret as $crate::objc::Ret>::Raw, _>(
                    receiver, $crate::objc::sel!($sel), ($($arg,)*));
                <$ret as $crate::objc::Ret>::from_raw(raw, concat!("-[", stringify!($ty), " ", $sel, "]"))
            }
        }
    };
    // class method
    (@emit [$ty:ty] [$(#[$meta:meta])*] $vis:vis $name:ident ($($arg:ident : $argty:ty),* $(,)?) [$out:ty] [$ret:ty] $sel:literal) => {
        $(#[$meta])*
        #[inline]
        #[allow(unreachable_pub, clippy::too_many_arguments)]
        $vis fn $name($($arg: $argty),*) -> $out {
            $crate::objc::binding_row!($ty, $sel, true, $ret, [$($argty),*]);
            // SAFETY: as above, sent to the class object.
            unsafe {
                let raw = $crate::objc::rt().send::<<$ret as $crate::objc::Ret>::Raw, _>(
                    <Self as $crate::objc::ClassType>::class().as_obj(), $crate::objc::sel!($sel), ($($arg,)*));
                <$ret as $crate::objc::Ret>::from_raw(raw, concat!("+[", stringify!($ty), " ", $sel, "]"))
            }
        }
    };
}
pub(crate) use objc_methods;

impl Class {
    #[inline]
    pub(crate) fn as_obj(self) -> Obj {
        self.0.as_ptr()
    }
}

/// The result of `+alloc`: must be passed to an `init…` binding.
pub(crate) struct Allocated<T>(Id, PhantomData<T>);

impl<T: Object> Allocated<T> {
    #[doc(hidden)]
    pub(crate) fn into_obj(self) -> Obj {
        let me = core::mem::ManuallyDrop::new(self);
        me.0.as_obj()
    }
}

/// `[T alloc]`.
pub(crate) fn alloc<T: ClassType>() -> Allocated<T> {
    // SAFETY: +alloc on a valid class returns a +1 instance (never nil for
    // the AppKit classes we bind; treat nil as an unrecoverable OOM).
    let id =
        unsafe { Id::from_retained(rt().send::<Obj, _>(T::class().as_obj(), sel!("alloc"), ())) };
    Allocated(id.expect("+alloc returned nil"), PhantomData)
}
