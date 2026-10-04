//! The contents of a `package.json`, from `Host::parse_package_json`, and a `tsconfig.json` as
//! parsed by the one shared parser.

use crate::atom::Interner;
use crate::check::spans::Spans;
use crate::hir::{
    Diagnostic, DiagnosticKind, ExprId, ExprKind, File, PropId, PropKey, PropKind, StmtKind, UnOp,
    is_parenthesized, start_of,
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

impl Json {
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

/// The end of `parseJSONText` for the file `hir` with source `text`: the errors of
/// `validateJsonValue` are parse diagnostics.
pub fn validate_json(hir: &mut File, text: &[u8]) {
    /// `validateJsonValue`, `validateJsonObjectLiteral`
    fn validate_json_value(spans: Spans<'_, '_>, e: ExprId, refused: &mut Vec<(u32, u32, u32)>) {
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
    hir.diagnostics
        .to_mut()
        .extend(refused.iter().map(|&(start, code, end)| {
            Diagnostic::new(DiagnosticKind::Parse, (start, end), code, &[])
        }));
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
        let is_object = |e: &ExprId| matches!(hir[*e].kind, ExprKind::Object(_));
        let root = root_expression(&hir).filter(|_| !hir.has_errors)?;
        let root = match hir[root].kind {
            ExprKind::Array(items) => hir.ids(items).find(is_object),
            _ => Some(root).filter(is_object),
        };
        Some(TsConfigSourceFile { hir, atoms, root })
    }

    /// `SourceFile.Diagnostics`: the code, the message arguments, the start and the end.
    pub fn diagnostics(&self) -> impl Iterator<Item = (u32, Vec<Vec<u8>>, u32, u32)> {
        let diagnostics = self.hir.diagnostics.iter();
        let parse_errors = diagnostics.filter(|d| d.kind == DiagnosticKind::Parse);
        parse_errors.map(|d| {
            let args = d.args.iter().map(|arg| arg.to_vec()).collect();
            let end = if d.end == Diagnostic::NO_LENGTH {
                0
            } else {
                d.end
            };
            (d.code, args, d.start, end.max(d.start))
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

    /// The span of the name of `p`.
    pub fn name_span(&self, p: PropId) -> (u32, u32) {
        (self.hir[p].pos, Spans::of(&self.hir).prop_name(p) as u32)
    }

    pub fn span(&self, e: ExprId) -> (u32, u32) {
        (start_of(&self.hir, e), Spans::of(&self.hir).expr(e) as u32)
    }

    /// `convertPropertyValueToJson`. A value that is not in the expected format becomes `null`,
    /// which is preserved in an array.
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
