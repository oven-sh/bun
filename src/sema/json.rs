//! The contents of a `package.json`, from `Host::parse_package_json`, and a `tsconfig.json` as
//! parsed by the one shared parser.

use crate::atom::Interner;
use crate::check::spans::{Spans, skip_trivia};
use crate::config_options::Declaration;
use crate::hir::{
    Diagnostic, DiagnosticKind, ExprId, ExprKind, File, PropId, PropKind, StmtKind, UnOp,
    is_bigint_literal_at, is_parenthesized, is_private_name_at, start_of,
};
use crate::resolve::Host;
use crate::session::Session;
use crate::util::{FxHashMap, FxHashSet};
use std::cell::RefCell;
use std::collections::hash_map::Entry;

/// A value can be nested as deep as memory allows: `JSON.parse` has no limit, and rules read files with it. So `drop`, `clone`
/// and `==`, which can't report that the stack is full, keep their place in a list and never recurse.
#[derive(Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    Array(Vec<Json>),
    /// In source order: the order of `exports` conditions matters.
    Object(Vec<(Vec<u8>, Json)>),
}

impl Json {
    fn children_mut(&mut self) -> impl Iterator<Item = &mut Json> {
        let (items, entries) = match self {
            Json::Array(items) => (&mut items[..], &mut [][..]),
            Json::Object(entries) => (&mut [][..], &mut entries[..]),
            _ => (&mut [][..], &mut [][..]),
        };
        let values = entries.iter_mut().map(|it| &mut it.1);
        items.iter_mut().chain(values)
    }

    fn children(&self) -> impl Iterator<Item = &Json> {
        let items = self.as_array().unwrap_or_default();
        let entries = self.as_object().unwrap_or_default();
        items.iter().chain(entries.iter().map(|it| &it.1))
    }

    fn has_children(&self) -> bool {
        match self {
            Json::Array(items) => !items.is_empty(),
            Json::Object(entries) => !entries.is_empty(),
            _ => false,
        }
    }

    /// Moves the arrays and objects directly inside `self` to `nested`.
    fn unnest(&mut self, nested: &mut Vec<Json>) {
        let inner = self.children_mut().filter(|it| it.has_children());
        nested.extend(inner.map(|it| std::mem::replace(it, Json::Null)));
    }

    /// `self` without what is inside its arrays and objects, which are `null` in the copy.
    fn clone_one_level(&self) -> Json {
        match self {
            Json::Null => Json::Null,
            Json::Bool(it) => Json::Bool(*it),
            Json::Number(it) => Json::Number(*it),
            Json::String(it) => Json::String(it.clone()),
            Json::Array(items) => Json::Array(items.iter().map(|_| Json::Null).collect()),
            Json::Object(entries) => {
                let names = entries.iter().map(|it| (it.0.clone(), Json::Null));
                Json::Object(names.collect())
            }
        }
    }

    /// Whether `self` and `other` are equal if what is inside their arrays and objects is.
    fn eq_one_level(&self, other: &Json) -> bool {
        match (self, other) {
            (Json::Null, Json::Null) => true,
            (Json::Bool(a), Json::Bool(b)) => a == b,
            (Json::Number(a), Json::Number(b)) => a == b,
            (Json::String(a), Json::String(b)) => a == b,
            (Json::Array(a), Json::Array(b)) => a.len() == b.len(),
            (Json::Object(a), Json::Object(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.0 == b.0)
            }
            _ => false,
        }
    }
}

impl Drop for Json {
    fn drop(&mut self) {
        if !self.has_children() {
            return;
        }
        let mut nested = Vec::new();
        self.unnest(&mut nested);
        while let Some(mut next) = nested.pop() {
            next.unnest(&mut nested);
        }
    }
}

impl Clone for Json {
    fn clone(&self) -> Json {
        let mut copy = self.clone_one_level();
        if !self.has_children() {
            return copy;
        }
        let mut unfinished = vec![(self, &mut copy)];
        while let Some((from, to)) = unfinished.pop() {
            for (from, to) in from.children().zip(to.children_mut()) {
                *to = from.clone_one_level();
                if from.has_children() {
                    unfinished.push((from, to));
                }
            }
        }
        copy
    }
}

