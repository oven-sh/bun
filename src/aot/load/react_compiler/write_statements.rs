use super::writer::{TreeWriter, UnsupportedNode, Written};
use bun_ast::binding::Data as BindingData;
use bun_ast::{Expr, G, Loc, LocRef, S, Stmt, StmtData};
use bun_lint_react_compiler::code_generation::SymbolOrigin;
use bun_sema::atom::Atom;
use bun_sema::hir::{
    self, ExprId, ExprKind, Flags, FnKind, IdList, StmtId, StmtKind, TextRange, TypeNodeId,
    VarDecl, VarDeclId, VarKind, rare,
};

#[derive(Copy, Clone)]
enum TypeAnnotation {
    Allowed,
    Forbidden,
}

impl TreeWriter<'_, '_> {
    pub(super) fn write_statement_list(&mut self, statements: &[Stmt]) -> Written<IdList<StmtId>> {
        // The compiler declares its cache before the directives of the function.
        let is_directive = |statement: &&Stmt| matches!(statement.data, StmtData::SDirective(_));
        let directives = statements.iter().filter(is_directive);
        let others = statements
            .iter()
            .filter(|statement| !is_directive(statement));
        let mut ids = Vec::with_capacity(statements.len());
        for statement in directives.chain(others) {
            ids.push(self.write_statement(statement)?);
        }
        Ok(self.file.list(&ids))
    }

