use core::ops::Range;

use crate::{
    ElementKind, ElementType, ElementWriter, Gc, HoleMode, JsObject, JsTypedArray, MappedArguments,
    NoGc, NumberElement, Value, with_element_type,
};

#[derive(Clone, Copy)]
enum Source {
    Dense(Gc<JsObject>),
    Arguments(Gc<MappedArguments>),
    Numbers(Gc<JsTypedArray>),
}

/// Properties with consecutive indices that can be copied without running code or allocating.
pub(crate) struct PlainRange {
    source: Source,
    range: Range<usize>,
    holes: HoleMode,
    kind: ElementKind,
}

fn kind_for_numbers(array: &JsTypedArray, no_gc: &NoGc<'_>, range: Range<usize>) -> ElementKind {
    use crate::Element;
    match array.element_type() {
        ElementType::Uint32 => ElementKind::Double,
        // Another thread may store a NaN at any time.
        ElementType::Float16 | ElementType::Float32 | ElementType::Float64 if array.is_shared() => {
            ElementKind::Contiguous
        }
        of @ (ElementType::Float16 | ElementType::Float32 | ElementType::Float64) => {
            let has_nan = with_element_type!(of, T => {
                array.typed::<T>().elements(no_gc).slice(range).iter().any(T::is_nan)
            });
            if has_nan {
                ElementKind::Contiguous
            } else {
                ElementKind::Double
            }
        }
        _ => ElementKind::Int32,
    }
}

impl PlainRange {
    #[inline(always)]
    pub(crate) fn of(
        no_gc: &NoGc<'_>,
        object: &JsObject,
        range: Range<u64>,
        holes: HoleMode,
    ) -> Option<PlainRange> {
        let Some(elements) = object.plain_elements(no_gc, range.clone()) else {
            return Self::of_exotic(no_gc, object, range, holes);
        };
        Some(PlainRange {
            source: Source::Dense(object.into()),
            range: range.start as usize..range.end as usize,
            holes,
            kind: elements.kind_with(holes),
        })
    }

    #[inline(never)]
    fn of_exotic(
        no_gc: &NoGc<'_>,
        object: &JsObject,
        range: Range<u64>,
        holes: HoleMode,
    ) -> Option<PlainRange> {
        let range = range.start as usize..range.end as usize;
        let (source, kind) = match object.downcast::<MappedArguments>() {
            Some(arguments) => (range.end <= arguments.plain_length() as usize)
                .then_some((Source::Arguments(arguments), ElementKind::Contiguous))?,
            None => {
                let array = object.downcast::<JsTypedArray>()?;
                if array.element_type().is_bigint() || range.end > array.length() {
                    return None;
                }
                let kind = kind_for_numbers(&array, no_gc, range.clone());
                (Source::Numbers(array), kind)
            }
        };
        Some(PlainRange {
            source,
            range,
            holes,
            kind,
        })
    }

    #[inline(always)]
    pub(crate) fn len(&self) -> usize {
        self.range.len()
    }

    /// The least general one that a copy can have.
    #[inline(always)]
    pub(crate) fn kind(&self) -> ElementKind {
        self.kind
    }

    /// # Safety
    /// The object has not changed since.
    #[inline(always)]
    pub(crate) unsafe fn write_to(&self, writer: &mut ElementWriter<'_>) {
        let range = self.range.clone();
        match self.source {
            Source::Dense(object) => {
                // SAFETY: the writer only copies.
                let elements = unsafe { object.elements_unchecked() }.expect("dense elements");
                writer.extend(elements.slice(range), self.holes);
            }
            Source::Arguments(arguments) => {
                for index in range {
                    writer.push_or_hole(arguments.try_get(index as u32));
                }
            }
            Source::Numbers(array) => write_numbers(&array, range, writer),
        }
    }
}

#[inline(never)]
fn write_numbers(array: &JsTypedArray, range: Range<usize>, writer: &mut ElementWriter<'_>) {
    with_element_type!(array.element_type(),
        T => {
            // SAFETY: the writer only copies.
            let numbers = unsafe { array.typed::<T>().elements_unchecked() }.slice(range).iter();
            if writer.kind() == ElementKind::Double {
                writer.extend_from_doubles(numbers.map(T::convert::<f64>));
            } else {
                writer.extend_from_values(numbers.map(T::to_number_value));
            }
        },
        bigint => writer.extend_from_values(core::iter::empty::<Value>())
    )
}
