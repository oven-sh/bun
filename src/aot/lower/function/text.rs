use bun_core::strings;
use bun_sema::atom::number_to_string;
use bun_sema::bind::Parent;
use bun_sema::check::spans::skip_trivia_back;
use bun_sema::erasure::{
    PackedTypeRanges, ReplacedText, TypeRanges, find_type_ranges_beside_what_is_laid,
};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, FnId, PropKind, StmtId, StmtKind, end_of_expr, start_of};
use bun_sema::module_format::list_this_of_file;
use rustc_hash::FxHashMap;

use super::text_of_heads::{find_parentheses_left_by_types, find_text_of_heads};
use super::text_of_jsx::find_text_written_for_jsx;
use super::text_read_back::{ChangesOfText, find_difference_in_kept_texts};
use super::text_replaced_by_bundling::find_text_replaced_by_bundling;
use crate::diagnostic_codes::Code;
use crate::diagnostics::Span;
use crate::ir::FunctionKey;
use crate::ir::generated::{ModuleKind, SourceRange};
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
                Constant::String(text) => print_string(atoms.bytes(text)),
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
        let written_by_loader = hir.texts_written_by_loader.iter();
        replaced.extend(written_by_loader.map(|written| ReplacedText {
            start: written.start,
            end: written.end,
            text: atoms.bytes(written.text).into(),
        }));
        if has_enum_in_function || !hir.modules.is_empty() {
            self.add_names_of_containers(&mut replaced);
        }
        let (jsx_mode, jsx) = (self.compiled.jsx_mode, self.compiled.jsx);
        let mut written_for_jsx = find_text_written_for_jsx(hir, atoms, jsx_mode, jsx);
        let stretches_of_jsx = written_for_jsx.iter().map(|part| (part.start, part.end));
        let stretches_of_jsx: Vec<(u32, u32)> = stretches_of_jsx.collect();
        replaced.append(&mut written_for_jsx);
        let decorators = hir.decorators.iter().filter(|_| hir.legacy_decorators);
        let decorators = decorators.map(|&(_, decorator)| {
            let name = start_of(hir, decorator) as usize;
            let sign = skip_trivia_back(&hir.text, name) as u32 - 1;
            (sign, end_of_expr(hir, decorator))
        });
        let mut not_evaluated: Vec<(u32, u32)> = decorators.collect();
        replaced.extend(not_evaluated.iter().map(|&(start, end)| ReplacedText {
            start,
            end,
            text: Box::default(),
        }));
        for (index, statement) in hir.stmts.iter().enumerate() {
            let StmtKind::Expr(expression) = statement.kind else {
                continue;
            };
            let may_be_left_out = !matches!(
                hir[expression].kind,
                ExprKind::Call(_) | ExprKind::Assign { .. } | ExprKind::Await(_) | ExprKind::New(_)
            );
            if !may_be_left_out || !self.reads_only_what_bun_run_leaves_out(expression, true) {
                continue;
            }
            let id = StmtId(index as u32);
            let above = match self.bound.parent_of_stmt(id) {
                Parent::Stmt(above) => hir[above].kind,
                _ => StmtKind::Empty,
            };
            let is_head_of_loop = match above {
                StmtKind::For { init: head, .. }
                | StmtKind::ForIn { left: head, .. }
                | StmtKind::ForOf { left: head, .. } => head == id,
                _ => false,
            };
            if is_head_of_loop {
                continue;
            }
            not_evaluated.push((statement.start, statement.loc.end));
            replaced.push(ReplacedText {
                start: statement.start,
                end: statement.loc.end,
                text: Box::new(*b";"),
            });
        }
        let this_of_file: &[u8] = match self.inputs.modules.kind(self.file) {
            _ if self.compiled.analysis.has_esm_syntax => b"null",
            ModuleKind::CommonJs => b"exports",
            _ => b"undefined",
        };
        let written_as_this = list_this_of_file(hir).into_iter();
        replaced.extend(written_as_this.map(|this| ReplacedText {
            start: hir[this].pos,
            end: hir[this].end,
            text: this_of_file.into(),
        }));
        let decisions = self.decisions();
        values_first_in_text.sort_unstable();
        values_first_in_text.dedup();
        replaced.append(&mut find_text_replaced_by_bundling(
            hir,
            self.bound,
            decisions,
            atoms,
            values_first_in_text,
            self.counts_executions(),
        ));
        let reads_back = self.inputs.options.reads_function_texts_back;
        let folded = decisions.as_folded_by_bun_run();
        let lays_heads = self.inputs.options.embeds_function_text;
        let mut changes = None;
        let ranges = find_type_ranges_beside_what_is_laid(hir, replaced, |types, replaced| {
            if lays_heads {
                if !hir.is_js {
                    let mut parentheses = find_parentheses_left_by_types(hir, replaced);
                    replaced.append(&mut parentheses);
                }
                let mut heads = find_text_of_heads(hir, types, replaced);
                replaced.append(&mut heads);
            }
            changes = reads_back
                .then(|| ChangesOfText::new(hir, &folded, replaced))
                .map(|changes| changes.written_anew_at(stretches_of_jsx))
                .map(|changes| changes.not_evaluated_by_text_at(not_evaluated));
        });
        if !ranges.is_empty() || reads_back {
            let mut texts = Vec::new();
            let embeds_texts = self.inputs.options.embeds_function_text;
            let written_by_loader = hir.functions_written_by_loader.iter();
            let written_by_loader: FxHashMap<FnId, SourceRange> = written_by_loader
                .filter(|_| embeds_texts)
                .map(|written| {
                    let text = hir.texts_written_by_loader[written.text as usize];
                    let start = match text.start < text.end {
                        true => ranges.map_start(text.start),
                        false => ranges.map_end(text.end) - atoms.bytes(text.text).len() as u32,
                    };
                    let range = SourceRange {
                        start: start + written.start_in_text,
                        end: start + written.end_in_text,
                    };
                    (written.function, range)
                })
                .collect();
            self.fragment.map_function_texts(|key, text| {
                if let FunctionKey::Source(source) = key
                    && let Some(&written) = written_by_loader.get(&source.function)
                {
                    return written;
                }
                texts.push((text.start, text.end));
                SourceRange {
                    start: ranges.map_start(text.start),
                    end: ranges.map_end(text.end),
                }
            });
            self.fragment
                .map_starts_of_declared_records(|start| ranges.map_start(start));
            if let Some(changes) = changes {
                self.read_function_texts_back(&ranges, texts, changes);
            }
        }
        ranges.pack()
    }

    fn read_function_texts_back(
        &mut self,
        ranges: &TypeRanges,
        texts: Vec<(u32, u32)>,
        changes: ChangesOfText,
    ) {
        let atoms = &self.queries.files().atoms;
        let path = self.inputs.sources.diagnostic_path(self.file);
        let count = &mut self.texts_read_back;
        let difference =
            find_difference_in_kept_texts(self.hir, atoms, ranges, texts, changes, path, count);
        if let Some(difference) = difference {
            let span = Span {
                file: self.file,
                start: difference.start,
                end: difference.end,
            };
            let code = Code::TextOfFunctionIsNotItsTree;
            self.diagnostics.report(code, span, &[&difference.message]);
        }
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

pub(in crate::lower) fn print_string(text: &[u8]) -> Vec<u8> {
    let mut printed = vec![b'"'];
    for unit in strings::wtf8_to_utf16(text) {
        match unit {
            0x22 | 0x5C => printed.extend([b'\\', unit as u8]),
            0x20..=0x7E => printed.push(unit as u8),
            _ => printed.extend(format!("\\u{unit:04X}").bytes()),
        }
    }
    printed.push(b'"');
    printed
}
