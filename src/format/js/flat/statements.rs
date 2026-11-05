//! Statements, imports and exports.

use super::holes::Hole;
use super::*;
use crate::js::print::block_statement::is_non_collapsible;

/// Writes the `case a:` of `case`, which starts a line.
pub(crate) fn write_case_head<'a>(case: Case<'a>, f: &mut Formatter<'a>) -> bool {
    let Some(test) = case.test() else {
        return false;
    };
    let mut statements = case.body().iter().filter(|it| it.tag() != StmtTag::Empty);
    let first = statements.next();
    // The `{` of a block that's the only statement is on this line.
    let after = match first {
        Some(first) if first.tag() == StmtTag::Block && statements.next().is_none() => {
            // All of a block with nothing but a comment in it can be on this line, and all of one that's ignored is.
            if first.as_block().is_none_or(|it| it.is_empty())
                || f.comments().is_ignored(first.as_ast_nodes())
            {
                return false;
            }
            2
        }
        _ => 0,
    };
    let end = first.map_or_else(|| case.span().end, |first| first.span().start);
    f.write_line(Span::new(case.span().start, end), (after, after), |line| {
        // Where the expression breaks is another matter.
        if line.breaks {
            return Err(Refused);
        }
        line.token("case ")?;
        line.expr_of_statement(test)?;
        line.byte(b':')
    })
}

