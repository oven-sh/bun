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
                known::r#await if is_parameter_of_async_arrow_function(hir, node) => 1359,
                known::r#yield if hir.yield_context(node) => {
                    match self.operator_as_name_error_class(file, node, Flags::GENERATOR) {
                        DiagnosticClass::EarlyError => 1359,
                        _ => continue,
                    }
                }
                known::r#yield if is_in_arrow_parameters_in_generator(hir, node) => 1359,
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

/// `async await => 1`
fn is_parameter_of_async_arrow_function(hir: &File<'_>, name: Node) -> bool {
    let parameter = hir.parent(name);
    let function = hir.parent(parameter);
    hir.kind(function) == Kind::ArrowFunction
        && hir.flags(function).contains(Flags::ASYNC)
        && hir.is_parameter_without_parentheses(function, parameter)
}

/// `function* f() { (a = yield) => 1; }`: the language reads the operator there, which no parameter may hold.
fn is_in_arrow_parameters_in_generator(hir: &File<'_>, node: Node) -> bool {
    let (mut below, mut above) = (node, hir.parent(node));
    while above.is_some() && !hir.kind(above).is_function_like() {
        (below, above) = (above, hir.parent(above));
    }
    hir.kind(above) == Kind::ArrowFunction
        && matches!(hir.data(below), NodeData::Param(_))
        && (hir.yield_context(above) || is_in_arrow_parameters_in_generator(hir, above))
}

fn is_class_or_import_name(hir: &File<'_>, name: Node) -> bool {
    let declaration = hir.parent(name);
    if hir.name(declaration) != name {
        return false;
    }
    match hir.data(declaration) {
        NodeData::Expr(e) => matches!(hir[e].kind, ExprKind::Class(_)),
        NodeData::Stmt(s) => match hir[s].kind {
            StmtKind::Class(_) => true,
            StmtKind::Enum(_) => !hir.is_ambient(declaration),
            StmtKind::Module(m) => !hir[m].is_erased && !hir.is_ambient(declaration),
            _ => false,
        },
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
