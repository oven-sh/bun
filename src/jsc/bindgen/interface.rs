//! What `b.interface` generates against: `src/jsc/bindings/Bindgen/JSInterface.h`.

use super::*;
use crate::DOMExceptionCode;
use bun_core::WTFStringImplStruct;
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};

/// Hands an argument to a body that takes it over or borrows it.
pub trait Pass<'s, To> {
    fn pass(&'s mut self) -> To;
}

impl<T> Pass<'_, T> for Option<T> {
    #[inline(always)]
    fn pass(&mut self) -> T {
        self.take().expect("passed once")
    }
}

impl<'s, T> Pass<'s, &'s T> for Option<T> {
    #[inline(always)]
    fn pass(&'s mut self) -> &'s T {
        self.as_ref().expect("passed once")
    }
}

impl<'s, T> Pass<'s, Option<&'s T>> for Option<Option<T>> {
    #[inline(always)]
    fn pass(&'s mut self) -> Option<&'s T> {
        self.as_ref()?.as_ref()
    }
}

impl<'s, T> Pass<'s, &'s [T]> for Option<Vec<T>> {
    #[inline(always)]
    fn pass(&'s mut self) -> &'s [T] {
        self.as_deref().unwrap_or_default()
    }
}

impl<T: Copy> Pass<'_, T> for &'static T {
    #[inline(always)]
    fn pass(&mut self) -> T {
        **self
    }
}

impl<T> Pass<'_, &'static T> for &'static T {
    #[inline(always)]
    fn pass(&mut self) -> &'static T {
        self
    }
}

unsafe extern "C" {
    static Bun__Bindgen__interfaceInfos: u8;
    static Bun__Bindgen__offsetOfBarrierThreshold: u32;
    static Bun__Bindgen__blockMask: usize;
    fn Bun__Bindgen__publishItems(
        list: *const c_void,
        addresses: *const usize,
        count: u32,
        offset_in_cell: usize,
        clock: *const u64,
    );
    fn Bun__Bindgen__writeBarrier(from: *const c_void, to: JSValue);
    safe fn Bun__Bindgen__constructorForInterface(global: &JSGlobalObject, number: u32) -> JSValue;
    safe fn Bun__Bindgen__prototypeForInterface(global: &JSGlobalObject, number: u32) -> JSValue;
    fn Bun__Bindgen__structureForNewTarget(
        global: &JSGlobalObject,
        new_target: JSValue,
        number: u32,
    ) -> *mut c_void;
    fn Bun__Bindgen__structureWithPrototype(
        global: &JSGlobalObject,
        prototype: JSValue,
        number: u32,
    ) -> *mut c_void;
    fn Bun__Bindgen__realmOf(object: JSValue) -> *const JSGlobalObject;
    fn Bun__Bindgen__setGlobalReceiver(global: &JSGlobalObject, receiver: JSValue);
    safe fn Bun__Bindgen__globalReceiver(global: &JSGlobalObject) -> JSValue;
    fn Bun__Bindgen__stringFromImpl(
        global: &JSGlobalObject,
        string: *const WTFStringImplStruct,
    ) -> JSValue;
    safe fn Bun__Bindgen__setExceptionAside(global: &JSGlobalObject) -> JSValue;
    fn Bun__Bindgen__restoreException(global: &JSGlobalObject, exception: JSValue);
    fn Bun__Bindgen__addPropertyName(names: &mut PropertyNames, name: *const WTFStringImplStruct);
    fn Bun__Bindgen__addUTF8PropertyName(names: &mut PropertyNames, name: *const u8, length: usize);
    fn Bun__Bindgen__interfaceObjectNamed(
        global: &JSGlobalObject,
        name: *const WTFStringImplStruct,
    ) -> JSValue;
    fn Bun__Bindgen__announceNamedProperty(object: JSValue);
    fn Bun__Bindgen__freezeArray(global: &JSGlobalObject, array: JSValue);
    fn Bun__Bindgen__hasEntry(global: &JSGlobalObject, entries: JSValue, key: JSValue) -> bool;
    fn Bun__Bindgen__removeEntry(global: &JSGlobalObject, entries: JSValue, key: JSValue) -> bool;
    fn Bun__Bindgen__addEntry(
        global: &JSGlobalObject,
        entries: JSValue,
        key: JSValue,
        value: JSValue,
    );
    fn Bun__Bindgen__clearEntries(global: &JSGlobalObject, entries: JSValue);
    fn Bun__Bindgen__getEntry(global: &JSGlobalObject, map: JSValue, key: JSValue) -> JSValue;
    fn Bun__Bindgen__listEntries(global: &JSGlobalObject, entries: JSValue) -> *mut c_void;
    safe fn Bun__Bindgen__createIteratorResult(
        global: &JSGlobalObject,
        value: JSValue,
        is_done: bool,
    ) -> JSValue;
    safe fn Bun__Bindgen__exposure(global: &JSGlobalObject) -> u8;
    fn Bun__Bindgen__createTypedArray(
        global: &JSGlobalObject,
        kind: crate::JSType,
        bytes: *const u8,
        count: usize,
    ) -> JSValue;
    fn Bun__Bindgen__createObservableArray(
        global: &JSGlobalObject,
        owner: JSValue,
        will_set: ObservableArrayHook,
        will_delete: ObservableArrayHook,
    ) -> JSValue;
    fn Bun__Bindgen__observableArrayValues(global: &JSGlobalObject, array: JSValue) -> *mut c_void;
    fn Bun__Bindgen__replaceObservableArray(
        global: &JSGlobalObject,
        array: JSValue,
        values: *const JSValue,
        count: usize,
    ) -> bool;
    safe fn Bun__Bindgen__instanceOfRealm(global: &JSGlobalObject, number: u32) -> JSValue;
    fn Bun__Bindgen__setInstanceOfRealm(global: &JSGlobalObject, number: u32, instance: JSValue);
    fn Bun__Bindgen__newDOMException(
        message: &WTFStringImplStruct,
        name: *const u8,
        length: usize,
    ) -> NonNull<c_void>;
    fn Bun__Bindgen__derefDOMException(wrapped: NonNull<c_void>);
    fn Bun__Bindgen__createDOMException(
        global: &JSGlobalObject,
        code: u8,
        message: *const u8,
        length: usize,
    ) -> JSValue;
}

