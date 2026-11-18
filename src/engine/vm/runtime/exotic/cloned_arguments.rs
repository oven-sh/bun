use bun_engine_macros::cell;
use bun_engine_text::{names, symbols};

use crate::{
    Attributes, CallFrame, Cx, ElementKind, Elements, Field, Gc, IndexingMode, JsObject,
    JsObjectInit, JsResult, NoGc, PropertyOffset, Shape, ShapeSpec, Storage, Trace, Value, Visitor,
};

const INLINE_CAPACITY: usize = 3;

#[repr(transparent)]
pub struct InlineSlots([Field<Option<Value>>; INLINE_CAPACITY]);

// SAFETY: visits each, and a store to a slot of an object runs the barrier.
unsafe impl Trace for InlineSlots {
    fn trace(&self, visitor: &mut Visitor) {
        for field in &self.0 {
            // SAFETY: the object keeps it alive.
            unsafe { visitor.append_hidden_word(field.word_concurrently()) };
        }
    }
}

/// The `arguments` of a function whose parameters have nothing to do with it: an ordinary object that starts with
/// `length`, `callee` and `Symbol.iterator` in the cell.
#[cell(name = "Arguments", cell_type = ClonedArguments)]
pub struct ClonedArguments {
    base: JsObject,
    slots: InlineSlots,
}

impl ClonedArguments {
    pub const LENGTH: PropertyOffset = PropertyOffset::new(0);
    pub const CALLEE: PropertyOffset = PropertyOffset::new(1);
    pub const ITERATOR: PropertyOffset = PropertyOffset::new(2);

    pub fn create_shape(cx: &Cx) -> Gc<Shape> {
        let spec = ShapeSpec::of::<ClonedArguments>()
            .with_indexing_mode(IndexingMode::non_array(ElementKind::Contiguous))
            .with_inline_capacity(INLINE_CAPACITY);
        let thrower = Attributes::DONT_ENUM | Attributes::DONT_DELETE | Attributes::ACCESSOR;
        let prototype = cx.object_prototype().into();
        [
            (names::length, Attributes::DONT_ENUM),
            (names::callee, thrower),
            (symbols::iterator, Attributes::DONT_ENUM),
        ]
        .into_iter()
        .fold(
            Shape::create(cx, Some(cx.global()), prototype, spec),
            |shape, (name, attributes)| shape.add_property_transition(cx, name, attributes).0,
        )
    }

    #[inline]
    pub fn create(cx: &Cx, arguments: &[Value]) -> JsResult<Gc<ClonedArguments>> {
        if arguments.len() >= Storage::MAX_VECTOR_LENGTH as usize {
            return Err(cx.throw_out_of_memory());
        }
        let length = arguments.len() as u32;
        let shape = cx.cloned_arguments_shape();
        let initial: [Value; INLINE_CAPACITY] = [
            length.into(),
            cx.throw_type_error_accessor().into(),
            cx.array_prototype_values().into(),
        ];
        // With the lengths, an even number of words.
        let vector_length = length | 1;
        let storage = cx.or_out_of_memory(Storage::try_allocate(cx, 0, 0, Some(vector_length)))?;
        // SAFETY: new and of that size. `arguments` has the values for as long as it takes.
        let base = unsafe {
            storage.set_lengths(length, vector_length);
            storage.clear_elements(ElementKind::Contiguous, vector_length - 1, vector_length);
            let elements = storage.elements_ptr().cast::<Value>();
            elements.copy_from_nonoverlapping(arguments.as_ptr(), arguments.len());
            JsObjectInit::with_storage(shape, storage)
        };
        Ok(cx.allocate::<ClonedArguments>(ClonedArgumentsInit {
            base,
            slots: InlineSlots(initial.map(|value| Field::new(Some(value)))),
        }))
    }

    /// `create_unmapped_arguments`, and `ensure_arguments` unless it is mapped.
    #[inline]
    pub fn from_frame(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<ClonedArguments>> {
        Self::create(cx, frame.arguments())
    }

    /// For the `arguments` property of a function that is not strict.
    pub fn create_with_callee(
        cx: &Cx,
        callee: Gc<JsObject>,
        arguments: &[Value],
    ) -> JsResult<Gc<ClonedArguments>> {
        let object = Self::create(cx, arguments)?;
        object.put_direct(cx, names::callee, callee.into(), Attributes::DONT_ENUM);
        Ok(object)
    }

    #[inline(always)]
    fn initial_slot(&self, offset: PropertyOffset) -> Option<Value> {
        let shape = self.shape();
        let original =
            (shape.global()?).slot_if_initialized(crate::RealmSlot::cloned_arguments_shape);
        self.slots.0[offset.get() as usize]
            .get()
            .filter(|_| original == Some(shape.cell()))
    }

    /// The value of `length`, if it can be had that easily.
    #[inline]
    pub fn try_length(&self) -> Option<u32> {
        self.initial_slot(Self::LENGTH)?.as_index_int32()
    }

    /// What reading `length` and the indices below it gives, if that runs no code.
    #[inline]
    pub fn pristine_values<'a>(&'a self, no_gc: &'a NoGc<'_>) -> Option<&'a [Value]> {
        let Elements::Contiguous(elements) = self.elements(no_gc)? else {
            return None;
        };
        let elements = elements.get(..self.try_length()? as usize)?;
        // SAFETY: none is empty.
        (!elements.contains(&None)).then(|| unsafe {
            core::slice::from_raw_parts(elements.as_ptr().cast(), elements.len())
        })
    }

    /// Whether iterating over it comes down to reading `length` and the elements.
    #[inline]
    pub fn is_iteration_pristine(&self) -> bool {
        self.realm().is_some_and(|global| {
            global.array_iterator_protocol_is_pristine()
                && self.initial_slot(Self::ITERATOR) == Some(global.array_prototype_values().into())
        })
    }
}
