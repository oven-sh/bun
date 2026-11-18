use core::mem::offset_of;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_macros::cell;
use bun_engine_number::to_length;
use bun_engine_text::{PropertyName, names, symbols};

use crate::code::metadata::StrongCell;
use crate::{
    Attributes, CodeBlock, Cx, Field, Gc, GlobalObject, JsObject, JsObjectInit, JsResult,
    PlainRegExp, PropertyOffset, RealmSlot, RealmWatchpoint, RegExp, Shape, ShapeFlags, ShapeSpec,
    Value, Visitor, Vm, options,
};

#[cell(name = "RegExp", cell_type = RegExpObject, export = "engine_class_RegExpObject", visit_children)]
pub struct RegExpObject {
    base: JsObject,
    /// The slot of `lastIndex`, which is an ordinary property.
    pub(self) first_slot: Field<Option<Value>>,
    regexp_and_flags: AtomicUsize,
}

const LAST_INDEX: PropertyOffset = PropertyOffset::new(0);

const _: () = assert!(RegExpObject::OFFSET_OF_LAST_INDEX as isize == LAST_INDEX.byte_offset());

impl RegExpObject {
    /// The first inline slot. With the original shape it has any value of the language, and may be stored to like any
    /// other slot, since nothing watches it.
    pub const OFFSET_OF_LAST_INDEX: usize = offset_of!(RegExpObject, first_slot);
    /// The `RegExp`, in all but `FLAG_MASK`. It changes only after `NoRegExpIsRecompiled` of the realm of the object has
    /// fired.
    pub const OFFSET_OF_REGEXP_AND_FLAGS: usize = offset_of!(RegExpObject, regexp_and_flags);
    pub const LACKS_LEGACY_FEATURES: usize = 1;
    /// See `literal_as_receiver`. What is about to show it to a script shows a copy.
    pub const IS_SHARED_LITERAL: usize = 2;
    pub const FLAG_MASK: usize = 3;

    pub fn create_shape(vm: &Vm, global: Gc<GlobalObject>, prototype: Gc<JsObject>) -> Gc<Shape> {
        let spec = ShapeSpec::of::<RegExpObject>().with_inline_capacity(1);
        let empty = Shape::create(vm, Some(global), prototype.into(), spec);
        let shape = Self::with_last_index(vm, empty);
        shape.did_cache_property_replacement(vm, LAST_INDEX);
        shape
    }

    fn with_last_index(vm: &Vm, empty: Gc<Shape>) -> Gc<Shape> {
        let attributes = Attributes::DONT_ENUM | Attributes::DONT_DELETE;
        let (shape, offset) = empty.add_property_transition(vm, names::lastIndex, attributes);
        assert!(offset == LAST_INDEX);
        shape
    }

    #[inline(always)]
    fn allocate(vm: &Vm, shape: Gc<Shape>, regexp: Gc<RegExp>, flags: usize) -> Gc<RegExpObject> {
        let object = vm.allocate::<RegExpObject>(RegExpObjectInit {
            base: JsObjectInit::new(vm, shape),
            first_slot: Some(Value::ZERO),
            regexp_and_flags: AtomicUsize::new(regexp.address() | flags),
        });
        regexp.keep_alive();
        object
    }

    #[inline]
    pub fn create(cx: &Cx, regexp: Gc<RegExp>) -> Gc<RegExpObject> {
        Self::create_with_shape(cx, cx.regexp_shape(), regexp)
    }

