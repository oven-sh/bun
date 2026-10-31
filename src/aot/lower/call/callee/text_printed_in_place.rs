use std::cmp::Reverse;

use bun_core::fmt::pow10_exp_1e4_to_1e9;
use bun_core::strings::{index_of, index_of_char_usize};
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::fold::Constant;
use bun_sema::hir::{
    BinOp, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, end_of_expr, start_inside_parentheses,
    start_of,
};

use super::{is_identifier_name, needs_no_escape};
use crate::lower::FileLowering;
use crate::lower::operator::needs_parentheses;
use crate::lower::transpiled::{Rewrite, WrittenFunction, find_written_literal};

enum PrintedText {
    Bytes(Vec<u8>),
    /// A function or a class between two marks. What lies in it may be quoted by itself.
    FromPrinter(Vec<u8>),
    /// Another piece of the file, as that is printed.
    Copy {
        start: u32,
        end: u32,
        is_in_brackets: bool,
    },
}

struct ReplacedText {
    start: u32,
    end: u32,
    printed: PrintedText,
}

/// What an expression is an operand of.
#[derive(Copy, Clone, PartialEq)]
enum Place {
    /// Something is read from it, or it is called.
    Target,
    Operand {
        of: BinOp,
        is_left: bool,
    },
    OperandOfPrefix,
    Other,
}

fn push_number(bytes: &mut Vec<u8>, mut number: u64) {
    while number >= 0x80 {
        bytes.push(number as u8 | 0x80);
        number >>= 7;
    }
    bytes.push(number as u8);
}

/// `print_non_negative_float` of js_printer.
fn append_non_negative_number(number: f64, text: &mut Vec<u8>) {
    let is_integer = number.fract() == 0.0 && number < (u64::MAX >> 12) as f64;
    match is_integer.then(|| pow10_exp_1e4_to_1e9(number as u64)) {
        Some(Some(exponent)) => text.extend_from_slice(&[b'1', b'e', b'0' + exponent]),
        Some(None) => text.extend_from_slice(format!("{}", number as u64).as_bytes()),
        None => text.extend_from_slice(format!("{number}").as_bytes()),
    }
}

/// `markOfIndentation` in the engine.
const MARK_OF_INDENTATION: u8 = 2;

/// `markOfTextFromPrinter` in the engine.
const MARK_OF_TEXT_FROM_PRINTER: u8 = 3;

/// `markOfDifferences`, `copyOfWrittenText`, `lineBreakWithIndentation` and `textWithPieceOfItsOwn` in the engine.
const MARK_OF_DIFFERENCES: u8 = 4;
const COPY_OF_WRITTEN_TEXT: u8 = 5;
const LINE_BREAK_WITH_INDENTATION: u8 = 6;
const TEXT_WITH_PIECE_OF_ITS_OWN: u8 = 7;

struct TextFromPrinter {
    start: u32,
    end: u32,
    printed: Vec<u8>,
}

const SMALLEST_COPY: usize = 4;

fn find_where_written_goes_on(written: &[u8], from: usize, next: &[u8]) -> Option<usize> {
    let (mut at, mut passed_over) = (from, 0);
    while at + SMALLEST_COPY <= written.len() && passed_over < 64 {
        if written[at..at + SMALLEST_COPY] == next[..SMALLEST_COPY] {
            return Some(at);
        }
        let rest = &written[at..];
        at = match rest {
            [b'/', b'/', ..] => {
                index_of_char_usize(rest, b'\n').map_or(written.len(), |end| at + end)
            }
            [b'/', b'*', ..] => {
                index_of(&rest[2..], b"*/").map_or(written.len(), |end| at + end + 4)
            }
            _ => {
                passed_over += usize::from(!rest[0].is_ascii_whitespace());
                at + 1
            }
        };
    }
    None
}

