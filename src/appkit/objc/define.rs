//! Defining Objective-C classes at run time: plain method-override subclasses,
//! and delegate classes whose instances carry an `owner` ivar pointing at a
//! reference-counted Rust handler `H`.

use core::ffi::{CStr, c_char, c_void};
use core::marker::PhantomData;
use core::ptr::{self, NonNull};
use std::rc::Rc;

use super::foundation::NSObject;
use super::{Bool, Class, Id, Obj, Object, Sel, Subclass, rt, sel};

// ─────────────────────────── method type encodings ───────────────────────────

/// # Safety
/// `ENCODING` is the Objective-C `@encode` of `Self` as a method argument or
/// return value.
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
    Obj => "@",
    Sel => ":",
    Bool => if cfg!(target_arch = "aarch64") { "B" } else { "c" },
    usize => "Q",
    isize => "q",
    () => "v",
    crate::geometry::Rect => "{CGRect={CGPoint=dd}{CGSize=dd}}",
}

/// The receiver of an IMP registered on an [`OwnedClassBuilder<H>`]: an
/// instance of a [`DelegateClass<H>`]. Only the Objective-C runtime makes
/// these, so an IMP typed for one handler cannot be registered on, or
/// dispatch through, another handler's class.
#[repr(transparent)]
pub(crate) struct This<H: ?Sized>(Obj, PhantomData<fn() -> Box<H>>);
impl<H: ?Sized> Clone for This<H> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<H: ?Sized> Copy for This<H> {}
// SAFETY: transparent over Obj.
unsafe impl<H: ?Sized> Encode for This<H> {
    const ENCODING: &'static str = Obj::ENCODING;
}

/// An `extern "C" fn(T, Sel, ...) -> R` with receiver `T`. The method type
/// string is derived from the signature, so it cannot disagree with it.
///
/// # Safety
/// `erase` returns this function pointer and the encoding of exactly its
/// signature.
pub(crate) unsafe trait MethodImp<T> {
    fn erase(self) -> (*const c_void, String);
}

macro_rules! method_imps {
    ($( ($($a:ident),*) ),*) => {$(
        // SAFETY: the encoding is built from the same type parameters as the
        // fn type.
        unsafe impl<T: Encode, R: Encode $(, $a: Encode)*> MethodImp<T> for extern "C" fn(T, Sel $(, $a)*) -> R {
            fn erase(self) -> (*const c_void, String) {
                let mut types = String::from(R::ENCODING);
                types.push_str(T::ENCODING);
                types.push_str(Sel::ENCODING);
                $( types.push_str($a::ENCODING); )*
                (self as *const c_void, types)
            }
        }
    )*};
}
method_imps!((), (A), (A, B), (A, B, C));

fn add_method<T, F: MethodImp<T>>(cls: Class, sel: Sel, imp: F) {
    let (func, mut types) = imp.erase();
    types.push('\0');
    // SAFETY: cls is under construction; types is NUL-terminated and the
    // runtime copies it.
    let ok =
        unsafe { (rt().class_addMethod)(cls.as_obj(), sel, func, types.as_ptr().cast::<c_char>()) };
    assert!(ok.get(), "duplicate method");
}

// ─────────────────────────────── builders ─────────────────────────────────────

/// A subclass of `T`'s class under construction. Finish with
/// [`register`](Self::register) for a plain subclass, or [`owned`](Self::owned)
/// then `register` for one whose instances back a [`Delegate<H>`].
pub(crate) struct ClassBuilder<T> {
    cls: Class,
    _t: PhantomData<fn() -> T>,
}

impl<T: Object> ClassBuilder<T> {
    /// Starts a subclass of `T`'s class named `name`. A second definition of
    /// the same name is a programming error.
    pub(crate) fn new(name: &CStr) -> Self {
        // SAFETY: valid superclass and NUL-terminated name.
        let cls = unsafe { (rt().objc_allocateClassPair)(T::class().as_obj(), name.as_ptr(), 0) };
        ClassBuilder {
            cls: Class(NonNull::new(cls).unwrap_or_else(|| panic!("class {name:?} defined twice"))),
            _t: PhantomData,
        }
    }

    pub(crate) fn method<F: MethodImp<Obj>>(self, sel: Sel, imp: F) -> Self {
        add_method(self.cls, sel, imp);
        self
    }

    /// Adds the `owner` ivar: instances will back a [`Delegate<H>`].
    pub(crate) fn owned<H: ?Sized>(self) -> OwnedClassBuilder<H> {
        let align = core::mem::align_of::<*mut c_void>().trailing_zeros() as u8;
        // SAFETY: cls is under construction; "^v" encodes `void *`.
        let ok = unsafe {
            (rt().class_addIvar)(
                self.cls.as_obj(),
                c"owner".as_ptr(),
                core::mem::size_of::<*mut c_void>(),
                align,
                c"^v".as_ptr(),
            )
        };
        assert!(ok.get(), "duplicate ivar");
        OwnedClassBuilder {
            cls: self.cls,
            _h: PhantomData,
        }
    }

    /// Registers a plain subclass: method overrides only, no owner.
    pub(crate) fn register(self) -> Subclass<T> {
        // SAFETY: cls is complete.
        unsafe { (rt().objc_registerClassPair)(self.cls.as_obj()) };
        Subclass::from_registered(self.cls)
    }
}

