//! https://learn.microsoft.com/windows/win32/com/the-component-object-model

use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::{NonNull, null_mut};
use std::sync::atomic::{AtomicU32, Ordering};

use super::{
    CoCreateInstance, CoTaskMemAlloc, CoTaskMemFree, PropVariantClear, RoActivateInstance,
    RoGetActivationFactory, Str, string_at,
};
use super::{
    SafeArrayCreateVector, SafeArrayPutElement, SysAllocStringLen, SysFreeString, SysStringLen,
};
use super::{WindowsCreateString, WindowsDeleteString, WindowsGetStringRawBuffer};

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Guid(u32, u16, u16, [u8; 8]);

impl Guid {
    pub const fn new(it: u128) -> Guid {
        Guid(
            (it >> 96) as u32,
            (it >> 80) as u16,
            (it >> 64) as u16,
            (it as u64).to_be_bytes(),
        )
    }
}

impl Guid {
    /// With or without braces.
    pub fn parse(text: &str) -> Option<Guid> {
        let digits = text.trim_matches(['{', '}']).replace('-', "");
        u128::from_str_radix(&digits, 16)
            .ok()
            .filter(|_| digits.len() == 32)
            .map(Guid::new)
    }
}

impl std::fmt::Display for Guid {
    fn fmt(&self, to: &mut std::fmt::Formatter) -> std::fmt::Result {
        let last = u64::from_be_bytes(self.3);
        write!(
            to,
            "{{{:08X}-{:04X}-{:04X}-{:04X}-{:012X}}}",
            self.0,
            self.1,
            self.2,
            last >> 48,
            last & 0xFFFF_FFFF_FFFF
        )
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
#[must_use]
pub struct Status(pub i32);

pub type Outcome<T = ()> = Result<T, Status>;

impl Status {
    pub const OK: Status = Status(0);
    pub const NOT_IMPLEMENTED: Status = Status(0x8000_4001_u32 as i32);
    pub const NO_INTERFACE: Status = Status(0x8000_4002_u32 as i32);
    pub const FAILED: Status = Status(0x8000_4005_u32 as i32);
    pub const INVALID_ARGUMENT: Status = Status(0x8007_0057_u32 as i32);
    pub const CANCELLED: Status = Status(0x8007_04C7_u32 as i32);

    pub fn ok(self) -> Outcome {
        if self.0 < 0 { Err(self) } else { Ok(()) }
    }
}

impl std::fmt::Display for Status {
    fn fmt(&self, to: &mut std::fmt::Formatter) -> std::fmt::Result {
        std::io::Error::from_raw_os_error(self.0).fmt(to)
    }
}

impl std::fmt::Debug for Status {
    fn fmt(&self, to: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(to, "{:#x}", self.0)
    }
}

impl std::error::Error for Status {}

/// What a function leaves in its last argument.
pub fn made<T>(make: impl FnOnce(&mut Option<T>) -> Status) -> Outcome<T> {
    let mut result = None;
    make(&mut result).ok()?;
    result.ok_or(Status::FAILED)
}

pub fn filled<T: Default>(fill: impl FnOnce(&mut T) -> Status) -> Outcome<T> {
    let mut result = T::default();
    fill(&mut result).ok().map(|()| result)
}

// ───────────────────────────── the objects of others ─────────────────────────────

/// A counted reference.
#[repr(transparent)]
pub struct Unknown(NonNull<*const *const c_void>);

/// # Safety
/// It is an `Unknown` whose object has the methods that `ID` stands for.
pub unsafe trait Interface: Sized {
    const ID: Guid;
}

// SAFETY: every object has them.
unsafe impl Interface for Unknown {
    const ID: Guid = Guid::new(0x00000000_0000_0000_c000_000000000046);
}

impl Unknown {
    pub fn as_ptr(&self) -> *mut c_void {
        self.0.as_ptr().cast()
    }

    /// # Safety
    /// `F` is the type of that method.
    pub unsafe fn method<F: Copy>(&self, index: usize) -> F {
        // SAFETY: an object starts with the address of its methods.
        unsafe { (*self.0.as_ptr()).add(index).cast::<F>().read() }
    }

    pub fn cast<T: Interface>(&self) -> Outcome<T> {
        // SAFETY: `QueryInterface`
        made(|it| unsafe {
            self.method::<extern "system" fn(*mut c_void, &Guid, &mut Option<T>) -> Status>(0)(
                self.as_ptr(),
                &T::ID,
                it,
            )
        })
    }

    pub fn cast_to(&self, id: &Guid) -> Outcome<Unknown> {
        // SAFETY: as above.
        made(|it| unsafe {
            self.method::<extern "system" fn(*mut c_void, &Guid, &mut Option<Unknown>) -> Status>(0)(
                self.as_ptr(),
                id,
                it,
            )
        })
    }

    pub fn borrowed(&self) -> Borrowed {
        // SAFETY: it is not released.
        Borrowed(ManuallyDrop::new(Some(unsafe { std::ptr::read(self) })))
    }
}

impl Clone for Unknown {
    fn clone(&self) -> Unknown {
        // SAFETY: `AddRef`
        unsafe { self.method::<extern "system" fn(*mut c_void) -> u32>(1)(self.as_ptr()) };
        Unknown(self.0)
    }
}

impl Drop for Unknown {
    fn drop(&mut self) {
        // SAFETY: `Release`
        unsafe { self.method::<extern "system" fn(*mut c_void) -> u32>(2)(self.as_ptr()) };
    }
}

/// An argument, which stays the caller's.
#[repr(transparent)]
pub struct Borrowed<T = Unknown>(ManuallyDrop<Option<T>>);

impl<T> Default for Borrowed<T> {
    fn default() -> Borrowed<T> {
        Borrowed(ManuallyDrop::new(None))
    }
}

impl<T> Borrowed<T> {
    pub fn get(&self) -> Outcome<&T> {
        self.0.as_ref().ok_or(Status::INVALID_ARGUMENT)
    }
}

macro_rules! interfaces {
    ($($name:ident = $id:literal { $($index:literal $method:ident($($argument:ident: $type:ty),*) $(-> $result:ty)?;)* })*) => {$(
        #[repr(transparent)]
        #[derive(Clone)]
        pub struct $name(Unknown);

        // SAFETY: as the headers of the SDK have it.
        unsafe impl Interface for $name {
            const ID: Guid = Guid::new($id);
        }

        impl std::ops::Deref for $name {
            type Target = Unknown;

            fn deref(&self) -> &Unknown {
                &self.0
            }
        }

        impl $name {$(
            pub fn $method(&self, $($argument: $type),*) $(-> $result)? {
                // SAFETY: as above, and the types of the arguments only have valid values.
                unsafe { self.0.method::<extern "system" fn(*mut c_void, $($type),*) $(-> $result)?>($index)(self.0.as_ptr(), $($argument),*) }
            }
        )*}
    )*};
}

pub(super) use interfaces;

pub fn create<T: Interface>(class: Guid) -> Outcome<T> {
    const IN_PROCESS_OR_LOCAL: u32 = 1 | 4;
    // SAFETY: room for a reference of that kind.
    made(|it| unsafe {
        CoCreateInstance(
            &class,
            Borrowed::default(),
            IN_PROCESS_OR_LOCAL,
            &T::ID,
            std::ptr::from_mut(it).cast(),
        )
    })
}

/// An object of the Windows Runtime.
pub fn activate(class: &str) -> Outcome<Unknown> {
    made(|it| RoActivateInstance(RuntimeString::new(class).0, it))
}

/// The static methods of a class of the Windows Runtime.
pub fn factory<T: Interface>(class: &str) -> Outcome<T> {
    let class = RuntimeString::new(class);
    // SAFETY: as above.
    made(|it| unsafe { RoGetActivationFactory(class.0, &T::ID, std::ptr::from_mut(it).cast()) })
}

// ───────────────────────────── the objects of the library ─────────────────────────────

pub struct Methods(pub &'static [*const ()]);

// SAFETY: addresses of functions.
unsafe impl Sync for Methods {}

pub trait Class: Sized + 'static {
    /// Each with the interfaces that it is or extends.
    type Facets: AsRef<[*const *const ()]>;
    const IDS: &'static [&'static [Guid]];

    fn facets() -> Self::Facets;
    fn has(&self, id: &Guid) -> bool;
}

#[repr(C)]
pub struct Object<T: Class> {
    facets: T::Facets,
    references: AtomicU32,
    value: T,
}

impl<T: Class> Object<T> {
    /// As its first facet.
    pub fn create(value: T) -> Unknown {
        Unknown(
            NonNull::from(Box::leak(Box::new(Object {
                facets: T::facets(),
                references: AtomicU32::new(1),
                value,
            })))
            .cast(),
        )
    }

