use bun_sema::atom::number_to_string;
use bun_sema::bind::Parent;
use bun_sema::erasure::{PackedTypeRanges, ReplacedText, find_type_ranges_beside};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, PropKind};

use super::text_replaced_by_bundling::find_text_replaced_by_bundling;
use crate::ir::generated::SourceRange;
use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn finish_function_texts(&mut self) -> PackedTypeRanges {
        let hir = self.hir;
        let atoms = &self.queries.files().atoms;
        let written = self.values_written_in_place.take();
        let mut values_first_in_text = Vec::new();
        let replaced = written.into_iter().filter_map(|(expression, value)| {
            let (start, end) = (hir[expression].pos, hir[expression].end);
            if start >= end || end as usize > hir.text.len() {
                return None;
            }
            let text = match value {
                Constant::Number(number) => {
                    print_number(number, hir.text.get(end as usize) == Some(&b'.'))
                }
                Constant::String(text) => print_string(atoms.bytes(text))?,
                _ => return None,
            };
            if let Some(&first @ (b'(' | b'"')) = text.first() {
                values_first_in_text.push((expression, first));
            }
            Some(ReplacedText {
                start,
                end,
                text: text.into_boxed_slice(),
            })
        });
        let mut replaced: Vec<ReplacedText> = replaced.collect();
        let has_enum_in_function = !self.enums_written_as_code.is_empty();
        replaced.append(&mut self.enums_written_as_code);
        if has_enum_in_function || !hir.modules.is_empty() {
            self.add_names_of_containers(&mut replaced);
        }
        let decisions = self.decisions();
        values_first_in_text.sort_unstable();
        values_first_in_text.dedup();
        replaced.append(&mut find_text_replaced_by_bundling(
            hir,
            self.bound,
            decisions,
            atoms,
            values_first_in_text,
        ));
        let ranges = find_type_ranges_beside(hir, replaced);
        if !ranges.is_empty() {
            self.fragment.map_function_texts(|text| SourceRange {
                start: ranges.map_start(text.start),
                end: ranges.map_end(text.end),
            });
        }
        ranges.pack()
    }

    fn add_names_of_containers(&self, replaced: &mut Vec<ReplacedText>) {
        let (hir, bound) = (self.hir, self.bound);
        let atoms = &self.queries.files().atoms;
        for (index, expression) in hir.exprs.iter().enumerate() {
            let ExprKind::Ident(name) = expression.kind else {
                continue;
            };
            let identifier = ExprId(index as u32);
            let Some(container) = self.find_member_container(identifier) else {
                continue;
            };
            let (container, name) = (atoms.bytes(bound.symbol(container).name), atoms.bytes(name));
            let is_shorthand = match bound.parent_of_expr(identifier) {
                Parent::Prop(property) => hir[property].kind == PropKind::Shorthand,
                _ => false,
            };
            let text = match is_shorthand {
                true => [name, b": ", container, b".", name].concat(),
                false => [container, b".", name].concat(),
            };
            replaced.push(ReplacedText {
                start: expression.pos,
                end: expression.end,
                text: text.into_boxed_slice(),
            });
        }
    }
}

pub(in crate::lower) fn print_number(number: f64, is_followed_by_dot: bool) -> Vec<u8> {
    if number.is_nan() {
        return b"(0/0)".to_vec();
    }
    let digits = match number.is_finite() {
        true => number_to_string(number.abs()),
        false => b"1/0".to_vec(),
    };
    match (number.is_sign_negative(), number.is_finite()) {
        (true, _) => [&b"(-"[..], &digits, b")"].concat(),
        (false, false) => [&b"("[..], &digits, b")"].concat(),
        (false, true) if is_followed_by_dot => [&digits[..], b" "].concat(),
        (false, true) => digits,
    }
}

pub(in crate::lower) fn print_string(text: &[u8]) -> Option<Vec<u8>> {
    let mut printed = vec![b'"'];
    for unit in core::str::from_utf8(text).ok()?.encode_utf16() {
        match unit {
            0x22 | 0x5C => printed.extend([b'\\', unit as u8]),
            0x20..=0x7E => printed.push(unit as u8),
            _ => printed.extend(format!("\\u{unit:04X}").bytes()),
        }
    }
    printed.push(b'"');
    Some(printed)
}
