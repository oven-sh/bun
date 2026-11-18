use core::cell::UnsafeCell;
use core::marker::{PhantomData, PhantomPinned};
use core::ops::Deref;

use bun_alloc::AllocError;
use bun_engine_text::{StringBuilder, StringRef, Text};

use crate::heap::stack::stack_pointer;
use crate::{
    ElementKind, Gc, GcFree, GlobalObject, JsArray, JsFinalObject, JsObject, JsString, Storage,
    Traps, Value, Vm,
};

/// The current realm, and the right to use the heap. With `&Cx`, or the `&Vm` that it gives, code may allocate, which
/// may collect. Only with `&mut Cx` may it run scripts. It has no size, and its address is that of the global object.
#[repr(C)]
pub struct Cx {
    /// Stores to the global object go through a pointer that is made from `&Cx`.
    _nothing: UnsafeCell<[u8; 0]>,
    _not_shared: PhantomData<*mut ()>,
    _not_unique: PhantomPinned,
}

impl !GcFree for Cx {}

/// An exception is pending in the `Vm`.
#[must_use]
#[derive(Debug)]
pub struct Thrown(());

impl Thrown {
    #[inline(always)]
    pub(crate) const fn new() -> Thrown {
        Thrown(())
    }
}

pub type JsResult<T> = Result<T, Thrown>;

const _: () = assert!(size_of::<JsResult<Value>>() == size_of::<u64>());

/// While it is alive nothing is allocated in the heap and no script runs.
pub struct NoGc<'a>(PhantomData<&'a mut Cx>);

impl Cx {
    /// # Safety
    /// On the thread of the `Vm`, and whoever else has a `Cx` of it is inside a call that borrows that in the way in
    /// which this one is used.
    #[inline(always)]
    pub unsafe fn from_global<'a>(global: Gc<GlobalObject>) -> &'a mut Cx {
        // SAFETY: a reference to nothing.
        unsafe { &mut *global.as_ptr().cast() }
    }

    #[inline(always)]
    pub fn global(&self) -> Gc<GlobalObject> {
        // SAFETY: what it was made from, which the reference keeps alive.
        unsafe { Gc::from_address(core::ptr::from_ref(self).expose_provenance()) }
    }

    #[inline(always)]
    pub fn vm(&self) -> &Vm {
        // SAFETY: outlives its cells.
        unsafe { &*self.global().vm_ptr() }
    }

    #[inline(always)]
    pub fn in_realm(&mut self, global: Gc<GlobalObject>) -> &mut Cx {
        // SAFETY: borrows `self`.
        unsafe { Cx::from_global(global) }
    }

    #[inline(always)]
    pub fn in_realm_shared(&self, global: Gc<GlobalObject>) -> &Cx {
        // SAFETY: as above.
        unsafe { Cx::from_global(global) }
    }

    #[inline(always)]
    pub fn in_realm_of(&mut self, object: &JsObject) -> &mut Cx {
        match object.realm() {
            Some(global) => self.in_realm(global),
            None => self,
        }
    }

    #[inline(always)]
    pub fn no_gc(&mut self) -> NoGc<'_> {
        NoGc(PhantomData)
    }

    /// For a loop that can take long. It has to end for them to be handled.
    #[inline(always)]
    pub(crate) fn no_gc_with_traps(&mut self) -> (NoGc<'_>, &Traps) {
        (NoGc(PhantomData), self.traps())
    }

    #[inline(always)]
    pub fn check_exception(&self) -> JsResult<()> {
        if self.has_exception() {
            return Err(Thrown::new());
        }
        Ok(())
    }

    /// In native code that recurses on input.
    #[inline(always)]
    pub fn check_stack(&self) -> JsResult<()> {
        if stack_pointer() < self.soft_stack_limit() {
            return Err(self.throw_stack_overflow());
        }
        Ok(())
    }

    /// In a native loop that can take long.
    #[inline(always)]
    pub fn check_traps(&mut self) -> JsResult<()> {
        if self.traps().need_handling() {
            return self.handle_traps();
        }
        Ok(())
    }

    #[inline(always)]
    pub fn or_out_of_memory<T>(&self, result: Result<T, AllocError>) -> JsResult<T> {
        result.map_err(|_| self.throw_out_of_memory())
    }

    #[inline]
    pub fn new_object(&self) -> Gc<JsObject> {
        JsFinalObject::create(self, self.object_shape()).upcast()
    }

    pub fn new_object_with_null_prototype(&self) -> Gc<JsObject> {
        JsFinalObject::create(self, self.null_prototype_object_shape()).upcast()
    }

    /// OrdinaryObjectCreate
    pub fn new_object_with_prototype(&self, prototype: Option<Gc<JsObject>>) -> Gc<JsObject> {
        match prototype {
            Some(prototype) => self.global().new_object_with_prototype(self, prototype),
            None => self.new_object_with_null_prototype(),
        }
    }

    #[inline]
    pub fn new_array(&self) -> Gc<JsArray> {
        let shape = self.global().array_shape(ElementKind::Undecided);
        JsArray::try_create(self, shape, 0, 0).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    /// Empty.
    pub fn new_array_with_capacity(
        &self,
        kind: ElementKind,
        capacity: usize,
    ) -> JsResult<Gc<JsArray>> {
        let capacity = capacity.min(Storage::MAX_VECTOR_LENGTH as usize) as u32;
        let shape = self.global().array_shape(kind);
        self.or_out_of_memory(JsArray::try_create(self, shape, 0, capacity))
    }

    /// ArrayCreate
    pub fn new_array_with_length(&self, kind: ElementKind, length: u32) -> JsResult<Gc<JsArray>> {
        let shape = self.global().array_shape(kind);
        self.or_out_of_memory(JsArray::try_create(self, shape, length, 0))
    }

    /// CreateArrayFromList
    #[inline]
    pub fn new_array_from(&self, values: &[Value]) -> JsResult<Gc<JsArray>> {
        let kind = ElementKind::Undecided.generalized_for_slice(values);
        JsArray::from_values(self, kind, values)
    }

    /// An entry, such as a key and its value.
    #[inline(always)]
    pub fn new_pair(&self, first: Value, second: Value) -> JsResult<Gc<JsArray>> {
        JsArray::from_values(self, ElementKind::Contiguous, &[first, second])
    }

    /// CreateIteratorResultObject
    #[inline]
    pub fn new_iterator_result(&self, value: Value, done: bool) -> Gc<JsObject> {
        let shape = self.iterator_result_shape();
        JsFinalObject::create_with_values(self, shape, &[value, done.into()]).upcast()
    }

    #[inline]
    pub fn new_string(&self, text: Text<'_>) -> JsResult<Gc<JsString>> {
        self.or_out_of_memory(JsString::try_from_text(self, text))
    }

    pub fn new_string_from_parts(&self, parts: &[Text<'_>]) -> JsResult<Gc<JsString>> {
        let string = self.or_out_of_memory(StringRef::try_concat(parts))?;
        Ok(JsString::new(self, string))
    }

    pub fn finish_string(&self, builder: StringBuilder) -> JsResult<Gc<JsString>> {
        Ok(JsString::new(
            self,
            self.or_out_of_memory(builder.finish())?,
        ))
    }
}

impl Deref for Cx {
    type Target = Vm;

    #[inline(always)]
    fn deref(&self) -> &Vm {
        self.vm()
    }
}
