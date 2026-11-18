use bun_alloc::AllocError;
use bun_engine_number::{INTEGER_TEXT_SLACK, i32_text_length, push_i32};
use bun_engine_text::{CodeUnit, MAX_LENGTH, StringRef};

use crate::{Cx, Gc, JsResult, JsRopeString, JsString, NumberStrings, Value, Vm};

const MAX_COPIED_LENGTH: usize = 32;

impl JsString {
    #[inline(always)]
    pub fn try_concat(vm: &Vm, a: Gc<JsString>, b: Gc<JsString>) -> Result<Gc<Self>, AllocError> {
        let (a_length, b_length) = (a.len(), b.len());
        if a_length == 0 {
            return Ok(b);
        }
        if b_length == 0 {
            return Ok(a);
        }
        let length = a_length + b_length;
        if length as usize > MAX_LENGTH {
            return Err(AllocError);
        }
        Ok(JsRopeString::concatenation(vm, a, b, None, length))
    }

    /// The same, if it takes no call.
    #[inline(always)]
    pub fn try_concat_quickly(vm: &Vm, a: Gc<JsString>, b: Gc<JsString>) -> Option<Gc<JsString>> {
        let (a_length, b_length) = (a.len(), b.len());
        if a_length == 0 {
            return Some(b);
        }
        if b_length == 0 {
            return Some(a);
        }
        let length = a_length + b_length;
        if length as usize > MAX_LENGTH {
            return None;
        }
        JsRopeString::try_concatenation_quickly(vm, a, b, length)
    }

    #[inline(always)]
    pub fn concat(cx: &Cx, a: Gc<JsString>, b: Gc<JsString>) -> JsResult<Gc<JsString>> {
        cx.or_out_of_memory(Self::try_concat(cx, a, b))
    }

    #[inline]
    pub fn concat3(
        cx: &Cx,
        a: Gc<JsString>,
        b: Gc<JsString>,
        c: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        let (first, second) = match [a.len(), b.len(), c.len()] {
            [0, _, _] => (b, c),
            [_, 0, _] => (a, c),
            [_, _, 0] => (a, b),
            lengths => {
                let length: u64 = lengths.into_iter().map(u64::from).sum();
                if length > MAX_LENGTH as u64 {
                    return Err(cx.throw_out_of_memory());
                }
                return Ok(JsRopeString::concatenation(
                    cx,
                    a,
                    b,
                    Some(c),
                    length as u32,
                ));
            }
        };
        Self::concat(cx, first, second)
    }

    /// `a + b` for two primitives. Panics unless one of them is a string.
    #[inline(always)]
    pub fn add(cx: &Cx, a: Value, b: Value) -> JsResult<Gc<JsString>> {
        match (a.as_string(), b.as_string()) {
            (Some(a), Some(b)) => Self::concat(cx, a, b),
            _ => Self::add_mixed(cx, a, b),
        }
    }

    #[inline(never)]
    fn add_mixed(cx: &Cx, a: Value, b: Value) -> JsResult<Gc<JsString>> {
        let is_string_first = a.is_string();
        let (string, other) = if is_string_first { (a, b) } else { (b, a) };
        let string = string.cast::<JsString>();
        let other_string = match other.as_int32() {
            Some(integer) => match Self::existing_for_int32(cx, integer) {
                Some(existing) => existing,
                None => {
                    if integer as u32 as usize >= NumberStrings::SMALL_COUNT
                        && let Some(sum) = string.copy_with(integer, is_string_first)
                    {
                        return Ok(Self::allocate(cx, sum));
                    }
                    Self::from_int32(cx, integer)
                }
            },
            None => other.primitive_to_string(cx)?,
        };
        if is_string_first {
            Self::concat(cx, string, other_string)
        } else {
            Self::concat(cx, other_string, string)
        }
    }

    /// If that takes less than a rope and a string for the number.
    #[inline(always)]
    fn copy_with(&self, number: i32, is_string_first: bool) -> Option<StringRef> {
        let string = u8::units(self.try_impl()?.text())?;
        if string.is_empty() || string.len() > MAX_COPIED_LENGTH {
            return None;
        }
        let length = string.len() + i32_text_length(number);
        StringRef::try_write_with_slack::<_, INTEGER_TEXT_SLACK>(length, |to| {
            if is_string_first {
                to.push_slice(string);
            }
            push_i32(number, to);
            if !is_string_first {
                to.push_slice(string);
            }
        })
        .ok()
    }

    /// The strings of any number of primitives, one after the other.
    #[inline]
    pub fn concat_primitives(
        cx: &Cx,
        values: impl IntoIterator<Item = Value>,
    ) -> JsResult<Gc<JsString>> {
        let mut builder = RopeBuilder::default();
        for value in values {
            let string = match value.as_string() {
                Some(string) => string,
                None => value.primitive_to_string(cx)?,
            };
            builder.push(cx, string)?;
        }
        Ok(builder.finish(cx))
    }
}

/// Concatenates any number of strings.
#[derive(Default)]
pub struct RopeBuilder {
    fibers: [Option<Gc<JsString>>; 3],
    length: u32,
}

impl RopeBuilder {
    #[inline(always)]
    pub fn push(&mut self, cx: &Cx, string: Gc<JsString>) -> JsResult<()> {
        let length = self.length + string.len();
        if length == self.length {
            return Ok(());
        }
        if length as usize > MAX_LENGTH {
            return Err(cx.throw_out_of_memory());
        }
        self.fibers = match self.fibers {
            [Some(a), Some(b), c @ Some(_)] => {
                let rope = JsRopeString::concatenation(cx, a, b, c, self.length);
                [Some(rope), Some(string), None]
            }
            [a @ Some(_), b @ Some(_), None] => [a, b, Some(string)],
            [a @ Some(_), None, _] => [a, Some(string), None],
            [None, ..] => [Some(string), None, None],
        };
        self.length = length;
        Ok(())
    }

    #[inline(always)]
    pub fn finish(self, vm: &Vm) -> Gc<JsString> {
        match self.fibers {
            [Some(a), Some(b), c] => JsRopeString::concatenation(vm, a, b, c, self.length),
            [Some(only), None, _] => only,
            [None, ..] => vm.small_strings.empty(),
        }
    }
}
