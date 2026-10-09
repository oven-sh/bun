//! `oxc_codegen`, as far as the fixes of oxlint print a part of the tree anew with it.

use bun_core::strings;
use bun_lint::prelude::*;
use smallvec::SmallVec;

/// `Codegen::print_string` and `print_string_literal`: the string with the value `value` in `quote`s. The fixes of oxlint
/// print `'` (`fixer.codegen()`), and `"` where they take the default options of `oxc_codegen`.
pub fn print_string(out: &mut Vec<u8>, value: &[u8], quote: u8) {
    out.push(quote);
    let mut rest = value;
    while let Some((&byte, after)) = rest.split_first() {
        let (escaped, len): (&[u8], usize) = match (byte, after) {
            (0x00, [b'0'..=b'9', ..]) => (b"\\x00", 1),
            (0x00, _) => (b"\\0", 1),
            (0x07, _) => (b"\\x07", 1),
            (0x08, _) => (b"\\b", 1),
            (0x0B, _) => (b"\\v", 1),
            (0x0C, _) => (b"\\f", 1),
            (b'\n', _) => (b"\\n", 1),
            (b'\r', _) => (b"\\r", 1),
            (0x1B, _) => (b"\\x1B", 1),
            (b'\\', _) => (b"\\\\", 1),
            (b'\'', _) if quote == b'\'' => (b"\\'", 1),
            (b'"', _) if quote == b'"' => (b"\\\"", 1),
            (b'<', [b'/', tag @ ..])
                if tag
                    .get(..6)
                    .is_some_and(|it| it.eq_ignore_ascii_case(b"script")) =>
            {
                (b"<\\/", 2)
            }
            (0xE2, [0x80, 0xA8, ..]) => (b"\\u2028", 3),
            (0xE2, [0x80, 0xA9, ..]) => (b"\\u2029", 3),
            (0xC2, [0xA0, ..]) => (b"\\xA0", 2),
            // Half of a surrogate pair.
            (0xED, [second @ 0xA0..=0xBF, third @ 0x80..=0xBF, ..]) => {
                let unit = 0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F);
                out.extend_from_slice(format!("\\u{unit:04x}").as_bytes());
                (b"", 3)
            }
            _ => (std::slice::from_ref(&byte), 1),
        };
        out.extend_from_slice(escaped);
        rest = rest.get(len..).unwrap_or_default();
    }
    out.push(quote);
}

/// `Codegen::print_non_negative_float`: the shortest way to write `n`.
fn print_number(out: &mut Vec<u8>, n: f64) {
    let text = text::number_to_string(n);
    let text = text.as_slice();
    if !n.is_finite() || n < 1000.0 && n.fract() == 0.0 {
        out.extend_from_slice(text);
        return;
    }
    let shorter_of = |best: Vec<u8>, candidate: Vec<u8>| {
        if candidate.len() < best.len() {
            candidate
        } else {
            best
        }
    };
    let mut best = text
        .strip_prefix(b"0")
        .filter(|it| it.starts_with(b"."))
        .unwrap_or(text)
        .to_vec();
    if let Some(at) = strings::index_of(&best, b"e+") {
        best.remove(at + 1);
    }
    let mut is_hex = false;
    if n.fract() == 0.0 {
        let hex = format!("0x{:x}", n as u128).into_bytes();
        is_hex = hex.len() < best.len();
        best = shorter_of(best, hex);
    } else if best.starts_with(b".0") {
        // `.0005` is `5e-4`.
        let zeros = best.iter().skip(1).take_while(|it| **it == b'0').count();
        let digits = best.get(1 + zeros..).unwrap_or_default();
        if !digits.is_empty() {
            let exponent = (digits.len() + zeros).to_string();
            let candidate = [digits, b"e-", exponent.as_bytes()].concat();
            best = shorter_of(best, candidate);
        }
    }
    let zeros = best.iter().rev().take_while(|it| **it == b'0').count();
    if !is_hex && zeros > 0 && zeros < best.len() {
        let digits = best.get(..best.len() - zeros).unwrap_or_default();
        let candidate = [digits, b"e", zeros.to_string().as_bytes()].concat();
        best = shorter_of(best, candidate);
    }
    // `1.2e101` is `12e100`.
    if let Some((integer, rest)) = strings::split_once_char(&best, b'.')
        && let Some((fraction, exponent)) = strings::split_once_char(rest, b'e')
        && let Some(exponent) = std::str::from_utf8(exponent)
            .ok()
            .and_then(|it| it.parse::<isize>().ok())
    {
        let exponent = (exponent - fraction.len() as isize).to_string();
        let candidate = [integer, fraction, b"e", exponent.as_bytes()].concat();
        best = shorter_of(best, candidate);
    }
    out.extend_from_slice(&best);
}

