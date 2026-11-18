//! What `indexOf`, `lastIndexOf` and `includes` do with dense elements.

use core::ops::Range;

use bun_engine_text::{CodeUnit, StringImpl, equal_units, with_text};
use bun_highway::elements::{
    index_of_either_u64, index_of_f64, index_of_u64, last_index_of_either_u64, last_index_of_f64,
    last_index_of_u64,
};

use crate::{
    Cx, ElementKind, Elements, Gc, JsArray, JsBigInt, JsObject, JsResult, JsString, NoGc, Value,
};

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Direction {
    Forward,
    Backward,
}

pub enum SearchResult {
    Found(usize),
    NotFound,
    /// The characters of the string at that index have to be put together before the search can go past it.
    Unresolved(usize),
}

impl From<Option<usize>> for SearchResult {
    #[inline(always)]
    fn from(index: Option<usize>) -> SearchResult {
        index.map_or(SearchResult::NotFound, SearchResult::Found)
    }
}

#[inline(always)]
fn find_word<const DIRECTION: Direction>(words: &[u64], word: u64) -> Option<usize> {
    match DIRECTION {
        Direction::Forward => index_of_u64(words, word),
        Direction::Backward => last_index_of_u64(words, word),
    }
}

#[inline(always)]
fn find_either<const DIRECTION: Direction>(words: &[u64], a: u64, b: u64) -> Option<usize> {
    match DIRECTION {
        Direction::Forward => index_of_either_u64(words, a, b),
        Direction::Backward => last_index_of_either_u64(words, a, b),
    }
}

fn find_zero<const DIRECTION: Direction>(words: &[u64]) -> Option<usize> {
    let [int32, positive, negative] =
        [Value::ZERO, Value::double(0.0), Value::double(-0.0)].map(Value::to_bits);
    let found = find_either::<DIRECTION>(words, int32, positive);
    let passed = match DIRECTION {
        Direction::Forward => 0..found.unwrap_or(words.len()),
        Direction::Backward => found.map_or(0, |index| index + 1)..words.len(),
    };
    let start = passed.start;
    (find_word::<DIRECTION>(&words[passed], negative).map(|index| start + index)).or(found)
}

#[inline(always)]
fn position<const DIRECTION: Direction>(
    values: &[Option<Value>],
    mut test: impl FnMut(Value) -> bool,
) -> Option<usize> {
    let test = |value: &Option<Value>| value.is_some_and(&mut test);
    match DIRECTION {
        Direction::Forward => values.iter().position(test),
        Direction::Backward => values.iter().rposition(test),
    }
}

/// `needle` is no concatenation that has yet to be resolved.
#[inline(always)]
fn find_string<const DIRECTION: Direction>(
    values: &[Option<Value>],
    needle: Gc<JsString>,
) -> SearchResult {
    let view = needle.try_view().expect("resolved");
    with_text!(view.text(), |units| find_units::<DIRECTION, _>(
        values, needle, units
    ))
}

/// The units are those of `needle`.
#[inline(always)]
fn find_units<const DIRECTION: Direction, T: CodeUnit>(
    values: &[Option<Value>],
    needle: Gc<JsString>,
    units: &[T],
) -> SearchResult {
    #[inline(never)]
    extern "rust-cold" fn compare<T: CodeUnit>(string: &JsString, units: &[T]) -> Option<bool> {
        Some(string.try_view()?.text() == T::text(units))
    }
    let atom = needle.try_impl().filter(|it| it.is_atom());
    let atom = atom.map_or(0, StringImpl::address);
    let mut is_unresolved = false;
    let index = position::<DIRECTION>(
        values,
        #[inline(always)]
        |value| {
            if value == needle.into() {
                return true;
            }
            let Some(string) = value.as_string() else {
                return false;
            };
            if let Some(flat) = string.try_impl() {
                if flat.len() != units.len() {
                    return false;
                }
                if atom != 0 && flat.is_atom() {
                    return flat.address() == atom;
                }
                if let Some(same_width) = T::units(flat.text()) {
                    return equal_units(same_width, units);
                }
            } else if string.len() as usize != units.len() {
                return false;
            }
            compare(&string, units).unwrap_or_else(|| {
                is_unresolved = true;
                true
            })
        },
    );
    match index {
        Some(index) if is_unresolved => SearchResult::Unresolved(index),
        index => index.into(),
    }
}

fn find_bigint<const DIRECTION: Direction>(
    values: &[Option<Value>],
    needle: Gc<JsBigInt>,
) -> Option<usize> {
    position::<DIRECTION>(values, |value| {
        (value.as_bigint()).is_some_and(|bigint| bigint.value() == needle.value())
    })
}