#[doc(hidden)]
pub const MAX_INTERFACE_CELL_SIZE: usize = 512;
const INFO_SIZE: usize = 256;
const TYPE_OFFSET: usize = 5;
const CELL_STATE_OFFSET: usize = 7;
const VM_OFFSET_IN_BLOCK: usize = 8;
const IS_PRECISE_ALLOCATION: usize = 8;

#[inline(always)]
fn cell_of<T: JsPayload>(this: &T) -> *const c_void {
    // SAFETY: a reference to the struct of an interface points into its cell.
    unsafe { this.wrapper_value() }.encoded() as *const c_void
}

/// The struct of an interface. Once it has been given to [`Class::create`], a reference to it is a handle for the JS
/// object. The methods are for such a reference, and not for a value that has yet to be moved into an object.
///
/// # Safety
/// Implemented by generated code only.
pub unsafe trait JsInterface: JsPayload {
    /// What it extends, and so on to the end.
    type Root: JsInterface;
    /// What an instance is made from: itself, or the nearest hand-written struct among what it extends.
    type Struct: JsInterface;
    #[doc(hidden)]
    const INLINE_CAPACITY: usize;
    #[doc(hidden)]
    const CELL_TYPE: u8;
    #[doc(hidden)]
    const NUMBER: u32;
    #[doc(hidden)]
    const SPAN: u32;

    #[inline(always)]
    fn to_js(&self) -> JSValue {
        let value = JSValue::from_cell(cell_of(self));
        debug_assert!(Self::Root::is(value));
        value
    }

    #[inline(always)]
    fn wrapper(&self) -> JsWrapper<'_, Self> {
        // SAFETY: a cell is not at null.
        let cell = unsafe { NonNull::new_unchecked(cell_of(self).cast_mut().cast()) };
        JsWrapper(cell, PhantomData, PhantomData)
    }

    /// Not for an interface that is abstract.
    fn interface_object(heap: &JsHeap<'_>) -> JSValue {
        Bun__Bindgen__constructorForInterface(heap.global_object(), Self::NUMBER)
    }

    /// What [`set_of_realm`](Self::set_of_realm) was called on.
    fn of_realm<'a>(heap: &JsHeap<'a>) -> Option<&'a Self> {
        let global = heap.global_object();
        Self::from_js(heap, Bun__Bindgen__instanceOfRealm(global, Self::NUMBER))
    }

    /// The realm holds it. Not for an interface that is abstract.
    fn set_of_realm(&self, heap: &JsHeap<'_>) {
        // SAFETY: an object.
        unsafe {
            Bun__Bindgen__setInstanceOfRealm(heap.global_object(), Self::NUMBER, self.to_js())
        }
    }

    #[inline(always)]
    fn as_object<'a>(&self, _: &JsHeap<'a>) -> JsLocal<'a, JSObject> {
        JsLocal::from_raw(self.to_js())
    }

    /// Whether `value` is an instance. It may be empty.
    #[inline(always)]
    fn is(value: JSValue) -> bool {
        if value.is_empty() || !value.is_cell() {
            return false;
        }
        let cell = value.encoded() as *const c_void;
        // SAFETY: every cell has a type, and one of this type has a ClassInfo.
        unsafe {
            cell.byte_add(TYPE_OFFSET).cast::<u8>().read() == Self::CELL_TYPE
                && has_class_info_of::<Self>(cell)
        }
    }

    #[inline(always)]
    fn from_js<'a>(_: &JsHeap<'a>, value: JSValue) -> Option<&'a Self> {
        // SAFETY: it is an instance, which the reference holds while it is on the stack.
        Self::is(value).then(|| unsafe { Self::from_js_unchecked(value) })
    }

    /// # Safety
    /// `value` is an instance, and lives for `'a`.
    #[inline(always)]
    unsafe fn from_js_unchecked<'a>(value: JSValue) -> &'a Self {
        debug_assert!(Self::is(value));
        // SAFETY: the struct is at this offset.
        unsafe {
            &*(value.encoded() as *const c_void)
                .byte_add(Self::PAYLOAD_OFFSET)
                .cast()
        }
    }

    #[inline(always)]
    fn is_a<U: JsInterface<Root = Self::Root>>(&self) -> bool {
        // SAFETY: the cells of what has one root have the ClassInfo in one place.
        unsafe { has_class_info_of::<U>(cell_of(self)) }
    }

    #[inline(always)]
    fn downcast<U: JsInterface<Root = Self::Root>>(&self) -> Option<&U> {
        // SAFETY: it is an instance, and it is the object that `self` is in.
        self.is_a::<U>()
            .then(|| unsafe { U::from_js_unchecked(self.to_js()) })
    }

    /// What allocates in the realm that the object was made in.
    #[inline]
    fn realm<'h, 'a>(&self, _: &'h JsHeap<'a>) -> &'h JsHeap<'a> {
        // SAFETY: the reference holds the global object while it is on the stack.
        JsHeap::from_global(unsafe { &*Bun__Bindgen__realmOf(self.to_js()) })
    }
}

/// # Safety
/// `cell` has the type that the cells of `T` have.
#[inline(always)]
unsafe fn has_class_info_of<T: JsInterface>(cell: *const c_void) -> bool {
    // SAFETY: the ClassInfo follows the header, the butterfly and the inline properties.
    let info = unsafe {
        cell.byte_add(16 + 8 * T::INLINE_CAPACITY)
            .cast::<usize>()
            .read()
    };
    let first = (&raw const Bun__Bindgen__interfaceInfos).addr() + T::NUMBER as usize * INFO_SIZE;
    info.wrapping_sub(first) < T::SPAN as usize * INFO_SIZE
}

