use crate::check::*;

impl Checker<'_, '_> {
    pub(super) fn check_reserved_name_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        let is_runtime_module =
            self.is_in_compile_build(file) && !self.is_compiled_as_commonjs(file);
        for &node in hir.keyword_identifiers() {
            if hir.is_identifier_name(node) || hir.is_ambient(node) {
                continue;
            }
            let code = match hir.text(node) {
                known::r#await if is_runtime_module => 1262,
                known::r#yield if hir.yield_context(node) => 1359,
                _ => continue,
            };
            let name = self.declaration_name_at(file, hir.start(node));
            self.early_error_on_node(file, node, code, &[Arg::Bytes(&name)]);
        }
    }

    pub(super) fn check_eval_or_arguments_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &name in hir.keyword_identifiers() {
            if matches!(hir.text(name), known::eval | known::arguments)
                && (is_class_or_import_name(hir, name)
                    || is_indirect_store_target(hir, bound, name))
                && self.is_read_as_strict_mode_code(file, name)
            {
                let code = self.strict_mode_message(file, hir.parent(name), [1210, 1215, 1100]);
                self.early_error_on_node(file, name, code, &[Arg::Atom(hir.text(name))]);
            }
        }
    }
}

fn is_class_or_import_name(hir: &File<'_>, name: Node) -> bool {
    let declaration = hir.parent(name);
    if hir.name(declaration) != name {
        return false;
    }
    match hir.data(declaration) {
        NodeData::Expr(e) => matches!(hir[e].kind, ExprKind::Class(_)),
        NodeData::Stmt(s) => matches!(hir[s].kind, StmtKind::Class(_)),
        NodeData::ImportSpec(spec) => !hir[spec].type_only && !hir[hir[spec].import].type_only,
        NodeData::Part(Part::ImportClause | Part::NamedBindings, import) => {
            matches!(hir.data(import), NodeData::Stmt(s)
                if matches!(hir[s].kind, StmtKind::Import(i) if !hir[i].type_only))
        }
        _ => false,
    }
}

fn is_indirect_store_target(hir: &File<'_>, bound: &Bound<'_>, name: Node) -> bool {
    let NodeData::Expr(target) = hir.data(name) else {
        return false;
    };
    let is_operand = matches!(
        hir.kind(hir.parent(name)),
        Kind::BinaryExpression | Kind::PostfixUnaryExpression | Kind::PrefixUnaryExpression
    );
    bound.is_store_target(target) && !is_operand
}