impl<'a> Line<'_, 'a> {
    pub(super) fn statement(&mut self, statement: Stmt<'a>) -> Written {
        if self.is_flow {
            self.check_flow_statement(statement)?;
        }
        match statement.kind() {
            StmtKind::Expr(expression) => {
                // A directive, or a string in parentheses that would be one without them.
                if expression.tag() == ExprTag::String {
                    return Err(Refused);
                }
                self.last_expr_of_statement(expression, true)?;
            }
            StmtKind::Var(declarations) => {
                let declarator = declarations.first().ok_or(Refused)?;
                self.declaration_modifiers(statement)?;
                self.var_kind(declarator)?;
                if declarations.len() > 1 {
                    // As the body of a `for` loop they're on one line for oxfmt.
                    if self.f.options().flavor.is_oxfmt()
                        && matches!(statement.parent(), Node::Stmt(parent) if matches!(
                            parent.tag(),
                            StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
                        ))
                    {
                        return Err(Refused);
                    }
                    return self.declarators(declarations);
                }
                self.declared(declarator)?;
                if declarator.is_definite() {
                    self.byte(b'!')?;
                }
                match (declarator.ty(), declarator.init()) {
                    // A pattern that nothing is assigned to has no group of its own, and breaks with its type.
                    (_, None) if declarator.pat().tag() != PatTag::Ident => return Err(Refused),
                    (Some(ty), None) => self.last_type_after(":", ty)?,
                    (ty, Some(init)) => {
                        self.type_annotation(ty)?;
                        self.token(" = ")?;
                        // A pattern breaks together with what it's assigned.
                        match declarator.pat().tag() {
                            PatTag::Ident => self.last_assigned_or_plain(init)?,
                            _ => self.assigned_to_pattern(init)?,
                        }
                    }
                    (None, None) => {}
                }
            }
            StmtKind::Return(argument) => {
                self.token("return")?;
                if let Some(argument) = argument {
                    self.byte(b' ')?;
                    self.last_expr_of_statement(argument, false)?;
                }
            }
            StmtKind::Throw(argument) => {
                self.token("throw ")?;
                self.last_expr_of_statement(argument, false)?;
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
                self.function_declaration(func)?;
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
                self.breaks = false;
                self.token("while (")?;
                self.condition(test, body)?;
                return self.clause(body);
            }
            StmtKind::DoWhile { body, test } => {
                self.breaks = false;
                self.token("do")?;
                self.block(body)?;
                self.token(" while (")?;
                self.expr_of_statement(test)?;
                self.byte(b')')?;
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.breaks = false;
                self.token("for (")?;
                if let Some(init) = init {
                    self.for_init(init)?;
                }
                self.byte(b';')?;
                if init.is_some() || test.is_some() || update.is_some() {
                    self.byte(b' ')?;
                }
                if let Some(test) = test {
                    self.expr_of_statement(test)?;
                }
                self.byte(b';')?;
                if let Some(update) = update {
                    self.byte(b' ')?;
                    self.expr_of_statement(update)?;
                }
                self.byte(b')')?;
                return self.clause(body);
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.breaks = false;
                self.token(match is_await {
                    true => "for await (",
                    false => "for (",
                })?;
                self.for_binding(left)?;
                self.token(" of ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.clause(body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.breaks = false;
                self.token("for (")?;
                self.for_binding(left)?;
                self.token(" in ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.clause(body);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.breaks = false;
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
                self.last_type_after(" =", alias.ty())?;
            }
            StmtKind::Interface(interface) => {
                self.declaration_modifiers(statement)?;
                return self.interface(statement, interface);
            }
            StmtKind::Enum(declaration) => {
                self.declaration_modifiers(statement)?;
                return self.enum_declaration(statement, declaration);
            }
            StmtKind::Module(module) => {
                self.declaration_modifiers(statement)?;
                return self.module(statement, module);
            }
            StmtKind::Switch { expr, cases } => {
                let first = cases.first().ok_or(Refused)?;
                self.token("switch (")?;
                self.expr_of_statement(expr)?;
                self.byte(b')')?;
                let span = Span::new(first.span().start, statement.span().end);
                return self.end_line_with_hole(Hole::BodyOf(statement), span, 2);
            }
            StmtKind::Labeled { body, .. } => {
                self.source(statement.label().ok_or(Refused)?.span())?;
                self.byte(b':')?;
                if body.tag() == StmtTag::Empty {
                    return self.byte(b';');
                }
                self.byte(b' ')?;
                return self.nested(|line| line.statement_in_statement(body));
            }
            StmtKind::ExportStar {
                alias, type_only, ..
            } => {
                if !statement.modifiers().is_empty() {
                    return Err(Refused);
                }
                // There's nowhere to break.
                self.limit = usize::MAX;
                self.token(match type_only {
                    true => "export type *",
                    false => "export *",
                })?;
                if let Some(alias) = alias {
                    self.token(" as ")?;
                    self.module_export_name(alias)?;
                }
                self.token(" from ")?;
                self.module_specifier(statement)?;
            }
            StmtKind::ExportAssign(expression) => {
                if !statement.modifiers().is_empty() {
                    return Err(Refused);
                }
                self.token("export = ")?;
                self.last_expr(expression, Place::Other)?;
            }
            StmtKind::ExportAsNamespace(_) => {
                if !statement.modifiers().is_empty() {
                    return Err(Refused);
                }
                self.token("export as namespace ")?;
                self.source(statement.namespace_export_name().ok_or(Refused)?.span())?;
            }
            StmtKind::ImportEquals(import) => {
                self.declaration_modifiers(statement)?;
                self.limit = usize::MAX;
                self.token(match import.flags().contains(Flags::TYPE_ONLY) {
                    true => "import type ",
                    false => "import ",
                })?;
                self.source(import.name().span())?;
                self.token(" = ")?;
                match import.target() {
                    ImportEqualsTarget::Entity(name) => self.entity_name(name)?,
                    ImportEqualsTarget::Require(_) => {
                        self.token("require(")?;
                        self.string(statement.module_specifier_span().ok_or(Refused)?)?;
                        self.byte(b')')?;
                    }
                }
            }
            _ => return Err(Refused),
        }
        self.semicolon()
    }

    /// `a, b`, or `a = 1,` and the others each on a line, after the keyword. With the `;`.
    fn declarators(&mut self, declarations: List<'a, VarDecl<'a>>) -> Written {
        self.breaks = false;
        let are_on_own_lines = declarations.iter().any(|it| it.init().is_some());
        for (index, declarator) in declarations.iter().enumerate() {
            match (index, are_on_own_lines) {
                (0, _) => {}
                (_, false) => self.token(", ")?,
                (1, true) => {
                    self.byte(b',')?;
                    self.break_line(1)?;
                }
                (_, true) => {
                    self.byte(b',')?;
                    self.break_line(0)?;
                }
            }
            self.declarator(declarator)?;
        }
        if are_on_own_lines {
            self.end_indent();
        }
        self.semicolon()
    }

    /// `a: T = 1`, on one line.
    fn declarator(&mut self, declarator: VarDecl<'a>) -> Written {
        // A pattern that nothing is assigned to has no group of its own, and breaks with the declaration.
        if declarator.init().is_none() && declarator.pat().tag() != PatTag::Ident {
            return Err(Refused);
        }
        self.pattern(declarator.pat())?;
        if declarator.is_definite() {
            self.byte(b'!')?;
        }
        self.type_annotation(declarator.ty())?;
        match declarator.init() {
            Some(init) => {
                self.token(" = ")?;
                self.assigned(init)
            }
            None => Ok(()),
        }
    }

    /// What is before the first `;` in the head of a `for`.
    fn for_init(&mut self, init: Stmt<'a>) -> Written {
        // The operator `in` is in parentheses there, however deep it is.
        let text = self.text_of(init.span());
        let is_part_of_name = |byte: Option<&u8>| {
            byte.is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
        };
        let mut from = 0;
        while let Some(at) = text
            .get(from..)
            .and_then(|rest| strings::index_of(rest, b"in"))
        {
            let at = from + at;
            if !is_part_of_name(at.checked_sub(1).and_then(|before| text.get(before)))
                && !is_part_of_name(text.get(at + 2))
            {
                return Err(Refused);
            }
            from = at + 2;
        }
        match init.kind() {
            StmtKind::Expr(expression) => self.expr(expression, Place::Other),
            StmtKind::Var(declarations) => {
                if !init.modifiers().is_empty() {
                    return Err(Refused);
                }
                self.var_kind(declarations.first().ok_or(Refused)?)?;
                self.list(declarations.iter(), |line, declarator| {
                    line.declarator(declarator)
                })
            }
            _ => Err(Refused),
        }
    }

    /// The condition of an `if` or a `while` and the `)` after it, before `body`.
    fn condition(&mut self, test: Expr<'a>, body: Stmt<'a>) -> Written {
        // What follows on its line.
        let after = match body.as_block() {
            Some(statements) if !is_empty_block(statements) => ") {".len(),
            Some(_) if is_non_collapsible(body.ast_parent(), self.f) => ") {".len(),
            Some(_) => ") {}".len(),
            None => {
                self.expr_of_statement(test)?;
                return self.byte(b')');
            }
        };
        let mark = self.mark();
        let limit = self.limit;
        let was_too_wide = std::mem::replace(&mut self.is_too_wide, false);
        self.limit = limit.saturating_sub(after);
        let written = self.expr_of_statement(test);
        self.limit = limit;
        let is_too_wide = std::mem::replace(&mut self.is_too_wide, was_too_wide);
        if written.is_ok() {
            return self.byte(b')');
        }
        if !is_too_wide || !self.is_certain() || self.is_careful || self.has_parts_since(mark) {
            self.is_too_wide |= is_too_wide;
            return Err(Refused);
        }
        self.go_back_to(mark);
        self.condition_too_wide(test)?;
        self.byte(b')')
    }

    /// The body of another statement, which isn't a block.
    fn statement_in_statement(&mut self, body: Stmt<'a>) -> Written {
        match body.tag() {
            StmtTag::Expr
            | StmtTag::Var
            | StmtTag::Return
            | StmtTag::Throw
            | StmtTag::Break
            | StmtTag::Continue
            | StmtTag::Debugger
            | StmtTag::If
            | StmtTag::For
            | StmtTag::ForIn
            | StmtTag::ForOf
            | StmtTag::While
            | StmtTag::DoWhile
            | StmtTag::Switch
            | StmtTag::Try
            | StmtTag::Labeled => self.statement(body),
            // An error.
            _ => Err(Refused),
        }
    }

    /// The body of an `if`, an `else` or a loop, after the head, which is the last of its line.
    pub(super) fn clause(&mut self, body: Stmt<'a>) -> Written {
        match body.tag() {
            StmtTag::Block => return self.block(body),
            StmtTag::Empty => return self.byte(b';'),
            _ => {}
        }
        // On the line of the head, if it fits there and nothing in it is certain to break.
        let mark = self.mark();
        let was_too_wide = std::mem::replace(&mut self.is_too_wide, false);
        let written =
            (self.byte(b' ')).and_then(|()| self.nested(|line| line.statement_in_statement(body)));
        let is_too_wide = std::mem::replace(&mut self.is_too_wide, was_too_wide);
        if !self.has_parts_since(mark) {
            if written.is_ok() {
                return Ok(());
            }
            // That it's too wide has been found by counting its bytes.
            if !is_too_wide || !self.is_certain() || !self.f.is_plain_source(body.span()) {
                self.is_too_wide |= is_too_wide;
                return Err(Refused);
            }
        } else if written.is_err() {
            // How it's printed isn't known, so neither is whether it breaks.
            return Err(Refused);
        }
        self.go_back_to(mark);
        self.check_source_up_to(body.span().start)?;
        // A comment at its end can be printed before the `else`.
        if self.has_comments_in(body.span()) {
            return Err(Refused);
        }
        self.end_text(Some(0))?;
        self.parts.push(Part::Hole(Hole::Statement(body)));
        self.checked_to = body.span().end;
        self.start_line(0);
        Ok(())
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
        let modifiers = statement.modifiers();
        if modifiers.is_empty() {
            return Ok(());
        }
        let tag = statement.tag();
        let mut rank = 0;
        // Looked for once: the search walks all the modifiers.
        let mut export = None;
        for modifier in modifiers {
            // The decorators of a class are each on a line.
            if let Some(decorator) = modifier.decorator() {
                if rank > 0 || tag != StmtTag::Class {
                    return Err(Refused);
                }
                // One that the `export` follows without a blank is printed after it.
                if (*export.get_or_insert_with(|| statement.export_span()))
                    .is_some_and(|it| it.start <= decorator.span().end)
                {
                    return Err(Refused);
                }
                let breaks = std::mem::replace(&mut self.breaks, false);
                self.decorator(decorator, true)?;
                self.break_line(0)?;
                self.breaks = breaks;
                continue;
            }
            let flag = modifier.flag();
            // One that makes no sense where it is isn't printed.
            let (next, keyword, is_printed) = if flag == Flags::EXPORT {
                (1, "export ", true)
            } else if flag == Flags::DEFAULT {
                let can_be_default =
                    matches!(tag, StmtTag::Fn | StmtTag::Class | StmtTag::Interface);
                (2, "default ", rank == 1 && can_be_default)
            } else if flag == Flags::AMBIENT {
                (3, "declare ", tag != StmtTag::ImportEquals)
            } else if flag == Flags::ABSTRACT {
                (4, "abstract ", tag == StmtTag::Class)
            } else if flag == Flags::ASYNC {
                // The function writes it.
                (5, "", tag == StmtTag::Fn)
            } else if flag == Flags::CONST {
                (6, "const ", tag == StmtTag::Enum)
            } else {
                return Err(Refused);
            };
            if next <= rank || !is_printed {
                return Err(Refused);
            }
            rank = next;
            self.token(keyword)?;
        }
        Ok(())
    }

    /// ` {`, and the rest of the block `body`.
    pub(super) fn block(&mut self, body: Stmt<'a>) -> Written {
        if !is_empty_block(body.as_block().ok_or(Refused)?) {
            return self.end_line_with(Part::Block(body), body.span(), 2);
        }
        self.token(" {")?;
        if is_non_collapsible(body.ast_parent(), self.f) {
            self.break_line(0)?;
        }
        self.byte(b'}')
    }

    pub(super) fn if_statement(&mut self, mut statement: Stmt<'a>) -> Written {
        self.breaks = false;
        loop {
            let Some((test, yes, no)) = statement.as_if() else {
                return Err(Refused);
            };
            self.token("if (")?;
            self.condition(test, yes)?;
            self.clause(yes)?;
            let Some(no) = no else {
                return Ok(());
            };
            match yes.tag() {
                StmtTag::Block => self.token(" else")?,
                _ => {
                    self.break_line(0)?;
                    self.token("else")?;
                }
            }
            if no.tag() != StmtTag::If {
                return self.clause(no);
            }
            self.byte(b' ')?;
            statement = no;
        }
    }

    /// `const a`, in the head of a loop.
    pub(super) fn for_binding(&mut self, left: Stmt<'a>) -> Written {
        if let Some(target) = left.as_expr() {
            return self.expr(target, Place::Other);
        }
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
        // `declare export { a }`
        if !statement.modifiers().is_empty() {
            return Err(Refused);
        }
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
