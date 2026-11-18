use bun_engine_text::{CodeUnit, Cursor, Identifier, Text};

use crate::{
    Cx, JsResult, NumberObject, PropertyNameList, PropertyNameMode, StringObject, Value, is_array,
};

pub(super) enum Replacer {
    None,
    Function(Value),
    /// The names of the properties to write.
    List(Vec<Identifier>),
}

impl Replacer {
    #[inline]
    pub(super) fn new(cx: &mut Cx, replacer: Value) -> JsResult<Replacer> {
        if !replacer.is_object() {
            Ok(Replacer::None)
        } else if replacer.is_callable() {
            Ok(Replacer::Function(replacer))
        } else if is_array(cx, replacer)? {
            Self::list(cx, replacer)
        } else {
            Ok(Replacer::None)
        }
    }

    #[inline(never)]
    fn list(cx: &mut Cx, array: Value) -> JsResult<Replacer> {
        let array = array.to_object(cx)?;
        let mut names = PropertyNameList::new(PropertyNameMode::Strings);
        for index in 0..array.length_of_array_like(cx)? {
            cx.check_traps()?;
            let item = array.get_index(cx, index)?;
            if item.is_string()
                || item.is_number()
                || item.is::<StringObject>()
                || item.is::<NumberObject>()
            {
                names.add(item.to_string(cx)?.to_property_key(cx)?.name());
            }
        }
        Ok(Replacer::List(names.into_vec()))
    }
}

/// One step of indentation, which is not empty.
pub(super) struct Gap {
    length: usize,
    /// One if all units are the same.
    period: usize,
    /// A line feed, and then the gap again and again.
    line: [u16; Gap::SHORT_LINE],
    /// The low bytes.
    narrow_line: [u8; Gap::SHORT_LINE],
    is_latin1: bool,
}

impl Gap {
    const LONGEST: usize = 10;
    const SHORT_LINE: usize = 32;

    #[inline]
    pub(super) fn new(cx: &mut Cx, mut space: Value) -> JsResult<Option<Gap>> {
        if space.is::<NumberObject>() {
            space = space.to_number(cx)?.into();
        } else if space.is::<StringObject>() {
            space = space.to_string(cx)?.into();
        }
        let (mut line, mut length, mut period) = ([b' '.into(); Self::SHORT_LINE], 0, 1);
        if let Some(count) = space.as_number() {
            length = (count as usize).min(Self::LONGEST);
        } else if let Some(string) = space.as_string().filter(|it| !it.is_empty()) {
            let view = string.view(cx)?;
            let text = view.text().slice(0..view.text().len().min(Self::LONGEST));
            length = text.len();
            if !text.all(|unit| unit == text.at(0)) {
                period = length;
            }
            Cursor::fill(&mut line[1..], |to| to.push_pattern(text, to.remaining()));
        }
        line[0] = b'\n'.into();
        Ok((length != 0).then(|| Gap {
            length,
            period,
            line,
            narrow_line: line.map(|unit| unit as u8),
            is_latin1: Text::Utf16(&line).fits_latin1(),
        }))
    }

    #[inline(always)]
    pub(super) fn is_latin1(&self) -> bool {
        self.is_latin1
    }

    /// With the line feed.
    #[inline(always)]
    pub(super) fn line_length(&self, depth: usize) -> usize {
        1 + depth * self.length
    }

    /// What `start_line` needs.
    #[inline(always)]
    pub(super) fn room_for(line_length: usize) -> usize {
        line_length.max(Self::SHORT_LINE)
    }

    /// The gap fits in `T`.
    #[inline(always)]
    pub(super) fn start_line<T: CodeUnit>(&self, length: usize, to: &mut Cursor<'_, T>) {
        if length > Self::SHORT_LINE {
            to.apart(|to| self.start_exact_line(length, to));
        } else if T::IS_LATIN1 {
            to.push_latin1_prefix(&self.narrow_line, length);
        } else {
            to.push_prefix(&self.line.map(T::from_u16_truncating), length);
        }
    }

    /// Takes no more room than `length`.
    #[inline(never)]
    pub(super) extern "rust-cold" fn start_exact_line<T: CodeUnit>(
        &self,
        length: usize,
        to: &mut Cursor<'_, T>,
    ) {
        to.push(b'\n'.into());
        to.push_pattern(Text::Utf16(&self.line[1..=self.period]), length - 1);
    }
}
