//! What a `package.json` says, and a `tsconfig.json` as the one parser reads it.

use crate::atom::Interner;
use crate::check::spans::Spans;
use crate::hir::{
    ExprId, ExprKind, File, PropId, PropKey, PropKind, StmtKind, UnOp, is_parenthesized, start_of,
};
use crate::resolve::{Host, Options};

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    Array(Vec<Json>),
    /// In the order written: the order of `exports` conditions matters.
    Object(Vec<(Vec<u8>, Json)>),
}

impl Json {
    pub fn parse(text: &[u8]) -> Option<Json> {
        let mut p = Parser {
            text,
            at: 0,
            depth: 0,
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            p.at = 3;
        }
        let value = p.value()?;
        p.skip();
        if p.at == text.len() {
            Some(value)
        } else {
            None
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

struct Parser<'a> {
    text: &'a [u8],
    at: usize,
    depth: u32,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn skip(&mut self) {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.at += 1,
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'/') => {
                    while !matches!(self.peek(), None | Some(b'\n')) {
                        self.at += 1;
                    }
                }
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'*') => {
                    self.at += 2;
                    while self.at < self.text.len() && !self.text[self.at..].starts_with(b"*/") {
                        self.at += 1;
                    }
                    self.at = (self.at + 2).min(self.text.len());
                }
                _ => return,
            }
        }
    }

    fn value(&mut self) -> Option<Json> {
        self.skip();
        self.depth += 1;
        if self.depth > 200 {
            return None;
        }
        let value = match self.peek()? {
            b'{' => {
                self.at += 1;
                let mut entries = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b'}' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => {
                            let key = self.string()?;
                            self.skip();
                            if self.peek()? != b':' {
                                return None;
                            }
                            self.at += 1;
                            entries.push((key, self.value()?));
                        }
                    }
                }
                Json::Object(entries)
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip();
                    match self.peek()? {
                        b']' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => items.push(self.value()?),
                    }
                }
                Json::Array(items)
            }
            b'"' => Json::String(self.string()?),
            b't' if self.text[self.at..].starts_with(b"true") => {
                self.at += 4;
                Json::Bool(true)
            }
            b'f' if self.text[self.at..].starts_with(b"false") => {
                self.at += 5;
                Json::Bool(false)
            }
            b'n' if self.text[self.at..].starts_with(b"null") => {
                self.at += 4;
                Json::Null
            }
            _ => {
                let start = self.at;
                while matches!(
                    self.peek(),
                    Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
                ) {
                    self.at += 1;
                }
                Json::Number(
                    std::str::from_utf8(&self.text[start..self.at])
                        .ok()?
                        .parse()
                        .ok()?,
                )
            }
        };
        self.depth -= 1;
        Some(value)
    }

    fn string(&mut self) -> Option<Vec<u8>> {
        if self.peek()? != b'"' {
            return None;
        }
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let c = self.peek()?;
            self.at += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.peek()?;
                    self.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let hex =
                                std::str::from_utf8(self.text.get(self.at..self.at + 4)?).ok()?;
                            self.at += 4;
                            let c = char::from_u32(u32::from_str_radix(hex, 16).ok()?)
                                .unwrap_or('\u{FFFD}');
                            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
        Some(out)
    }
}

/// The expression of the one statement of a JSON file.
fn root_expression(hir: &File) -> Option<ExprId> {
    hir.ids(hir.body).find_map(|s| match hir[s].kind {
        StmtKind::ExportAssign(e) => Some(e),
        _ => None,
    })
}

/// The end of `parseJSONText`, of the file `hir` that reads `text`: what `validateJsonValue` objects to is among what the parser does.
pub fn validate_json(hir: &mut File, text: &[u8]) {
    /// `validateJsonValue`, `validateJsonObjectLiteral`
    fn validate_json_value(spans: Spans<'_>, e: ExprId, refused: &mut Vec<(u32, u32, u32)>) {
        let hir = spans.hir;
        let is_double_quoted = |at: u32| spans.text.get(at as usize) == Some(&b'"');
        let start = start_of(hir, e);
        let code = match hir[e].kind {
            _ if is_parenthesized(hir, e) => 1328,
            ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) => return,
            ExprKind::String(_) if is_double_quoted(start) => return,
            ExprKind::String(_) => 1327,
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } if matches!(hir[operand].kind, ExprKind::Number(_)) => return,
            ExprKind::Array(items) => {
                return hir
                    .ids(items)
                    .for_each(|item| validate_json_value(spans, item, refused));
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let prop = hir[p];
                    if prop.kind != PropKind::Init {
                        refused.push((prop.start, 1136, spans.prop(p) as u32));
                        continue;
                    }
                    if !is_double_quoted(prop.pos) {
                        refused.push((prop.pos, 1327, spans.prop_name(p) as u32));
                    }
                    validate_json_value(spans, prop.value, refused);
                }
                return;
            }
            _ => 1328,
        };
        refused.push((start, code, spans.expr(e) as u32));
    }
    let mut refused = Vec::new();
    if let Some(root) = root_expression(hir).filter(|_| !hir.has_errors) {
        validate_json_value(Spans { hir, text }, root, &mut refused);
    }
    hir.has_parse_diagnostics |= !refused.is_empty();
    hir.early_errors
        .extend(refused.iter().map(|&(start, code, _)| (start, code)));
    hir.error_ends.extend(refused);
}

