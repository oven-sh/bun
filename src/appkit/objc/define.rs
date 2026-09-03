//! Defining Objective-C classes at run time: plain method-override subclasses,
//! delegate classes whose instances carry an `owner` ivar pointing at a
//! reference-counted Rust handler `H`, and the bare [`Declarations`] that
//! [`super::script`] builds script-defined classes on. The builders are
//! private to `objc` because registering an IMP whose Rust signature differs
//! from what AppKit calls it with is undefined behaviour the type system
//! cannot see.

use core::cell::RefCell;
use core::ffi::{CStr, c_char, c_void};
use core::marker::PhantomData;
use core::ptr::{self, NonNull};
use std::rc::Rc;

use super::foundation::NSObject;
use super::{Class, ClassType, Encode, Id, Obj, Object, Sel, rt, sel};

// ─────────────────────────── method type encodings ───────────────────────────

/// The receiver of an IMP registered on an [`OwnedClassBuilder<H>`]: an
/// instance of a [`DelegateClass<H>`]. Only the Objective-C runtime makes
/// these, so an IMP typed for one handler cannot be registered on, or
/// dispatch through, another handler's class.
#[repr(transparent)]
pub(super) struct This<H: ?Sized>(Obj, PhantomData<fn() -> Box<H>>);
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
pub(super) unsafe trait MethodImp<T> {
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
                types.push_str(<Sel as Encode>::ENCODING);
                $( types.push_str($a::ENCODING); )*
                (self as *const c_void, types)
            }
        }
    )*};
}
method_imps!((), (A), (A, B), (A, B, C));