    /// `shape` is the `regexp_shape` of some realm.
    #[inline]
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>, regexp: Gc<RegExp>) -> Gc<RegExpObject> {
        Self::allocate(vm, shape, regexp, 0)
    }

    /// For a `new.target` other than `RegExp`. `shape` is what `shape_from_new_target` makes of `regexp_shape`.
    pub fn create_derived(vm: &Vm, shape: Gc<Shape>, regexp: Gc<RegExp>) -> Gc<RegExpObject> {
        let shape = match shape.max_offset().is_valid() {
            true => shape,
            false => Self::with_last_index(vm, shape),
        };
        Self::allocate(vm, shape, regexp, Self::LACKS_LEGACY_FEATURES)
    }

    /// For `new_reg_exp`.
    #[inline]
    pub fn for_literal(cx: &Cx, regexp: Gc<RegExp>) -> JsResult<Gc<RegExpObject>> {
        regexp.check_literal(cx)?;
        Ok(Self::create(cx, regexp))
    }

    /// For `new_shared_reg_exp`.
    ///
    /// # Safety
    /// `shared` is in the metadata of `code_block`, for an instruction of that kind.
    #[inline]
    pub unsafe fn literal_as_receiver(
        cx: &Cx,
        code_block: &CodeBlock,
        regexp: Gc<RegExp>,
        for_test: bool,
        shared: &StrongCell,
    ) -> JsResult<Gc<RegExpObject>> {
        let can_share = cx.holds(RealmWatchpoint::RegExpPrimordialProperties)
            && (!for_test || cx.holds(RealmWatchpoint::RegExpPrototypeTest));
        if can_share && let Some(object) = shared.0.get() {
            // SAFETY: what is stored below.
            let object = unsafe { object.cast_unchecked::<RegExpObject>() };
            if object.is_untouched_shared_literal(cx, regexp) {
                return Ok(object);
            }
        }
        regexp.check_literal(cx)?;
        let can_share = can_share && options().use_shared_regexp_literals;
        let flags = usize::from(can_share) * Self::IS_SHARED_LITERAL;
        let object = Self::allocate(cx, cx.regexp_shape(), regexp, flags);
        // SAFETY: the caller's.
        unsafe { (shared.0).set(code_block, can_share.then_some(object.cell())) };
        Ok(object)
    }

    /// A debugger can get at it.
    #[inline(always)]
    pub fn is_untouched_shared_literal(&self, cx: &Cx, regexp: Gc<RegExp>) -> bool {
        self.word() == regexp.address() | Self::IS_SHARED_LITERAL
            && self.has_original_shape(cx)
            && self.first_slot() == Some(Value::ZERO)
    }

    /// The object itself, unless no script may see that.
    #[inline]
    pub fn unshared(&self, cx: &Cx) -> Gc<RegExpObject> {
        if self.word() & Self::IS_SHARED_LITERAL == 0 {
            return self.into();
        }
        let global = self.realm().unwrap_or_else(|| cx.global());
        Self::allocate(cx, global.regexp_shape(cx), self.regexp(), 0)
    }

    #[inline(always)]
    fn word(&self) -> usize {
        self.regexp_and_flags.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub fn regexp(&self) -> Gc<RegExp> {
        // SAFETY: visited.
        unsafe { Gc::from_address(self.word() & !Self::FLAG_MASK) }
    }

    pub fn has_legacy_features(&self) -> bool {
        self.word() & Self::LACKS_LEGACY_FEATURES == 0
    }

    /// In the realm of the object.
    pub fn recompile(&self, cx: &mut Cx, regexp: Gc<RegExp>) -> JsResult<()> {
        let global = cx.global();
        (global.watchpoints_unchecked(RealmWatchpoint::NoRegExpIsRecompiled)).fire(cx);
        let word = regexp.address() | self.word() & Self::FLAG_MASK;
        self.regexp_and_flags.store(word, Ordering::Relaxed);
        self.write_barrier_for_cell();
        self.set_last_index(cx, 0)
    }

    pub fn last_index(&self) -> Value {
        let value = self.first_slot().filter(|it| !it.is_accessor_cell());
        value.unwrap_or_default()
    }

    /// ToLength(Get(O, "lastIndex"))
    #[inline(always)]
    pub(super) fn get_last_index(&self, cx: &mut Cx) -> JsResult<u64> {
        match self.first_slot().and_then(Value::as_index_int32) {
            Some(index) => Ok(index.into()),
            None => self.get(cx, names::lastIndex)?.to_length(cx),
        }
    }

    /// The same, if the slot has a number.
    #[inline(always)]
    pub(super) fn numeric_last_index(&self) -> u64 {
        match self.first_slot().and_then(Value::as_index_int32) {
            Some(index) => index.into(),
            None => (self.first_slot().and_then(Value::as_number)).map_or(0, to_length),
        }
    }

    #[inline(always)]
    fn can_store_last_index(&self) -> bool {
        !self.shape().has(
            ShapeFlags::HAS_ANY_ACCESSOR
                | ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO
                | ShapeFlags::IS_WATCHING_REPLACEMENT,
        )
    }

    /// Set(O, "lastIndex", index, true)
    #[inline(always)]
    pub fn set_last_index(&self, cx: &mut Cx, index: u64) -> JsResult<()> {
        if !self.can_store_last_index() {
            return self.set(cx, names::lastIndex, index.into(), true).map(drop);
        }
        self.store_last_index(index);
        Ok(())
    }

    #[inline(always)]
    pub(super) fn store_last_index(&self, index: u64) {
        debug_assert!(self.can_store_last_index());
        // SAFETY: no cell.
        unsafe { self.first_slot.set_without_barrier(Some(index.into())) };
    }

    #[inline(always)]
    pub(super) fn numeric_last_index_value(&self) -> Option<Value> {
        self.first_slot().filter(|it| it.is_number())
    }

    pub(super) fn restore_last_index(&self, number: Option<Value>) {
        assert!(number.is_some_and(Value::is_number));
        // SAFETY: no cell.
        unsafe { self.first_slot.set_without_barrier(number) };
    }

    #[inline(always)]
    fn has_numeric_last_index(&self) -> bool {
        self.first_slot().is_some_and(Value::is_number)
    }

    /// Whether `lastIndex` can be read and written without anybody noticing. The original shape allows the write.
    #[inline(always)]
    pub(crate) fn is_plain(&self) -> bool {
        self.has_numeric_last_index() && self.can_store_last_index()
    }

    #[inline(always)]
    fn has_original_shape(&self, cx: &Cx) -> bool {
        let original = cx.global().slot_if_initialized(RealmSlot::regexp_shape);
        original.is_some_and(|it| it == self.shape())
    }

    /// Whether the methods with symbols for names, and all that they look up, are those of this realm and run no script.
    #[inline(always)]
    pub fn is_pristine(&self, cx: &Cx) -> bool {
        self.has_original_shape(cx)
            && self.has_numeric_last_index()
            && cx.holds(RealmWatchpoint::RegExpPrimordialProperties)
    }

    #[inline(always)]
    pub fn as_pristine<'a>(&self, cx: &'a Cx) -> Option<PlainRegExp<'a>> {
        self.is_pristine(cx).then(|| PlainRegExp::new(cx, self))
    }

    /// And what SpeciesConstructor finds.
    #[inline(always)]
    pub fn as_pristine_with_species<'a>(&self, cx: &'a Cx) -> Option<PlainRegExp<'a>> {
        (self.as_pristine(cx)).filter(|_| cx.holds(RealmWatchpoint::RegExpSpecies))
    }

    /// Whether these of the primordial properties are those of the realm.
    #[inline(always)]
    pub fn inherits_pristine(&self, cx: &Cx, properties: &[PropertyName<'_>]) -> bool {
        (self.has_original_shape(cx) || self.inherits_from_original(cx, properties))
            && cx.holds(RealmWatchpoint::RegExpPrimordialProperties)
    }

    #[inline(never)]
    fn inherits_from_original(&self, cx: &Cx, properties: &[PropertyName<'_>]) -> bool {
        let shape = self.shape();
        shape.prototype() == cx.regexp_prototype().into()
            && properties.iter().all(|&name| shape.get(name).is_none())
    }

    /// Whether RegExpExec runs no script.
    #[inline(always)]
    pub fn has_pristine_exec(&self, cx: &Cx) -> bool {
        self.has_numeric_last_index() && self.inherits_pristine(cx, &[names::exec])
    }

    /// Whether `Symbol.search` can leave `lastIndex` alone once it has been called.
    #[inline(always)]
    pub fn can_search_directly(&self, cx: &Cx) -> bool {
        self.is_plain() && self.inherits_pristine(cx, &[names::exec])
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.append(self.regexp());
    }
}

impl Value {
    /// IsRegExp
    #[inline]
    pub fn is_regexp(self, cx: &mut Cx) -> JsResult<bool> {
        let Some(object) = self.as_object() else {
            return Ok(false);
        };
        let matcher = object.get(cx, symbols::r#match)?;
        if matcher.is_undefined() {
            return Ok(object.is::<RegExpObject>());
        }
        Ok(matcher.to_boolean(cx))
    }
}
