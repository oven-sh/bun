//! The contents of a `package.json`, from `Host::parse_package_json`, and a `tsconfig.json` as
//! parsed by the one shared parser.

use crate::atom::Interner;
use crate::check::spans::Spans;
use crate::config_options::Declaration;
use crate::hir::{
    Diagnostic, DiagnosticKind, ExprId, ExprKind, File, PropId, PropKind, StmtKind, UnOp,
    is_bigint_literal_at, is_parenthesized, is_private_name_at, start_of,
};
use crate::resolve::{Host, Options};
use crate::session::Session;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    Array(Vec<Json>),
    /// In source order: the order of `exports` conditions matters.
    Object(Vec<(Vec<u8>, Json)>),
}

/// `jsonwire.AppendQuote` under `AllowInvalidUTF8`, without `EscapeForHTML` and `EscapeForJS`.
fn append_quote(out: &mut Vec<u8>, text: &[u8]) {
    use std::io::Write;
    out.push(b'"');
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        let size = bun_core::lexer::char_and_size(text, at).1;
        match byte {
            b'"' | b'\\' => out.extend_from_slice(&[b'\\', byte]),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            _ if byte < 0x20 => {
                let _ = write!(out, "\\u{byte:04x}");
            }
            // `isInvalidUTF8`
            _ if byte >= 0x80 && size == 1 => out.extend_from_slice("\u{FFFD}".as_bytes()),
            _ => out.extend_from_slice(&text[at..at + size]),
        }
        at += size;
    }
    out.push(b'"');
}

impl Json {
    /// `core.StringifyJson` without indentation.
    pub fn stringify(&self, out: &mut Vec<u8>) {
        match self {
            Json::Null => out.extend_from_slice(b"null"),
            Json::Bool(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
            // `jsonwire.AppendFloat`
            Json::Number(value) => out.extend_from_slice(
                bun_core::fmt::FormatDouble::dtoa_with_negative_zero(&mut [0; 124], *value),
            ),
            Json::String(value) => append_quote(out, value),
            Json::Array(items) => {
                out.push(b'[');
                // `convertArrayLiteralExpressionToJson` leaves out what is `null`.
                let converted = items.iter().filter(|item| !matches!(item, Json::Null));
                for (index, item) in converted.enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    item.stringify(out);
                }
                out.push(b']');
            }
            Json::Object(properties) => {
                out.push(b'{');
                for (index, (name, value)) in properties.iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    append_quote(out, name);
                    out.push(b':');
                    value.stringify(out);
                }
                out.push(b'}');
            }
        }
    }

    pub fn get(&self, key: &[u8]) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|e| e.0 == key).map(|e| &e.1),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&[u8]> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(Vec<u8>, Json)]> {
        match self {
            Json::Object(o) => Some(o),
            _ => None,
        }
    }
}

/// The expression of the single statement of a JSON file.
fn root_expression(hir: &File) -> Option<ExprId> {
    hir.ids(hir.body).find_map(|s| match hir[s].kind {
        StmtKind::ExportAssign(e) => Some(e),
        _ => None,
    })
}

/// The index in `File::numbers` of `n`, if `e` is `-n` and `n` a `NumericLiteral`.
fn negated_numeric_literal(hir: &File, e: ExprId) -> Option<u32> {
    match hir[e].kind {
        ExprKind::Unary {
            op: UnOp::Minus,
            operand,
        } if !is_parenthesized(hir, operand) => match hir[operand].kind {
            ExprKind::Number(n) => Some(n),
            _ => None,
        },
        _ => None,
    }
}

/// What a function that visits the values of a JSON text in source order has yet to visit. It is
/// in a list, the next at the end: the original calls itself, on a stack that grows.
enum Pending {
    Value(ExprId),
    /// Of an object literal.
    Property(PropId),
}