    /// # Safety
    /// `facet` is the one at `index` of a live object.
    unsafe fn of<'a>(facet: *mut c_void, index: usize) -> &'a Object<T> {
        // SAFETY: they are at its start.
        unsafe { &*facet.cast::<*const ()>().sub(index).cast() }
    }

    /// If it is one, in this process.
    pub fn behind(object: &Unknown) -> Option<&T> {
        // SAFETY: an object starts with the address of its methods, and nothing else has these.
        unsafe {
            let index = T::facets()
                .as_ref()
                .iter()
                .position(|it| *it == (*object.0.as_ptr()).cast())?;
            Some(&Self::of(object.as_ptr(), index).value)
        }
    }

    /// # Safety
    /// As for `of`.
    pub unsafe fn call<R: Returned>(
        facet: *mut c_void,
        index: usize,
        method: impl FnOnce(&T) -> R,
    ) -> R::Raw {
        // SAFETY: the caller's contract.
        let object = unsafe { Self::of(facet, index) };
        catch_unwind(AssertUnwindSafe(|| method(&object.value).raw())).unwrap_or(R::IF_IT_PANICS)
    }

    pub unsafe extern "system" fn query<const INDEX: usize>(
        facet: *mut c_void,
        id: &Guid,
        result: &mut *mut c_void,
    ) -> Status {
        // SAFETY: it is only among the methods of that facet.
        let object = unsafe { Self::of(facet, INDEX) };
        let found = if *id == Unknown::ID {
            Some(0)
        } else {
            T::IDS
                .iter()
                .position(|it| it.contains(id))
                .filter(|_| object.value.has(id))
        };
        // SAFETY: from one facet to another.
        *result = found.map_or(null_mut(), |it| unsafe {
            facet.cast::<*const ()>().sub(INDEX).add(it).cast()
        });
        object
            .references
            .fetch_add(found.is_some().into(), Ordering::Relaxed);
        if found.is_some() {
            Status::OK
        } else {
            Status::NO_INTERFACE
        }
    }

