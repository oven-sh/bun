use bun_engine_bytecode::{CodeFlags, Opcode, Position};
use bun_engine_text::{StringBuilder, StringRef, Text};

use crate::{CodeBlock, StackVisitor, Value, Vm};

/// How the text of the expression that failed goes into the message.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SourceAppender {
    Default,
    NotAFunction,
    /// As `NotAFunction`, for an instruction of the innermost code.
    FailedCall,
    /// As `Default`, for the same.
    FailedConstruct,
    In,
    InstanceofNotAFunction,
    HasInstanceNotAFunction,
    InvalidPrototype,
}

fn join(parts: &[Text<'_>]) -> Option<StringRef> {
    StringRef::try_concat(parts).ok()
}

const fn ascii(text: &'static str) -> Text<'static> {
    Text::from_ascii(text)
}

fn clamped(message: Text<'_>) -> Text<'_> {
    message.slice(0..message.len().min(2048))
}

fn near(message: Text<'_>, source: Text<'_>) -> Option<StringRef> {
    join(&[
        clamped(message),
        ascii(" (near '..."),
        source,
        ascii("...')"),
    ])
}

fn evaluating(message: Text<'_>, source: Text<'_>) -> Option<StringRef> {
    join(&[message, ascii(" (evaluating '"), source, ascii("')")])
}

fn is_space(unit: u16) -> bool {
    bun_engine_unicode::is_str_white_space(unit.into())
}

fn trimmed(text: Text<'_>) -> Text<'_> {
    let start = text.code_units().take_while(|&it| is_space(it)).count();
    let rest = text.slice_from(start);
    let trailing = rest.code_units().rev().take_while(|&it| is_space(it));
    rest.slice(0..rest.len() - trailing.count())
}

/// What is before the parenthesis that matches the last one.
fn call_base(source: Text<'_>) -> Option<Text<'_>> {
    let is = |index: usize, character: u8| source.at(index) == u16::from(character);
    let mut index = source.len().checked_sub(2)?;
    if !is(index + 1, b')') {
        return None;
    }
    let (mut depth, mut is_in_comment) = (1, false);
    while depth != 0 && index != 0 {
        if is_in_comment {
            if is(index, b'*') && is(index - 1, b'/') {
                is_in_comment = false;
                index -= 1;
            }
        } else if is(index, b'(') {
            depth -= 1;
        } else if is(index, b')') {
            depth += 1;
        } else if is(index, b'/') && is(index - 1, b'*') {
            is_in_comment = true;
            index -= 1;
        }
        index = index.saturating_sub(1);
    }
    if depth != 0 {
        return None;
    }
    if index > 1 && is(index, b'.') && is(index - 1, b'?') {
        index -= 2;
    }
    Some(source.slice(0..index + 1))
}

fn not_a_function(message: Text<'_>, source: Text<'_>, value: Value) -> Option<StringRef> {
    let Some(base) = call_base(source) else {
        return near(message, source);
    };
    let mut out = StringBuilder::new();
    for part in [
        base,
        ascii(" is not a function. (In '"),
        source,
        ascii("', '"),
        base,
    ] {
        out.push_text(part);
    }
    out.push_ascii("' is ");
    if value.is_symbol() {
        out.push_ascii("a Symbol");
    } else {
        if value.is_object() {
            out.push_ascii("an instance of ");
        }
        out.push_text(message.slice(0..message.len() - " is not a function".len()));
    }
    out.push_latin1(b')');
    let fallback = || StringRef::from_literal("object is not a function.");
    Some(out.finish().unwrap_or_else(|_| fallback()))
}

/// Names the operand to the right of the keyword, if there is no doubt which that is.
fn right_operand(
    message: Text<'_>,
    source: Text<'_>,
    keyword: &'static str,
    complaint: &'static str,
) -> Option<StringRef> {
    let last = source.rfind(ascii(keyword), usize::MAX)?;
    if source.find(ascii(keyword), 0) != Some(last) {
        return evaluating(message, source);
    }
    let operand = trimmed(source.slice_from(last + keyword.len()));
    let (open, close) = (ascii(". (evaluating '"), ascii("')"));
    join(&[operand, ascii(complaint), open, source, close])
}

/// One that sets up an object before anything else is known by that place.
fn position_in_builtin(code_block: &CodeBlock, bytecode_offset: u32) -> Option<Position> {
    let (offset, first) = code_block.body().positions().entries().next()?;
    let sets_up = matches!(
        code_block.opcode_at(offset),
        Some(Opcode::Call | Opcode::SetPrototype)
    );
    if sets_up && first.start == first.end {
        return Some(first);
    }
    Some(code_block.position(bytecode_offset)).filter(|it| it.start < it.end)
}

impl SourceAppender {
    pub(super) fn is_for_call(self) -> bool {
        matches!(
            self,
            SourceAppender::FailedCall | SourceAppender::FailedConstruct
        )
    }

    fn append_exact(self, message: Text<'_>, source: Text<'_>, value: Value) -> Option<StringRef> {
        match self {
            SourceAppender::Default | SourceAppender::FailedConstruct => {
                evaluating(clamped(message), source)
            }
            SourceAppender::NotAFunction | SourceAppender::FailedCall => {
                not_a_function(message, source, value)
            }
            SourceAppender::In => right_operand(message, source, "in", " is not an Object"),
            SourceAppender::InstanceofNotAFunction => {
                right_operand(message, source, "instanceof", " is not a function")
            }
            SourceAppender::HasInstanceNotAFunction => {
                let complaint = "[Symbol.hasInstance] is not a function, undefined, or null";
                right_operand(message, source, "instanceof", complaint)
            }
            SourceAppender::InvalidPrototype => {
                let last = source.rfind(ascii("extends"), usize::MAX);
                if last.is_none() || source.find(ascii("extends"), 0) != last {
                    return evaluating(message, source);
                }
                Some(StringRef::from_literal(
                    "The value of the superclass's prototype property is not an object or null.",
                ))
            }
        }
    }

    /// `None` if the message stays as it is.
    pub(super) fn append(self, vm: &Vm, message: Text<'_>, value: Value) -> Option<StringRef> {
        const CONTEXT: usize = 20;
        // A call is that of the code which makes it, whether or not that can be seen.
        let is_call = self.is_for_call();
        let (code_block, bytecode_offset) = StackVisitor::frames(vm)
            .filter(|frame| is_call || !frame.is_private())
            .find_map(|frame| Some((frame.code_block?, frame.bytecode_offset)))?;
        let body = code_block.body();
        if body.positions().is_empty() || code_block.executable().is_private_builtin() {
            return None;
        }
        // What a built-in calls its variables does not take the place of the value.
        let (appender, position) = if is_call || !body.flags().contains(CodeFlags::BUILTIN) {
            (self, code_block.position(bytecode_offset))
        } else {
            let position = position_in_builtin(&code_block, bytecode_offset)?;
            (SourceAppender::Default, position)
        };
        let provider = code_block.source_provider();
        let text = provider.text();
        let (start, end) = (position.start as usize, position.end as usize);
        if end == 0 || start > text.len() || end > text.len() {
            return None;
        }
        if start < end {
            return appender.append_exact(message, text.slice(start..end), value);
        }
        let is_on_line = |&unit: &u16| unit != u16::from(b'\n');
        let before = text.slice(0..start).code_units().rev().take(CONTEXT);
        let before = text.slice(start - before.take_while(is_on_line).count()..start);
        let leading = before.code_units().take_while(|&it| is_space(it)).count();
        let after = text.slice_from(start).code_units().take(CONTEXT);
        let after = text.slice(start..start + after.take_while(is_on_line).count());
        let trailing = after.code_units().rev().take_while(|&it| is_space(it));
        let first = start - before.len() + leading.min(before.len().saturating_sub(1));
        let last = start + after.len() - trailing.count();
        near(message, text.slice(first..last))
    }
}