/// What stands behind `markOfDifferences`. `written` starts at `start` in the file. `is_kept_whole`: no type is cut out of that piece of the file.
fn find_differences_from_written(
    printed: &[u8],
    written: &[u8],
    start: u32,
    inner: &[&TextFromPrinter],
    is_kept_whole: impl Fn(u32, u32) -> bool,
) -> Vec<u8> {
    let mut differences = Vec::with_capacity(printed.len() / 8 + 8);
    let mut inner = inner.iter().peekable();
    let (mut at, mut end_of_copied) = (0, 0);
    while at < printed.len() {
        let next = &printed[at..];
        while inner
            .next_if(|inner| ((inner.start - start) as usize) < end_of_copied)
            .is_some()
        {}
        let next_inner = inner.peek().map(|inner| {
            (
                (inner.start - start) as usize,
                (inner.end - start) as usize,
                &inner.printed[..],
            )
        });
        let may_be_copied = next.len() >= SMALLEST_COPY && !matches!(next[0], b' ' | b'\n');
        let found = match may_be_copied {
            true => find_where_written_goes_on(written, end_of_copied, next),
            false => None,
        };
        if let Some((start_of_inner, end_of_inner, printed_inner)) = next_inner
            && found.is_none_or(|found| found >= start_of_inner)
            && next.starts_with(printed_inner)
        {
            differences.push(TEXT_WITH_PIECE_OF_ITS_OWN);
            push_number(&mut differences, (start_of_inner - end_of_copied) as u64);
            push_number(&mut differences, (end_of_inner - start_of_inner) as u64);
            end_of_copied = end_of_inner;
            at += printed_inner.len();
            continue;
        }
        if let Some(found) = found {
            let both = next.iter().zip(&written[found..]);
            let mut size = both
                .take_while(|(printed, written)| printed == written)
                .count();
            if let Some((start_of_inner, end_of_inner, _)) = next_inner
                && found < start_of_inner
                && (start_of_inner..end_of_inner).contains(&(found + size))
            {
                size = start_of_inner - found;
            }
            if is_kept_whole(start + found as u32, start + (found + size) as u32) {
                differences.push(COPY_OF_WRITTEN_TEXT);
                push_number(&mut differences, (found - end_of_copied) as u64);
                push_number(&mut differences, size as u64);
                end_of_copied = found + size;
                at += size;
                continue;
            }
        }
        let blanks = next[1..].iter().take_while(|&&byte| byte == b' ').count();
        if next[0] == b'\n' && blanks % 2 == 0 {
            differences.push(LINE_BREAK_WITH_INDENTATION);
            push_number(&mut differences, blanks as u64 / 2);
            at += 1 + blanks;
            continue;
        }
        differences.push(next[0]);
        at += 1;
    }
    differences
}

fn zigzag(number: i64) -> u64 {
    ((number << 1) ^ (number >> 63)) as u64
}

/// `bun run` runs what Bun's transpiler prints of a file, and an error quotes that: the value in place of the name of a constant,
/// an initializer in place of the only use of a variable, `3` for `1 + 2`, `b` for `(a, b)`.
impl FileLowering<'_, '_, '_, '_> {
    /// `Module.textPrintedInPlace`: see `TextPrintedInPlaceOfModule` in the engine. The starts count from the start of the file.
    pub(in crate::lower) fn find_text_printed_in_place(&self) -> Vec<u8> {
        // One piece of no size: nothing prints this file anew, so `true` is not `!0` in it either.
        if self.runs_as_written() {
            return vec![0, 0, 0];
        }
        let Some(transpiled) = &self.transpiled else {
            return Vec::new();
        };
        let hir = self.hir;
        let is_name_or_number = |expression: ExprId| {
            matches!(
                hir[expression].kind,
                ExprKind::Ident(_) | ExprKind::Number(_)
            )
        };
        let names_and_numbers = (0..hir.exprs.len() as u32)
            .map(ExprId)
            .filter(|&it| is_name_or_number(it));
        let rewritten = transpiled.rewritten_expressions();
        let rewritten = rewritten.filter(|&it| !is_name_or_number(it));
        let keys = transpiled.keys_printed_as_names().iter().copied();
        let mut replaced: Vec<(ReplacedText, ExprId)> = names_and_numbers
            .chain(rewritten)
            .chain(keys)
            .filter_map(|it| Some((self.find_text_printed_in_place_of(it)?, it)))
            .collect();
        // The bracket, one mark, and one more for each indentation of its line.
        let brackets = transpiled.quoted_brackets_over_lines().iter();
        replaced.extend(brackets.filter_map(|&(start, indentation)| {
            let bracket = *hir.text.get(start as usize)?;
            let mut printed = vec![MARK_OF_INDENTATION; indentation as usize + 2];
            printed[0] = bracket;
            let printed = PrintedText::Bytes(printed);
            let end = start + 1;
            matches!(bracket, b'[' | b'{').then_some((
                ReplacedText {
                    start,
                    end,
                    printed,
                },
                ExprId::NONE,
            ))
        }));
        let functions = self.find_text_from_printer().into_iter();
        replaced.extend(functions.map(|text| (text, ExprId::NONE)));
        replaced.sort_unstable_by_key(|(text, of)| (text.start, Reverse(text.end), *of));
        let mut bytes = Vec::with_capacity(replaced.len() * 5);
        let (mut last_start, mut last_end, mut end_of_bytes) = (0, 0, 0);
        for (text, _) in &replaced {
            // Nothing beneath what is given as bytes is printed. A copy there still says where the place of an error in an initializer leads.
            // Of two for one piece the first stands for both.
            let is_bytes = !matches!(text.printed, PrintedText::Copy { .. });
            if (is_bytes && text.start < end_of_bytes)
                || (text.start, text.end) == (last_start, last_end)
            {
                continue;
            }
            push_number(&mut bytes, u64::from(text.start - last_start));
            push_number(&mut bytes, u64::from(text.end - text.start));
            match &text.printed {
                PrintedText::Bytes(printed) => {
                    push_number(&mut bytes, (printed.len() as u64) << 1);
                    bytes.extend_from_slice(printed);
                    end_of_bytes = text.end;
                }
                PrintedText::FromPrinter(printed) => {
                    push_number(&mut bytes, (printed.len() as u64) << 1);
                    bytes.extend_from_slice(printed);
                }
                &PrintedText::Copy {
                    start,
                    end,
                    is_in_brackets,
                } => {
                    let size = u64::from(end - start);
                    push_number(&mut bytes, size << 2 | u64::from(is_in_brackets) << 1 | 1);
                    push_number(&mut bytes, zigzag(i64::from(text.start) - i64::from(start)));
                }
            }
            (last_start, last_end) = (text.start, text.end);
        }
        bytes
    }