/// The end of `parseJSONText` for the file `hir` with source `text`: the errors of
/// `validateJsonValue` are parse diagnostics.
pub fn validate_json(hir: &mut File, text: &[u8]) {
    /// `validateJsonValue`, `validateJsonObjectLiteral`
    fn validate_json_value(spans: Spans<'_, '_>, root: ExprId, refused: &mut Vec<(u32, u32, u32)>) {
        let hir = spans.hir;
        let is_double_quoted = |at: u32| spans.text.get(at as usize) == Some(&b'"');
        let mut pending = vec![Pending::Value(root)];
        while let Some(next) = pending.pop() {
            let e = match next {
                Pending::Value(e) => e,
                Pending::Property(p) => {
                    let prop = hir[p];
                    if prop.kind != PropKind::Init {
                        refused.push((prop.start, 1136, spans.prop(p) as u32));
                        continue;
                    }
                    if !is_double_quoted(prop.pos) {
                        refused.push((prop.pos, 1327, spans.prop_name(p) as u32));
                    }
                    prop.value
                }
            };
            let start = start_of(hir, e);
            let code = match hir[e].kind {
                _ if is_parenthesized(hir, e) => 1328,
                ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) => continue,
                ExprKind::String(_) if is_double_quoted(start) => continue,
                ExprKind::String(_) if spans.text.get(start as usize) != Some(&b'`') => 1327,
                ExprKind::Unary { .. } if negated_numeric_literal(hir, e).is_some() => continue,
                ExprKind::Array(items) => {
                    pending.extend(hir.ids(items).rev().map(Pending::Value));
                    continue;
                }
                ExprKind::Object(props) => {
                    pending.extend(props.iter().rev().map(Pending::Property));
                    continue;
                }
                _ => 1328,
            };
            refused.push((start, code, spans.expr(e) as u32));
        }
    }
    let mut refused = Vec::new();
    if let Some(root) = root_expression(hir).filter(|_| !hir.has_errors) {
        validate_json_value(Spans { hir, text }, root, &mut refused);
    }
    hir.has_parse_diagnostics |= !refused.is_empty();
    hir.diagnostics
        .to_mut()
        .extend(refused.iter().map(|&(start, code, end)| {
            Diagnostic::new(DiagnosticKind::Parse, (start, end), code, &[])
        }));
}

/// `tokenValue` of the private identifier `text`: `scanIdentifierParts` decodes the escapes.
fn private_identifier_token_value(text: &[u8]) -> Vec<u8> {
    let mut value = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        let escape = match byte {
            b'\\' => bun_core::lexer::peek_unicode_escape(text, at),
            _ => None,
        };
        match escape.and_then(|(ch, size)| Some((char::from_u32(ch as u32)?, size))) {
            Some((ch, size)) => {
                value.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes());
                at += size;
            }
            None => {
                value.push(byte);
                at += 1;
            }
        }
    }
    value
}

/// `jsnum.ParsePseudoBigInt`: the base 10 digits of the bigint literal `text`.
fn parse_pseudo_big_int(text: &[u8]) -> Vec<u8> {
    let text = text.strip_suffix(b"n").unwrap_or(text);
    let (radix, digits) = match text.get(1) {
        Some(b'b' | b'B') => (2, &text[2..]),
        Some(b'o' | b'O') => (8, &text[2..]),
        Some(b'x' | b'X') => (16, &text[2..]),
        _ => (10, text),
    };
    // Least significant first.
    let mut decimal = vec![0u8];
    for &digit in digits {
        let mut carry = char::from(digit).to_digit(radix).unwrap_or(0);
        for place in &mut decimal {
            let value = u32::from(*place) * radix + carry;
            *place = (value % 10) as u8;
            carry = value / 10;
        }
        while carry > 0 {
            decimal.push((carry % 10) as u8);
            carry /= 10;
        }
    }
    decimal.iter().rev().map(|place| place + b'0').collect()
}

/// `tokenValue` of the bigint literal `text`: `scanHexDigits`, `scanBigIntSuffix`.
pub fn bigint_token_value(text: &[u8]) -> Vec<u8> {
    let without_separators = text.iter().filter(|&&byte| byte != b'_');
    let mut value: Vec<u8> = without_separators.map(u8::to_ascii_lowercase).collect();
    // `Scan`: for a radix prefix without digits, the digit is 0.
    if matches!(value.as_slice(), [b'0', b'x' | b'b' | b'o', b'n']) {
        value.insert(2, b'0');
    }
    if !matches!(value.get(1), Some(b'b' | b'o')) {
        return value;
    }
    let mut decimal = parse_pseudo_big_int(&value);
    decimal.push(b'n');
    decimal
}

/// `TsConfigSourceFile`
pub struct TsConfigSourceFile<'s> {
    hir: File<'s>,
    atoms: Interner<'s>,
    /// `convertConfigFileToObject`: the object that is converted. `None`: the root is not an
    /// object, nor an array that contains one.
    pub root: Option<ExprId>,
}

impl<'s> TsConfigSourceFile<'s> {
    /// `NewTsconfigSourceFileFromFilePath`. `None`: the parser failed.
    pub fn parse(
        host: &dyn Host,
        session: &'s Session,
        text: std::borrow::Cow<'static, [u8]>,
    ) -> Option<Self> {
        let atoms = Interner::new_in(session);
        let path = b"/tsconfig.json";
        let mut hir = host.parse(session.arena(), path, &text, &atoms, &Options::default());
        hir.text = text;
        let is_object =
            |e: &ExprId| matches!(hir[*e].kind, ExprKind::Object(_)) && !is_parenthesized(&hir, *e);
        let root = root_expression(&hir).filter(|_| !hir.has_errors)?;
        let root = match hir[root].kind {
            ExprKind::Array(items) => hir.ids(items).find(is_object),
            _ => Some(root).filter(is_object),
        };
        Some(TsConfigSourceFile { hir, atoms, root })
    }