    pub(super) fn write_statement(&mut self, statement: &Stmt) -> Written<StmtId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(UnsupportedNode("nesting"));
        }
        let loc = statement.loc;
        let kind = match &statement.data {
            StmtData::SEmpty(_) => StmtKind::Empty,
            StmtData::SDebugger(_) => StmtKind::Debugger,
            StmtData::SDirective(directive) => {
                let raw = self.atoms.intern(directive.value.slice());
                let (start, end) = self.range_of(loc);
                let expr = self.file.expr(ExprKind::String(raw), start, end);
                StmtKind::Directive { expr, raw }
            }
            StmtData::SExpr(expression) => {
                StmtKind::Expr(self.write_expression(&expression.value)?)
            }
            StmtData::SLocal(local) => {
                return self.write_local(local, loc, TypeAnnotation::Allowed);
            }
            StmtData::SReturn(returned) => {
                StmtKind::Return(self.write_expression_or_none(returned.value.as_ref())?)
            }
            StmtData::SThrow(thrown) => StmtKind::Throw(self.write_expression(&thrown.value)?),
            StmtData::SIf(if_statement) => {
                let test = self.write_expression(&if_statement.test)?;
                let yes = self.write_block_or_statement(&if_statement.yes)?;
                let no = match &if_statement.no {
                    Some(no) => self.write_block_or_statement(no)?,
                    None => StmtId::NONE,
                };
                StmtKind::If { test, yes, no }
            }
            StmtData::SBlock(block) => {
                StmtKind::Block(self.write_statement_list(block.stmts.slice())?)
            }
            StmtData::SFor(for_loop) => {
                let init = match &for_loop.init {
                    Some(head) => self.write_for_head(head, TypeAnnotation::Allowed)?,
                    None => StmtId::NONE,
                };
                let test = self.write_expression_or_none(for_loop.test.as_ref())?;
                let update = self.write_expression_or_none(for_loop.update.as_ref())?;
                let body = self.write_block_or_statement(&for_loop.body)?;
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                }
            }
            StmtData::SForIn(for_loop) => {
                let left = self.write_for_head(&for_loop.init, TypeAnnotation::Forbidden)?;
                let expr = self.write_expression(&for_loop.value)?;
                let body = self.write_block_or_statement(&for_loop.body)?;
                StmtKind::ForIn { left, expr, body }
            }
            StmtData::SForOf(for_loop) => {
                let is_await = for_loop.is_await;
                if is_await {
                    self.file.rare_syntax |= rare::FOR_AWAIT;
                }
                let left = self.write_for_head(&for_loop.init, TypeAnnotation::Forbidden)?;
                let expr = self.write_expression(&for_loop.value)?;
                let body = self.write_block_or_statement(&for_loop.body)?;
                StmtKind::ForOf {
                    left,
                    expr,
                    body,
                    is_await,
                }
            }
            StmtData::SWhile(while_loop) => {
                let test = self.write_expression(&while_loop.test)?;
                let body = self.write_block_or_statement(&while_loop.body)?;
                StmtKind::While { test, body }
            }
            StmtData::SDoWhile(while_loop) => {
                let body = self.write_block_or_statement(&while_loop.body)?;
                let test = self.write_expression(&while_loop.test)?;
                StmtKind::DoWhile { body, test }
            }
            StmtData::SSwitch(switch) => {
                let expr = self.write_expression(&switch.test)?;
                let mut cases = Vec::with_capacity(switch.cases.len());
                for case in switch.cases.slice() {
                    let test = self.write_expression_or_none(case.value.as_ref())?;
                    let body = self.write_statement_list(case.body.slice())?;
                    let (pos, end) = self.range_of(case.loc);
                    cases.push(hir::Case {
                        test,
                        body,
                        pos,
                        end,
                    });
                }
                let cases = self.file.add_cases(&cases);
                StmtKind::Switch { expr, cases }
            }
            StmtData::STry(try_statement) => self.write_try(try_statement)?,
            StmtData::SLabel(labeled) => {
                let body = self.write_block_or_statement(&labeled.stmt)?;
                let label = self.resolve_label(labeled.name);
                StmtKind::Labeled { label, body }
            }
            StmtData::SBreak(jump) => StmtKind::Break(self.resolve_optional_label(jump.label)),
            StmtData::SContinue(jump) => {
                StmtKind::Continue(self.resolve_optional_label(jump.label))
            }
            StmtData::SFunction(function) => {
                return self.write_function_declaration(&function.func, loc);
            }
            _ => {
                return Err(UnsupportedNode::statement(statement.data.tag()));
            }
        };
        Ok(self.add_statement(kind, loc))
    }

    pub(super) fn write_function_declaration(
        &mut self,
        function: &G::Fn,
        loc: Loc,
    ) -> Written<StmtId> {
        let id = self.write_function_expression(function, FnKind::Decl, loc)?;
        Ok(self.add_statement(StmtKind::Fn(id), loc))
    }

    fn add_statement(&mut self, kind: StmtKind, loc: Loc) -> StmtId {
        let (start, end) = self.range_of(loc);
        self.file.add_stmt_node(hir::Stmt {
            kind,
            start,
            loc: TextRange { pos: start, end },
        })
    }

    pub(super) fn write_expression_or_none(
        &mut self,
        expression: Option<&Expr>,
    ) -> Written<ExprId> {
        match expression {
            Some(expression) => self.write_expression(expression),
            None => Ok(ExprId::NONE),
        }
    }

    fn write_local(
        &mut self,
        local: &S::Local,
        loc: Loc,
        annotation: TypeAnnotation,
    ) -> Written<StmtId> {
        let kind = match local.kind {
            S::Kind::KVar => VarKind::Var,
            S::Kind::KLet => VarKind::Let,
            S::Kind::KConst => VarKind::Const,
            S::Kind::KUsing | S::Kind::KAwaitUsing => return Err(UnsupportedNode("using")),
        };
        let mut declarations = Vec::with_capacity(local.decls.len());
        for declaration in local.decls.iter() {
            let pat = self.write_binding(&declaration.binding)?;
            let init = self.write_expression_or_none(declaration.value.as_ref())?;
            let (pos, binding_end) = self.range_of(declaration.binding.loc);
            let ty = match annotation {
                TypeAnnotation::Allowed if self.needs_any_annotation(declaration) => {
                    self.any_type(binding_end)
                }
                TypeAnnotation::Allowed | TypeAnnotation::Forbidden => TypeNodeId::NONE,
            };
            declarations.push(VarDecl {
                pat,
                ty,
                init,
                kind,
                flags: Flags::empty(),
                // TypeScript rejects a `,` in the text after the last declaration. No node starts with one.
                loc: TextRange { pos, end: pos },
            });
        }
        let declarations = self.file.add_var_decls(&declarations);
        Ok(self.add_statement(StmtKind::Var(declarations), loc))
    }

    fn needs_any_annotation(&self, declaration: &G::Decl) -> bool {
        let declares_local = match declaration.binding.data {
            BindingData::BIdentifier(identifier) => {
                self.origin_of(identifier.r#ref) == SymbolOrigin::Local
            }
            BindingData::BArray(_) | BindingData::BObject(_) | BindingData::BMissing(_) => false,
        };
        !self.file.is_js && declaration.value.is_none() && declares_local
    }

    fn write_block_or_statement(&mut self, statement: &Stmt) -> Written<StmtId> {
        if matches!(statement.data, StmtData::SLocal(_) | StmtData::SFunction(_)) {
            self.file.rare_syntax |= rare::DECLARATION_AS_BODY;
        }
        self.write_statement(statement)
    }

    fn write_block_statement(&mut self, statements: &[Stmt], loc: Loc) -> Written<StmtId> {
        let list = self.write_statement_list(statements)?;
        Ok(self.add_statement(StmtKind::Block(list), loc))
    }

    fn write_for_head(&mut self, head: &Stmt, annotation: TypeAnnotation) -> Written<StmtId> {
        if let StmtData::SLocal(local) = &head.data {
            return self.write_local(local, head.loc, annotation);
        }
        let StmtData::SExpr(expression) = &head.data else {
            return Err(UnsupportedNode::statement(head.data.tag()));
        };
        let expression = self.write_expression(&expression.value)?;
        Ok(self.add_statement(StmtKind::Expr(expression), head.loc))
    }

    fn write_try(&mut self, try_statement: &S::Try) -> Written<StmtKind> {
        let body = try_statement.body.slice();
        let block = self.write_block_statement(body, try_statement.body_loc)?;
        let (param, handler) = match &try_statement.catch {
            Some(catch) => {
                let param = match &catch.binding {
                    Some(binding) => {
                        let pat = self.write_binding(binding)?;
                        let (pos, end) = self.range_of(binding.loc);
                        self.file.add_var_decl(VarDecl {
                            pat,
                            ty: TypeNodeId::NONE,
                            init: ExprId::NONE,
                            kind: VarKind::Let,
                            flags: Flags::empty(),
                            loc: TextRange { pos, end },
                        })
                    }
                    None => VarDeclId::NONE,
                };
                (
                    param,
                    self.write_block_statement(catch.body.slice(), catch.body_loc)?,
                )
            }
            None => (VarDeclId::NONE, StmtId::NONE),
        };
        let finalizer = match &try_statement.finally {
            Some(finally) => self.write_block_statement(finally.stmts.slice(), finally.loc)?,
            None => StmtId::NONE,
        };
        Ok(StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        })
    }

    fn resolve_label(&mut self, label: LocRef) -> Atom {
        self.file.rare_syntax |= rare::ODD_JUMP;
        self.name_of(label.ref_)
    }

    fn resolve_optional_label(&mut self, label: Option<LocRef>) -> Atom {
        label.map_or(Atom::NONE, |label| self.resolve_label(label))
    }
}