    fn find_text_from_printer(&self) -> Vec<ReplacedText> {
        let transpiled = self.transpiled.as_ref();
        let functions = transpiled.map_or(&[][..], |transpiled| transpiled.printed_functions());
        let places = self.find_places_of_text_from_printer();
        let is_mark =
            |byte: &u8| (MARK_OF_TEXT_FROM_PRINTER..=TEXT_WITH_PIECE_OF_ITS_OWN).contains(byte);
        let mut texts: Vec<TextFromPrinter> = functions
            .iter()
            .zip(places)
            .filter(|(function, _)| !function.text.iter().any(is_mark))
            .filter_map(|(function, place)| {
                let (start, end, is_in_brackets) = place?;
                let mut printed = Vec::with_capacity(function.text.len() + 2);
                if is_in_brackets {
                    printed.push(b'(');
                }
                printed.extend_from_slice(&function.text);
                if is_in_brackets {
                    printed.push(b')');
                }
                Some(TextFromPrinter {
                    start,
                    end,
                    printed,
                })
            })
            .collect();
        texts.sort_unstable_by_key(|text| (text.start, Reverse(text.end)));
        texts.dedup_by_key(|text| (text.start, text.end));
        let mut inner: Vec<Vec<&TextFromPrinter>> = vec![Vec::new(); texts.len()];
        let mut around: Vec<usize> = Vec::new();
        for (index, text) in texts.iter().enumerate() {
            while around
                .pop_if(|&mut last| texts[last].end <= text.start)
                .is_some()
            {}
            if let Some(&last) = around.last() {
                inner[last].push(text);
            }
            around.push(index);
        }
        let is_kept_whole = |from: u32, to: u32| {
            self.type_ranges.map_offset(to) - self.type_ranges.map_offset(from) == to - from
        };
        let told = texts.iter().zip(&inner).map(|(text, inner)| {
            let written = &self.hir.text[text.start as usize..text.end as usize];
            let differences = find_differences_from_written(
                &text.printed,
                written,
                text.start,
                inner,
                is_kept_whole,
            );
            let mut printed = vec![MARK_OF_TEXT_FROM_PRINTER];
            if differences.len() <= text.printed.len() {
                printed.push(MARK_OF_DIFFERENCES);
                printed.extend_from_slice(&differences);
            } else {
                printed.extend_from_slice(&text.printed);
                printed.push(MARK_OF_TEXT_FROM_PRINTER);
            }
            ReplacedText {
                start: text.start,
                end: text.end,
                printed: PrintedText::FromPrinter(printed),
            }
        });
        told.collect()
    }