/// `JSC::EmbedderListItems`
#[repr(C)]
struct Items {
    /// The collector clears it from its own thread.
    items: AtomicUsize,
    time: AtomicU64,
    clock: *const AtomicU64,
}

/// What is published holds until this has been advanced.
#[repr(transparent)]
pub struct ItemsClock(AtomicU64);

impl ItemsClock {
    pub const fn new() -> ItemsClock {
        ItemsClock(AtomicU64::new(0))
    }

    /// From one thread only.
    #[inline(always)]
    pub fn advance(&self) {
        self.0.store(self.0.load(Relaxed) + 1, Relaxed);
    }
}

#[inline(always)]
fn items_of<T: PublishesItems>(this: &T) -> &Items {
    // SAFETY: JSInterface.cpp asserts the layout.
    unsafe { &*cell_of(this).byte_add(24).cast() }
}

/// # Safety
/// Implemented by generated code only.
pub unsafe trait PublishesItems: JsInterface + Sized {
    /// From now on the engine may answer indexed reads with them. It may collect no garbage meanwhile.
    ///
    /// # Safety
    /// They are instances that are alive. `clock` outlives the VM.
    unsafe fn publish_instances<T: JsInterface>(&self, items: &[*const T], clock: &ItemsClock) {
        let Ok(count) = u32::try_from(items.len()) else {
            return;
        };
        // SAFETY: the caller's contract.
        unsafe {
            Bun__Bindgen__publishItems(
                cell_of(self),
                items.as_ptr().cast(),
                count,
                T::PAYLOAD_OFFSET,
                clock.0.as_ptr(),
            )
        }
    }

    /// Likewise, for good.
    ///
    /// # Safety
    /// They are alive.
    unsafe fn publish_values(&self, items: &[JSValue]) {
        let Ok(count) = u32::try_from(items.len()) else {
            return;
        };
        // SAFETY: the caller's contract.
        unsafe {
            Bun__Bindgen__publishItems(
                cell_of(self),
                items.as_ptr().cast(),
                count,
                0,
                core::ptr::null(),
            )
        }
    }

    /// What was published last still holds. Whether it is still there.
    #[inline(always)]
    fn renew_items(&self) -> bool {
        let items = items_of(self);
        // SAFETY: the contract of `publish_instances`, or else it points to `time`.
        let now = unsafe { &*items.clock }.load(Relaxed);
        items.time.store(now, Relaxed);
        items.items.load(Relaxed) != 0
    }

    #[inline(always)]
    fn withdraw_items(&self) {
        items_of(self).items.store(0, Relaxed);
    }
}

impl<'a, T: JsInterface> JsWrapper<'a, T> {
    #[inline(always)]
    pub fn get(self) -> &'a T {
        // SAFETY: no member of an interface takes `&mut self`.
        unsafe { self.payload_ref() }
    }
}

impl<T: JsInterface> core::ops::Deref for JsWrapper<'_, T> {
    type Target = T;
    #[inline(always)]
    fn deref(&self) -> &T {
        self.get()
    }
}

/// What a body returns for an instance of `T`.
pub trait Instance<T> {
    fn into_instance(self) -> JSValue;
}
impl<T: JsInterface> Instance<T> for &T {
    #[inline(always)]
    fn into_instance(self) -> JSValue {
        self.to_js()
    }
}
impl<T: JsInterface> Instance<T> for JsWrapper<'_, T> {
    #[inline(always)]
    fn into_instance(self) -> JSValue {
        self.to_js()
    }
}

/// The room for the internal fields of a subclass, in its struct.
#[repr(transparent)]
pub struct Fields<const N: usize>(UnsafeCell<[JSValue; N]>);
impl<const N: usize> Default for Fields<N> {
    #[inline(always)]
    fn default() -> Self {
        Fields(UnsafeCell::new([JSValue::ZERO; N]))
    }
}

/// # Safety
/// The cell has an internal field at `offset`.
#[doc(hidden)]
#[inline(always)]
pub unsafe fn value_in_field<T: JsInterface>(this: &T, offset: usize) -> Option<JSValue> {
    // SAFETY: forwarded.
    unsafe { internal_field_at(this.to_js(), offset) }
}

/// # Safety
/// As [`value_in_field`], and it is empty or holds a `U`.
#[doc(hidden)]
#[inline(always)]
pub unsafe fn instance_in_field<T: JsInterface, U: JsInterface>(
    this: &T,
    offset: usize,
) -> Option<&U> {
    // SAFETY: forwarded. If the field is overwritten, the reference holds the object while it is on the stack.
    unsafe { value_in_field(this, offset).map(|value| U::from_js_unchecked(value)) }
}

/// `WriteBarrier::set`.
///
/// # Safety
/// As [`value_in_field`].
#[doc(hidden)]
#[inline(always)]
pub unsafe fn store_in_field<T: JsInterface>(this: &T, offset: usize, value: JSValue) {
    let cell = cell_of(this);
    // SAFETY: the field is in the cell. A cell that is no precise allocation is in a MarkedBlock, whose header has the VM.
    unsafe {
        cell.byte_add(offset)
            .cast::<JSValue>()
            .cast_mut()
            .write_volatile(value);
        if value.is_empty() || !value.is_cell() {
            return;
        }
        if cell as usize & IS_PRECISE_ALLOCATION == 0 {
            let block = (cell as usize & Bun__Bindgen__blockMask) as *const c_void;
            let vm = block
                .byte_add(VM_OFFSET_IN_BLOCK)
                .cast::<*const c_void>()
                .read();
            let threshold = vm
                .byte_add(Bun__Bindgen__offsetOfBarrierThreshold as usize)
                .cast::<u32>()
                .read_volatile();
            if u32::from(
                cell.byte_add(CELL_STATE_OFFSET)
                    .cast::<u8>()
                    .read_volatile(),
            ) > threshold
            {
                return;
            }
        }
        Bun__Bindgen__writeBarrier(cell, value);
    }
}

type CreateCell = unsafe extern "C" fn(*mut JSGlobalObject, u32, *mut c_void) -> NonNull<c_void>;