/// `TsConfigSourceFile`
pub struct TsConfigSourceFile {
    hir: File,
    atoms: Interner,
    /// `convertConfigFileToObject`: the object that is read. `None`: there is none at the root, nor in a list at the root.
    pub root: Option<ExprId>,
}

impl TsConfigSourceFile {
    /// `NewTsconfigSourceFileFromFilePath`. `None`: the parser gave up.
    pub fn parse(host: &dyn Host, text: std::borrow::Cow<'static, [u8]>) -> Option<Self> {
        let atoms = Interner::new();
        let mut hir = host.parse(b"/tsconfig.json", &text, &atoms, &Options::default());
        hir.text = text;
        let is_object = |e: &ExprId| matches!(hir[*e].kind, ExprKind::Object(_));
        let root = root_expression(&hir).filter(|_| !hir.has_errors)?;
        let root = match hir[root].kind {
            ExprKind::Array(items) => hir.ids(items).find(is_object),
            _ => Some(root).filter(is_object),
        };
        Some(TsConfigSourceFile { hir, atoms, root })
    }

    /// `SourceFile.Diagnostics`: the code, what goes into the message, from where to where.
    pub fn diagnostics(&self) -> impl Iterator<Item = (u32, Vec<Vec<u8>>, u32, u32)> {
        let hir = &self.hir;
        let is_the_parsers = |e: &&(u32, u32)| {
            crate::check::errors_js::SYNTACTIC_ERRORS
                .binary_search(&e.1)
                .is_ok()
        };
        let errors = hir.early_errors.iter().filter(is_the_parsers);
        errors.map(|&(start, code)| {
            let mut ends = hir.error_ends.iter();
            let end = ends.find(|e| e.0 == start && e.1 == code);
            let mut named = hir.error_arguments.iter();
            let named = named.find(|named| (named.0, named.1) == (start, code));
            let args = named.map(|named| named.2.iter().map(|arg| arg.to_vec()).collect());
            (
                code,
                args.unwrap_or_default(),
                start,
                end.map_or(start, |e| e.2),
            )
        })
    }

    /// `ForEachPropertyAssignment`: the first property of `object` called `name` or `other`.
    pub fn property(&self, object: ExprId, name: &[u8], other: &[u8]) -> Option<PropId> {
        let ExprKind::Object(props) = self.hir[object].kind else {
            return None;
        };
        props.iter().find(|&p| match self.hir[p] {
            crate::hir::Prop {
                kind: PropKind::Init,
                key: PropKey::Name(key),
                ..
            } => {
                let key = self.atoms.bytes(key);
                key == name || !other.is_empty() && key == other
            }
            _ => false,
        })
    }

    pub fn initializer(&self, p: PropId) -> ExprId {
        self.hir[p].value
    }

    pub fn elements(&self, array: ExprId) -> impl Iterator<Item = ExprId> {
        let items = match self.hir[array].kind {
            ExprKind::Array(items) => items,
            _ => Default::default(),
        };
        self.hir.ids(items)
    }

    /// From where to where the name of `p` is written.
    pub fn name_span(&self, p: PropId) -> (u32, u32) {
        (self.hir[p].pos, Spans::of(&self.hir).prop_name(p) as u32)
    }

    pub fn span(&self, e: ExprId) -> (u32, u32) {
        (start_of(&self.hir, e), Spans::of(&self.hir).expr(e) as u32)
    }

    /// `convertPropertyValueToJson`. What is not in the expected format is `null`, which stays in a list.
    pub fn convert_property_value_to_json(&self, e: ExprId) -> Json {
        let hir = &self.hir;
        match hir[e].kind {
            _ if is_parenthesized(hir, e) => Json::Null,
            ExprKind::True => Json::Bool(true),
            ExprKind::False => Json::Bool(false),
            ExprKind::String(text) => Json::String(self.atoms.bytes(text).to_vec()),
            ExprKind::Number(n) => Json::Number(hir.numbers[n as usize]),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => match hir[operand].kind {
                ExprKind::Number(n) => Json::Number(-hir.numbers[n as usize]),
                _ => Json::Null,
            },
            ExprKind::Array(_) => Json::Array(
                self.elements(e)
                    .map(|element| self.convert_property_value_to_json(element))
                    .collect(),
            ),
            // `convertObjectLiteralExpressionToJson`
            ExprKind::Object(props) => {
                let mut result: Vec<(Vec<u8>, Json)> = Vec::new();
                for p in props.iter() {
                    let (PropKind::Init, PropKey::Name(key)) = (hir[p].kind, hir[p].key) else {
                        continue;
                    };
                    let key = self.atoms.bytes(key);
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
