use std::borrow::Cow;

use bun_sema::hir::{Branches, ExprId, ExprKind, NodeData};
use smallvec::{SmallVec, smallvec};

use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::engine::{
    RegExpLiteralCreation, classify_regexp_literal, describe_regexp_construction_error,
};
use crate::ir::generated::{BlockRole, RegExpFlags};
use crate::ir::{StringId, TypeId, TypeTable, ValueId};
use crate::lower::call::Arguments;
use crate::lower::context::regexp_pattern_as_printed;
use crate::lower::{FileLowering, FunctionLowering};

const TOO_MANY_NESTED_DISJUNCTIONS: &[u8] =
    b"Invalid regular expression: too many nested disjunctions";

fn regexp_flags(letters: &[u8]) -> Option<RegExpFlags> {
    let mut flags = RegExpFlags::default();
    for &letter in letters {
        let flag = match letter {
            b'd' => RegExpFlags::HAS_INDICES,
            b'g' => RegExpFlags::GLOBAL,
            b'i' => RegExpFlags::IGNORE_CASE,
            b'm' => RegExpFlags::MULTILINE,
            b's' => RegExpFlags::DOT_ALL,
            b'u' => RegExpFlags::UNICODE,
            b'v' => RegExpFlags::UNICODE_SETS,
            b'y' => RegExpFlags::STICKY,
            _ => return None,
        };
        if flags.contains(flag) {
            return None;
        }
        flags |= flag;
    }
    if flags.contains(RegExpFlags::UNICODE) && flags.contains(RegExpFlags::UNICODE_SETS) {
        return None;
    }
    Some(flags)
}

fn emit_regexp_construction(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: StringId,
    letters: &[u8],
) -> ValueId {
    let letters = lowering.file.intern_bytes(letters);
    let constructor = lowering.emit_builtin_itself(BuiltinId::RegExp);
    let pattern = lowering.builder.string(pattern);
    let letters = lowering.builder.string(letters);
    let arguments = Arguments::Values(smallvec![pattern, letters]);
    lowering.emit_construct(constructor, arguments, None)
}

fn emit_syntax_error(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    message: &[u8],
) -> ValueId {
    let message = lowering.file.intern_bytes(message);
    let message = lowering.builder.string(message);
    let constructor = lowering.emit_builtin_itself(BuiltinId::SyntaxError);
    lowering.emit_construct(constructor, Arguments::Values(smallvec![message]), None)
}

// For a pattern that is nested too deep for the stack at hand `new RegExp` throws an out-of-memory error, and a literal a SyntaxError.
fn emit_deeply_nested_regexp(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: StringId,
    letters: &[u8],
) -> ValueId {
    let after = lowering.create_block();
    let handler = lowering.begin_handler(BlockRole::CatchHandler, None);
    let created = emit_regexp_construction(lowering, pattern, letters);
    lowering.end_handler(handler);
    lowering.jump(after);

    lowering.continue_in(handler.block());
    lowering.builder.catch_value();
    let error = emit_syntax_error(lowering, TOO_MANY_NESTED_DISJUNCTIONS);
    lowering.builder.throw(error);

    lowering.continue_in(after);
    created
}

pub(super) fn lower_array_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Array(elements) = hir[literal].kind else {
        unreachable!("lower_array_literal takes an Array expression");
    };
    let contents = lowering.file.array_literal_contents(literal);
    let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
    lowering.lower_elements(contents, &[], &elements, hir[literal].pos)
}

