use crate::bind::Parent;
use crate::check::errors::operator_text;
use crate::check::*;

pub(super) fn is_reached(bound: &Bound<'_>, e: ExprId) -> bool {
    !matches!(bound.parent_of_expr(e), Parent::None)
}

fn is_private_access(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Dot { .. })
        && hir.expr_flags(e).contains(ExprFlags::PRIVATE_NAME)
}

fn logical_operator(hir: &File, e: ExprId) -> Option<BinOp> {
    if let ExprKind::Binary {
        op: op @ (BinOp::Or | BinOp::And),
        ..
    } = hir[e].kind
    {
        Some(op)
    } else {
        None
    }
}

fn is_operand_of_new(hir: &File, import_call: ExprId) -> bool {
    let mut child = hir.node(import_call);
    let mut parent = hir.parent(child);
    while hir.kind(parent).is_access_expression() && hir.expression(parent) == child {
        (child, parent) = (parent, hir.parent(parent));
    }
    hir.kind(parent) == Kind::NewExpression && hir.expression(parent) == child
}

fn comma_expression_name(hir: &File, name: PropKey) -> Option<ExprId> {
    let PropKey::Computed(expression) = name else {
        return None;
    };
    let is_comma_expression = matches!(
        hir[expression].kind,
        ExprKind::Binary {
            op: BinOp::Comma,
            ..
        }
    );
    (is_comma_expression && !is_parenthesized(hir, expression)).then_some(expression)
}

fn may_have_object_literal_early_errors(hir: &File) -> bool {
    let odd_syntax = rare::DEFAULT_IN_OBJECT | rare::ODD_PRIVATE_NAME | rare::ODD_TARGET;
    if hir.rare_syntax & odd_syntax != 0 || !hir.modifiers_of_props.is_empty() {
        return true;
    }
    let mut proto_setters = 0u32;
    for prop in hir.props.iter() {
        if prop.postfix_token != 0 || comma_expression_name(hir, prop.key).is_some() {
            return true;
        }
        proto_setters += u32::from(is_proto_setter(prop));
    }
    proto_setters > 1
}

fn is_in_parameter_decorator(hir: &File, node: Node) -> bool {
    let (mut below, mut above) = (node, hir.parent(node));
    loop {
        let kind = hir.kind(above);
        match kind {
            Kind::Parameter => return matches!(hir.data(below), NodeData::Modifier(_)),
            Kind::SourceFile | Kind::Unknown | Kind::ClassStaticBlockDeclaration => return false,
            _ if kind.is_function_like() => return false,
            _ => (below, above) = (above, hir.parent(above)),
        }
    }
}

impl Checker<'_, '_> {
    pub(in crate::check) fn is_await_refused_at(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        self.is_in_compile_build(file)
            && hir.rare_syntax & rare::SUSPENDS_IN_PARAMETERS != 0
            && is_in_parameter_decorator(hir, node)
    }

    pub(super) fn check_expression_early_errors(&mut self, file: FileId) {
        self.check_target_early_errors(file);
        self.check_arguments_early_errors(file);
        self.check_private_name_early_errors(file);
        self.check_delete_early_errors(file);
        self.check_object_literal_early_errors(file);
        self.check_decorator_early_errors(file);

        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        let reached = |e: &&ExprId| is_reached(bound, **e);
        for &e in index.of(ExprTag::Super).iter().filter(reached) {
            self.check_super_early_errors(file, e);
        }
        for &e in index.of(ExprTag::NewTarget).iter().filter(reached) {
            self.check_new_target_early_errors(file, e);
        }
        for &e in index.of(ExprTag::Binary).iter().filter(reached) {
            if let ExprKind::Binary {
                op: BinOp::Nullish,
                left,
                right,
            } = hir[e].kind
            {
                self.check_mixed_nullish_operators(file, e, left, right);
            }
        }
        for &e in index.of(ExprTag::Await).iter().filter(reached) {
            self.check_grammar_await_expression(file, e);
        }
        for &e in index.of(ExprTag::Yield).iter().filter(reached) {
            self.check_grammar_yield_expression(file, e);
        }
        for &e in index.of(ExprTag::ImportCall).iter().filter(reached) {
            self.check_import_call_early_errors(file, e);
        }
        for &e in index.of(ExprTag::Jsx).iter().filter(reached) {
            if let ExprKind::Jsx(j) = hir[e].kind {
                self.check_jsx_attribute_early_errors(file, j);
            }
        }
    }