/// An interface whose instances are `T`s: `T` itself, or after [`widen`](Self::widen) one that extends it.
pub struct Class<T> {
    number: u32,
    create: CreateCell,
    instances: PhantomData<fn() -> T>,
}
impl<T> Clone for Class<T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Class<T> {}

impl<T: JsInterface> Class<T> {
    /// # Safety
    /// `create` makes a cell for `T`.
    #[doc(hidden)]
    pub const unsafe fn new(create: CreateCell) -> Self {
        Class {
            number: T::NUMBER,
            create,
            instances: PhantomData,
        }
    }

    /// For a table of interfaces that are made from one struct.
    pub const fn widen(self) -> Class<T::Struct>
    where
        T::Struct: JsInterface<Struct = T::Struct>,
    {
        Class {
            number: self.number,
            create: self.create,
            instances: PhantomData,
        }
    }

    #[inline(always)]
    pub fn create<'a>(self, heap: &JsHeap<'a>, payload: T::Struct) -> &'a T {
        // SAFETY: a null structure is that of the interface.
        unsafe { self.create_with(heap, core::ptr::null_mut(), payload) }
    }

    /// # Safety
    /// `structure` is null or for instances of this interface.
    #[inline(always)]
    unsafe fn create_with<'a>(
        self,
        heap: &JsHeap<'a>,
        structure: *mut c_void,
        payload: T::Struct,
    ) -> &'a T {
        // SAFETY: the cell fits the struct, and is an instance.
        unsafe {
            let create = |_| (self.create)(heap.global_ptr(), self.number, structure);
            T::from_js_unchecked(JsWrapper::create_with(heap, create, payload).to_js())
        }
    }

    /// # Safety
    /// `structure` is for instances of this interface, and the call `heap` belongs to holds it.
    #[doc(hidden)]
    #[inline(always)]
    pub unsafe fn structure_from_extern<'a>(
        self,
        structure: *mut c_void,
        _: &JsHeap<'a>,
    ) -> ClassStructure<'a, T> {
        ClassStructure(self, structure, PhantomData)
    }

    /// That of the interface itself.
    #[inline(always)]
    pub fn structure<'a>(self, _: &JsHeap<'a>) -> ClassStructure<'a, T> {
        ClassStructure(self, core::ptr::null_mut(), PhantomData)
    }

    /// What `new` makes an object with. It reads the `prototype` of `new_target`.
    pub fn structure_for_new_target<'a>(
        self,
        cx: &mut JsScope<'a>,
        new_target: JsLocal<'a, JSObject>,
    ) -> Result<'a, ClassStructure<'a, T>> {
        let global = cx.global();
        let mut structure = core::ptr::null_mut();
        crate::call_false_is_throw(global, || {
            // SAFETY: an object, and the number of an interface.
            structure =
                unsafe { Bun__Bindgen__structureForNewTarget(global, new_target.0, self.number) };
            !structure.is_null()
        })?;
        Ok(ClassStructure(self, structure, PhantomData))
    }

    /// For instances that inherit from `prototype`. It is cached.
    pub fn structure_with_prototype<'a>(
        self,
        heap: &JsHeap<'a>,
        prototype: JsLocal<'a, JSObject>,
    ) -> ClassStructure<'a, T> {
        // SAFETY: an object, and the number of an interface.
        let structure = unsafe {
            Bun__Bindgen__structureWithPrototype(heap.global_object(), prototype.0, self.number)
        };
        ClassStructure(self, structure, PhantomData)
    }

    /// The empty value if there is no interface object.
    pub fn constructor(self, heap: &JsHeap<'_>) -> JSValue {
        Bun__Bindgen__constructorForInterface(heap.global_object(), self.number)
    }

    pub fn prototype(self, heap: &JsHeap<'_>) -> JSValue {
        Bun__Bindgen__prototypeForInterface(heap.global_object(), self.number)
    }
}

/// The structure of an interface, or of a JavaScript class that extends it.
pub struct ClassStructure<'a, T>(Class<T>, *mut c_void, InvariantLifetime<'a>);

impl<'a, T: JsInterface> ClassStructure<'a, T> {
    #[inline(always)]
    pub fn create(self, heap: &JsHeap<'a>, payload: T::Struct) -> &'a T {
        // SAFETY: by construction.
        unsafe { self.0.create_with(heap, self.1, payload) }
    }
}

/// For a struct that has no `Cell`. A reference to such a struct is `noalias readonly`, so LLVM may drop what is
/// stored through it in the fields of the object, or in the struct of an interface that extends it.
#[derive(Default)]
pub struct Interior(UnsafeCell<()>);

impl Clone for Interior {
    fn clone(&self) -> Self {
        Self::default()
    }
}

#[doc(hidden)]
pub struct IsFreeze<T>(PhantomData<T>);
impl<T: core::marker::Freeze> IsFreeze<T> {
    pub const YES: bool = true;
}
#[doc(hidden)]
pub trait IsNotFreeze {
    const YES: bool = false;
}
impl<T> IsNotFreeze for IsFreeze<T> {}

/// The struct of an abstract interface with `prototypeBase: "DOMException"`.
#[repr(C)]
pub struct DomException(NonNull<c_void>, Interior);

impl DomException {
    pub fn new(message: &WTFStringImplStruct, name: &str) -> DomException {
        // SAFETY: a live StringImpl, and the pointer and the length of one slice.
        let wrapped = unsafe { Bun__Bindgen__newDOMException(message, name.as_ptr(), name.len()) };
        DomException(wrapped, Interior::default())
    }
}

impl Drop for DomException {
    fn drop(&mut self) {
        // SAFETY: `new` has the reference.
        unsafe { Bun__Bindgen__derefDOMException(self.0) }
    }
}

/// `receiver` is what the members of a `global` interface get when they are called on the global object.
pub fn set_global_receiver<T: JsInterface>(heap: &JsHeap<'_>, receiver: &T) {
    // SAFETY: an object.
    unsafe { Bun__Bindgen__setGlobalReceiver(heap.global_object(), receiver.to_js()) }
}

pub fn global_receiver<'a, T: JsInterface>(heap: &JsHeap<'a>) -> Option<&'a T> {
    T::from_js(heap, Bun__Bindgen__globalReceiver(heap.global_object()))
}