impl JsArray {
    /// Whether and where it has a string or an int32, if one look at the elements tells.
    #[inline(always)]
    pub fn try_find(&self, no_gc: &NoGc<'_>, needle: Value) -> Option<Option<usize>> {
        let kind = self.element_kind();
        if kind == ElementKind::Int32 && needle.is_int32() {
            let elements = self.plain_elements(no_gc, 0..self.length().into())?;
            return Some(index_of_u64(elements.words(), needle.to_bits()));
        }
        let needle = needle.as_string().filter(|it| !it.is_rope())?;
        let values = self.contiguous_elements(no_gc)?;
        if self.holes_must_forward_to_prototype() {
            return None;
        }
        match find_string::<{ Direction::Forward }>(values, needle) {
            SearchResult::Found(index) => Some(Some(index)),
            SearchResult::NotFound => Some(None),
            SearchResult::Unresolved(_) => None,
        }
    }
}

impl Elements<'_> {
    /// By IsStrictlyEqual. If `needle` is a string, it has a view.
    #[inline]
    pub fn find_strictly_equal<const DIRECTION: Direction>(self, needle: Value) -> SearchResult {
        let words = self.words();
        match (self, needle.as_number()) {
            (Elements::Int32(_), Some(number)) => {
                let int32 = Value::number(number + 0.0);
                (int32.is_int32())
                    .then(|| find_word::<DIRECTION>(words, int32.to_bits()))
                    .flatten()
            }
            (Elements::Double(numbers), Some(number)) => match DIRECTION {
                Direction::Forward => index_of_f64(numbers, number),
                Direction::Backward => last_index_of_f64(numbers, number),
            },
            (Elements::Int32(_) | Elements::Double(_), None) => None,
            (Elements::Contiguous(_), Some(number)) => {
                if number == 0.0 {
                    find_zero::<DIRECTION>(words)
                } else if number.is_nan() {
                    None
                } else {
                    let (a, b) = (Value::number(number), Value::double(number));
                    find_either::<DIRECTION>(words, a.to_bits(), b.to_bits())
                }
            }
            (Elements::Contiguous(values), None) => {
                if let Some(string) = needle.as_string() {
                    return find_string::<DIRECTION>(values, string);
                }
                match needle.as_bigint() {
                    Some(bigint) => find_bigint::<DIRECTION>(values, bigint),
                    None => find_word::<DIRECTION>(words, needle.to_bits()),
                }
            }
        }
        .into()
    }

    /// By SameValueZero, with holes as undefined. If `needle` is a string, it has a view.
    #[inline]
    pub fn find_same_value_zero(self, needle: Value) -> SearchResult {
        match self {
            Elements::Contiguous(_) if needle.is_undefined() => {
                index_of_either_u64(self.words(), 0, needle.to_bits()).into()
            }
            _ if needle.is_undefined() => self.first_hole().into(),
            Elements::Contiguous(values) if needle.as_double().is_some_and(f64::is_nan) => {
                let is_nan = |value: Value| value.as_double().is_some_and(f64::is_nan);
                position::<{ Direction::Forward }>(values, is_nan).into()
            }
            _ => self.find_strictly_equal::<{ Direction::Forward }>(needle),
        }
    }
}

#[inline(always)]
fn search_elements(
    cx: &mut Cx,
    object: &JsObject,
    mut range: Range<u64>,
    needle: Value,
    direction: Direction,
    find: impl Fn(Elements<'_>) -> SearchResult,
) -> JsResult<Option<Option<u64>>> {
    if let Some(string) = needle.as_string() {
        string.view(cx)?;
    }
    loop {
        let no_gc = cx.no_gc();
        let Some(elements) = object.plain_elements(&no_gc, range.clone()) else {
            return Ok(None);
        };
        let offset = match find(elements) {
            SearchResult::Found(offset) => return Ok(Some(Some(range.start + offset as u64))),
            SearchResult::NotFound => return Ok(Some(None)),
            SearchResult::Unresolved(offset) => offset,
        };
        if let Some(rope) = elements.at(offset).and_then(Value::as_string) {
            rope.resolve(cx)?;
        }
        match direction {
            Direction::Forward => range.start += offset as u64,
            Direction::Backward => range.end = range.start + offset as u64 + 1,
        }
    }
}

impl JsObject {
    /// `None` if it takes more than a look at the elements.
    #[inline(always)]
    pub fn try_index_of<const DIRECTION: Direction>(
        &self,
        cx: &mut Cx,
        range: Range<u64>,
        needle: Value,
    ) -> JsResult<Option<Option<u64>>> {
        let find = |elements: Elements<'_>| elements.find_strictly_equal::<DIRECTION>(needle);
        search_elements(cx, self, range, needle, DIRECTION, find)
    }

    /// As above.
    #[inline(always)]
    pub fn try_includes(
        &self,
        cx: &mut Cx,
        range: Range<u64>,
        needle: Value,
    ) -> JsResult<Option<bool>> {
        let find = |elements: Elements<'_>| elements.find_same_value_zero(needle);
        let found = search_elements(cx, self, range, needle, Direction::Forward, find)?;
        Ok(found.map(|index| index.is_some()))
    }
}
