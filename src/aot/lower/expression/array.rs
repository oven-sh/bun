use bun_core::printer::{FIRST_ASCII, LAST_ASCII, bmp_escape, surrogate_pair_escape};
use bun_core::strings::{CodepointIterator, Cursor};
use bun_sema::hir::{Branches, ExprId, ExprKind, NodeData};
use smallvec::SmallVec;

use crate::diagnostic_codes::Code;
use crate::ir::generated::RegExpFlags;
use crate::ir::{TypeId, TypeTable, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

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
    let letters = lowering.file.queries.atom_bytes(flags);
    let Some(flags) = regexp_flags(letters) else {
        let span = lowering.file.span_of(NodeData::Expr(literal));
        let diagnostics = &mut lowering.file.diagnostics;
        diagnostics.report(Code::InvalidRegExpFlags, span, &[letters]);
        return lowering.builder.undefined();
    };
    let pattern = match pattern_as_printed(lowering.file.queries.atom_bytes(pattern)) {
        Some(printed) => lowering.file.intern_bytes(&printed),
        None => lowering.file.intern_atom(pattern),
    };
    lowering.builder.new_reg_exp(pattern, flags)
}

/// As `js_printer` writes a literal for `bun run`, so that `source` reads the same. `None`: as written.
fn pattern_as_printed(written: &[u8]) -> Option<Vec<u8>> {
    let is_printed_as_written = |character: u32| (FIRST_ASCII..=LAST_ASCII).contains(&character);
    if written
        .iter()
        .all(|&byte| is_printed_as_written(u32::from(byte)))
    {
        return None;
    }
    let mut printed = Vec::with_capacity(written.len() * 2);
    let characters = CodepointIterator::init(written);
    let mut cursor = Cursor::default();
    while characters.next(&mut cursor) {
        match cursor.c as u32 {
            character if is_printed_as_written(character) => printed.push(character as u8),
            character @ 0..=0xFFFF => printed.extend_from_slice(&bmp_escape(character)),
            character => printed.extend_from_slice(&surrogate_pair_escape(character)),
        }
    }
    Some(printed)
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

    fn lower_elements(
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

    fn lower_appended_spread(&mut self, array: ValueId, iterable: ExprId) {
        let hir = self.file.hir;
        if !ends_in_list_literal(self.file, iterable) {
            // JSC reports the iteration at the end of `...`.
            let position = hir[iterable].pos;
            let iterable = self.lower_expression(iterable);
            self.set_position(position);
            self.builder.append_spread(array, iterable);
            return;
        }
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
                    self.lower_appended_spread(array, arm);
                    self.jump(join);
                }
                self.continue_in(join);
            }
            _ => unreachable!("ends_in_list_literal has looked"),
        }
    }

    fn lower_appended_element(&mut self, array: ValueId, element: ExprId) {
        let hir = self.file.hir;
        let position = hir[element].pos;
        match hir[element].kind {
            ExprKind::Spread(iterable) => self.lower_appended_spread(array, iterable),
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

fn ends_in_list_literal(file: &FileLowering<'_, '_, '_, '_>, iterable: ExprId) -> bool {
    let hir = file.hir;
    if file.is_statically_resolved(iterable) || file.is_simplified(iterable) {
        return false;
    }
    let is_dead = |arm: ExprId| file.decisions().is_dead_expr(arm);
    match hir[iterable].kind {
        ExprKind::Array(elements) => hir
            .ids(elements)
            .all(|element| !matches!(hir[element].kind, ExprKind::Missing)),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            !is_dead(yes)
                && !is_dead(no)
                && (ends_in_list_literal(file, yes) || ends_in_list_literal(file, no))
        }
        _ => false,
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