    pub unsafe extern "system" fn retain<const INDEX: usize>(facet: *mut c_void) -> u32 {
        // SAFETY: as above.
        unsafe { Self::of(facet, INDEX) }
            .references
            .fetch_add(1, Ordering::Relaxed)
            + 1
    }

    pub unsafe extern "system" fn release<const INDEX: usize>(facet: *mut c_void) -> u32 {
        // SAFETY: as above.
        let left = unsafe { Self::of(facet, INDEX) }
            .references
            .fetch_sub(1, Ordering::AcqRel)
            - 1;
        if left == 0 {
            // SAFETY: what `create` has leaked, and this was the last reference.
            drop(unsafe {
                Box::from_raw(facet.cast::<*const ()>().sub(INDEX).cast::<Object<T>>())
            });
        }
        left
    }
}

pub trait Returned {
    type Raw;
    const IF_IT_PANICS: Self::Raw;

    fn raw(self) -> Self::Raw;
}

impl Returned for Outcome {
    type Raw = Status;
    const IF_IT_PANICS: Status = Status::FAILED;

    fn raw(self) -> Status {
        self.err().unwrap_or(Status::OK)
    }
}

impl Returned for u32 {
    type Raw = u32;
    const IF_IT_PANICS: u32 = 0;

    fn raw(self) -> u32 {
        self
    }
}

pub extern "system" fn not_implemented() -> Status {
    Status::NOT_IMPLEMENTED
}

/// The methods of each facet come in the order of the interface. `_` is one that is not implemented.
macro_rules! class {
    ($class:ty $(, if $has:path)? { $($index:literal [$($id:expr),+] { $($method:tt($($argument:ident: $type:ty),*) $(-> $result:ty)?),* $(,)? })+ }) => {
        impl $crate::win32::com::Class for $class {
            type Facets = [*const *const (); [$($index),+].len()];
            const IDS: &'static [&'static [$crate::win32::com::Guid]] = &[$(&[$($id),+]),+];

            fn facets() -> Self::Facets {
                [$({
                    use $crate::win32::com::{Methods, Object};
                    static METHODS: Methods = Methods(&[
                        Object::<$class>::query::<$index> as *const (),
                        Object::<$class>::retain::<$index> as *const (),
                        Object::<$class>::release::<$index> as *const (),
                        $(class!(@method $class, $index, $method($($argument: $type),*) $(-> $result)?)),*
                    ]);
                    METHODS.0.as_ptr()
                }),+]
            }

            fn has(&self, _id: &$crate::win32::com::Guid) -> bool {
                true $(&& $has(self, _id))?
            }
        }
    };
    (@method $class:ty, $index:literal, _()) => { $crate::win32::com::not_implemented as *const () };
    (@method $class:ty, $index:literal, $method:ident($($argument:ident: $type:ty),*)) => {
        class!(@method $class, $index, $method($($argument: $type),*) -> $crate::win32::com::Status)
    };
    (@method $class:ty, $index:literal, $method:ident($($argument:ident: $type:ty),*) -> $result:ty) => {{
        unsafe extern "system" fn method(facet: *mut std::ffi::c_void, $($argument: $type),*) -> $result {
            // SAFETY: it is only among the methods of that facet.
            unsafe { $crate::win32::com::Object::<$class>::call(facet, $index, |it| it.$method($($argument),*)) }
        }
        method as *const ()
    }};
}