/// Runs `leave` with no exception pending, and ends with `returned`, which is empty if one was.
#[doc(hidden)]
#[inline(always)]
pub fn leave_after<'a>(
    returned: JSValue,
    cx: &mut JsScope<'a>,
    leave: impl FnOnce(&mut JsScope<'a>) -> crate::JsResult<()>,
) -> JSValue {
    let exception = if returned.is_empty() {
        Bun__Bindgen__setExceptionAside(cx.global())
    } else {
        JSValue::ZERO
    };
    if let Err(error) = leave(cx) {
        return Error::pending(error).into_host_fn_return(cx);
    }
    if !exception.is_empty() {
        // SAFETY: the `JSC::Exception` from above.
        unsafe { Bun__Bindgen__restoreException(cx.global(), exception) };
    }
    returned
}

/// The empty value with no exception pending says that there is no such property.
#[doc(hidden)]
#[inline(always)]
pub fn special_getter_return<'a, T, E: IntoError<'a>>(
    cx: &mut JsScope<'a>,
    result: core::result::Result<Option<T>, E>,
    convert: impl FnOnce(&JsHeap<'a>, T) -> Result<'a, JsLocal<'a>>,
) -> JSValue {
    match result.transpose() {
        Some(result) => host_fn_return(cx, result, convert),
        None => JSValue::ZERO,
    }
}

/// What `named_keys` fills, in order. A name that is added again keeps its first place.
#[repr(C)]
pub struct PropertyNames(UnsafeCell<[u8; 0]>, NotSend);

impl<'a, T> JsLocal<'a, T> {
    /// <https://webidl.spec.whatwg.org/#call-a-user-objects-operation>
    pub fn call_operation(
        self,
        cx: &mut JsScope<'a>,
        name: &'static str,
        arguments: &[JsLocal<'a>],
    ) -> Result<'a, JsLocal<'a>> {
        if let Some(function) = self.as_value().as_callable() {
            return function.call(cx, JsLocal::UNDEFINED, arguments);
        }
        let member = self.to_js().get(cx.global(), name)?;
        match member.and_then(|it| JsLocal::new(&cx.heap, it).as_callable()) {
            Some(function) => function.call(cx, self, arguments),
            None => Err(cx.heap.type_error(format_args!("{name} is not a function"))),
        }
    }
}

impl PropertyNames {
    pub fn add(&mut self, name: &WTFStringImplStruct) {
        // SAFETY: a live StringImpl.
        unsafe { Bun__Bindgen__addPropertyName(self, name) }
    }

    pub fn add_utf8(&mut self, name: &[u8]) {
        // SAFETY: C++ copies the bytes.
        unsafe { Bun__Bindgen__addUTF8PropertyName(self, name.as_ptr(), name.len()) }
    }
}

#[doc(hidden)]
#[inline(always)]
pub fn keep_alive<T: Copy>(value: T) {
    core::hint::black_box(value);
}

impl<'a> JsHeap<'a> {
    /// As [`error`](Self::error), a `DOMException`.
    #[cold]
    pub fn dom_exception(
        &self,
        code: DOMExceptionCode,
        args: core::fmt::Arguments<'_>,
    ) -> Error<'a> {
        Error::unthrown(self.create_dom_exception(code, args).0)
    }

    #[cold]
    pub fn create_dom_exception(
        &self,
        code: DOMExceptionCode,
        args: core::fmt::Arguments<'_>,
    ) -> JsLocal<'a, JSObject> {
        let message = args.to_string();
        // SAFETY: C++ copies the bytes.
        JsLocal::from_raw(unsafe {
            Bun__Bindgen__createDOMException(
                self.global_object(),
                code as u8,
                message.as_ptr(),
                message.len(),
            )
        })
    }

    /// The constructor, namespace or legacy factory function that JavaScript calls `name`, or `undefined`.
    pub fn interface_object(&self, name: &WTFStringImplStruct) -> JsLocal<'a> {
        // SAFETY: a live StringImpl.
        JsLocal::new(self, unsafe {
            Bun__Bindgen__interfaceObjectNamed(self.global_object(), name)
        })
    }

    /// For `announcesNames`: `named_get` of `object` is about to find another name.
    pub fn announce_named_property<T: JsInterface>(&self, object: &T) {
        // SAFETY: an object.
        unsafe { Bun__Bindgen__announceNamedProperty(object.to_js()) }
    }

    /// For an array that JavaScript has not seen.
    pub fn freeze_array(&self, array: JsLocal<'a, JSArray>) -> Result<'a, JsLocal<'a, JSArray>> {
        let global = self.global_object();
        // SAFETY: an object.
        crate::call_check_slow(global, || unsafe {
            Bun__Bindgen__freezeArray(global, array.0)
        })
        .map_err(Error::pending)?;
        Ok(array)
    }

    /// `{ value, done }`. `None` is the end.
    pub fn create_iterator_result(&self, value: Option<JSValue>) -> JsLocal<'a, JSObject> {
        JsLocal::from_raw(Bun__Bindgen__createIteratorResult(
            self.global_object(),
            value.unwrap_or(JSValue::UNDEFINED),
            value.is_none(),
        ))
    }

    pub fn is_window(&self) -> bool {
        Bun__Bindgen__exposure(self.global_object()) & 1 != 0
    }

    pub fn is_secure_context(&self) -> bool {
        Bun__Bindgen__exposure(self.global_object()) & 0x80 != 0
    }

    /// With a copy of `elements`.
    pub fn create_typed_array<T: TypedArrayElement>(
        &self,
        elements: &[T],
    ) -> Result<'a, JsLocal<'a, TypedArray<T>>> {
        let global = self.global_object();
        // SAFETY: that many elements of that kind.
        JsLocal::from_js_result(crate::call_zero_is_throw(global, || unsafe {
            Bun__Bindgen__createTypedArray(
                global,
                T::KIND,
                elements.as_ptr().cast(),
                elements.len(),
            )
        }))
    }

    /// An empty one. It holds `owner`.
    pub fn create_observable_array<T: ObservableArrayOwner>(
        &self,
        owner: &T,
    ) -> JsLocal<'a, ObservableArray> {
        macro_rules! hook {
            ($name:ident) => {{
                unsafe extern "C" fn hook<T: ObservableArrayOwner>(
                    global: *mut JSGlobalObject,
                    owner: JSValue,
                    value: JSValue,
                    index: u32,
                ) -> bool {
                    // SAFETY: C++ passes the owner from below, and holds what it passes.
                    unsafe {
                        JsScope::with(global, |cx| {
                            let owner = T::from_js_unchecked(owner);
                            let result = owner.$name(cx, JsLocal::from_raw(value), index);
                            !host_fn_return(cx, result, to_js::undefined).is_empty()
                        })
                    }
                }
                hook::<T>
            }};
        }
        // SAFETY: an object, and hooks for it.
        JsLocal::from_raw(unsafe {
            Bun__Bindgen__createObservableArray(
                self.global_object(),
                owner.to_js(),
                hook!(will_set),
                hook!(will_delete),
            )
        })
    }

    /// `jsStringWithCache`. The JS string takes a reference.
    #[inline]
    pub fn string_from_impl(&self, string: &WTFStringImplStruct) -> JsLocal<'a, JSString> {
        // SAFETY: a live StringImpl.
        JsLocal::from_raw(unsafe { Bun__Bindgen__stringFromImpl(self.global_object(), string) })
    }
}