/// What the fixes of oxlint print a part of the tree anew with: oxc's `Codegen`, with single quotes. Strings, numbers,
/// objects and arrays are printed as there. Everything else stays as it is written, which is the same only if it is
/// written as oxc prints it.
#[derive(Default)]
pub struct Codegen {
    pub code: Vec<u8>,
    indent: usize,
    /// How many objects and arrays are being printed.
    depth: usize,
}

impl Codegen {
    /// `print_soft_newline` and `print_indent`
    pub fn print_soft_newline(&mut self) {
        self.code.push(b'\n');
        self.code.extend(std::iter::repeat_n(b'\t', self.indent));
    }

    pub fn indent(&mut self) {
        self.indent += 1;
    }

    pub fn dedent(&mut self) {
        self.indent = self.indent.saturating_sub(1);
    }

    pub fn print_expression(&mut self, e: Expr) {
        self.print_expr(e, false);
    }

    /// `in_list`: where a comma separates, so that `a, b` needs parentheses. Those that `e` is written in are not
    /// printed, except around a function.
    fn print_expr(&mut self, e: Expr, in_list: bool) {
        let is_wrapped = match e.tag() {
            ExprTag::Fn => e.is_parenthesized(),
            _ => in_list && e.binary_op() == Some(BinOp::Comma),
        };
        if is_wrapped {
            self.code.push(b'(');
        }
        match e.kind() {
            ExprKind::String(value) if !e.is_jsx_text() => {
                print_string(&mut self.code, value.bytes(), b'\'')
            }
            ExprKind::Number(n) => print_number(&mut self.code, n),
            // In base 10.
            ExprKind::BigInt(digits) => {
                self.code.extend_from_slice(digits.bytes());
                self.code.push(b'n');
            }
            ExprKind::Spread(argument) if e.jsx_container_span().is_none() => {
                self.code.extend_from_slice(b"...");
                self.print_expr(argument, in_list);
            }
            // The stack is not for what is nested deeper than anybody writes it.
            ExprKind::Object(properties) if self.depth < 64 => {
                let properties: SmallVec<[Prop; 8]> = properties.iter().collect();
                self.print_object_expression(&properties);
            }
            ExprKind::Array(elements) if self.depth < 64 => self.print_array_expression(elements),
            _ => self.code.extend_from_slice(e.text()),
        }
        if is_wrapped {
            self.code.push(b')');
        }
    }

    /// An object literal with `properties`.
    pub fn print_object_expression(&mut self, properties: &[Prop]) {
        let is_multi_line = properties.len() > 1;
        self.depth += 1;
        self.indent += usize::from(is_multi_line);
        self.code.push(b'{');
        for (i, property) in properties.iter().enumerate() {
            if i != 0 {
                self.code.push(b',');
            }
            match is_multi_line {
                true => self.print_soft_newline(),
                false => self.code.push(b' '),
            }
            self.print_object_property(*property);
        }
        self.indent -= usize::from(is_multi_line);
        match properties.len() {
            0 => {}
            1 => self.code.push(b' '),
            _ => self.print_soft_newline(),
        }
        self.code.push(b'}');
        self.depth -= 1;
    }

