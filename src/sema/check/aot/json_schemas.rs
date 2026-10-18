use crate::check::Checker;
use crate::bind::Decl;
use crate::hir::{Chain, ExprId, ExprKind, ExprTag, FileKind};
use crate::program::FileId;

pub struct JsonParseSchema {
    pub start: u32,
    pub end: u32,
    pub schema: Result<Vec<u8>, String>,
    pub is_json_parse: bool,
    pub is_unresolved: bool,
}

impl Checker<'_, '_> {
    pub fn json_parse_schemas(&mut self, file: FileId) -> Vec<JsonParseSchema> {
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration {
            return Vec::new();
        }
        let mut found = Vec::new();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[e].kind else { continue };
            if hir[call].type_args.len != 1 {
                continue;
            }
            let diagnostics_before = self.diagnostics_made;
            let is_json_parse = hir[call].chain != Chain::No || !self.is_bun_validate(file, hir[call].callee);
            let validated = if is_json_parse { self.type_argument_of_json_parse(file, e) } else { Some(self.type_from_node(file, hir.id_at(hir[call].type_args, 0))) };
            let (schema, is_unresolved) = match validated {
                Some(ty) => {
                    let plan = self.validation_plan(ty);
                    match plan.unsupported.first() {
                        Some(first) => (Err(format!("a type that cannot be validated: {first}")), plan.has_unresolved_type),
                        None => (Ok(plan.to_json()), false),
                    }
                }
                None if is_json_parse && self.is_json_parse_with_unresolved_type(file, e) => (Err("a type that cannot be validated: it does not resolve".to_string()), true),
                _ => continue,
            };
            found.push(JsonParseSchema { start: hir[e].pos, end: hir[e].end, schema, is_json_parse, is_unresolved: is_unresolved || self.diagnostics_made != diagnostics_before });
        }
        found
    }

    fn is_bun_validate(&mut self, file: FileId, callee: ExprId) -> bool {
        let (hir, bound, atoms) = (self.hir(file), self.bound(file), self.atoms());
        let is_imported_from_bun = |e: ExprId, imported: Option<&[u8]>| {
            let local = bound.expr_symbol[e.idx()];
            local.is_some()
                && bound.symbols[local.idx()].decls.as_slice().iter().any(|&declaration| match declaration {
                    Decl::ImportSpec(named) => imported == Some(atoms.bytes(hir[named].imported)) && atoms.bytes(hir[hir[named].import].spec) == b"bun",
                    Decl::ImportDefault(import) | Decl::ImportNamespace(import) => imported.is_none() && atoms.bytes(hir[import].spec) == b"bun",
                    _ => false,
                })
        };
        match hir[callee].kind {
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if atoms.bytes(name) == b"validate" => is_imported_from_bun(obj, None) || self.refers_to_global_object(file, obj, b"Bun"),
            ExprKind::Ident(_) => is_imported_from_bun(callee, Some(b"validate")),
            _ => false,
        }
    }

    fn is_json_parse_with_unresolved_type(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return false };
        self.atoms().bytes(name) == b"parse" && self.refers_to_global_object(file, obj, b"JSON") && {
            let written = self.type_from_node(file, hir.id_at(hir[call].type_args, 0));
            self.is_error_type(written)
        }
    }
}
