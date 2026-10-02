//! `checkSourceFile`: the statements of a file from top to bottom, each with all that is in it, then what was put off on the way
//! (`checkDeferredNodes`): the bodies of function expressions and the members of class expressions.
//!
//! A function here has the name of the function of checker.go it is the port of. It visits what that one visits, in that order, and
//! returns where that one returns. So every question is asked for the first time in the place TypeScript asks it, and where the
//! answer depends on what is under way, it is the same answer.

use super::errors_x_statements::is_with_statement;
use super::*;
use crate::bind::{Parent, PatParent};

/// `deferredNodes`
pub(super) enum DeferredNode {
    FunctionExpression(FnId),
    ClassExpression(ClassId),
}

impl Checker<'_> {
    /// `checkSourceFile`
    pub(super) fn check_source_file(&mut self, file: FileId) {
        let uncertain = self.uncertain;
        self.check_source_elements(file, self.hir(file).body);
        self.check_deferred_nodes(file);
        self.reported_unreachable_nodes.clear();
        self.uncertain = uncertain;
        if self.trace_cycles {
            self.report_what_was_not_looked_at(file);
        }
    }

    /// `checkSourceFile(file)` by a checker that shares nothing, as every checker of tsgo's: what is said once, of whoever asks first,
    /// goes by the order in which THAT one asks. `read`: what it noted on the way.
    pub(super) fn check_source_file_alone<R>(
        &self,
        file: FileId,
        read: impl FnOnce(&Checker<'_>) -> R,
    ) -> R {
        // Nobody else can ask about a file that nothing refers to.
        if crate::local::file() == file.0 {
            return read(self);
        }
        let program = Program::new(Arc::clone(&self.p.files));
        let mut checker = program.checker();
        (checker.stack_base, checker.stack_limit) = (self.stack_base, self.stack_limit);
        (checker.deadline, checker.checking) = (self.deadline, Some(file));
        checker.check_source_file(file);
        read(&checker)
    }

    /// `checkSourceElements`
    fn check_source_elements(&mut self, file: FileId, statements: IdList<StmtId>) {
        for s in self.hir(file).ids(statements) {
            self.check_source_element(file, s);
        }
    }

    /// `checkTruthinessExpression`
    fn check_truthiness_expression(&mut self, file: FileId, node: ExprId) {
        if node.is_some() {
            self.check_expression(file, node);
            let ty = self.type_of_expr(file, node);
            self.check_truthiness_of_type(file, node, ty);
        }
    }

    /// `checkDeferredNodes`: what is put off meanwhile goes to the end of the line.
    fn check_deferred_nodes(&mut self, file: FileId) {
        let hir = self.hir(file);
        while let Some(node) = self.deferred_nodes.pop_front() {
            if self.timed_out() {
                break;
            }
            match node {
                // `checkFunctionExpressionOrObjectLiteralMethodDeferred`
                DeferredNode::FunctionExpression(func) => {
                    self.check_getter_returns_a_value(file, func);
                    if hir[func].ret.is_none() {
                        self.return_type_of_fn(file, func);
                    }
                    self.check_all_code_paths_in_non_void_function_return_or_throw(file, func);
                    self.check_function_body(file, func);
                }
                // `checkClassExpressionDeferred`
                DeferredNode::ClassExpression(class) => {
                    self.check_members(file, hir[class].members)
                }
            }
        }
        self.deferred_nodes.clear();
    }

    /// `checkSourceElement(node.Body())`, `checkExpressionCached(node.Body())`
    fn check_function_body(&mut self, file: FileId, func: FnId) {
        match self.hir(file)[func].body {
            FnBody::Block(list) => self.check_source_elements(file, list),
            FnBody::Expr(e) => {
                self.check_expression(file, e);
                self.check_returned_body(file, func, e);
            }
            FnBody::None => {}
        }
    }

    /// `checkDecorators`: those of what cannot be decorated are not looked at.
    fn check_decorators(&mut self, file: FileId, modifiers: Span<ModifierId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for modifier in hir.modifier_list(modifiers) {
            if let ModifierKind::Decorator(e) = modifier.kind
                && !bound.refused_decorators.contains(&e)
            {
                self.check_expression(file, e);
            }
        }
    }

    /// `checkTypeParameters`
    fn check_type_parameters(&mut self, file: FileId, type_params: Span<TypeParamId>) {
        for tp in type_params.iter() {
            self.check_type_parameter(file, tp);
        }
    }

    /// `checkTypeParameter`
    fn check_type_parameter(&mut self, file: FileId, tp: TypeParamId) {
        let decl = &self.hir(file)[tp];
        self.check_type_node(file, decl.constraint);
        self.check_type_node(file, decl.default);
        let ty = self.type_param(file, tp);
        self.base_constraint(ty);
    }

    /// `checkSignatureDeclaration`
    fn check_signature_declaration(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        self.check_type_parameters(file, hir[func].type_params);
        self.check_type_node(file, hir[func].this_ty(hir));
        if hir[func].this_param.is_some() {
            self.type_of_this_parameter(file, func);
        }
        for p in hir[func].params.iter() {
            let param = &hir[p];
            self.check_type_node(file, param.ty);
            self.check_binding_name(file, param.pat);
            self.check_expression(file, param.default);
        }
        self.check_signature_implicitly_any(file, func);
        let ret = hir[func].ret;
        match ret.some().map(|ret| hir[ret].kind) {
            // `checkTypePredicate`
            Some(TypeNodeKind::Predicate { ty, .. }) => self.check_type_node(file, ty),
            _ => self.check_type_node(file, ret),
        }
        self.check_async_function_return_type(file, func);
        self.check_generator_return_annotation(file, func);
        self.check_full_signature(file, func);
    }

    /// `checkFunctionOrMethodDeclaration`: the body is not put off.
    fn check_function_or_method_declaration(&mut self, file: FileId, func: FnId) {
        if func.is_none() {
            return;
        }
        let hir = self.hir(file);
        self.check_signature_declaration(file, func);
        self.check_function_body(file, func);
        self.check_all_code_paths_in_non_void_function_return_or_throw(file, func);
        if hir[func].ret.is_none()
            && hir[func].flags.contains(Flags::GENERATOR)
            && !matches!(hir[func].body, FnBody::None)
        {
            self.return_type_of_fn(file, func);
        }
    }

    /// `checkVariableLikeDeclaration`, as far as `node.Name()` goes: a name, or the elements of a pattern (`checkBindingElement`).
    fn check_binding_name(&mut self, file: FileId, pat: PatId) {
        if pat.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                self.type_of_pat(file, pat);
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    self.check_unused_renamed_binding_element(file, p);
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    self.check_binding_name(file, hir[p].value);
                    self.check_expression(file, hir[p].default);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.check_binding_name(file, hir[e].pat);
                    self.check_expression(file, hir[e].default);
                }
            }
        }
    }

    /// Whether the element `p` of a pattern has a `PropertyName` and a name: `{ a: b }`, not `{ a }`.
    pub(super) fn is_renamed_binding_element(&self, file: FileId, p: PatPropId) -> bool {
        let hir = self.hir(file);
        !hir[p].is_rest
            && matches!(hir[hir[p].value].kind, PatKind::Ident(_))
            && hir[hir[p].value].pos != hir[p].pos
    }

    /// `checkVariableLikeDeclaration`, `checkUnusedRenamedBindingElements`: 2842
    fn check_unused_renamed_binding_element(&mut self, file: FileId, p: PatPropId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration || !self.is_renamed_binding_element(file, p) {
            return;
        }
        // `WalkUpBindingElementsAndPatterns`
        let mut outermost = hir[p].value;
        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
            bound.pat_parent[outermost.idx()]
        {
            outermost = outer;
        }
        let PatParent::Param(param) = bound.pat_parent[outermost.idx()] else {
            return;
        };
        let func = &hir[bound.param_fn[param.idx()]];
        let symbol = bound.pat_symbol[hir[p].value.idx()];
        // `NodeIsMissing(body)`, `referenceKinds == 0`
        if !matches!(func.body, FnBody::None)
            || func.flags.contains(Flags::BODY_DROPPED)
            || symbol.is_none()
            || bound.expr_symbol.contains(&symbol)
        {
            return;
        }
        let start = hir[hir[p].value].pos;
        let (node, name) = match hir[hir[p].value].kind {
            PatKind::Ident(name) if name != known::empty => {
                (self.place_of_token(file, start), Arg::Atom(name))
            }
            _ => ((file, start, start), Arg::Text("(Missing)")),
        };
        let property = self.declaration_name_at(file, hir[p].pos);
        let related = hir[param].ty.is_none().then(|| {
            let end = self.end_of_param(file, param);
            self.new_diagnostic((file, end, end), 2843, &[Arg::Text(&property)])
        });
        let diagnostic = self.error(node, 2842, &[name, Arg::Text(&property)]);
        if let Some(related) = related {
            diagnostic.add_related_info(related);
        }
    }

    /// `checkVariableDeclarationList`
    fn check_variable_declaration_list(&mut self, file: FileId, decls: Span<VarDeclId>) {
        for d in decls.iter() {
            self.check_variable_declaration(file, d);
        }
    }

    /// `checkVariableDeclaration`
    fn check_variable_declaration(&mut self, file: FileId, d: VarDeclId) {
        let decl = &self.hir(file)[d];
        self.check_type_node(file, decl.ty);
        self.check_binding_name(file, decl.pat);
        self.check_expression(file, decl.init);
    }

    /// `checkClassLikeDeclaration`
    fn check_class_like_declaration(&mut self, file: FileId, class: ClassId) {
        let decl = &self.hir(file)[class];
        self.check_type_parameters(file, decl.type_params);
        let symbol = self.bound(file).class_symbol[class.idx()];
        if symbol.is_some() {
            let sym = self.files().sym(file, symbol);
            self.declared_type(sym);
            self.type_of_symbol(sym);
            self.check_type_nodes(file, decl.extends_args);
            self.check_expression(file, decl.extends);
            self.base_types(sym);
            self.report_class_like_declaration(file, class, sym);
        }
        self.check_type_nodes(file, decl.implements);
    }

    /// `checkInterfaceDeclaration`
    fn check_interface_declaration(&mut self, file: FileId, interface: InterfaceId) {
        let decl = &self.hir(file)[interface];
        self.check_type_parameters(file, decl.type_params);
        let symbol = self.bound(file).interface_symbol[interface.idx()];
        if symbol.is_some() {
            let sym = self.files().sym(file, symbol);
            let declared = self.declared_type(sym);
            let bases = self.base_types(sym);
            // `typeWithThis`, and `getTypeWithThisArgument(baseType, t.thisType)`: made before the members are looked at, and
            // `isDeeplyNestedType` goes by the order in which types are made. An interface without type parameters may be thisless,
            // which costs to tell.
            if !decl.type_params.is_empty() {
                let this = self.intern(TypeData::ThisParam(sym));
                self.type_with_this_argument(declared, this);
                for &base in bases.iter() {
                    self.type_with_this_argument(base, this);
                }
            }
        }
        self.check_type_nodes(file, decl.extends);
        self.check_members(file, decl.members);
    }

    /// `checkTypeAliasDeclaration`
    fn check_type_alias_declaration(&mut self, file: FileId, alias: AliasId) {
        let decl = &self.hir(file)[alias];
        // `getTypeFromTypeAliasReference`: a reference to the alias in its own declaration starts with `getDeclaredTypeOfTypeAlias`.
        let symbol = self.bound(file).alias_symbol[alias.idx()];
        if symbol.is_some() {
            self.declared_type(self.files().sym(file, symbol));
        }
        self.check_type_parameters(file, decl.type_params);
        self.check_type_node(file, decl.ty);
    }

    /// `checkSourceElements(node.Members())`, of a class, an interface or a type literal: `checkPropertyDeclaration`,
    /// `checkMethodDeclaration`, `checkConstructorDeclaration`, `checkAccessorDeclaration`, `checkClassStaticBlockDeclaration`,
    /// `checkSignatureDeclaration`.
    fn check_members(&mut self, file: FileId, members: Span<MemberId>) {
        let hir = self.hir(file);
        for m in members.iter() {
            let member = &hir[m];
            self.check_decorators(file, member.modifiers);
            self.check_type_node(file, member.ty);
            if member.func.is_some() {
                self.check_signature_declaration(file, member.func);
                self.check_getter_returns_a_value(file, member.func);
            }
            // `checkComputedPropertyName`
            if let PropKey::Computed(key) = member.key {
                self.check_expression(file, key);
            }
            if member.func.is_some() {
                self.check_function_body(file, member.func);
                self.check_all_code_paths_in_non_void_function_return_or_throw(file, member.func);
            }
            self.check_expression(file, member.init);
        }
    }

    /// `checkSourceElements`, of type nodes.
    fn check_type_nodes(&mut self, file: FileId, nodes: IdList<TypeNodeId>) {
        for node in self.hir(file).ids(nodes) {
            self.check_type_node(file, node);
        }
    }

    /// `checkSourceElement`, of a type node.
    fn check_type_node(&mut self, file: FileId, node: TypeNodeId) {
        if node.is_none() || self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        match hir[node].kind {
            // `checkTypeReferenceNode`
            TypeNodeKind::Ref { args, .. } => {
                self.check_type_nodes(file, args);
                self.type_from_node(file, node);
            }
            // `checkImportType` does not look at the type arguments. `checkThisType`
            TypeNodeKind::Import { .. } | TypeNodeKind::Keyword(Keyword::This) => {
                self.type_from_node(file, node);
            }
            // `checkTypeQuery`: `checkExpressionWithTypeArguments`
            TypeNodeKind::Typeof { args, expr, .. } => {
                self.check_type_nodes(file, args);
                self.check_expression(file, expr);
                self.type_from_node(file, node);
            }
            // `checkTypeLiteral`
            TypeNodeKind::Object(members) => {
                self.check_members(file, members);
                self.type_from_node(file, node);
            }
            // `checkArrayType`, `checkTypeOperator`
            TypeNodeKind::Array(of) | TypeNodeKind::Keyof(of) | TypeNodeKind::Readonly(of) => {
                self.check_type_node(file, of);
            }
            // `checkTupleType`, `checkNamedTupleMember`
            TypeNodeKind::Tuple(elems) => {
                self.check_tuple_type(file, node, elems);
                for elem in elems.iter() {
                    self.check_type_node(file, hir[elem].ty);
                }
                self.type_from_node(file, node);
            }
            // `checkUnionOrIntersectionType`
            TypeNodeKind::Union(parts) | TypeNodeKind::Intersection(parts) => {
                self.check_type_nodes(file, parts);
                self.type_from_node(file, node);
            }
            // `checkSignatureDeclaration`
            TypeNodeKind::Fn(func) => self.check_signature_declaration(file, func),
            // `checkConditionalType`
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.check_type_node(file, check);
                self.check_type_node(file, extends);
                self.check_type_node(file, yes);
                self.check_type_node(file, no);
            }
            // `checkInferType`
            TypeNodeKind::Infer(tp) => self.check_type_parameter(file, tp),
            // `checkTemplateLiteralType`
            TypeNodeKind::Template { types, .. } => {
                for placeholder in hir.ids(types) {
                    self.check_type_node(file, placeholder);
                    self.type_from_node(file, placeholder);
                }
                self.type_from_node(file, node);
            }
            // `checkIndexedAccessType`
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.check_type_node(file, obj);
                self.check_type_node(file, index);
                self.check_indexed_access_type(file, node, obj, index);
            }
            // `checkMappedType`
            TypeNodeKind::Mapped(mapped) => {
                self.check_type_parameter(file, hir[mapped].param);
                self.check_type_node(file, hir[mapped].name_ty);
                self.check_type_node(file, hir[mapped].ty);
                if hir[mapped].ty.is_none() && self.p.files.options.no_implicit_any {
                    let end = self.end_of_type_node(file, node);
                    self.error((file, hir[node].pos, end), 7039, &[]);
                }
                self.type_from_node(file, node);
            }
            // `checkTypePredicate` returns at once where it is not what a function returns. The rest has no `check` function.
            _ => {}
        }
    }

    /// `checkSourceElement`, of a statement.
    fn check_source_element(&mut self, file: FileId, s: StmtId) {
        let within_unreachable_code = self.within_unreachable_code;
        if s.is_some()
            && !within_unreachable_code
            && self.p.files.options.reports_unreachable_code
            && self.check_source_element_unreachable(file, s)
        {
            self.within_unreachable_code = true;
        }
        self.check_source_element_worker(file, s);
        self.within_unreachable_code = within_unreachable_code;
    }

    /// `checkSourceElementWorker`. The head of a `for` and the object of a `with` are kept as statements and are none.
    fn check_source_element_worker(&mut self, file: FileId, s: StmtId) {
        if s.is_none() || self.timed_out() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[s].kind {
            StmtKind::Expr(e) | StmtKind::Throw(e) => self.check_expression(file, e),
            // `checkExportAssignment`: out of place, or in a namespace, it is not looked at.
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                let is_looked_at = match bound.stmt_parent[s.idx()] {
                    Parent::File => true,
                    Parent::Module(m) => !matches!(hir[m].name, ModuleName::Ident(_)),
                    _ => false,
                };
                if is_looked_at {
                    self.check_expression(file, e);
                }
            }
            // `checkReturnStatement`: in no function, or in a static block, what is returned is not looked at. Elsewhere it is asked
            // what the function returns first.
            StmtKind::Return(e) => {
                if let Some(func) = self.enclosing_fn(file, Parent::Stmt(s))
                    && hir[func].kind != FnKind::StaticBlock
                {
                    self.return_type_of_fn(file, func);
                    self.check_expression(file, e);
                    self.check_return_statement(file, s, func, e);
                }
            }
            StmtKind::Var(decls) => self.check_variable_declaration_list(file, decls),
            StmtKind::Fn(func) => self.check_function_or_method_declaration(file, func),
            // `checkClassDeclaration`
            StmtKind::Class(class) => {
                self.check_decorators(file, hir[s].modifiers);
                self.check_class_like_declaration(file, class);
                self.check_members(file, hir[class].members);
            }
            StmtKind::Interface(interface) => self.check_interface_declaration(file, interface),
            StmtKind::TypeAlias(alias) => self.check_type_alias_declaration(file, alias),
            StmtKind::If { test, yes, no } => {
                self.check_truthiness_expression(file, test);
                self.check_source_element(file, yes);
                self.check_source_element(file, no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.check_source_element_worker(file, init);
                self.check_truthiness_expression(file, test);
                self.check_expression(file, update);
                self.check_source_element(file, body);
            }
            // `checkForInStatement`: the object first.
            StmtKind::ForIn { left, expr, body } => {
                self.check_expression(file, expr);
                self.check_source_element_worker(file, left);
                self.check_source_element(file, body);
            }
            // `checkForOfStatement`: what is iterated is looked at for the variable (`checkRightHandSideOfForOf`), so not at all
            // where none is declared, and before what is written in the place of a declaration.
            StmtKind::ForOf {
                left, expr, body, ..
            } => {
                match hir[left].kind {
                    StmtKind::Var(decls) if decls.is_empty() => {}
                    StmtKind::Var(_) => {
                        self.check_source_element_worker(file, left);
                        self.check_expression(file, expr);
                    }
                    _ => {
                        self.check_expression(file, expr);
                        self.check_source_element_worker(file, left);
                    }
                }
                self.check_source_element(file, body);
            }
            StmtKind::While { test, body } => {
                self.check_truthiness_expression(file, test);
                self.check_source_element(file, body);
            }
            StmtKind::DoWhile { body, test } => {
                self.check_source_element(file, body);
                self.check_truthiness_expression(file, test);
            }
            // `checkWithStatement`: the object, and not the body.
            StmtKind::Block(list) if is_with_statement(hir, s) => {
                self.check_source_element_worker(file, hir.id_at(list, 0));
            }
            StmtKind::Block(list) => self.check_source_elements(file, list),
            StmtKind::Switch { expr, cases } => {
                self.check_expression(file, expr);
                for c in cases.iter() {
                    if hir[c].test.is_some() {
                        self.check_expression(file, hir[c].test);
                        self.check_case_clause(file, expr, hir[c].test);
                    }
                    self.check_source_elements(file, hir[c].body);
                    let fallthrough = bound.case_fallthrough[c.idx()];
                    if self.p.files.options.no_fallthrough_cases_in_switch
                        && fallthrough.is_some()
                        && self.is_reachable(file, fallthrough)
                    {
                        let (start, end) = self.error_range_of_case(file, c);
                        self.error((file, start, end), 7029, &[]);
                    }
                }
            }
            // `checkTryStatement`, `checkCatchClause`
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.check_source_element(file, block);
                if param.is_some() {
                    self.check_variable_declaration(file, param);
                }
                self.check_source_element(file, handler);
                self.check_source_element(file, finalizer);
            }
            StmtKind::Labeled { body, .. } => {
                if self.p.files.options.reports_unused_labels && bound.unused_labels.contains(&s) {
                    self.error(self.place_of_token(file, hir[s].pos), 7028, &[]);
                }
                self.check_source_element(file, body);
            }
            StmtKind::Module(module) => self.check_source_elements(file, hir[module].body),
            StmtKind::Enum(e) => {
                for m in hir[e].members.iter() {
                    self.check_expression(file, hir[m].init);
                }
                // `computeEnumMemberValues`
                for m in hir[e].members.iter() {
                    self.get_enum_member_value(file, m);
                }
            }
            _ => {}
        }
    }

    /// With `BUN_SEMA_TRACE_CYCLES`: the expressions `checkSourceFile` comes to that have not been looked at.
    fn report_what_was_not_looked_at(&self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, e) in hir.exprs.iter().enumerate() {
            let id = ExprId(i as u32);
            if !bound.is_unchecked(i)
                && !matches!(e.kind, ExprKind::Missing)
                && self.kept_type_of_expr(file, id).is_none()
                && !self.looked_at.contains(&(file, id))
            {
                let path = &self.files().module(file).path;
                eprintln!("GAP {:?} {path}:{}", e.kind.tag(), e.pos);
            }
        }
    }

    /// `checkExpression`: `e`, then whatever in it that did not need looking at.
    fn check_expression(&mut self, file: FileId, e: ExprId) {
        if e.is_none() || self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        self.type_of_expr(file, e);
        match hir[e].kind {
            ExprKind::Template { exprs, .. } | ExprKind::Array(exprs) => {
                for x in hir.ids(exprs) {
                    self.check_expression(file, x);
                }
            }
            // `resolveCall`: the type arguments of `super<T>()` are those of the `extends` clause.
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                let callee = hir[c].callee;
                self.check_expression(file, callee);
                if callee.is_none() || !matches!(hir[callee].kind, ExprKind::Super) {
                    self.check_type_nodes(file, hir[c].type_args);
                }
                for x in hir.ids(hir[c].args) {
                    self.check_expression(file, x);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    self.check_expression(file, hir[p].value);
                }
            }
            // `checkFunctionExpressionOrObjectLiteralMethod`: the signature now, and what it returns if something is expected of it.
            ExprKind::Fn(func) => {
                self.check_signature_declaration(file, func);
                if hir[func].ret.is_none() && self.contextual_signature(file, func).is_some() {
                    self.return_type_of_fn(file, func);
                }
                self.deferred_nodes
                    .push_back(DeferredNode::FunctionExpression(func));
            }
            // `checkClassExpression`
            ExprKind::Class(class) => {
                self.check_class_like_declaration(file, class);
                self.deferred_nodes
                    .push_back(DeferredNode::ClassExpression(class));
            }
            // `checkYieldExpression`: outside a generator what is yielded is not looked at.
            ExprKind::Yield { value, .. } => {
                if self.containing_generator(file, e).is_some() {
                    self.check_expression(file, value);
                }
            }
            ExprKind::Dot { obj: x, .. }
            | ExprKind::Unary { operand: x, .. }
            | ExprKind::Spread(x)
            | ExprKind::Await(x)
            | ExprKind::AsConst(x)
            | ExprKind::NonNull(x) => self.check_expression(file, x),
            // `checkImportCallExpression`
            ExprKind::ImportCall { args, .. } => {
                for x in hir.ids(args) {
                    self.check_expression(file, x);
                }
            }
            // `checkAssertion`
            ExprKind::As { expr, ty } => {
                self.check_expression(file, expr);
                self.check_type_node(file, ty);
            }
            // `checkSatisfiesExpression`
            ExprKind::Satisfies { expr, ty } => {
                self.check_type_node(file, ty);
                self.check_expression(file, expr);
            }
            // `checkExpressionWithTypeArguments`
            ExprKind::Instantiation { expr, type_args } => {
                self.check_type_nodes(file, type_args);
                self.check_expression(file, expr);
            }
            ExprKind::Index {
                obj: a, index: b, ..
            }
            | ExprKind::Binary {
                left: a, right: b, ..
            }
            | ExprKind::Assign {
                target: a,
                value: b,
                ..
            } => {
                self.check_expression(file, a);
                self.check_expression(file, b);
            }
            ExprKind::Cond { test, yes, no } => {
                self.check_expression(file, test);
                self.check_expression(file, yes);
                self.check_expression(file, no);
            }
            // `checkJsxElementDeferred`
            ExprKind::Jsx(jsx) => {
                let component = |c: &Self, tag: ExprId| match tag.some() {
                    Some(tag) if c.jsx_intrinsic_tag_name(file, tag).is_none() => tag,
                    _ => ExprId::NONE,
                };
                self.check_expression(file, component(self, hir[jsx].tag));
                self.check_type_nodes(file, hir[jsx].type_args);
                for p in hir[jsx].attrs.iter() {
                    self.check_expression(file, hir[p].value);
                }
                self.check_expression(file, component(self, hir[jsx].close_tag));
                for x in hir.ids(hir[jsx].children) {
                    self.check_expression(file, x);
                }
            }
            _ => {}
        }
    }
}
