use std::cmp::Reverse;

use bun_core::fmt::pow10_exp_1e4_to_1e9;
use bun_core::strings::contains_char;
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::fold::Constant;
use bun_sema::hir::{
    BinOp, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, end_of_expr, start_inside_parentheses,
    start_of,
};

use super::{is_identifier_name, needs_no_escape};
use crate::lower::FileLowering;
use crate::lower::operator::needs_parentheses;
use crate::lower::transpiled::{PrintedFunction, Rewrite, WrittenFunction, find_written_literal};

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
        let brackets = transpiled.brackets_over_lines_in_lists().iter();
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
        let functions = self.find_text_from_printer(transpiled.printed_functions_in_lists());
        replaced.extend(functions.into_iter().map(|text| (text, ExprId::NONE)));
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

    fn find_text_from_printer(&self, functions: &[PrintedFunction]) -> Vec<ReplacedText> {
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
        let texts = functions.iter().filter_map(|function| {
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
            if start >= end || contains_char(&function.text, MARK_OF_TEXT_FROM_PRINTER) {
                return None;
            }
            let mut printed = Vec::with_capacity(function.text.len() + 4);
            printed.push(MARK_OF_TEXT_FROM_PRINTER);
            if is_in_brackets {
                printed.push(b'(');
            }
            printed.extend_from_slice(&function.text);
            if is_in_brackets {
                printed.push(b')');
            }
            printed.push(MARK_OF_TEXT_FROM_PRINTER);
            Some(ReplacedText {
                start,
                end,
                printed: PrintedText::FromPrinter(printed),
            })
        });
        texts.collect()
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
