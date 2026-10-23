use bun_sema::hir::{Branches, ExprId, ExprKind, NodeData};
use smallvec::SmallVec;

use super::{is_statically_resolved, lower_expression};
use crate::diagnostic_codes::Code;
use crate::ir::generated::RegExpFlags;
use crate::ir::{TypeId, TypeTable, ValueId};
use crate::lower::{FileLowering, FunctionLowering, call, condition, types};

enum ElementKind {
    Hole,
    Spread(ExprId),
    Value,
}

fn element_kind(kind: ExprKind) -> ElementKind {
    match kind {
        ExprKind::Missing => ElementKind::Hole,
        ExprKind::Spread(iterable) => ElementKind::Spread(iterable),
        _ => ElementKind::Value,
    }
}

fn regexp_flag(letter: u8) -> Option<RegExpFlags> {
    match letter {
        b'd' => Some(RegExpFlags::HAS_INDICES),
        b'g' => Some(RegExpFlags::GLOBAL),
        b'i' => Some(RegExpFlags::IGNORE_CASE),
        b'm' => Some(RegExpFlags::MULTILINE),
        b's' => Some(RegExpFlags::DOT_ALL),
        b'u' => Some(RegExpFlags::UNICODE),
        b'v' => Some(RegExpFlags::UNICODE_SETS),
        b'y' => Some(RegExpFlags::STICKY),
        _ => None,
    }
}

fn regexp_flags(letters: &[u8]) -> Option<RegExpFlags> {
    let mut flags = RegExpFlags::default();
    for &letter in letters {
        let flag = regexp_flag(letter)?;
        if flags.contains(flag) {
            return None;
        }
        flags |= flag;
    }
    Some(flags)
}

pub(super) fn lower_array_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Array(elements) = hir[literal].kind else {
        unreachable!("lower_array_literal takes an Array expression");
    };
    if let Some(made) = call::try_lower_list_of_indexes(lowering, literal) {
        return made;
    }
    let contents = types::array_literal_contents(lowering.file, literal);
    let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
    lower_elements(lowering, contents, &[], &elements, hir[literal].pos)
}

pub(super) fn lower_regexp_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let ExprKind::Regex { pattern, flags } = lowering.file.hir[literal].kind else {
        unreachable!("lower_regexp_literal takes a Regex expression");
    };
    let letters = lowering.file.queries.atom_bytes(flags);
    let Some(flags) = regexp_flags(letters) else {
        let span = lowering.file.span_of(NodeData::Expr(literal));
        let diagnostics = &mut lowering.file.diagnostics;
        diagnostics.report(Code::InvalidRegExpFlags, span, &[letters]);
        return lowering.builder.undefined();
    };
    let pattern = lowering.file.intern_atom(pattern);
    lowering.builder.new_reg_exp(pattern, flags)
}

pub(in crate::lower) fn lower_argument_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    prefix: &[ValueId],
    arguments: &[ExprId],
    position: u32,
) -> ValueId {
    lower_elements(lowering, TypeTable::ANYTHING, prefix, arguments, position)
}

fn lower_elements(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    contents: TypeId,
    prefix: &[ValueId],
    elements: &[ExprId],
    position: u32,
) -> ValueId {
    let hir = lowering.file.hir;
    let mut holes: SmallVec<[u32; 4]> = SmallVec::new();
    let mut values: SmallVec<[ValueId; 8]> = SmallVec::from_slice(prefix);
    let mut length = prefix.len() as u32;
    let mut remaining = elements;
    while let Some((&element, rest)) = remaining.split_first() {
        match element_kind(hir[element].kind) {
            ElementKind::Spread(_) => break,
            ElementKind::Hole => holes.push(length),
            ElementKind::Value => values.push(lower_expression(lowering, element)),
        }
        length += 1;
        remaining = rest;
    }
    lowering.set_position(position);
    let array = lowering.builder.new_array(contents, &holes, &values);
    for &element in remaining {
        lower_appended_element(lowering, array, element);
    }
    array
}

fn ends_in_list_literal(file: &FileLowering<'_, '_, '_, '_>, iterable: ExprId) -> bool {
    let hir = file.hir;
    if is_statically_resolved(file, iterable) || file.is_simplified(iterable) {
        return false;
    }
    let is_dead = |arm: ExprId| file.decisions().is_dead_expr(arm);
    match hir[iterable].kind {
        ExprKind::Array(elements) => hir
            .ids(elements)
            .all(|element| !matches!(element_kind(hir[element].kind), ElementKind::Hole)),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            !is_dead(yes)
                && !is_dead(no)
                && (ends_in_list_literal(file, yes) || ends_in_list_literal(file, no))
        }
        _ => false,
    }
}

fn lower_appended_spread(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    array: ValueId,
    iterable: ExprId,
) {
    let hir = lowering.file.hir;
    if !ends_in_list_literal(lowering.file, iterable) {
        let position = hir[iterable].pos;
        let iterable = lower_expression(lowering, iterable);
        lowering.set_position(position);
        lowering.builder.append_spread(array, iterable);
        return;
    }
    match hir[iterable].kind {
        ExprKind::Array(elements) => {
            let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
            for element in elements {
                lower_appended_element(lowering, array, element);
            }
        }
        ExprKind::Cond { test, branches } => {
            let Branches { yes, no } = hir.branches(branches);
            let if_true = lowering.create_block();
            let if_false = lowering.create_block();
            let join = lowering.create_block();
            condition::lower_condition(lowering, test, if_true, if_false);
            lowering.continue_in(if_true);
            lower_appended_spread(lowering, array, yes);
            lowering.jump(join);
            lowering.continue_in(if_false);
            lower_appended_spread(lowering, array, no);
            lowering.jump(join);
            lowering.continue_in(join);
        }
        _ => unreachable!("ends_in_list_literal has looked"),
    }
}

fn lower_appended_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    array: ValueId,
    element: ExprId,
) {
    let hir = lowering.file.hir;
    let position = hir[element].pos;
    match element_kind(hir[element].kind) {
        ElementKind::Spread(iterable) if ends_in_list_literal(lowering.file, iterable) => {
            lower_appended_spread(lowering, array, iterable);
        }
        ElementKind::Spread(iterable) => {
            // JSC reports the iteration at the end of `...`.
            let position = hir[iterable].pos;
            let iterable = lower_expression(lowering, iterable);
            lowering.set_position(position);
            lowering.builder.append_spread(array, iterable);
        }
        ElementKind::Hole => {
            lowering.set_position(position);
            lowering.builder.append_hole(array);
        }
        ElementKind::Value => {
            let value = lower_expression(lowering, element);
            lowering.set_position(position);
            lowering.builder.append_element(array, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::regexp_flags;
    use crate::ir::generated::RegExpFlags;

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
        assert_eq!(regexp_flags(b"dgimsuvy"), Some(RegExpFlags::ALL));
        assert_eq!(regexp_flags(b""), Some(RegExpFlags::default()));
    }

    #[test]
    fn invalid_flag_letters() {
        assert_eq!(regexp_flags(b"z"), None);
        assert_eq!(regexp_flags(b"gz"), None);
        assert_eq!(regexp_flags(b"gig"), None);
        assert_eq!(regexp_flags("g\u{e9}".as_bytes()), None);
    }
}