pub(crate) use class;

/// Where a method leaves a result. What is there is not valid before.
#[repr(transparent)]
pub struct Out<T>(*mut T);

impl<T> Out<T> {
    pub fn set(self, value: T) -> Outcome {
        if self.0.is_null() {
            return Err(Status::INVALID_ARGUMENT);
        }
        // SAFETY: only callers of methods make one, and it points to room for the result.
        unsafe { self.0.write(value) };
        Ok(())
    }
}

impl<T: Default> Out<T> {
    /// A result is sent to the caller even if the method has failed.
    pub fn answer(self, value: Outcome<T>) -> Outcome {
        match value {
            Ok(value) => self.set(value),
            Err(status) => self.set(T::default()).and(Err(status)),
        }
    }
}

// ───────────────────────────── values ─────────────────────────────

/// `BSTR`
#[repr(transparent)]
pub struct BasicString(*mut u16);

impl BasicString {
    pub fn new(text: &str) -> BasicString {
        BasicString::of(&text.encode_utf16().collect::<Vec<_>>())
    }

    pub fn of(units: &[u16]) -> BasicString {
        // SAFETY: a slice with its length.
        BasicString(unsafe { SysAllocStringLen(units.as_ptr(), units.len() as u32) })
    }

    /// As an argument.
    pub fn lent(&self) -> Str<'_> {
        // SAFETY: null, or there is a zero at the end.
        unsafe { Str::at(self.0) }
    }

    pub fn text(&self) -> String {
        match self.0.is_null() {
            true => String::new(),
            // SAFETY: it knows its length.
            false => String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(self.0, SysStringLen(self.0) as usize)
            }),
        }
    }
}

impl Default for BasicString {
    fn default() -> BasicString {
        BasicString(null_mut())
    }
}

impl Drop for BasicString {
    fn drop(&mut self) {
        // SAFETY: null, or this one's.
        unsafe { SysFreeString(self.0) };
    }
}

/// `HSTRING`
#[repr(transparent)]
#[derive(Default)]
pub struct RuntimeString(pub isize);

impl RuntimeString {
    pub fn new(text: &str) -> RuntimeString {
        let (units, mut string) = (
            text.encode_utf16().collect::<Vec<_>>(),
            RuntimeString::default(),
        );
        // SAFETY: a slice with its length. It stays empty if that fails.
        _ = unsafe { WindowsCreateString(units.as_ptr(), units.len() as u32, &mut string.0) };
        string
    }

    pub fn text(&self) -> String {
        let mut length = 0;
        // SAFETY: that many units, for as long as the string lives.
        String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(
                WindowsGetStringRawBuffer(self.0, &mut length),
                length as usize,
            )
        })
    }
}

impl Drop for RuntimeString {
    fn drop(&mut self) {
        // SAFETY: empty, or this one's.
        _ = unsafe { WindowsDeleteString(self.0) };
    }
}

/// From `CoTaskMemAlloc`.
#[repr(transparent)]
pub struct TaskString(NonNull<u16>);

impl TaskString {
    pub fn text(&self) -> String {
        // SAFETY: only functions that return strings make one.
        unsafe { string_at(self.0.as_ptr()) }
    }
}

impl Drop for TaskString {
    fn drop(&mut self) {
        // SAFETY: this one's.
        unsafe { CoTaskMemFree(self.0.as_ptr().cast()) };
    }
}

