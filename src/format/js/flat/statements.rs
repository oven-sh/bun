//! Statements, imports and exports.

use super::*;

impl<'a> Line<'_, 'a> {
    pub(super) fn statement(&mut self, statement: Stmt<'a>) -> Written {
        match statement.kind() {
            StmtKind::Expr(expression) => {
                // A directive, or a string in parentheses that would be one without them.
                if expression.tag() == ExprTag::String {
                    return Err(Refused);
                }
                self.last_expr(expression, Place::Other)?;
            }
            StmtKind::Var(declarations) => {
                let (Some(declarator), 1) = (declarations.first(), declarations.len()) else {
                    return Err(Refused);
                };
                self.declaration_modifiers(statement)?;
                self.var_kind(declarator)?;
                self.pattern(declarator.pat())?;
                if declarator.is_definite() {
                    self.byte(b'!')?;
                }
                self.type_annotation(declarator.ty())?;
                if let Some(init) = declarator.init() {
                    self.token(" = ")?;
                    // A pattern breaks together with what it's assigned.
                    match declarator.pat().tag() {
                        PatTag::Ident => self.last_assigned(init)?,
                        _ => self.assigned(init)?,
                    }
                }
            }
            StmtKind::Return(argument) => {
                self.token("return")?;
                if let Some(argument) = argument {
                    self.byte(b' ')?;
                    self.last_expr(argument, Place::Other)?;
                }
            }
            StmtKind::Throw(argument) => {
                self.token("throw ")?;
                self.last_expr(argument, Place::Other)?;
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                self.token(match statement.tag() {
                    StmtTag::Break => "break",
                    _ => "continue",
                })?;
                if let Some(label) = statement.label() {
                    self.byte(b' ')?;
                    self.source(label.span())?;
                }
            }
            StmtKind::Debugger => self.token("debugger")?,
            StmtKind::Fn(func) => {
                self.declaration_modifiers(statement)?;
                self.function(func, true)?;
                if func.has_body() {
                    return Ok(());
                }
            }
            StmtKind::Class(class) => {
                self.declaration_modifiers(statement)?;
                return self.class(class);
            }
            StmtKind::If { .. } => return self.if_statement(statement),
            StmtKind::While { test, body } => {
                self.token("while (")?;
                self.expr(test, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.token(match is_await {
                    true => "for await (",
                    false => "for (",
                })?;
                self.for_binding(left)?;
                self.token(" of ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.token("for (")?;
                self.for_binding(left)?;
                self.token(" in ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.token("try")?;
                self.block(block)?;
                if let Some(handler) = handler {
                    self.token(" catch")?;
                    if let Some(param) = param {
                        self.token(" (")?;
                        self.pattern(param.pat())?;
                        self.type_annotation(param.ty())?;
                        self.byte(b')')?;
                    }
                    self.block(handler)?;
                }
                if let Some(finalizer) = finalizer {
                    self.token(" finally")?;
                    self.block(finalizer)?;
                }
                return Ok(());
            }
            StmtKind::Import(import) => self.import(statement, import)?,
            StmtKind::ExportNamed(export) => self.export_named(statement, export)?,
            StmtKind::ExportDefault(expression) => {
                // A function or a class gets no semicolon.
                if matches!(expression.tag(), ExprTag::Fn | ExprTag::Class) {
                    return Err(Refused);
                }
                self.token("export default ")?;
                self.last_expr(expression, Place::Other)?;
            }
            StmtKind::TypeAlias(alias) => {
                self.declaration_modifiers(statement)?;
                self.token("type ")?;
                self.source(alias.name().span())?;
                self.type_parameters(alias.type_params())?;
                self.token(" = ")?;
                self.ty(alias.ty())?;
            }
            _ => return Err(Refused),
        }
        self.byte(b';')
    }

    pub(super) fn var_kind(&mut self, declarator: VarDecl<'a>) -> Written {
        self.token(match declarator.var_kind() {
            VarKind::Var => "var ",
            VarKind::Let => "let ",
            VarKind::Const => "const ",
            VarKind::Using | VarKind::AwaitUsing => return Err(Refused),
        })
    }

    /// `export default declare abstract `, in this order.
    pub(super) fn declaration_modifiers(&mut self, statement: Stmt<'a>) -> Written {
        let mut rank = 0;
        for modifier in statement.modifiers() {
            let flag = modifier.flag();
            let (next, keyword) = if flag == Flags::EXPORT {
                (1, "export ")
            } else if flag == Flags::DEFAULT {
                (2, "default ")
            } else if flag == Flags::AMBIENT {
                (3, "declare ")
            } else if flag == Flags::ABSTRACT {
                (4, "abstract ")
            } else if flag == Flags::ASYNC {
                // The function writes it.
                (5, "")
            } else {
                return Err(Refused);
            };
            if next <= rank || modifier.decorator().is_some() {
                return Err(Refused);
            }
            rank = next;
            self.token(keyword)?;
        }
        Ok(())
    }

    /// ` {`, and the rest of the block `body`, which has statements in it.
    pub(super) fn block(&mut self, body: Stmt<'a>) -> Written {
        match body.as_block() {
            Some(statements) if !is_empty_block(statements) => {
                self.end_line_with(Part::Block(body), body.span(), 2)
            }
            _ => Err(Refused),
        }
    }

    pub(super) fn if_statement(&mut self, mut statement: Stmt<'a>) -> Written {
        loop {
            let Some((test, yes, no)) = statement.as_if() else {
                return Err(Refused);
            };
            self.token("if (")?;
            self.expr(test, Place::Other)?;
            self.byte(b')')?;
            self.block(yes)?;
            let Some(no) = no else {
                return Ok(());
            };
            self.token(" else")?;
            if no.tag() != StmtTag::If {
                return self.block(no);
            }
            self.byte(b' ')?;
            statement = no;
        }
    }

    /// `const a`, in the head of a loop.
    pub(super) fn for_binding(&mut self, left: Stmt<'a>) -> Written {
        let declarations = left.as_var().ok_or(Refused)?;
        let (Some(declarator), 1) = (declarations.first(), declarations.len()) else {
            return Err(Refused);
        };
        if declarator.init().is_some() || declarator.ty().is_some() {
            return Err(Refused);
        }
        self.var_kind(declarator)?;
        self.pattern(declarator.pat())
    }

    /// `"a"`, where the string isn't an expression.
    pub(super) fn module_specifier(&mut self, statement: Stmt<'a>) -> Written {
        if statement.import_attributes().is_some() {
            return Err(Refused);
        }
        self.string(statement.module_specifier_span().ok_or(Refused)?)
    }

    pub(super) fn open_brace(&mut self) -> Written {
        self.token(match self.f.options().bracket_spacing.value() {
            true => "{ ",
            false => "{",
        })
    }

    pub(super) fn close_brace(&mut self) -> Written {
        self.token(match self.f.options().bracket_spacing.value() {
            true => " }",
            false => "}",
        })
    }

    pub(super) fn module_export_name(&mut self, name: Ident<'a>) -> Written {
        match name.is_string() {
            true => self.string(name.span()),
            false => self.source(name.span()),
        }
    }

    /// `{ a, b }`, or each on a line if that's too wide.
    pub(super) fn specifiers<T>(
        &mut self,
        count: usize,
        items: impl Iterator<Item = T>,
        mut write: impl FnMut(&mut Self, T) -> Written,
    ) -> Written {
        if count == 0 {
            return self.token("{}");
        }
        if self.breaks {
            self.byte(b'{')?;
            let has_last_comma = self.has_trailing_comma(false);
            // Nothing in them can break.
            self.lines(count, items, has_last_comma, |line, item| {
                line.limit = usize::MAX;
                write(line, item)
            })?;
            self.limit = usize::MAX;
            return self.byte(b'}');
        }
        self.open_brace()?;
        self.list(items, write)?;
        self.close_brace()
    }

    pub(super) fn import(&mut self, statement: Stmt<'a>, import: Import<'a>) -> Written {
        if import.phase().is_some() {
            return Err(Refused);
        }
        self.token(match import.is_type_only() {
            true => "import type ",
            false => "import ",
        })?;
        if import.is_side_effect() {
            self.limit = usize::MAX;
            return self.module_specifier(statement);
        }
        let named = import.named();
        let has_braces = import.has_named_imports()
            && !(named.is_empty() && (import.default().is_some() || import.namespace().is_some()));
        let mut is_first = true;
        if let Some(default) = import.default() {
            self.source(default.span())?;
            is_first = false;
        }
        if let Some(namespace) = import.namespace() {
            if !is_first {
                self.token(", ")?;
            }
            self.token("* as ")?;
            self.source(namespace.span())?;
            is_first = false;
        }
        // Without a list of several names there's nowhere to break.
        if !has_braces || named.is_empty() || (named.len() == 1 && is_first) {
            self.limit = usize::MAX;
            self.breaks = false;
        }
        if has_braces {
            if !is_first {
                self.token(", ")?;
            }
            self.specifiers(named.len(), named.iter(), |line, specifier| {
                if specifier.is_type_only() {
                    line.token("type ")?;
                }
                if specifier.is_renamed() {
                    line.module_export_name(specifier.imported())?;
                    line.token(" as ")?;
                }
                line.source(specifier.local().span())
            })?;
        }
        self.token(" from ")?;
        self.module_specifier(statement)
    }

    pub(super) fn export_named(&mut self, statement: Stmt<'a>, export: Export<'a>) -> Written {
        self.token(match export.is_type_only() {
            true => "export type ",
            false => "export ",
        })?;
        let items = export.items();
        if items.len() <= 1 {
            (self.limit, self.breaks) = (usize::MAX, false);
        }
        self.specifiers(items.len(), items.iter(), |line, specifier| {
            if specifier.is_type_only() {
                line.token("type ")?;
            }
            line.module_export_name(specifier.local())?;
            if specifier.is_renamed() {
                line.token(" as ")?;
                line.module_export_name(specifier.exported())?;
            }
            Ok(())
        })?;
        if export.has_from() {
            self.token(" from ")?;
            self.module_specifier(statement)?;
        }
        Ok(())
    }
}