#[doc(hidden)]
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternStringAndImpl {
    string: *mut c_void,
    characters: *const WTFStringImplStruct,
}
impl ExternStringAndImpl {
    #[inline(always)]
    pub fn is_null(self) -> bool {
        self.string.is_null()
    }
}

/// A result that is `.impl` or `.atom`.
pub trait IntoJsString<'a> {
    fn into_js_string(self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString>;
}
impl<'a> IntoJsString<'a> for JsLocal<'a, JSString> {
    #[inline(always)]
    fn into_js_string(self, _: &JsHeap<'a>) -> Self {
        self
    }
}
impl<'a> IntoJsString<'a> for &WTFStringImplStruct {
    #[inline(always)]
    fn into_js_string(self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        heap.string_from_impl(self)
    }
}

macro_rules! string_and_impl {
    ($($(#[$doc:meta])* $name:ident)*) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy)]
        pub struct $name<'a> {
            string: JsLocal<'a, JSString>,
            characters: &'a WTFStringImplStruct,
        }
        impl<'a> $name<'a> {
            /// # Safety
            /// Generated C++ just made `value`, for the call `heap` belongs to.
            #[doc(hidden)]
            #[inline(always)]
            pub unsafe fn from_extern(value: ExternStringAndImpl, heap: &JsHeap<'a>) -> Self {
                // SAFETY: the string keeps the characters while it is on the stack.
                unsafe {
                    Self {
                        string: JsLocal::from_cell(value.string, heap),
                        characters: &*value.characters,
                    }
                }
            }

            #[inline(always)]
            pub fn get(self) -> &'a WTFStringImplStruct {
                self.characters
            }

            #[inline(always)]
            pub fn string(self) -> JsLocal<'a, JSString> {
                self.string
            }

            #[doc(hidden)]
            #[inline(always)]
            pub fn keep_alive(self) {
                self.string.keep_alive();
            }
        }
        // SAFETY: `asElement` makes a string that has the characters.
        unsafe impl<'a> Element<'a> for $name<'a> {
            #[inline(always)]
            unsafe fn from_element(value: JSValue) -> Self {
                // SAFETY: the fiber of a string that is no rope is its StringImpl.
                let characters = unsafe {
                    &*(value.encoded() as *const *const WTFStringImplStruct)
                        .add(1)
                        .read()
                };
                Self {
                    string: JsLocal::from_raw(value),
                    characters,
                }
            }
        }
        impl<'a> IntoJsString<'a> for $name<'a> {
            #[inline(always)]
            fn into_js_string(self, _: &JsHeap<'a>) -> JsLocal<'a, JSString> {
                self.string
            }
        }
    )*};
}
string_and_impl! {
    /// A JS string that is no rope, and its `StringImpl`.
    JsStringImpl
    /// A JS string, and the `AtomStringImpl` with its characters.
    JsAtom
}

/// What a [`JsList`] holds.
///
/// # Safety
/// It undoes `asElement` in Bindgen/IDLConvert.h.
pub unsafe trait Element<'a> {
    /// # Safety
    /// `asElement` made `value` from a value of this type, and it lives for `'a`.
    #[doc(hidden)]
    unsafe fn from_element(value: JSValue) -> Self;
}

// SAFETY: the cell.
unsafe impl<'a, T: JsInterface> Element<'a> for &'a T {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        // SAFETY: forwarded.
        unsafe { T::from_js_unchecked(value) }
    }
}
// SAFETY: the value.
unsafe impl<'a, T> Element<'a> for JsLocal<'a, T> {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        JsLocal::from_raw(value)
    }
}
// SAFETY: `null` is none.
unsafe impl<'a, T: Element<'a>> Element<'a> for Option<T> {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        // SAFETY: forwarded.
        (!value.is_null()).then(|| unsafe { T::from_element(value) })
    }
}
// SAFETY: a boolean.
unsafe impl Element<'_> for bool {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        value == JSValue::TRUE
    }
}
macro_rules! numbers_are_elements {
    ($($type:ty)*) => {$(
        // SAFETY: a number that this type has.
        unsafe impl Element<'_> for $type {
            #[inline(always)]
            unsafe fn from_element(value: JSValue) -> Self {
                value.as_number() as $type
            }
        }
    )*};
}
numbers_are_elements!(i8 u8 i16 u16 i32 u32 f32 f64);

