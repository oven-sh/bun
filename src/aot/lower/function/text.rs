use bun_core::strings;
use bun_sema::atom::number_to_string;
use bun_sema::bind::Parent;
use bun_sema::check::spans::skip_trivia_back;
use bun_sema::erasure::{
    PackedTypeRanges, ReplacedText, TypeRanges, find_type_ranges_beside_what_is_laid,
};
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, FnId, PropKind, StmtId, StmtKind, end_of_expr, find_transpiled_mark,
    start_of,
};
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
use crate::load::SourceKind;
use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    fn is_left_out_of_text(&self, expression: ExprId) -> bool {
        let may_be_left_out = !matches!(
            self.hir[expression].kind,
            ExprKind::Call(_) | ExprKind::Assign { .. } | ExprKind::Await(_) | ExprKind::New(_)
        );
        may_be_left_out && self.reads_only_what_bun_run_leaves_out(expression, true)
    }

    fn find_operands_left_out(&self, list: ExprId) -> Vec<(u32, u32)> {
        let hir = self.hir;
        let decisions = self.decisions();
        let mut found = Vec::new();
        let mut waiting = vec![list];
        while let Some(operand) = waiting.pop() {
            if let ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } = hir[operand].kind
            {
                waiting.extend([left, right]);
                continue;
            }
            let is_written_in_place = matches!(
                decisions.decision(operand),
                Decision::Constant(_) | Decision::Data(_)
            );
            if !is_written_in_place && self.is_left_out_of_text(operand) {
                found.push((hir[operand].pos, hir[operand].end));
            }
        }
        found
    }

    pub(in crate::lower) fn finish_function_sources(&mut self) -> PackedTypeRanges {
        let hir = self.hir;
        let atoms = &self.queries.files().atoms;
        let is_of_program = self.inputs.sources.kind(self.file) == SourceKind::Program;
        let stands_as_written = is_of_program && find_transpiled_mark(&hir.text).is_some();
        let written = self.values_written_in_place.take();
        let written = written.into_iter().filter(|_| !stands_as_written);
        let mut values_first_in_text = Vec::new();
        let replaced = written.filter_map(|(expression, value)| {
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
        let mut left_out: Vec<(u32, u32)> = Vec::new();
        replaced.extend(not_evaluated.iter().map(|&(start, end)| ReplacedText {
            start,
            end,
            text: Box::default(),
        }));
        let statements = hir.stmts.iter().enumerate();
        for (index, statement) in statements.filter(|_| !stands_as_written) {
            let StmtKind::Expr(expression) = statement.kind else {
                continue;
            };
            let is_left_out = self.is_left_out_of_text(expression);
            let is_list = matches!(
                hir[expression].kind,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    ..
                }
            );
            if !is_left_out && !is_list {
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
            if !is_left_out {
                let operands = self.find_operands_left_out(expression);
                replaced.extend(operands.iter().map(|&(start, end)| ReplacedText {
                    start,
                    end,
                    text: Box::new(*b"0"),
                }));
                left_out.extend(&operands);
                not_evaluated.extend(operands);
                continue;
            }
            left_out.push((statement.start, statement.loc.end));
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
        let written_as_this = written_as_this.filter(|_| !stands_as_written);
        replaced.extend(written_as_this.map(|this| ReplacedText {
            start: hir[this].pos,
            end: hir[this].end,
            text: this_of_file.into(),
        }));
        let decisions = self.decisions();
        values_first_in_text.sort_unstable();
        values_first_in_text.dedup();
        if !stands_as_written {
            replaced.append(&mut find_text_replaced_by_bundling(
                hir,
                self.bound,
                decisions,
                atoms,
                values_first_in_text,
                self.counts_executions(),
            ));
        }
        remove_parts_inside(&mut replaced, left_out);
        let written_end = hir.written_text_end();
        replaced.retain(|it| it.start <= written_end);
        let reparses = self.inputs.options.reparses_function_sources;
        let folded = decisions.as_folded_by_bun_run();
        let is_printed_by_bun = is_of_program && !stands_as_written;
        let lays_heads = self.inputs.options.embeds_function_source && is_printed_by_bun;
        let mut changes = None;
        let ranges = find_type_ranges_beside_what_is_laid(hir, replaced, |types, replaced| {
            if lays_heads {
                if !hir.is_js {
                    let mut parentheses = find_parentheses_left_by_types(hir, replaced);
                    replaced.append(&mut parentheses);
                }
                let mut heads = find_text_of_heads(hir, types, replaced);
                replaced.append(&mut heads);
                replaced.retain(|it| it.start <= written_end);
            }
            changes = reparses
                .then(|| ChangesOfText::new(hir, &folded, replaced))
                .map(|changes| changes.written_anew_at(stretches_of_jsx))
                .map(|changes| changes.not_evaluated_by_text_at(not_evaluated));
        });
        if !ranges.is_empty() || reparses {
            let mut texts = Vec::new();
            let embeds_sources = self.inputs.options.embeds_function_source;
            let written_by_loader = hir.functions_written_by_loader.iter();
            let written_by_loader: FxHashMap<FnId, SourceRange> = written_by_loader
                .filter(|_| embeds_sources)
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
            self.fragment.map_function_source_ranges(|key, text| {
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
            if let Some(changes) = changes {
                self.reparse_function_sources(&ranges, texts, changes);
            }
        }
        ranges.pack()
    }

    fn reparse_function_sources(
        &mut self,
        ranges: &TypeRanges,
        texts: Vec<(u32, u32)>,
        changes: ChangesOfText,
    ) {
        let atoms = &self.queries.files().atoms;
        let path = self.inputs.sources.diagnostic_path(self.file);
        let count = &mut self.function_sources_reparsed;
        let difference =
            find_difference_in_kept_texts(self.hir, atoms, ranges, texts, changes, path, count);
        if let Some(difference) = difference {
            let span = Span {
                file: self.file,
                start: difference.start,
                end: difference.end,
            };
            let code = Code::FunctionSourceReparseMismatch;
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

fn remove_parts_inside(replaced: &mut Vec<ReplacedText>, mut left_out: Vec<(u32, u32)>) {
    left_out.sort_unstable_by_key(|&(start, end)| (start, u32::MAX - end));
    let mut outermost: Vec<(u32, u32)> = Vec::with_capacity(left_out.len());
    for range in left_out {
        if outermost.last().is_none_or(|last| last.1 < range.1) {
            outermost.push(range);
        }
    }
    replaced.retain(|part| {
        let next = outermost.partition_point(|range| range.0 <= part.start);
        let Some(&(start, end)) = next.checked_sub(1).and_then(|at| outermost.get(at)) else {
            return true;
        };
        let is_written_for_stretch = (part.start, part.end) == (start, end);
        let stands_behind = part.start >= end && *part.text != *b")";
        is_written_for_stretch || stands_behind || part.end > end
    });
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