/// A [`ClassBuilder`] that has the `owner` ivar; registers into a
/// [`DelegateClass<H>`].
pub(crate) struct OwnedClassBuilder<H: ?Sized> {
    cls: Class,
    _h: PhantomData<fn() -> Box<H>>,
}

impl<H: ?Sized> OwnedClassBuilder<H> {
    /// Only IMPs whose receiver is `This<H>` fit, so one written for another
    /// handler's class is a type error here.
    pub(crate) fn method<F: MethodImp<This<H>>>(self, sel: Sel, imp: F) -> Self {
        add_method(self.cls, sel, imp);
        self
    }

    pub(crate) fn register(self) -> DelegateClass<H> {
        // SAFETY: cls is complete.
        unsafe { (rt().objc_registerClassPair)(self.cls.as_obj()) };
        // SAFETY: cls is registered and `owned()` added the ivar.
        let ivar =
            unsafe { (rt().class_getInstanceVariable)(self.cls.as_obj(), c"owner".as_ptr()) };
        assert!(!ivar.is_null(), "owner ivar missing");
        // SAFETY: valid Ivar handle.
        let owner_offset = unsafe { (rt().ivar_getOffset)(ivar) };
        DelegateClass {
            cls: self.cls,
            owner_offset,
            _h: PhantomData,
        }
    }
}

// ─────────────────────────── delegate classes ────────────────────────────────

/// A registered class whose instances carry `owner: *const Box<H>`, an
/// `Rc::into_raw` count owned by a live [`Delegate<H>`].
pub(crate) struct DelegateClass<H: ?Sized> {
    cls: Class,
    owner_offset: isize,
    _h: PhantomData<fn() -> Box<H>>,
}

impl<H: ?Sized> DelegateClass<H> {
    /// A new instance whose `owner` ivar is `owner`.
    fn instantiate(&self, owner: *const Box<H>) -> NSObject {
        // SAFETY: alloc/init of an NSObject subclass; then a pointer-sized
        // store into our own ivar.
        unsafe {
            let obj: Obj = rt().send(
                rt().send::<Obj, _>(self.cls.as_obj(), sel!("alloc"), ()),
                sel!("init"),
                (),
            );
            let id = Id::from_retained(obj).expect("delegate init");
            self.set_owner(id.as_obj(), owner);
            <NSObject as Object>::from_id(id)
        }
    }

    /// # Safety
    /// `obj` is an instance of this class.
    #[inline]
    unsafe fn owner(&self, obj: Obj) -> *const Box<H> {
        // SAFETY: the ivar lives at this offset and only `set_owner` writes it.
        unsafe { *obj.byte_offset(self.owner_offset).cast::<*const Box<H>>() }
    }

    /// # Safety
    /// `obj` is an instance of this class.
    #[inline]
    unsafe fn set_owner(&self, obj: Obj, owner: *const Box<H>) {
        // SAFETY: as above.
        unsafe { *obj.byte_offset(self.owner_offset).cast::<*const Box<H>>() = owner };
    }

    /// Runs `f` with the handler behind `this` if it still has one. Re-entrant
    /// callbacks are fine because handlers take `&self`.
    ///
    /// # Safety
    /// `this` was received by an IMP registered on this class.
    pub(crate) unsafe fn dispatch<R>(&self, this: This<H>, f: impl FnOnce(&H) -> R) -> Option<R> {
        // SAFETY: per contract.
        let owner = unsafe { self.owner(this.0) };
        if owner.is_null() {
            return None;
        }
        // SAFETY: a non-null ivar is the `Rc::into_raw` count a live
        // `Delegate` owns (its Drop nulls the ivar before releasing it); taking
        // our own count keeps the handler alive even if `f` drops that
        // `Delegate`.
        let handler = unsafe {
            Rc::increment_strong_count(owner);
            Rc::from_raw(owner)
        };
        Some(f(&**handler))
    }
}

/// A live subscription of a Rust event handler to a runtime-defined delegate
/// object. The object's `owner` ivar holds the one long-lived count on the
/// handler (an `Rc` around the fat `Box<H>` so the ivar stays thin). Dropping
/// this clears `owner` so late callbacks from AppKit find nothing to call,
/// releases that count, then releases the delegate.
pub(crate) struct Delegate<H: ?Sized + 'static> {
    class: &'static DelegateClass<H>,
    object: NSObject,
}

impl<H: ?Sized> Delegate<H> {
    pub(crate) fn new(class: &'static DelegateClass<H>, handler: Box<H>) -> Delegate<H> {
        let object = class.instantiate(Rc::into_raw(Rc::new(handler)));
        Delegate { class, object }
    }

    /// The Objective-C object to install as target / delegate / data source.
    #[inline]
    pub(crate) fn as_nsobject(&self) -> &NSObject {
        &self.object
    }
}

impl<H: ?Sized> Drop for Delegate<H> {
    fn drop(&mut self) {
        let obj = self.object.as_obj();
        // SAFETY: `object` is an instance of `class`; its ivar is the
        // `Rc::into_raw` from `new` and only this Drop releases it, after
        // nulling the ivar so no `dispatch` can read it again.
        unsafe {
            let owner = self.class.owner(obj);
            self.class.set_owner(obj, ptr::null());
            if !owner.is_null() {
                drop(Rc::from_raw(owner));
            }
        }
    }
}