/// A `sequence<T>`, or the rest of the arguments.
pub struct JsList<'a, T> {
    values: *const JSValue,
    len: usize,
    /// Empty if the values are in a frame.
    owner: JSValue,
    elements: PhantomData<(InvariantLifetime<'a>, fn() -> T)>,
}
impl<T> Clone for JsList<'_, T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for JsList<'_, T> {}

impl<'a, T> JsList<'a, T> {
    /// # Safety
    /// `values` are `len` elements that something holds for the call `heap` belongs to.
    #[doc(hidden)]
    #[inline(always)]
    pub unsafe fn from_arguments(values: *const JSValue, len: usize, _: &JsHeap<'a>) -> Self {
        JsList {
            values,
            len,
            owner: JSValue::ZERO,
            elements: PhantomData,
        }
    }

    /// # Safety
    /// `cell` is null, or a `JSCellButterfly` of elements.
    #[doc(hidden)]
    #[inline(always)]
    pub unsafe fn from_cell(cell: *mut c_void, _: &JsHeap<'a>) -> Self {
        // SAFETY: forwarded.
        unsafe { Self::of_cell(cell) }
    }

    #[inline(always)]
    unsafe fn of_cell(cell: *const c_void) -> Self {
        let (values, len) = if cell.is_null() {
            (core::ptr::null(), 0)
        } else {
            // SAFETY: the header of the cell, the lengths, the elements.
            unsafe {
                let words = cell.cast::<JSValue>();
                (words.add(2), words.add(1).cast::<u32>().read() as usize)
            }
        };
        JsList {
            values,
            len,
            owner: JSValue::from_encoded(cell as usize),
            elements: PhantomData,
        }
    }

    #[inline(always)]
    pub fn len(self) -> usize {
        self.len
    }

    #[inline(always)]
    pub fn is_empty(self) -> bool {
        self.len == 0
    }
}

impl<'a, T: Element<'a>> JsList<'a, T> {
    #[inline(always)]
    pub fn get(self, index: usize) -> Option<T> {
        if index >= self.len {
            return None;
        }
        // SAFETY: by construction.
        let element = unsafe { T::from_element(self.values.add(index).read()) };
        core::hint::black_box(self.owner);
        Some(element)
    }

    #[inline(always)]
    pub fn iter(self) -> JsListIter<'a, T> {
        JsListIter(self)
    }
}

impl<'a, T: Element<'a>> IntoIterator for JsList<'a, T> {
    type Item = T;
    type IntoIter = JsListIter<'a, T>;
    #[inline(always)]
    fn into_iter(self) -> JsListIter<'a, T> {
        JsListIter(self)
    }
}

pub struct JsListIter<'a, T>(JsList<'a, T>);

impl<'a, T: Element<'a>> Iterator for JsListIter<'a, T> {
    type Item = T;
    #[inline(always)]
    fn next(&mut self) -> Option<T> {
        let first = self.0.get(0)?;
        self.0.values = self.0.values.wrapping_add(1);
        self.0.len -= 1;
        Some(first)
    }
    #[inline(always)]
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.0.len, Some(self.0.len))
    }
}
impl<'a, T: Element<'a>> DoubleEndedIterator for JsListIter<'a, T> {
    #[inline(always)]
    fn next_back(&mut self) -> Option<T> {
        let last = self.0.get(self.0.len.checked_sub(1)?)?;
        self.0.len -= 1;
        Some(last)
    }
}
impl<'a, T: Element<'a>> ExactSizeIterator for JsListIter<'a, T> {}

// SAFETY: the array.
unsafe impl<'a, T> Element<'a> for JsList<'a, T> {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        // SAFETY: forwarded.
        unsafe { Self::of_cell(value.encoded() as *const c_void) }
    }
}

/// A `record<K, V>`. Two keys that differ in their lone surrogates alone are the same `USVString`: the last one counts.
pub struct JsRecord<'a, K, V>(JsList<'a, JsLocal<'a>>, PhantomData<fn() -> (K, V)>);
impl<K, V> Clone for JsRecord<'_, K, V> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<K, V> Copy for JsRecord<'_, K, V> {}

impl<'a, K: Element<'a>, V: Element<'a>> JsRecord<'a, K, V> {
    /// # Safety
    /// As [`JsList::from_cell`]. Keys and values alternate.
    #[doc(hidden)]
    #[inline(always)]
    pub unsafe fn from_cell(cell: *mut c_void, heap: &JsHeap<'a>) -> Self {
        // SAFETY: forwarded.
        JsRecord(unsafe { JsList::from_cell(cell, heap) }, PhantomData)
    }

    #[inline]
    pub fn iter(self) -> impl Iterator<Item = (K, V)> {
        let mut values = self.0.iter();
        core::iter::from_fn(move || {
            let (key, value) = (values.next()?, values.next()?);
            // SAFETY: by construction.
            Some(unsafe { (K::from_element(key.0), V::from_element(value.0)) })
        })
    }
}

// SAFETY: the array.
unsafe impl<'a, K, V> Element<'a> for JsRecord<'a, K, V> {
    #[inline(always)]
    unsafe fn from_element(value: JSValue) -> Self {
        // SAFETY: forwarded.
        JsRecord(unsafe { JsList::from_element(value) }, PhantomData)
    }
}

/// `b.typedArray`: a buffer or a view whose elements are `T`s.
pub struct TypedArray<T>(PhantomData<T>);

impl<'a, T: bun_core::AnyBitPattern> JsLocal<'a, TypedArray<T>> {
    #[inline(always)]
    pub fn as_buffer_source(self) -> JsLocal<'a, BufferSource> {
        JsLocal::from_raw(self.0)
    }

    /// `value` is what [`JsHeap`] or [`ArrayBuffer`] has just made, of the kind that the schema names.
    #[inline(always)]
    pub fn from_buffer_source(value: JsLocal<'a, BufferSource>) -> Self {
        JsLocal::from_raw(value.0)
    }

    /// The elements as they are now. A detached or out-of-bounds view is empty.
    #[inline]
    pub fn with_elements<R>(
        self,
        heap: &JsHeap<'a>,
        f: impl FnOnce(&[bun_core::Unaligned<T>]) -> R,
    ) -> R {
        self.as_buffer_source()
            .with_bytes(heap, |bytes| f(bun_core::Unaligned::slice_of(bytes)))
    }
}