pub const VT_I4: u16 = 3;
pub const VT_R8: u16 = 5;
pub const VT_BSTR: u16 = 8;
pub const VT_BOOL: u16 = 11;
pub const VT_UNKNOWN: u16 = 13;
const VT_LPWSTR: u16 = 31;
const VT_CLSID: u16 = 72;
pub const VT_ARRAY: u16 = 0x2000;

/// `SAFEARRAY*`, which goes to whoever gets it.
#[repr(transparent)]
#[derive(Default)]
pub struct Array(isize);

impl Array {
    fn of<T>(kind: u16, all: &[T], address: impl Fn(&T) -> *const c_void) -> Array {
        let array = SafeArrayCreateVector(kind, 0, all.len() as u32);
        for (index, it) in (0..).zip(all) {
            // SAFETY: an element of that kind, which is copied.
            _ = unsafe { SafeArrayPutElement(array, &index, address(it)) };
        }
        Array(array)
    }

    pub fn of_integers(all: &[i32]) -> Array {
        Array::of(VT_I4, all, |it| std::ptr::from_ref(it).cast())
    }

    pub fn of_numbers(all: &[f64]) -> Array {
        Array::of(VT_R8, all, |it| std::ptr::from_ref(it).cast())
    }

    pub fn of_objects(all: &[Unknown]) -> Array {
        Array::of(VT_UNKNOWN, all, |it| it.as_ptr())
    }
}

/// `VARIANT` and `PROPVARIANT`
#[repr(C)]
#[derive(Default)]
pub struct Variant {
    kind: u16,
    reserved: [u16; 3],
    value: [u64; 2],
}

impl Variant {
    fn new(kind: u16, value: u64) -> Variant {
        Variant {
            kind,
            reserved: [0; 3],
            value: [value, 0],
        }
    }

    pub fn array(kind: u16, array: Array) -> Variant {
        Variant::new(kind | VT_ARRAY, array.0 as u64)
    }

    pub fn object(kind: u16, object: Unknown) -> Variant {
        Variant::new(kind, ManuallyDrop::new(object).as_ptr() as u64)
    }

    fn of_copy<T: Copy>(kind: u16, values: &[T]) -> Variant {
        let copy = CoTaskMemAlloc(size_of_val(values)).cast::<T>();
        if copy.is_null() {
            return Variant::default();
        }
        // SAFETY: there is room.
        unsafe { copy.copy_from_nonoverlapping(values.as_ptr(), values.len()) };
        Variant::new(kind, copy as u64)
    }

    /// As properties of the shell have it.
    pub fn of_text(text: &str) -> Variant {
        Variant::of_copy(
            VT_LPWSTR,
            &text.encode_utf16().chain([0]).collect::<Vec<_>>(),
        )
    }

    pub fn of_class(class: Guid) -> Variant {
        Variant::of_copy(VT_CLSID, &[class])
    }

    pub fn describe(&self) -> String {
        // SAFETY: the value is of that kind.
        unsafe {
            match self.kind {
                VT_LPWSTR | VT_BSTR if self.value[0] != 0 => string_at(self.value[0] as *const u16),
                VT_CLSID => (*(self.value[0] as *const Guid)).to_string(),
                _ => String::new(),
            }
        }
    }

    /// Of plain values and strings.
    pub fn is_like(&self, other: &Variant) -> bool {
        let text = |it: &Variant| ManuallyDrop::new(BasicString(it.value[0] as *mut u16)).text();
        self.kind == other.kind
            && match self.kind {
                VT_BSTR => text(self) == text(other),
                VT_BOOL => self.value[0] as u16 == other.value[0] as u16,
                VT_I4 => self.value[0] as u32 == other.value[0] as u32,
                _ => self.value[0] == other.value[0],
            }
    }
}

impl From<i32> for Variant {
    fn from(value: i32) -> Variant {
        Variant::new(VT_I4, u64::from(value as u32))
    }
}

impl From<f64> for Variant {
    fn from(value: f64) -> Variant {
        Variant::new(VT_R8, value.to_bits())
    }
}

impl From<bool> for Variant {
    fn from(value: bool) -> Variant {
        Variant::new(VT_BOOL, if value { 0xFFFF } else { 0 })
    }
}

impl From<&str> for Variant {
    fn from(value: &str) -> Variant {
        Variant::new(VT_BSTR, ManuallyDrop::new(BasicString::new(value)).0 as u64)
    }
}

impl Drop for Variant {
    fn drop(&mut self) {
        if self.kind > VT_R8 {
            _ = PropVariantClear(self);
        }
    }
}