    fn print_object_property(&mut self, property: Prop) {
        match (property.kind(), property.key(), property.value()) {
            (PropKind::Spread, _, Some(argument)) => {
                self.code.extend_from_slice(b"...");
                self.print_expr(argument, true);
            }
            (PropKind::Init, Some(key), Some(value)) => {
                let written = property.file().slice(key.inner_span(property.file()));
                let (open, close): (&[u8], &[u8]) = if key.is_computed() {
                    (b"[", b"]: ")
                } else {
                    (b"", b": ")
                };
                self.code.extend_from_slice(open);
                match key.kind() {
                    KeyKind::Computed(e) => self.print_expr(e, true),
                    KeyKind::String(name) | KeyKind::ComputedString(name)
                        if !written.starts_with(b"`") =>
                    {
                        print_string(&mut self.code, name.bytes(), b'\'');
                    }
                    KeyKind::Number(name) | KeyKind::ComputedNumber(name)
                        if !written.ends_with(b"n") =>
                    {
                        print_number(
                            &mut self.code,
                            bun_core::fmt::js_string_to_number(name.bytes()),
                        );
                    }
                    _ => self.code.extend_from_slice(written),
                }
                self.code.extend_from_slice(close);
                self.print_expr(value, true);
            }
            _ => self.code.extend_from_slice(property.text()),
        }
    }

    fn print_array_expression<'a>(&mut self, elements: List<'a, Expr<'a>>) {
        let (len, is_multi_line) = (elements.len(), elements.len() > 2);
        self.depth += 1;
        self.indent += usize::from(is_multi_line);
        self.code.push(b'[');
        for (i, element) in elements.iter().enumerate() {
            if i != 0 {
                self.code.push(b',');
            }
            if is_multi_line {
                self.print_soft_newline();
            } else if i != 0 {
                self.code.push(b' ');
            }
            match element.is_missing() {
                true if i + 1 == len => self.code.push(b','),
                true => {}
                false => self.print_expr(element, true),
            }
        }
        self.indent -= usize::from(is_multi_line);
        if is_multi_line {
            self.print_soft_newline();
        }
        self.code.push(b']');
        self.depth -= 1;
    }
}

/// [`Codegen::print_expression`], which leaves a call as it is written. Here calls, `new`, member expressions and `a, b` are printed as
/// oxc prints them, so that what is in their parentheses and brackets is printed anew too. The parentheses around `e` are not printed.
pub fn print_expression(codegen: &mut Codegen, e: Expr) {
    print_expression_in(codegen, e, 0, false);
}

/// Whether oxc prints no parentheses around it where it is called or a member of it is read.
fn is_primary(e: Expr) -> bool {
    match e.tag() {
        ExprTag::Ident
        | ExprTag::This
        | ExprTag::New
        | ExprTag::Array
        | ExprTag::Object
        | ExprTag::Class
        | ExprTag::Template
        | ExprTag::TaggedTemplate
        | ExprTag::ImportCall
        | ExprTag::Regex
        | ExprTag::String
        | ExprTag::Number
        | ExprTag::BigInt
        | ExprTag::Null
        | ExprTag::True
        | ExprTag::False => true,
        ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull => !e.is_chain_root(),
        _ => false,
    }
}