/// The `Map` behind what is `maplike`.
pub struct MapEntries(());
/// The `Set` behind what is `setlike`.
pub struct SetEntries(());

fn checked<'a, R>(heap: &JsHeap<'a>, f: impl FnOnce(&JSGlobalObject) -> R) -> Result<'a, R> {
    let global = heap.global_object();
    crate::call_check_slow(global, || f(global)).map_err(Error::pending)
}

macro_rules! entries {
    ($($type:ty)*) => {$(
        impl<'a> JsLocal<'a, $type> {
            pub fn has(self, heap: &JsHeap<'a>, key: JSValue) -> Result<'a, bool> {
                // SAFETY: a `Map` or a `Set`.
                checked(heap, |global| unsafe { Bun__Bindgen__hasEntry(global, self.0, key) })
            }

            pub fn remove(self, heap: &JsHeap<'a>, key: JSValue) -> Result<'a, bool> {
                // SAFETY: a `Map` or a `Set`.
                checked(heap, |global| unsafe { Bun__Bindgen__removeEntry(global, self.0, key) })
            }

            pub fn clear(self, heap: &JsHeap<'a>) -> Result<'a, ()> {
                // SAFETY: a `Map` or a `Set`.
                checked(heap, |global| unsafe { Bun__Bindgen__clearEntries(global, self.0) })
            }

            fn list(self, heap: &JsHeap<'a>) -> Result<'a, JsList<'a, JsLocal<'a>>> {
                // SAFETY: a `Map` or a `Set`.
                let array = checked(heap, |global| unsafe {
                    Bun__Bindgen__listEntries(global, self.0)
                })?;
                // SAFETY: nothing else has the array.
                Ok(unsafe { JsList::of_cell(array) })
            }
        }
    )*};
}
entries!(MapEntries SetEntries);

impl<'a> JsLocal<'a, MapEntries> {
    /// `undefined` if there is none.
    pub fn get(self, heap: &JsHeap<'a>, key: JSValue) -> Result<'a, JSValue> {
        // SAFETY: a `Map`.
        checked(heap, |global| unsafe {
            Bun__Bindgen__getEntry(global, self.0, key)
        })
    }

    pub fn set(self, heap: &JsHeap<'a>, key: JSValue, value: JSValue) -> Result<'a, ()> {
        // SAFETY: a `Map`.
        checked(heap, |global| unsafe {
            Bun__Bindgen__addEntry(global, self.0, key, value)
        })
    }

    /// As they are now.
    pub fn entries(self, heap: &JsHeap<'a>) -> Result<'a, JsRecord<'a, JsLocal<'a>, JsLocal<'a>>> {
        Ok(JsRecord(self.list(heap)?, PhantomData))
    }
}

impl<'a> JsLocal<'a, SetEntries> {
    pub fn add(self, heap: &JsHeap<'a>, value: JSValue) -> Result<'a, ()> {
        // SAFETY: a `Set`.
        checked(heap, |global| unsafe {
            Bun__Bindgen__addEntry(global, self.0, value, value)
        })
    }

    /// As they are now.
    pub fn values(self, heap: &JsHeap<'a>) -> Result<'a, JsList<'a, JsLocal<'a>>> {
        self.list(heap)
    }
}

pub trait TypedArrayElement: bun_core::NoUninit {
    #[doc(hidden)]
    const KIND: crate::JSType;
}
macro_rules! typed_array_elements {
    ($($type:ty: $kind:ident)*) => {$(
        impl TypedArrayElement for $type {
            const KIND: crate::JSType = crate::JSType::$kind;
        }
    )*};
}
typed_array_elements!(
    i8: Int8Array u8: Uint8Array i16: Int16Array u16: Uint16Array i32: Int32Array u32: Uint32Array
    f32: Float32Array f64: Float64Array
);

type ObservableArrayHook = unsafe extern "C" fn(*mut JSGlobalObject, JSValue, JSValue, u32) -> bool;

/// WebIDL's `ObservableArray<T>`, where `T` is an interface.
pub struct ObservableArray(());

pub trait ObservableArrayOwner: JsInterface {
    /// `value` is what JavaScript assigns. It fails if that is no `T`.
    fn will_set<'a>(&self, cx: &mut JsScope<'a>, value: JsLocal<'a>, index: u32) -> Result<'a, ()>;
    fn will_delete<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value: JsLocal<'a>,
        index: u32,
    ) -> Result<'a, ()>;
}

impl<'a> JsLocal<'a, ObservableArray> {
    /// # Safety
    /// [`JsHeap::create_observable_array`] made `value`.
    pub unsafe fn from_js_unchecked(_: &JsHeap<'a>, value: JSValue) -> Self {
        JsLocal::from_raw(value)
    }

    /// As they are now.
    pub fn values(self, heap: &JsHeap<'a>) -> Result<'a, JsList<'a, JsLocal<'a>>> {
        // SAFETY: an observable array.
        let array = checked(heap, |global| unsafe {
            Bun__Bindgen__observableArrayValues(global, self.0)
        })?;
        // SAFETY: nothing else has the array.
        Ok(unsafe { JsList::of_cell(array) })
    }

    /// What assigning to the attribute does.
    pub fn replace<T>(self, cx: &mut JsScope<'a>, values: JsList<'a, T>) -> Result<'a, ()> {
        let global = cx.global();
        // SAFETY: an observable array, and values that `owner` holds.
        let result = crate::call_false_is_throw(global, || unsafe {
            Bun__Bindgen__replaceObservableArray(global, self.0, values.values, values.len)
        });
        core::hint::black_box(values.owner);
        result.map_err(Error::pending)
    }
}
