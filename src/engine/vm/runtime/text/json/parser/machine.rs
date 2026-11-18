//! The loop that all text goes through. What is rare or long is left to functions that preserve its registers.

use bun_engine_number::{parse_few_json_digits, parse_few_json_places};
use bun_highway::json_text::{BLOCK, plain_ascii_len, white_space_len};

use super::keys::NodeId;
use super::reader::{Cursor, WINDOW};
use super::stack::Stack;
use super::strings::ShortText;
use super::{Parser, Tables};
use crate::json::Failure;
use crate::json::records::Recorder;
use crate::json::syntax_error::Expected;
use crate::{ElementKind, JsArray, Value};

#[derive(Clone, Copy)]
enum State {
    OpenObject,
    OpenArray,
    Member,
    Element,
    AfterMember,
    AfterElement,
    NextMember,
    NextElement,
    CloseObject,
    CloseArray,
    /// An object or an array is complete.
    Resume,
}

/// In the spare bits of a node: what the value of that key, or a part of it, is in.
const IN_OBJECT: u32 = 0;
const IN_ARRAY: u32 = 1;
const IN_NOTHING: u32 = 2;

type Window = [u8; WINDOW];

#[inline(always)]
fn chunk<const N: usize>(window: &Window, at: usize) -> &[u8; N] {
    window[at..].first_chunk().expect("inside the window")
}

/// `lowest` is the least of the bits of the elements, none of which is NaN.
#[inline(always)]
fn kind_for(lowest: u64) -> ElementKind {
    if lowest < Value::DOUBLE_OFFSET {
        ElementKind::Contiguous
    } else if lowest < Value::NUMBER_TAG {
        ElementKind::Double
    } else {
        ElementKind::Int32
    }
}