    fn check_super_early_errors(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        if let Some(code) = Self::super_early_error_code(hir, hir.node(e)) {
            self.early_error_at(self.span_of_expr(file, e), code, &[]);
        }
    }

    fn check_new_target_early_errors(&mut self, file: FileId, e: ExprId) {
        if self.is_new_target_outside_function(file, e) {
            self.early_error_on_node(file, e, 17013, &[Arg::Bytes(b"new.target")]);
        }
    }

    fn check_arguments_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &node in hir.keyword_identifiers() {
            if hir.text(node) != known::arguments {
                continue;
            }
            let NodeData::Expr(e) = hir.data(node) else {
                continue;
            };
            if matches!(hir[e].kind, ExprKind::Ident(_))
                && is_reached(bound, e)
                && Self::is_in_class_initializer(hir, node)
            {
                self.early_error_at(self.span_of_token(file, hir[e].pos), 2815, &[]);
            }
        }
    }

    fn check_private_name_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.rare_syntax & rare::ODD_PRIVATE_NAME == 0 {
            return;
        }
        let index = self.exprs_by_kind(file);
        let reached = |e: &&ExprId| is_reached(bound, **e);
        for &e in index.of(ExprTag::Dot).iter().filter(reached) {
            let ExprKind::Dot { obj, .. } = hir[e].kind else {
                continue;
            };
            if !hir.expr_flags(e).contains(ExprFlags::PRIVATE_NAME) {
                continue;
            }
            let is_on_super = matches!(hir[obj].kind, ExprKind::Super);
            if !is_on_super && self.is_private_name_declared(file, e) {
                continue;
            }
            let name_pos = hir.name_pos(e);
            let at = self.span_of_token(file, name_pos);
            if is_on_super {
                self.early_grammar_error_at(at, 1034, &[]);
            } else if self.classes_enclosing_private_name(file, e).is_empty() {
                self.early_grammar_error_at(at, 18016, &[]);
            } else {
                let written = self.declaration_name_at(file, name_pos);
                self.early_grammar_error_at(at, 1111, &[Arg::Bytes(&written)]);
            }
        }
        self.check_private_names(file);
        for &e in index.of(ExprTag::PrivateIdentifier).iter().filter(reached) {
            if !self.is_private_name_declared(file, e)
                && !self.enclosing_classes(file, e).is_empty()
            {
                let written = self.declaration_name_at(file, hir[e].pos);
                self.early_grammar_error_at((file, hir[e].pos, 0), 1111, &[Arg::Bytes(&written)]);
            }
        }
    }

    fn is_private_name_declared(&self, file: FileId, e: ExprId) -> bool {
        self.bound(file).runtime.private_class(e).is_some()
    }

    fn check_delete_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.rare_syntax & rare::DELETES_A_NAME == 0 {
            return;
        }
        let index = self.exprs_by_kind(file);
        let reached = |e: &&ExprId| is_reached(bound, **e);
        for &e in index.of(ExprTag::Unary).iter().filter(reached) {
            let ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            } = hir[e].kind
            else {
                continue;
            };
            let target = hir.skip_type_assertions(operand);
            if is_private_access(hir, target) {
                self.early_error_at(self.span_of_expr(file, target), 18011, &[]);
            } else if matches!(hir[target].kind, ExprKind::Ident(_))
                && (target != operand || is_parenthesized(hir, operand))
                && self.is_strict_mode_code(file, hir.node(e))
            {
                self.early_error_at((file, hir[target].pos, 0), 1102, &[]);
            }
        }
    }

    fn check_object_literal_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !may_have_object_literal_early_errors(hir) {
            return;
        }
        let index = self.exprs_by_kind(file);
        let reached = |e: &&ExprId| is_reached(bound, **e);
        for &e in index.of(ExprTag::Object).iter().filter(reached) {
            if let ExprKind::Object(props) = hir[e].kind {
                self.check_grammar_object_literal_expression(file, e, props, false);
            }
        }
    }

    fn check_mixed_nullish_operators(
        &mut self,
        file: FileId,
        e: ExprId,
        left: ExprId,
        right: ExprId,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let operator_of_operand = |operand: ExprId| {
            logical_operator(hir, operand).filter(|_| !is_parenthesized(hir, operand))
        };
        if let Some(operator) = operator_of_operand(left) {
            self.report_mixed_operators(file, left, operator, BinOp::Nullish);
        }
        if let Some(operator) = operator_of_operand(right) {
            self.report_mixed_operators(file, right, BinOp::Nullish, operator);
        }
        if let Parent::Expr(outer) = bound.parent_of_expr(e)
            && !is_parenthesized(hir, e)
            && let Some(operator) = logical_operator(hir, outer)
        {
            self.report_mixed_operators(file, e, BinOp::Nullish, operator);
        }
    }

    fn report_mixed_operators(
        &mut self,
        file: FileId,
        operand: ExprId,
        first: BinOp,
        second: BinOp,
    ) {
        let at = (
            file,
            self.start_of(file, operand),
            self.end_of_expr(file, operand),
        );
        let (first, second) = (operator_text(first, false), operator_text(second, false));
        self.early_grammar_error_at(at, 5076, &[Arg::Bytes(&first), Arg::Bytes(&second)]);
    }

    fn check_import_call_early_errors(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::ImportCall { args } = hir[e].kind else {
            return;
        };
        if is_operand_of_new(hir, e) {
            self.early_grammar_error_at((file, hir[e].pos, 0), 1109, &[]);
        }
        let specifier = hir.id_at(args, 0);
        if args.len() > 2 || matches!(hir[specifier].kind, ExprKind::Missing) {
            self.early_grammar_error_on_node(file, e, 1450, &[]);
            return;
        }
        let is_spread = |argument: &ExprId| matches!(hir[*argument].kind, ExprKind::Spread(_));
        if let Some(spread) = hir.ids(args).find(is_spread) {
            let at = (file, hir[spread].pos, self.end_of_expr(file, spread));
            self.early_grammar_error_at(at, 1325, &[]);
        }
    }

    fn check_jsx_attribute_early_errors(&mut self, file: FileId, j: JsxId) {
        let hir = self.hir(file);
        for attribute in hir[j].attrs.iter().map(|p| &hir[p]) {
            if attribute.kind != PropKind::Spread
                && attribute.value.is_some()
                && matches!(hir[attribute.value].kind, ExprKind::Missing)
            {
                let at = (file, hir[attribute.value].pos, attribute.end);
                self.early_grammar_error_at(at, 17000, &[]);
            }
        }
    }

    fn check_decorator_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.legacy_decorators || hir.has_parse_diagnostics {
            return;
        }
        for &(_, decorator) in hir.decorators.iter() {
            if is_reached(bound, decorator)
                && !is_parenthesized(hir, decorator)
                && let Some(invalid) = self.invalid_syntax_in_decorator(file, decorator)
            {
                let written = self.decorator_position(file, decorator);
                self.early_error_at((file, written.start, written.end), 1497, &[])
                    .add_related_info(Reported::bare((file, invalid.from, invalid.to), 1498));
            }
        }
    }
}