pub(super) fn lower_regexp_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let ExprKind::Regex { pattern, flags } = lowering.file.hir[literal].kind else {
        unreachable!("lower_regexp_literal takes a Regex expression");
    };
    if lowering.file.is_invalid_regexp_literal_left_out(literal) {
        let empty = lowering.file.intern_bytes(b"(?:)");
        return lowering.builder.new_reg_exp(empty, RegExpFlags::default());
    }
    let letters = lowering.file.queries.atom_bytes(flags);
    let Some(flags) = regexp_flags(letters) else {
        let span = lowering.file.span_of(NodeData::Expr(literal));
        let diagnostics = &mut lowering.file.diagnostics;
        diagnostics.report(Code::InvalidRegExpFlags, span, &[letters]);
        return lowering.builder.undefined();
    };
    let text = regexp_pattern_as_printed(lowering.file.queries.atom_bytes(pattern));
    let creation = classify_regexp_literal(&text, letters);
    if creation == RegExpLiteralCreation::NeverBuilt
        && let Some(message) = describe_regexp_construction_error(&text, letters)
    {
        let error = emit_syntax_error(lowering, &message);
        lowering.emit_throw(error);
        return lowering.builder.undefined();
    }
    let pattern = match &text {
        Cow::Borrowed(_) => lowering.file.intern_atom(pattern),
        Cow::Owned(printed) => lowering.file.intern_bytes(printed),
    };
    match creation {
        RegExpLiteralCreation::FromRecord => lowering.builder.new_reg_exp(pattern, flags),
        RegExpLiteralCreation::NeverBuilt => emit_regexp_construction(lowering, pattern, letters),
        RegExpLiteralCreation::DependsOnStack => {
            emit_deeply_nested_regexp(lowering, pattern, letters)
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_argument_list(
        &mut self,
        prefix: &[ValueId],
        arguments: &[ExprId],
        position: u32,
    ) -> ValueId {
        self.lower_elements(TypeTable::ANYTHING, prefix, arguments, position)
    }

    pub(in crate::lower) fn lower_elements(
        &mut self,
        contents: TypeId,
        prefix: &[ValueId],
        elements: &[ExprId],
        position: u32,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut holes: SmallVec<[u32; 4]> = SmallVec::new();
        let mut values: SmallVec<[ValueId; 8]> = SmallVec::from_slice(prefix);
        let mut length = prefix.len() as u32;
        let mut remaining = elements;
        while let Some((&element, rest)) = remaining.split_first() {
            if !self.may_wait_with(values.len() - prefix.len()) {
                break;
            }
            match hir[element].kind {
                ExprKind::Spread(_) => break,
                ExprKind::Missing => holes.push(length),
                _ => values.push(self.lower_expression(element)),
            }
            length += 1;
            remaining = rest;
        }
        self.set_position(position);
        let array = self.builder.new_array(contents, &holes, &values);
        for &element in remaining {
            self.lower_appended_element(array, element);
        }
        array
    }

    fn lower_appended_spread(&mut self, array: ValueId, spread: ExprId, iterable: ExprId) {
        let hir = self.file.hir;
        if !ends_in_array_literal(self.file, iterable) {
            // JSC reports the iteration at the end of `...`.
            let position = hir[spread].pos + 3;
            let iterable = self.lower_expression(iterable);
            self.set_position(position);
            self.builder.append_spread(array, iterable);
            return;
        }
        if !self.enter_nesting(hir[iterable].pos) {
            return;
        }
        let counted = self.enter_counted_expression(iterable);
        match hir[iterable].kind {
            ExprKind::Array(elements) => {
                for element in hir.ids(elements) {
                    self.lower_appended_element(array, element);
                }
            }
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                let if_true = self.create_block();
                let if_false = self.create_block();
                let join = self.create_block();
                self.lower_condition(test, if_true, if_false);
                for (block, arm) in [(if_true, yes), (if_false, no)] {
                    self.continue_in(block);
                    self.lower_appended_spread(array, spread, arm);
                    self.jump(join);
                }
                self.continue_in(join);
            }
            _ => unreachable!("ends_in_array_literal has looked"),
        }
        self.leave_counted_expression(counted);
        self.leave_nesting();
    }

    fn lower_appended_element(&mut self, array: ValueId, element: ExprId) {
        let hir = self.file.hir;
        let position = hir[element].pos;
        match hir[element].kind {
            ExprKind::Spread(iterable) => self.lower_appended_spread(array, element, iterable),
            ExprKind::Missing => {
                self.set_position(position);
                self.builder.append_hole(array);
            }
            _ => {
                let value = self.lower_expression(element);
                self.set_position(position);
                self.builder.append_element(array, value);
            }
        }
    }
}