impl PartialEq for Json {
    fn eq(&self, other: &Json) -> bool {
        if !self.eq_one_level(other) {
            return false;
        }
        if !self.has_children() {
            return true;
        }
        let mut unfinished = vec![(self, other)];
        while let Some((a, b)) = unfinished.pop() {
            for (a, b) in a.children().zip(b.children()) {
                if !a.eq_one_level(b) {
                    return false;
                }
                if a.has_children() {
                    unfinished.push((a, b));
                }
            }
        }
        true
    }
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
    /// `Boolean(value)`
    pub fn is_truthy(&self) -> bool {
        match self {
            Json::Null => false,
            Json::Bool(value) => *value,
            Json::Number(value) => *value != 0.0 && !value.is_nan(),
            Json::String(value) => !value.is_empty(),
            Json::Array(_) | Json::Object(_) => true,
        }
    }

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

    /// An object with `entries` as a text has them. A key that is written more than once is there once, at its first place and
    /// with its last value: what `JSON.parse` makes of it, and an object to which each entry is assigned in turn. Everything that
    /// reads a text makes its objects with this, so whoever walks the entries sees what [`Json::get`] finds.
    pub fn object(entries: Vec<(Vec<u8>, Json)>) -> Json {
        // Comparing all pairs is faster than hashing for the few keys that most objects have.
        let has_repeats = match entries.len() {
            0..=16 => (entries.iter().enumerate())
                .any(|(at, entry)| entries[..at].iter().any(|it| it.0 == entry.0)),
            len => {
                let keys: FxHashSet<&[u8]> = entries.iter().map(|it| &it.0[..]).collect();
                keys.len() < len
            }
        };
        if !has_repeats {
            return Json::Object(entries);
        }
        let mut places: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        let mut kept: Vec<(Vec<u8>, Json)> = Vec::with_capacity(entries.len());
        for (key, value) in entries {
            match places.entry(key) {
                Entry::Occupied(place) => kept[*place.get()].1 = value,
                Entry::Vacant(place) => {
                    kept.push((place.key().clone(), value));
                    place.insert(kept.len() - 1);
                }
            }
        }
        Json::Object(kept)
    }

    /// Of two entries with one key the last counts, as for `JSON.parse`.
    pub fn get(&self, key: &[u8]) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().rfind(|e| e.0 == key).map(|e| &e.1),
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

    /// A type with a `Drop` can't be taken apart by a pattern. These three do that.
    pub fn into_string(mut self) -> Option<Vec<u8>> {
        match &mut self {
            Json::String(s) => Some(std::mem::take(s)),
            _ => None,
        }
    }

    pub fn into_array(mut self) -> Option<Vec<Json>> {
        match &mut self {
            Json::Array(a) => Some(std::mem::take(a)),
            _ => None,
        }
    }

    pub fn into_object(mut self) -> Option<Vec<(Vec<u8>, Json)>> {
        match &mut self {
            Json::Object(o) => Some(std::mem::take(o)),
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
                        // `getErrorSpanForNode`: a missing name is before the trivia.
                        let start = skip_trivia(spans.text, prop.pos as usize) as u32;
                        refused.push((start, 1327, spans.prop_name(p) as u32));
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
            // Only a missing node ends where the text starts.
            let end = match end {
                0 => Diagnostic::NO_LENGTH,
                end => end,
            };
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
    /// For an object with many properties that `property` has been asked about: the first with
    /// each name. It is asked about each of thousands of `paths`.
    first_with_name: RefCell<FxHashMap<ExprId, FxHashMap<Box<[u8]>, PropId>>>,
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
        let mut hir = host.parse(session.arena(), path, &text, &atoms, Default::default());
        hir.text = text;
        let is_object =
            |e: &ExprId| matches!(hir[*e].kind, ExprKind::Object(_)) && !is_parenthesized(&hir, *e);
        let root = root_expression(&hir).filter(|_| !hir.has_errors)?;
        let root = match hir[root].kind {
            ExprKind::Array(items) => hir.ids(items).find(is_object),
            _ => Some(root).filter(is_object),
        };
        Some(TsConfigSourceFile {
            hir,
            atoms,
            root,
            first_with_name: Default::default(),
        })
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
        if props.len() > 32 {
            let mut first_with_name = self.first_with_name.borrow_mut();
            let of_object = first_with_name.entry(object).or_insert_with(|| {
                let mut of_object = FxHashMap::default();
                for p in assignments {
                    if let Some(prop_name) = self.try_get_text_of_property_name(p) {
                        of_object.entry(prop_name.into()).or_insert(p);
                    }
                }
                of_object
            });
            let keys = [Some(key), key2].into_iter().flatten();
            return (keys.filter_map(|key| of_object.get(key).copied())).min_by_key(|p| p.idx());
        }
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
                let entries = self.properties(e).map(|(p, key)| {
                    let value = self.convert_property_value_to_json(hir[p].value);
                    (key.to_vec(), value)
                });
                Json::object(entries.collect())
            }
            _ => Json::Null,
        }
    }
}