    /// `SourceFile.Diagnostics`
    pub fn diagnostics(&self) -> impl Iterator<Item = &Diagnostic> {
        let diagnostics = self.hir.diagnostics.iter();
        diagnostics.filter(|d| d.kind == DiagnosticKind::Parse)
    }

    /// `Loc` of one of `diagnostics`, or of its related information.
    pub fn diagnostic_span(&self, d: &Diagnostic) -> (u32, u32) {
        let end = Spans::of(&self.hir).diagnostic_end(d.start, d.end);
        (d.start, end)
    }

    /// `TryGetTextOfPropertyName` for the name of `p`.
    fn try_get_text_of_property_name(&self, p: PropId) -> Option<&[u8]> {
        let (hir, prop) = (&self.hir, self.hir[p]);
        if let Some(name) = prop.key.name() {
            return Some(self.atoms.bytes(name));
        }
        // A private identifier and a bigint literal declare nothing: the key is without their text.
        let written = hir
            .text
            .get(prop.pos as usize..Spans::of(hir).prop_name(p))?;
        let token_value = if is_private_name_at(hir, prop.pos) {
            private_identifier_token_value(written)
        } else if is_bigint_literal_at(hir, prop.pos) {
            bigint_token_value(written)
        } else {
            return None;
        };
        Some(self.atoms.bytes(self.atoms.intern(&token_value)))
    }

    /// The properties for which `convertObjectLiteralExpressionToJson` calls `onPropertySet`, in
    /// source order, each with `keyText`. None if `object` is no object literal.
    pub(crate) fn properties(&self, object: ExprId) -> impl Iterator<Item = (PropId, &[u8])> {
        let props = match self.hir[object].kind {
            ExprKind::Object(props) if !is_parenthesized(&self.hir, object) => props,
            _ => Default::default(),
        };
        let assignments = props
            .iter()
            .filter(move |&p| self.hir[p].kind == PropKind::Init);
        assignments
            .filter_map(move |p| Some((p, self.try_get_text_of_property_name(p)?)))
            .filter(|property| !property.1.is_empty())
    }

    /// `getTsConfigObjectLiteralExpression`: `root`, if it is the expression of the first statement
    /// itself. What is reported after the conversion looks its node up from here.
    pub(crate) fn object_literal_expression(&self) -> Option<ExprId> {
        self.root
            .filter(|&root| root_expression(&self.hir) == Some(root))
    }

    /// `ForEachPropertyAssignment`: the first property of `object` called `key` or `key2`. An empty
    /// `key2` is a name like any other.
    pub fn property(&self, object: ExprId, key: &[u8], key2: Option<&[u8]>) -> Option<PropId> {
        let props = match self.hir[object].kind {
            ExprKind::Object(props) if !is_parenthesized(&self.hir, object) => props,
            _ => return None,
        };
        let mut assignments = props.iter().filter(|&p| self.hir[p].kind == PropKind::Init);
        assignments.find(|&p| {
            let prop_name = self.try_get_text_of_property_name(p);
            prop_name.is_some_and(|prop_name| prop_name == key || key2 == Some(prop_name))
        })
    }

    pub fn initializer(&self, p: PropId) -> ExprId {
        self.hir[p].value
    }

    /// None if `array` is no array literal (`IsArrayLiteralExpression`).
    pub fn elements(&self, array: ExprId) -> impl Iterator<Item = ExprId> {
        let items = match self.hir[array].kind {
            ExprKind::Array(items) if !is_parenthesized(&self.hir, array) => items,
            _ => Default::default(),
        };
        self.hir.ids(items)
    }

    /// The span of the name of `p`.
    pub fn name_span(&self, p: PropId) -> (u32, u32) {
        (self.hir[p].pos, Spans::of(&self.hir).prop_name(p) as u32)
    }

    pub fn span(&self, e: ExprId) -> (u32, u32) {
        (start_of(&self.hir, e), Spans::of(&self.hir).expr(e) as u32)
    }

    /// `Loc`: from the end of the token before it.
    fn loc(&self, start: u32, end: usize) -> (u32, u32) {
        let pos = crate::check::spans::skip_trivia_back(&self.hir.text, start as usize);
        (pos as u32, end as u32)
    }