// `[a, ...[b, c]]`, `[a, ...(test ? [b] : [])]`: nobody else has the list, and nobody sees the iterator of lists hand out its elements. A hole is handed out as undefined.
fn ends_in_array_literal(file: &FileLowering<'_, '_, '_, '_>, iterable: ExprId) -> bool {
    let hir = file.hir;
    if !file.is_array_iterator_protocol_intact() {
        return false;
    }
    let is_dead = |arm: ExprId| file.decisions().is_dead_expr(arm);
    let is_hole = |element: ExprId| matches!(hir[element].kind, ExprKind::Missing);
    let mut pending: SmallVec<[ExprId; 8]> = SmallVec::from_slice(&[iterable]);
    while let Some(candidate) = pending.pop() {
        if file.is_statically_resolved(candidate) || file.is_simplified(candidate) {
            continue;
        }
        match hir[candidate].kind {
            ExprKind::Array(elements) if !hir.ids(elements).any(is_hole) => return true,
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                if !is_dead(yes) && !is_dead(no) {
                    pending.extend_from_slice(&[no, yes]);
                }
            }
            _ => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::regexp_flags;
    use crate::compile::testing::lower_program_replacing;
    use crate::ir::Opcode;
    use crate::ir::generated::RegExpFlags;

    // How many closures the function makes in a row, with nothing in between that takes one.
    fn count_closures_that_wait(program: &str, function: &str) -> usize {
        let lowered = lower_program_replacing(&[("a.js", program)], &[]);
        let fragment = &lowered[0].1.fragment;
        let tables = fragment.tables.take();
        let mut functions = fragment.functions.iter().map(|(_, function)| function);
        let found = functions.find(|candidate| {
            let text = candidate.name.map(|name| tables.strings.get(name));
            text == Some(function.as_bytes())
        });
        let found = found.expect("the fragment defines the function");
        let takers = [
            Opcode::NewArray,
            Opcode::AppendElement,
            Opcode::NewObject,
            Opcode::PropDefine,
        ];
        let (mut waiting, mut most) = (0, 0);
        for value in found.body.blocks().flat_map(|block| block.values()) {
            if value.opcode == Opcode::NewClosure {
                waiting += 1;
                most = most.max(waiting);
            } else if takers.contains(&value.opcode) {
                waiting = 0;
            }
        }
        most
    }

    #[test]
    fn literal_takes_its_values_as_they_are_made_where_the_function_suspends() {
        let write_out = |write: &dyn Fn(usize) -> String| -> String {
            (0..40).map(write).collect::<Vec<String>>().join(", ")
        };
        let list = write_out(&|index| format!("() => {index}"));
        let object = write_out(&|index| format!("k{index}: () => {index}"));
        let indexes = write_out(&|index| format!("{index}: () => {index}"));
        // The member that finds no room has been made by then.
        let heads = [
            ("async function", [32, 33, 32]),
            ("function*", [32, 33, 32]),
            ("function", [40, 40, 40]),
        ];
        for (head, expected) in heads {
            let program = format!(
                "export {head} list() {{ return [{list}]; }}
export {head} object() {{ return {{ {object} }}; }}
export {head} indexes() {{ return {{ {indexes} }}; }}"
            );
            let counted = ["list", "object", "indexes"]
                .map(|function| count_closures_that_wait(&program, function));
            assert_eq!(counted, expected, "{head}");
        }
    }

    #[test]
    fn flag_letters() {
        let flags = [
            (b'd', RegExpFlags::HAS_INDICES),
            (b'g', RegExpFlags::GLOBAL),
            (b'i', RegExpFlags::IGNORE_CASE),
            (b'm', RegExpFlags::MULTILINE),
            (b's', RegExpFlags::DOT_ALL),
            (b'u', RegExpFlags::UNICODE),
            (b'v', RegExpFlags::UNICODE_SETS),
            (b'y', RegExpFlags::STICKY),
        ];
        for (letter, flag) in flags {
            assert_eq!(regexp_flags(&[letter]), Some(flag));
        }
        let without_sets = RegExpFlags::ALL.without(RegExpFlags::UNICODE_SETS);
        let without_unicode = RegExpFlags::ALL.without(RegExpFlags::UNICODE);
        assert_eq!(regexp_flags(b"dgimsuy"), Some(without_sets));
        assert_eq!(regexp_flags(b"dgimsvy"), Some(without_unicode));
        assert_eq!(regexp_flags(b""), Some(RegExpFlags::default()));
    }

    #[test]
    fn invalid_flag_letters() {
        assert_eq!(regexp_flags(b"z"), None);
        assert_eq!(regexp_flags(b"gz"), None);
        assert_eq!(regexp_flags(b"gig"), None);
        assert_eq!(regexp_flags("g\u{e9}".as_bytes()), None);
    }

    #[test]
    fn unicode_excludes_unicode_sets() {
        assert_eq!(regexp_flags(b"uv"), None);
        assert_eq!(regexp_flags(b"vu"), None);
        assert_eq!(regexp_flags(b"dgimsuvy"), None);
    }
}