thread_local! {
    /// Mismatches found while registering classes, for [`super::verify_bindings`].
    static PROBLEMS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Drains what class registration on this thread found wrong so far.
pub(super) fn take_registration_problems() -> Vec<String> {
    PROBLEMS.with(|p| core::mem::take(&mut *p.borrow_mut()))
}

fn problem(message: String) {
    debug_assert!(false, "{message}");
    PROBLEMS.with(|p| p.borrow_mut().push(message));
}

/// A class under construction, and what the methods added to it are
/// checked against: the protocols it adopts, then its superclass chain.
pub(super) struct Declarations {
    cls: Class,
    superclass: Class,
    protocols: Vec<(String, NonNull<c_void>)>,
}

impl Declarations {
    /// Starts a subclass of `superclass` named `name`; `None` when the name
    /// is taken.
    pub(super) fn new(superclass: Class, name: &CStr) -> Option<Declarations> {
        // SAFETY: valid superclass and NUL-terminated name.
        let cls = unsafe { (rt().objc_allocateClassPair)(superclass.as_obj(), name.as_ptr(), 0) };
        Some(Declarations {
            cls: Class(NonNull::new(cls)?),
            superclass,
            protocols: Vec::new(),
        })
    }

    /// Adopts `name` (see [`super::Runtime::protocol`]); an unknown one is
    /// a problem [`super::verify_bindings`] reports.
    fn adopt(&mut self, name: &CStr) {
        if !self.try_adopt(name) {
            problem(format!(
                "protocol {name:?} is not registered by any loaded framework"
            ));
        }
    }

    /// [`adopt`](Self::adopt), but `false` rather than a problem for a
    /// protocol nothing declares.
    pub(super) fn try_adopt(&mut self, name: &CStr) -> bool {
        let Some(p) = rt().protocol(name) else {
            return false;
        };
        // SAFETY: cls is under construction; p is a live Protocol.
        unsafe { (rt().class_addProtocol)(self.cls.as_obj(), p.as_ptr()) };
        self.protocols
            .push((name.to_string_lossy().into_owned(), p));
        true
    }

    /// Each adopted protocol's name with the instance methods it requires
    /// (not those of protocols it incorporates in turn).
    pub(super) fn required(&self) -> Vec<(&str, Vec<Sel>)> {
        self.protocols
            .iter()
            .map(|(name, p)| (name.as_str(), rt().protocol_required_methods(*p)))
            .collect()
    }

    /// The class being built (usable as a value now, instantiable once
    /// [`register`](Self::register)ed).
    pub(super) fn class(&self) -> Class {
        self.cls
    }

    /// The encoding the superclass (its metaclass chain) declares for class
    /// method `sel`.
    pub(super) fn declared_class_method(&self, sel: Sel) -> Option<String> {
        rt().class_method_types(self.superclass, sel, true)
    }

    /// # Safety
    /// As [`add_raw`](Self::add_raw), for a class method (one of the
    /// metaclass's).
    pub(super) unsafe fn add_class_raw(&self, sel: Sel, imp: *const c_void, types: *const c_char) {
        // SAFETY: cls is under construction, and so is its metaclass; the
        // runtime copies `types`.
        let ok = unsafe {
            let metaclass = (rt().object_getClass)(self.cls.as_obj());
            (rt().class_addMethod)(metaclass, sel, imp, types)
        };
        assert!(ok.get(), "duplicate class method");
    }

    /// Whether the superclass chain implements instance method `sel`.
    pub(super) fn inherits(&self, sel: Sel) -> bool {
        rt().class_method_types(self.superclass, sel, false)
            .is_some()
    }

    /// The protocols any loaded image registers that declare instance
    /// method `sel`, for the message about a method nothing adopted or
    /// inherited declares: the Foundation, AppKit, QuartzCore and Metal ones
    /// (by name prefix) when any of those declare it, since the runtime
    /// holds thousands of private protocols besides, else the rest; one name
    /// per distinct encoding, encodings shown without frame offsets.
    pub(super) fn suggested_protocols(&self, sel: Sel) -> Vec<(String, String)> {
        let public = |name: &str| {
            ["NS", "CA", "MTL", "MTK"]
                .iter()
                .any(|p| name.starts_with(p))
        };
        let normal = |types: &String| super::normalize_encoding(types);
        let all = rt().protocols_declaring(sel);
        let mut found: Vec<(String, String)> = match all.iter().any(|(name, _)| public(name)) {
            true => all.into_iter().filter(|(name, _)| public(name)).collect(),
            false => all,
        };
        found.sort_by_cached_key(|(name, types)| (normal(types), name.clone()));
        found.dedup_by(|a, b| normal(&a.1) == normal(&b.1));
        for (_, types) in &mut found {
            types.retain(|c| !c.is_ascii_digit());
        }
        found
    }

    /// The encoding an adopted protocol or the superclass declares for
    /// `sel`, and who that is: a protocol this class adopts; what the
    /// superclass chain implements; a protocol a class up that chain adopts.
    pub(super) fn declared(&self, sel: Sel) -> Option<(String, String)> {
        self.protocols
            .iter()
            .find_map(|(name, p)| Some((name.clone(), rt().protocol_method_types(*p, sel)?)))
            .or_else(|| {
                let types = rt().class_method_types(self.superclass, sel, false)?;
                Some((
                    format!("the superclass {}", rt().class_name(self.superclass)),
                    types,
                ))
            })
            .or_else(|| rt().class_protocol_method_types(self.superclass, sel))
    }

    /// # Safety
    /// `imp`'s signature is what the adopted protocol or superclass declares
    /// for `sel` on both architectures (checked when either declares it;
    /// selectors of our own, like `onAction:`, are unchecked).
    pub(super) unsafe fn add_method<T, F: MethodImp<T>>(&self, sel: Sel, imp: F) {
        let (func, mut types) = imp.erase();
        if let Some((_, declared)) = self.declared(sel)
            && super::normalize_encoding(&declared) != super::normalize_encoding(&types)
        {
            problem(format!(
                "IMP for {} registered as {types} but declared as {declared}",
                rt().sel_name(sel),
            ));
        }
        types.push('\0');
        // SAFETY: forwarded contract; `types` describes `func` and is NUL-terminated.
        unsafe { self.add_raw(sel, func, types.as_ptr().cast::<c_char>()) };
    }

    /// # Safety
    /// `imp` behaves as a method of NUL-terminated type `types` when the
    /// runtime calls it for `sel`.
    pub(super) unsafe fn add_raw(&self, sel: Sel, imp: *const c_void, types: *const c_char) {
        // SAFETY: cls is under construction; the runtime copies `types`.
        let ok = unsafe { (rt().class_addMethod)(self.cls.as_obj(), sel, imp, types) };
        assert!(ok.get(), "duplicate method");
    }

    /// Adds a pointer-sized ivar zeroed at `alloc`; its offset is read back
    /// with [`ivar_offset`] once the class is registered.
    pub(super) fn add_pointer_ivar(&self, name: &CStr) {
        let align = core::mem::align_of::<*mut c_void>().trailing_zeros() as u8;
        // SAFETY: cls is under construction; "^v" encodes `void *`.
        let ok = unsafe {
            (rt().class_addIvar)(
                self.cls.as_obj(),
                name.as_ptr(),
                core::mem::size_of::<*mut c_void>(),
                align,
                c"^v".as_ptr(),
            )
        };
        assert!(ok.get(), "duplicate ivar");
    }

    /// Registers the class: from here on it can be instantiated and never goes away.
    pub(super) fn register(self) -> Class {
        // SAFETY: cls is complete.
        unsafe { (rt().objc_registerClassPair)(self.cls.as_obj()) };
        self.cls
    }

    /// Throws the unregistered class away.
    pub(super) fn dispose(self) {
        // SAFETY: cls was allocated by `new` and never registered.
        unsafe { (rt().objc_disposeClassPair)(self.cls.as_obj()) };
    }
}

/// The byte offset of ivar `name` in instances of `cls` or a superclass.
pub(super) fn ivar_offset(cls: Class, name: &CStr) -> Option<isize> {
    // SAFETY: a registered class and a NUL-terminated name.
    let ivar = unsafe { (rt().class_getInstanceVariable)(cls.as_obj(), name.as_ptr()) };
    if ivar.is_null() {
        return None;
    }
    // SAFETY: valid Ivar handle.
    Some(unsafe { (rt().ivar_getOffset)(ivar) })
}

// ─────────────────────────────── builders ─────────────────────────────────────

/// A subclass of `T`'s class under construction. Finish with
/// [`owned`](Self::owned) then `register` for one whose instances back a
/// [`Delegate<H>`].
pub(super) struct ClassBuilder<T> {
    decls: Declarations,
    _t: PhantomData<fn() -> T>,
}

impl<T: ClassType> ClassBuilder<T> {
    /// Starts a subclass of `T`'s class named `name`. A second definition of
    /// the same name is a programming error.
    pub(super) fn new(name: &CStr) -> Self {
        ClassBuilder {
            decls: Declarations::new(T::class(), name)
                .unwrap_or_else(|| panic!("class {name:?} defined twice")),
            _t: PhantomData,
        }
    }

    /// Adds the `owner` ivar: instances will back a [`Delegate<H>`].
    pub(super) fn owned<H: ?Sized>(self) -> OwnedClassBuilder<H> {
        self.decls.add_pointer_ivar(c"owner");
        OwnedClassBuilder {
            decls: self.decls,
            _h: PhantomData,
        }
    }
}

/// A [`ClassBuilder`] that has the `owner` ivar; registers into a
/// [`DelegateClass<H>`].
pub(super) struct OwnedClassBuilder<H: ?Sized> {
    decls: Declarations,
    _h: PhantomData<fn() -> Box<H>>,
}

impl<H: ?Sized> OwnedClassBuilder<H> {
    /// Declares conformance to `name` (so `conformsToProtocol:` answers YES)
    /// and makes its method declarations the ones later IMPs are checked
    /// against.
    pub(super) fn protocol(mut self, name: &CStr) -> Self {
        self.decls.adopt(name);
        self
    }

    /// Only IMPs whose receiver is `This<H>` fit, so one written for another
    /// handler's class is a type error here.
    ///
    /// # Safety
    /// See [`Declarations::add_method`].
    pub(super) unsafe fn method<F: MethodImp<This<H>>>(self, sel: Sel, imp: F) -> Self {
        // SAFETY: forwarded contract.
        unsafe { self.decls.add_method(sel, imp) };
        self
    }

    pub(super) fn register(self) -> DelegateClass<H> {
        let cls = self.decls.register();
        DelegateClass {
            cls,
            owner_offset: ivar_offset(cls, c"owner").expect("owner ivar missing"),
            _h: PhantomData,
        }
    }
}

// ─────────────────────────── delegate classes ────────────────────────────────

/// A registered class whose instances carry `owner: *const Box<H>`, an
/// `Rc::into_raw` count owned by a live [`Delegate<H>`].
pub(super) struct DelegateClass<H: ?Sized> {
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
    pub(super) unsafe fn dispatch<R>(&self, this: This<H>, f: impl FnOnce(&H) -> R) -> Option<R> {
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
    pub(super) fn new(class: &'static DelegateClass<H>, handler: Box<H>) -> Delegate<H> {
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