    /// `KindNoSubstitutionTemplateLiteral`
    fn is_template(&self, e: ExprId) -> bool {
        self.hir.text.get(start_of(&self.hir, e) as usize) == Some(&b'`')
    }

    /// The errors of `convertPropertyValueToJson` for `e`, which is converted for `option`: the
    /// code, the arguments and the span.
    pub(crate) fn conversion_errors(
        &self,
        e: ExprId,
        option: Option<Declaration>,
        errors: &mut Vec<(u32, Vec<Vec<u8>>, (u32, u32))>,
    ) {
        let (hir, spans) = (&self.hir, Spans::of(&self.hir));
        // Each with the option that it, or the object literal that has it, is converted for.
        let mut pending = vec![(Pending::Value(e), option)];
        while let Some((next, option)) = pending.pop() {
            let (e, option) = match next {
                Pending::Value(e) => (e, option),
                // `convertObjectLiteralExpressionToJson`
                Pending::Property(p) => {
                    let prop = hir[p];
                    if prop.kind != PropKind::Init {
                        errors.push((1136, Vec::new(), self.loc(prop.start, spans.prop(p))));
                        continue;
                    }
                    // `QuestionToken`
                    let token = prop.postfix_token;
                    if token != 0 && hir.text.get(token as usize) == Some(&b'?') {
                        let loc = self.loc(token, token as usize + 1);
                        errors.push((8009, vec![b"?".to_vec()], loc));
                    }
                    let key_text = self.try_get_text_of_property_name(p).unwrap_or_default();
                    (prop.value, option.and_then(|it| it.element(key_text)))
                }
            };
            match hir[e].kind {
                _ if is_parenthesized(hir, e) => {}
                ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) => continue,
                ExprKind::String(_) if !self.is_template(e) => continue,
                ExprKind::Unary { .. } if negated_numeric_literal(hir, e).is_some() => continue,
                // `convertArrayLiteralExpressionToJson`
                ExprKind::Array(items) => {
                    let elements = hir.ids(items).rev();
                    pending.extend(elements.map(|element| (Pending::Value(element), option)));
                    continue;
                }
                ExprKind::Object(props) => {
                    pending.extend(props.iter().rev().map(|p| (Pending::Property(p), option)));
                    continue;
                }
                _ => {}
            }
            let (code, args) = match option {
                Some(option) => (5024, vec![option.name().to_vec(), option.takes().to_vec()]),
                None => (1328, Vec::new()),
            };
            let end = spans.expr(e);
            let loc = match hir[e].kind {
                // `createMissingNode`: it is empty, at the end of the token before it.
                ExprKind::Missing if !is_parenthesized(hir, e) => (end as u32, end as u32),
                _ => self.loc(start_of(hir, e), end),
            };
            errors.push((code, args, loc));
        }
    }

    /// `convertPropertyValueToJson`. A value that is not in the expected format becomes `null`,
    /// which stays in an array (`[null]` is a nil slice, `[]` is not): the readers leave it out.
    /// So does a value for which the stack, which grows in Go, is at its end. Only `StringifyJson`
    /// reads what is nested that deep, and it panics beyond `maxNestingDepth`.
    pub fn convert_property_value_to_json(&self, e: ExprId) -> Json {
        let hir = &self.hir;
        match hir[e].kind {
            _ if is_parenthesized(hir, e) || self.is_template(e) => Json::Null,
            ExprKind::Array(_) | ExprKind::Object(_)
                if !bun_core::StackCheck::init().is_safe_to_recurse() =>
            {
                Json::Null
            }
            ExprKind::True => Json::Bool(true),
            ExprKind::False => Json::Bool(false),
            ExprKind::String(text) => Json::String(self.atoms.bytes(text).to_vec()),
            ExprKind::Number(n) => Json::Number(hir.numbers[n as usize]),
            ExprKind::Unary { .. } => negated_numeric_literal(hir, e)
                .map_or(Json::Null, |n| Json::Number(-hir.numbers[n as usize])),
            ExprKind::Array(_) => Json::Array(
                self.elements(e)
                    .map(|element| self.convert_property_value_to_json(element))
                    .collect(),
            ),
            // `convertObjectLiteralExpressionToJson`
            ExprKind::Object(_) => {
                let mut result: Vec<(Vec<u8>, Json)> = Vec::new();
                for (p, key) in self.properties(e) {
                    let value = self.convert_property_value_to_json(hir[p].value);
                    match result.iter_mut().find(|entry| entry.0 == key) {
                        Some(entry) => entry.1 = value,
                        None => result.push((key.to_vec(), value)),
                    }
                }
                Json::Object(result)
            }
            _ => Json::Null,
        }
    }
}