    /// For each of `printed_functions`: where it starts and ends in the file, and whether it is printed in round brackets.
    pub(in crate::lower) fn find_places_of_text_from_printer(
        &self,
    ) -> Vec<Option<(u32, u32, bool)>> {
        let transpiled = self.transpiled.as_ref();
        let functions = transpiled.map_or(&[][..], |transpiled| transpiled.printed_functions());
        if functions.is_empty() {
            return Vec::new();
        }
        let hir = self.hir;
        let blocks = hir.body_starts.iter().map(|&(id, start)| (start, id.0));
        let arrows = (0..hir.fns.len() as u32).map(FnId).filter_map(|id| {
            let function = &hir[id];
            let returns_expression =
                function.kind == FnKind::Arrow && matches!(function.body, FnBody::Expr(_));
            returns_expression.then_some((function.anchor, id.0))
        });
        let mut by_body: Vec<(u32, u32)> = blocks.chain(arrows).collect();
        by_body.sort_unstable();
        let find_function = |body: u32| {
            let found = by_body.binary_search_by_key(&body, |function| function.0);
            Some(FnId(by_body[found.ok()?].1))
        };
        let classes = (0..hir.exprs.len() as u32).map(ExprId);
        let mut classes: Vec<(u32, u32)> = classes
            .filter_map(|expression| match hir[expression].kind {
                ExprKind::Class(class) => Some((hir[class].text_start, expression.0)),
                _ => None,
            })
            .collect();
        classes.sort_unstable();
        let find_class = |keyword: u32| {
            let found = classes.binary_search_by_key(&keyword, |class| class.0);
            Some(ExprId(classes[found.ok()?].1))
        };
        let owner_of = |function: FnId| self.bound.fns[function.idx()].owner;
        let places = functions.iter().map(|function| {
            let expression = match function.written {
                WrittenFunction::Expression { body } => match owner_of(find_function(body)?) {
                    FnOwner::Expr(expression) => Some(expression),
                    _ => return None,
                },
                WrittenFunction::Class { keyword } => Some(find_class(keyword)?),
                WrittenFunction::Method { .. } => None,
            };
            let (start, end, is_in_brackets) = match (expression, function.written) {
                (Some(expression), _) => {
                    let whole = self.with_type_syntax_around(expression);
                    let place = self.place_of(expression);
                    let is_in_brackets = self.is_printed_in_brackets(expression, place);
                    (
                        start_of(hir, whole),
                        end_of_expr(hir, whole),
                        is_in_brackets,
                    )
                }
                (None, WrittenFunction::Method { body }) => {
                    let method = find_function(body)?;
                    let end = self.find_end_of_function(method)?;
                    (hir[method].text_start, end, false)
                }
                (None, _) => return None,
            };
            (start < end).then_some((start, end, is_in_brackets))
        });
        places.collect()
    }

    /// `f as T` and `f!` of `f`.
    fn with_type_syntax_around(&self, expression: ExprId) -> ExprId {
        let mut whole = expression;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(whole)
            && matches!(
                self.hir[parent].kind,
                ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::Instantiation { .. }
            )
        {
            whole = parent;
        }
        whole
    }

    fn find_text_printed_in_place_of(&self, expression: ExprId) -> Option<ReplacedText> {
        let hir = self.hir;
        if let ExprKind::Index { obj, index, chain } = hir[expression].kind
            && self.find_rewrite(expression).is_none()
        {
            return self.find_name_printed_for_key(expression, obj, index, chain);
        }
        let (start, end) = (start_of(hir, expression), end_of_expr(hir, expression));
        // `0x10`, `1_000` and `10000` are printed `16`, `1000` and `1e4`.
        if let ExprKind::Number(index) = hir[expression].kind
            && self.find_rewrite(expression).is_none()
        {
            let mut printed = Vec::new();
            append_non_negative_number(hir.numbers[index as usize], &mut printed);
            let (start, end) = (hir[expression].pos, hir[expression].end);
            let is_written_so = hir.text.get(start as usize..end as usize) == Some(&printed[..]);
            return (!is_written_so).then_some(ReplacedText {
                start,
                end,
                printed: PrintedText::Bytes(printed),
            });
        }
        let operand = match hir[expression].kind {
            ExprKind::Ident(_) => self.find_printed_initializer(expression),
            _ => self.find_operand_printed_alone(expression),
        };
        if let Some(operand) = operand {
            let operand = self.skip_type_syntax(operand);
            return Some(ReplacedText {
                start,
                end,
                printed: PrintedText::Copy {
                    start: start_inside_parentheses(hir, operand),
                    end: hir[operand].end,
                    is_in_brackets: self.is_printed_in_brackets(operand, self.place_of(expression)),
                },
            });
        }
        let Some(Rewrite::Literal { value, .. }) = self.find_rewrite(expression) else {
            return None;
        };
        let mut printed = Vec::new();
        let is_in_brackets = self.place_of(expression) == Place::Target;
        if !self.append_literal(value, is_in_brackets, &mut printed) {
            return None;
        }
        self.append_name_of_enum_member(expression, &mut printed);
        Some(ReplacedText {
            start,
            end,
            printed: PrintedText::Bytes(printed),
        })
    }