impl<'a, R: Recorder> Parser<'a, R> {
    #[inline(never)]
    extern "rust-cold" fn skip_much_white_space(&mut self, mut cursor: Cursor<'a>) -> Cursor<'a> {
        self.skip_white_space(&mut cursor);
        cursor
    }

    /// The window after any white space.
    #[inline(always)]
    fn token(&mut self, mut cursor: Cursor<'a>) -> (Cursor<'a>, &Window) {
        let window = self.reader.window(&mut cursor);
        let blank = white_space_len(chunk(window, 0));
        cursor.advance(blank);
        if blank == BLOCK as u32 {
            cursor = self.skip_much_white_space(cursor);
        }
        let window = self.reader.window(&mut cursor);
        (cursor, window)
    }

    /// The same, for a state that starts over, to which the constants would be moved.
    #[inline(never)]
    extern "rust-cold" fn skip_to_token(&mut self, cursor: Cursor<'a>) -> Cursor<'a> {
        self.token(cursor).0
    }

    #[inline(never)]
    extern "rust-cold" fn empty_object(&mut self) -> Value {
        self.cx.new_object().into()
    }

    #[inline(never)]
    extern "rust-cold" fn empty_array(&mut self) -> Option<Value> {
        let array = self.cx.services.text.json.parser.empty_array(self.cx);
        self.or_out_of_memory(array).map(Into::into)
    }

    #[inline(never)]
    extern "rust-cold" fn any_array(&mut self, elements: &[Value]) -> Option<Value> {
        let kind = ElementKind::Undecided.generalized_for_slice(elements);
        let array = JsArray::try_from_values(self.cx, kind, elements);
        self.or_out_of_memory(array).map(Into::into)
    }

    #[inline(always)]
    fn record(&mut self, action: impl FnOnce(&mut R) -> Result<(), Failure>) -> Option<()> {
        let result = action(&mut self.recorder);
        self.or_failed(result)
    }

    /// The object or the array at the cursor, and the cursor after it.
    #[inline(always)]
    pub(super) fn structure(
        &mut self,
        tables: &mut Tables,
        mut cursor: Cursor<'a>,
        is_object: bool,
    ) -> Option<(Cursor<'a>, Value)> {
        let (vm, global) = (self.cx.vm(), self.cx.global());
        // SAFETY: a parser has the tables to itself, and defers collection.
        let stack = unsafe { Stack::new(&mut tables.stack) };
        let mut stack = self.or_out_of_memory(stack)?;
        let mut node = self.root;
        let mut context = node.bits() | IN_NOTHING;
        let mut value = Value::NULL;
        let mut lowest = 0;
        let mut state = if is_object {
            State::OpenObject
        } else {
            State::OpenArray
        };

        macro_rules! go {
            ($label:lifetime, $state:ident) => {{
                #[const_continue]
                break $label State::$state;
            }};
        }

        macro_rules! grow {
            ($result:expr) => {
                if $result.is_err() {
                    return self.out_of_memory();
                }
            };
        }

        macro_rules! read_value {
            ($label:lifetime, $this:ident, $after:ident, $next:ident, $close:ident, $closer:literal, $holder:expr, $expected:expr) => {{
                let start = R::IS_ACTIVE.then(|| self.reader.position(&cursor));
                let window = self.reader.window(&mut cursor);
                let first = window[0];
                let slow;
                if first == b'"' {
                    let length = plain_ascii_len(chunk(window, 1));
                    if window[1 + length as usize] == b'"' {
                        let text = ShortText::new(chunk(window, 1), length);
                        cursor.advance(length + 2);
                        value = match tables.strings.find_short(text) {
                            Some(string) => string.into(),
                            None => self.new_short_string(tables, text)?,
                        };
                    } else {
                        (cursor, slow) = self.any_string(tables, cursor);
                        value = slow?;
                    }
                } else if first.is_ascii_digit() {
                    if let Some((number, length)) = parse_few_json_digits(*chunk(window, 0))
                        && !R::IS_ACTIVE
                    {
                        let following = window[length as usize];
                        value = Value::int32(number);
                        if following == b',' {
                            cursor.advance(length);
                            go!($label, $next)
                        }
                        if following == $closer {
                            cursor.advance(length);
                            go!($label, $close)
                        }
                        if following <= b' ' {
                            cursor.advance(length);
                            go!($label, $after)
                        }
                        if following == b'.'
                            && let places = *chunk(window, length as usize + 1)
                            && let Some((number, count)) = parse_few_json_places(number, places)
                            && places[count as usize] | 0x20 != b'e'
                        {
                            value = number.into();
                            cursor.advance(length + 1 + count);
                            go!($label, $after)
                        }
                    }
                    (cursor, slow) = self.any_number(cursor);
                    value = slow?;
                } else if first == b'{' {
                    context = node.bits() | $holder;
                    go!($label, OpenObject)
                } else if first == b'[' {
                    context = node.bits() | $holder;
                    go!($label, OpenArray)
                } else if first == b' ' {
                    cursor.advance(1);
                    go!($label, $this)
                } else if chunk(window, 0) == b"null" {
                    cursor.advance(4);
                    value = Value::NULL;
                } else if chunk(window, 0) == b"true" {
                    cursor.advance(4);
                    value = Value::TRUE;
                } else if first == b'f' && chunk(window, 1) == b"alse" {
                    cursor.advance(5);
                    value = Value::FALSE;
                } else if first == b'-' {
                    (cursor, slow) = self.negative_number(cursor);
                    value = slow?;
                } else if matches!(first, b'\n' | b'\r' | b'\t') {
                    cursor = self.skip_to_token(cursor);
                    go!($label, $this)
                } else {
                    return self.unexpected(&cursor, $expected);
                }
                if let Some(start) = start {
                    let end = self.reader.position(&cursor);
                    self.record(|it| it.primitive(value, start..end))?;
                }
                go!($label, $after)
            }};
        }

        #[loop_match]
        loop {
            state = 'next: {
                match state {
                    State::OpenObject => {
                        self.record(R::open)?;
                        cursor.advance(1);
                        let mut window = self.reader.window(&mut cursor);
                        if window[0] != b'"' {
                            (cursor, window) = self.token(cursor);
                            if window[0] == b'}' {
                                cursor.advance(1);
                                value = self.empty_object();
                                self.record(|it| it.close(value, 0))?;
                                go!('next, Resume)
                            }
                            if window[0] != b'"' {
                                return self.unexpected(&cursor, Expected::ClosingBrace);
                            }
                        }
                        // SAFETY: from `bits`.
                        let outer = unsafe { NodeId::from_bits(context & !NodeId::SPARE_BITS) };
                        node = tables.tree[outer].child;
                        if let Some(length) = tables.tree[node].find_in(chunk(window, 0)) {
                            cursor.advance(length);
                        } else {
                            (cursor, node) = self.unforeseen_first_key(tables, cursor, outer);
                            if node == NodeId::NONE {
                                return None;
                            }
                        }
                        self.record(|it| it.key(|| tables.identifier(node)))?;
                        grow!(stack.enter(&mut tables.stack, context));
                        go!('next, Member)
                    }
                    State::OpenArray => {
                        self.record(R::open)?;
                        cursor.advance(1);
                        let mut window = self.reader.window(&mut cursor);
                        if window[0] <= b' ' {
                            (cursor, window) = self.token(cursor);
                        }
                        if window[0] == b']' {
                            cursor.advance(1);
                            value = self.empty_array()?;
                            self.record(|it| it.close(value, 0))?;
                            go!('next, Resume)
                        }
                        // SAFETY: as above.
                        node = unsafe { NodeId::from_bits(context & !NodeId::SPARE_BITS) };
                        lowest = u64::MAX;
                        grow!(stack.enter(&mut tables.stack, context));
                        go!('next, Element)
                    }
                    State::Member => read_value!(
                        'next, Member, AfterMember, NextMember, CloseObject, b'}', IN_OBJECT, Expected::Value
                    ),
                    State::Element => read_value!(
                        'next, Element, AfterElement, NextElement, CloseArray, b']', IN_ARRAY, Expected::Element
                    ),
                    State::AfterMember => {
                        let mut window = self.reader.window(&mut cursor);
                        if window[0] == b',' {
                            go!('next, NextMember)
                        }
                        if window[0] == b'}' {
                            go!('next, CloseObject)
                        }
                        (cursor, window) = self.token(cursor);
                        if window[0] == b'}' {
                            go!('next, CloseObject)
                        }
                        if window[0] == b',' {
                            go!('next, NextMember)
                        }
                        return self.unexpected(&cursor, Expected::ClosingBrace);
                    }
                    State::AfterElement => {
                        let mut window = self.reader.window(&mut cursor);
                        if window[0] == b',' {
                            go!('next, NextElement)
                        }
                        if window[0] == b']' {
                            go!('next, CloseArray)
                        }
                        (cursor, window) = self.token(cursor);
                        if window[0] == b']' {
                            go!('next, CloseArray)
                        }
                        if window[0] == b',' {
                            go!('next, NextElement)
                        }
                        return self.unexpected(&cursor, Expected::ClosingBracket);
                    }
                    State::NextMember => {
                        grow!(stack.push(&mut tables.stack, value));
                        let next = tables.tree[node].next;
                        cursor.advance(1);
                        let mut window = self.reader.window(&mut cursor);
                        if window[0] != b'"' {
                            (cursor, window) = self.token(cursor);
                            if window[0] != b'"' {
                                return self.unexpected(&cursor, Expected::Key);
                            }
                        }
                        if let Some(length) = tables.tree[next].find_in(chunk(window, 0)) {
                            cursor.advance(length);
                            node = next;
                        } else {
                            (cursor, node) = self.unforeseen_next_key(tables, cursor, node);
                            if node == NodeId::NONE {
                                return None;
                            }
                        }
                        self.record(|it| it.key(|| tables.identifier(node)))?;
                        go!('next, Member)
                    }
                    State::NextElement => {
                        lowest = lowest.min(value.to_bits());
                        grow!(stack.push(&mut tables.stack, value));
                        cursor.advance(1);
                        go!('next, Element)
                    }
                    State::CloseObject => {
                        cursor.advance(1);
                        let members = stack.members_and(value);
                        let snug = tables.tree[node].snug_shape();
                        // SAFETY: there is a value for each key.
                        value = match snug.and_then(|it| unsafe { it.try_create(vm, members) }) {
                            Some(object) => object.into(),
                            None => self.any_object(tables, node, members)?,
                        };
                        self.record(|it| it.close(value, members.len()))?;
                        // SAFETY: what has been entered on the way here.
                        context = unsafe { stack.leave() };
                        go!('next, Resume)
                    }
                    State::CloseArray => {
                        cursor.advance(1);
                        let kind = kind_for(lowest.min(value.to_bits()));
                        let elements = stack.members_and(value);
                        // SAFETY: the kind goes by all of them.
                        value =
                            match unsafe { JsArray::try_create_small(vm, &global, kind, elements) }
                            {
                                Some(array) => array.into(),
                                None => self.any_array(elements)?,
                            };
                        self.record(|it| it.close(value, elements.len()))?;
                        // SAFETY: as above.
                        context = unsafe { stack.leave() };
                        go!('next, Resume)
                    }
                    State::Resume => {
                        // SAFETY: from `bits`.
                        node = unsafe { NodeId::from_bits(context & !NodeId::SPARE_BITS) };
                        if context & NodeId::SPARE_BITS == IN_OBJECT {
                            go!('next, AfterMember)
                        }
                        if context & IN_ARRAY != 0 {
                            lowest = value.to_bits();
                            go!('next, AfterElement)
                        }
                        return Some((cursor, value));
                    }
                }
            }
        }
    }
}