/// `depth`: in how many pairs of parentheses and brackets that are printed anew. `is_callee_of_new`: a call that it starts with is
/// in parentheses.
fn print_expression_in(codegen: &mut Codegen, e: Expr, depth: usize, is_callee_of_new: bool) {
    // The stack is not for what is nested deeper than anybody writes it.
    if depth > 32 {
        return codegen.print_expression(e);
    }
    // Also `a, (b, c)` is `a, b, c`.
    if e.binary_op() == Some(BinOp::Comma) {
        for (i, item) in e.sequence().iter().enumerate() {
            if i != 0 {
                codegen.code.extend_from_slice(b", ");
            }
            print_expression_in(codegen, *item, depth + 1, false);
        }
        return;
    }
    // `a.b(c)[d]`, which can be as long as one likes: the `[d]`, the `(c)` and the `.b`, and then the `a`.
    let mut links: SmallVec<[Expr; 8]> = SmallVec::new();
    let mut at = e;
    while at == e || !at.is_parenthesized() || is_primary(at) {
        let next = match at.kind() {
            ExprKind::Dot { obj, .. } if !at.is_private_member() => obj,
            ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) if call.type_args().is_empty() => call.callee(),
            _ => break,
        };
        links.push(at);
        at = next;
    }
    // `new (a().b)` is `new (a()).b()`.
    let last_call = links
        .iter()
        .position(|it| it.tag() == ExprTag::Call)
        .filter(|_| is_callee_of_new);
    if last_call.is_some() {
        codegen.code.push(b'(');
    }
    let start = codegen.code.len();
    let is_in_parentheses =
        at != e && at.is_parenthesized() && !is_primary(at) && at.tag() != ExprTag::Fn;
    match at.kind() {
        _ if is_in_parentheses => {
            codegen.code.push(b'(');
            print_expression_in(codegen, at, depth + 1, false);
            codegen.code.push(b')');
        }
        ExprKind::New(call) if call.type_args().is_empty() => {
            let callee = call.callee();
            let is_wrapped =
                callee.is_parenthesized() && !is_primary(callee) && callee.tag() != ExprTag::Fn;
            codegen
                .code
                .extend_from_slice(if is_wrapped { "new (" } else { "new " }.as_bytes());
            print_expression_in(codegen, callee, depth + 1, !is_wrapped);
            codegen
                .code
                .extend_from_slice(if is_wrapped { ")(" } else { "(" }.as_bytes());
            print_arguments(codegen, call, depth);
        }
        _ => codegen.print_expression(at),
    }
    // `1 .a`
    let mut is_integer = at.tag() == ExprTag::Number
        && codegen
            .code
            .get(start..)
            .is_some_and(|it| it.iter().all(u8::is_ascii_digit));
    for (i, link) in links.iter().enumerate().rev() {
        let is_optional = link.is_optional();
        match link.kind() {
            ExprKind::Dot { name, .. } => {
                codegen.code.extend_from_slice(
                    if is_optional {
                        "?."
                    } else if is_integer {
                        " ."
                    } else {
                        "."
                    }
                    .as_bytes(),
                );
                codegen
                    .code
                    .extend_from_slice(link.file().slice(name.span()));
            }
            ExprKind::Index { index, .. } => {
                codegen
                    .code
                    .extend_from_slice(if is_optional { "?.[" } else { "[" }.as_bytes());
                print_expression_in(codegen, index, depth + 1, false);
                codegen.code.push(b']');
            }
            ExprKind::Call(call) => {
                codegen
                    .code
                    .extend_from_slice(if is_optional { "?.(" } else { "(" }.as_bytes());
                print_arguments(codegen, call, depth);
            }
            _ => {}
        }
        is_integer = false;
        if last_call == Some(i) {
            codegen.code.push(b')');
        }
    }
}

/// The arguments and the `)`.
fn print_arguments(codegen: &mut Codegen, call: Call, depth: usize) {
    for (i, argument) in call.args().iter().enumerate() {
        if i != 0 {
            codegen.code.extend_from_slice(b", ");
        }
        let argument = match argument.kind() {
            ExprKind::Spread(spread) => {
                codegen.code.extend_from_slice(b"...");
                spread
            }
            _ => argument,
        };
        let is_sequence = argument.binary_op() == Some(BinOp::Comma);
        if is_sequence {
            codegen.code.push(b'(');
        }
        print_expression_in(codegen, argument, depth + 1, false);
        if is_sequence {
            codegen.code.push(b')');
        }
    }
    codegen.code.push(b')');
}