    /// `a[k]` is printed `a.name` where the transpiler has the text in place of `k` as it reads the file.
    /// `a["name"]` is printed so everywhere, which needs no word here.
    fn find_name_printed_for_key(
        &self,
        expression: ExprId,
        object: ExprId,
        key: ExprId,
        chain: Chain,
    ) -> Option<ReplacedText> {
        let hir = self.hir;
        let written = find_written_literal(hir, self.bound, self.skip_type_syntax(key));
        if matches!(written, Some(Constant::String(_))) {
            return None;
        }
        let Some(Constant::String(name)) = self.find_literal_value(key) else {
            return None;
        };
        let name = self.queries.atom_bytes(name);
        if !is_identifier_name(name) {
            return None;
        }
        let text = &hir.text[..];
        let is_skipped = |byte: u8| byte.is_ascii_whitespace() || byte == b'!';
        let mut at = end_of_expr(hir, object) as usize;
        while text.get(at).is_some_and(|&byte| is_skipped(byte)) {
            at += 1;
        }
        let mut printed = Vec::with_capacity(name.len() + 1);
        if chain == Chain::Start && text[at..].starts_with(b"?.") {
            at += 2;
        } else {
            printed.push(b'.');
        }
        if text.get(at) != Some(&b'[') {
            return None;
        }
        printed.extend_from_slice(name);
        Some(ReplacedText {
            start: at as u32,
            end: hir[expression].end,
            printed: PrintedText::Bytes(printed),
        })
    }

    fn place_of(&self, expression: ExprId) -> Place {
        let hir = self.hir;
        let mut child = expression;
        loop {
            let Parent::Expr(parent) = self.bound.parent_of_expr(child) else {
                return Place::Other;
            };
            return match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. } => {
                    child = parent;
                    continue;
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == child => {
                    Place::Target
                }
                ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site)
                    if hir[site].callee == child =>
                {
                    Place::Target
                }
                ExprKind::Binary { op, left, .. } => Place::Operand {
                    of: op,
                    is_left: left == child,
                },
                ExprKind::Unary { .. } | ExprKind::Await(_) => Place::OperandOfPrefix,
                _ => Place::Other,
            };
        }
    }

    /// Bun prints round brackets only where the meaning hangs on them, so those around an initializer come with the place that it is printed in.
    fn is_printed_in_brackets(&self, operand: ExprId, place: Place) -> bool {
        let hir = self.hir;
        if place == Place::Other {
            return false;
        }
        let printed = self.follow_replaced_names(operand);
        match self.find_literal_value(printed) {
            Some(Constant::Undefined | Constant::Boolean(_)) => return place == Place::Target,
            Some(Constant::Number(number)) => {
                return place == Place::Target && number.is_sign_negative();
            }
            Some(_) => return false,
            None => {}
        }
        match hir[printed].kind {
            ExprKind::Binary { op: inner, .. } => match place {
                Place::Operand { of, is_left } => needs_parentheses(of, inner, is_left),
                Place::Target | Place::OperandOfPrefix | Place::Other => true,
            },
            ExprKind::Cond { .. } | ExprKind::Assign { .. } | ExprKind::Yield { .. } => true,
            ExprKind::Fn(function) => hir[function].kind == FnKind::Arrow,
            ExprKind::Unary { .. } | ExprKind::Await(_) => place == Place::Target,
            _ => false,
        }
    }

    fn append_literal(&self, value: Constant, is_in_brackets: bool, text: &mut Vec<u8>) -> bool {
        let in_brackets = |printed: &[u8], text: &mut Vec<u8>| {
            if is_in_brackets {
                text.push(b'(');
            }
            text.extend_from_slice(printed);
            if is_in_brackets {
                text.push(b')');
            }
        };
        match value {
            Constant::Null => text.extend_from_slice(b"null"),
            Constant::Undefined => in_brackets(b"void 0", text),
            Constant::Boolean(true) => in_brackets(b"!0", text),
            Constant::Boolean(false) => in_brackets(b"!1", text),
            Constant::Number(number) if number.is_nan() => text.extend_from_slice(b"NaN"),
            Constant::Number(number) if !number.is_finite() => return false,
            Constant::Number(number) if number.is_sign_negative() => {
                let mut printed = vec![b'-'];
                append_non_negative_number(-number, &mut printed);
                in_brackets(&printed, text);
            }
            Constant::Number(number) => append_non_negative_number(number, text),
            Constant::String(printed) if needs_no_escape(self.queries.atom_bytes(printed)) => {
                text.push(b'"');
                text.extend_from_slice(self.queries.atom_bytes(printed));
                text.push(b'"');
            }
            Constant::String(_) | Constant::BigInt(_) => return false,
        }
        true
    }
}
