//! Statements, imports and exports.

use super::{Converter, Extras};
use crate::ast::{
    Case, ExportSpec, ExprKind, Flags, ImportAttributes, ImportEqualsTarget, ImportSpec, List,
    Module, ModuleName, Prop, Stmt, StmtKind, VarDecl, VarKind,
};
use crate::estree::NodeType::*;
use crate::estree::Sink;
use crate::span::Span;

impl<'a, S: Sink> Converter<'a, '_, S> {
    pub(super) fn program(&mut self) {
        self.open(Program, self.file.program_span());
        self.statements("body", self.file.body(), true);
        let is_module = self.file.has_module_syntax() || self.has_import_meta;
        self.text("sourceType", if is_module { b"module" } else { b"script" });
        self.close();
    }

    /// The field `name` with `statements`. `has_directives`: the strings that come first are
    /// directives.
    pub(super) fn statements(
        &mut self,
        name: &'static str,
        statements: List<'a, Stmt<'a>>,
        has_directives: bool,
    ) {
        let mut is_prologue = has_directives;
        self.list(name, statements, |this, statement| {
            is_prologue = is_prologue
                && matches!(statement.kind(), StmtKind::Expr(e)
                    if matches!(e.kind(), ExprKind::String(_)) && !e.is_parenthesized());
            this.stmt_or_directive(statement, is_prologue);
        });
    }

    pub(super) fn block(&mut self, span: Span, statements: List<'a, Stmt<'a>>, has_directives: bool) {
        self.open(BlockStatement, span);
        self.statements("body", statements, has_directives);
        self.close();
    }

    #[inline]
    pub(super) fn stmt(&mut self, statement: Stmt<'a>) {
        self.stmt_or_directive(statement, false);
    }

    fn opt_stmt(&mut self, statement: Option<Stmt<'a>>) {
        match statement {
            Some(statement) => self.stmt(statement),
            None => self.out.null(),
        }
    }

    /// `export` and `export default` before the declaration `statement`: whether there is a
    /// `default`.
    fn export_of(statement: Stmt<'a>) -> Option<bool> {
        let mut keywords = statement.modifiers().iter().map(|it| it.flag()).filter(|it| !it.is_empty());
        (keywords.next()? == Flags::EXPORT).then(|| keywords.next() == Some(Flags::DEFAULT))
    }

    fn stmt_or_directive(&mut self, statement: Stmt<'a>, is_directive: bool) {
        if !self.can_descend() {
            return;
        }
        let kind = statement.kind();
        let is_declaration = matches!(
            kind,
            StmtKind::Fn(_)
                | StmtKind::Var(_)
                | StmtKind::Class(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Interface(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::ImportEquals(_)
        );
        let export = if is_declaration { Self::export_of(statement) } else { None };
        let Some(is_default) = export else {
            return self.unexported(statement, kind, statement.span(), is_directive);
        };
        let whole = statement.export_span().unwrap_or_else(|| statement.span());
        let inner = statement.span_without_export();
        if is_default {
            self.open(ExportDefaultDeclaration, whole);
            self.field("declaration");
            self.unexported(statement, kind, inner, false);
            self.text("exportKind", b"value");
            return self.close();
        }
        self.open(ExportNamedDeclaration, whole);
        self.empty("attributes");
        self.field("declaration");
        self.unexported(statement, kind, inner, false);
        let is_type = match kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) => true,
            StmtKind::ImportEquals(_) => false,
            _ => statement.flags().contains(Flags::AMBIENT),
        };
        self.text("exportKind", if is_type { b"type" } else { b"value" });
        self.null("source");
        self.empty("specifiers");
        self.close();
    }

    /// `statement` at `span`, which leaves out an `export`.
    fn unexported(&mut self, statement: Stmt<'a>, kind: StmtKind<'a>, span: Span, is_directive: bool) {
        let is_declared = || statement.flags().contains(Flags::AMBIENT);
        match kind {
            StmtKind::Empty => self.leaf(EmptyStatement, span),
            StmtKind::Debugger => self.leaf(DebuggerStatement, span),
            StmtKind::Expr(e) => {
                self.open(ExpressionStatement, span);
                if is_directive {
                    self.text("directive", self.file.slice(e.span().shrink(1, 1)));
                }
                self.field("expression");
                self.expr(e);
                self.close();
            }
            StmtKind::Var(declarations) => self.variable_declaration(span, declarations, is_declared()),
            StmtKind::Fn(func) => self.function_declaration(span, func, is_declared()),
            StmtKind::Class(class) => self.class(ClassDeclaration, span, class),
            StmtKind::Interface(interface) => self.interface(span, interface, is_declared()),
            StmtKind::TypeAlias(alias) => {
                self.open(TSTypeAliasDeclaration, span);
                self.flag("declare", is_declared());
                self.field("id");
                self.ident(alias.name());
                self.field("typeAnnotation");
                self.ty(alias.ty());
                self.type_parameters(alias.type_params());
                self.close();
            }
            StmtKind::Enum(it) => self.enumeration(span, it, is_declared()),
            StmtKind::Module(module) => self.module(span, module, is_declared()),
            StmtKind::Return(argument) => {
                self.open(ReturnStatement, span);
                self.field("argument");
                self.opt_expr(argument);
                self.close();
            }
            StmtKind::If { test, yes, no } => {
                self.open(IfStatement, span);
                self.field("test");
                self.expr(test);
                self.field("consequent");
                self.stmt(yes);
                self.field("alternate");
                self.opt_stmt(no);
                self.close();
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.open(ForStatement, span);
                self.field("init");
                match init {
                    Some(init) => self.for_head(init, false),
                    None => self.out.null(),
                }
                self.field("test");
                self.opt_expr(test);
                self.field("update");
                self.opt_expr(update);
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::ForIn { left, expr, body } => {
                self.open(ForInStatement, span);
                self.field("left");
                self.for_head(left, true);
                self.field("right");
                self.expr(expr);
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.open(ForOfStatement, span);
                self.flag("await", is_await);
                self.field("left");
                self.for_head(left, true);
                self.field("right");
                self.expr(expr);
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::While { test, body } => {
                self.open(WhileStatement, span);
                self.field("test");
                self.expr(test);
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::DoWhile { body, test } => {
                self.open(DoWhileStatement, span);
                self.field("body");
                self.stmt(body);
                self.field("test");
                self.expr(test);
                self.close();
            }
            StmtKind::Block(statements) => self.block(span, statements, false),
            StmtKind::With { object, body } => {
                self.open(WithStatement, span);
                self.field("object");
                self.expr(object);
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::Switch { expr, cases } => {
                self.open(SwitchStatement, span);
                self.field("discriminant");
                self.expr(expr);
                self.list("cases", cases, Self::case);
                self.close();
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.open(TryStatement, span);
                self.field("block");
                self.stmt(block);
                self.field("handler");
                match (handler, statement.catch_clause_span()) {
                    (Some(handler), Some(clause)) => {
                        self.open(CatchClause, clause);
                        self.field("param");
                        match param {
                            Some(param) => self.declared(param),
                            None => self.out.null(),
                        }
                        self.field("body");
                        self.stmt(handler);
                        self.close();
                    }
                    _ => self.out.null(),
                }
                self.field("finalizer");
                self.opt_stmt(finalizer);
                self.close();
            }
            StmtKind::Throw(argument) => {
                self.open(ThrowStatement, span);
                self.field("argument");
                self.expr(argument);
                self.close();
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                let is_break = matches!(kind, StmtKind::Break(_));
                self.open(if is_break { BreakStatement } else { ContinueStatement }, span);
                self.field("label");
                match statement.label() {
                    Some(label) => self.ident(label),
                    None => self.out.null(),
                }
                self.close();
            }
            StmtKind::Labeled { body, .. } => {
                self.open(LabeledStatement, span);
                self.field("label");
                match statement.label() {
                    Some(label) => self.ident(label),
                    None => self.out.null(),
                }
                self.field("body");
                self.stmt(body);
                self.close();
            }
            StmtKind::Import(import) => {
                self.open(ImportDeclaration, span);
                self.attributes(import.attributes());
                self.text("importKind", if import.is_type_only() { b"type" } else { b"value" });
                self.field("phase");
                match import.is_deferred() {
                    true => self.out.string(b"defer"),
                    false => self.out.null(),
                }
                self.source(statement, Some(import.spec().bytes()));
                self.field("specifiers");
                self.out.start_list();
                if let Some(local) = import.default() {
                    self.open(ImportDefaultSpecifier, local.span());
                    self.field("local");
                    self.ident(local);
                    self.close();
                }
                if let (Some(local), Some(span)) = (import.namespace(), import.namespace_span()) {
                    self.open(ImportNamespaceSpecifier, span);
                    self.field("local");
                    self.ident(local);
                    self.close();
                }
                for specifier in import.named() {
                    self.import_specifier(specifier);
                }
                self.out.end_list();
                self.close();
            }
            StmtKind::ImportEquals(import) => {
                self.open(TSImportEqualsDeclaration, span);
                self.field("id");
                self.ident(import.name());
                let is_type = import.flags().contains(Flags::TYPE_ONLY);
                self.text("importKind", if is_type { b"type" } else { b"value" });
                self.field("moduleReference");
                match import.target() {
                    ImportEqualsTarget::Entity(name) => self.entity_name(name, TSQualifiedName),
                    ImportEqualsTarget::Require(spec) => match import.require_span() {
                        Some(require) => {
                            self.open(TSExternalModuleReference, require);
                            self.source_as("expression", statement, spec.map(|it| it.bytes()));
                            self.close();
                        }
                        None => self.out.null(),
                    },
                }
                self.close();
            }
            StmtKind::ExportNamed(export) => {
                self.open(ExportNamedDeclaration, span);
                self.attributes(export.attributes());
                self.null("declaration");
                self.text("exportKind", if export.is_type_only() { b"type" } else { b"value" });
                self.source(statement, export.spec().map(|it| it.bytes()));
                self.list("specifiers", export.items(), Self::export_specifier);
                self.close();
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
            } => {
                self.open(ExportAllDeclaration, span);
                self.attributes(statement.import_attributes());
                self.field("exported");
                match alias {
                    Some(alias) => self.module_export_name(alias),
                    None => self.out.null(),
                }
                self.text("exportKind", if type_only { b"type" } else { b"value" });
                self.source(statement, spec.map(|it| it.bytes()));
                self.close();
            }
            StmtKind::ExportDefault(e) => {
                self.open(ExportDefaultDeclaration, span);
                self.field("declaration");
                self.expr(e);
                self.text("exportKind", b"value");
                self.close();
            }
            StmtKind::ExportAssign(e) => {
                self.open(TSExportAssignment, span);
                self.field("expression");
                self.expr(e);
                self.close();
            }
            StmtKind::ExportAsNamespace(_) => {
                self.open(TSNamespaceExportDeclaration, span);
                self.field("id");
                match statement.namespace_export_name() {
                    Some(name) => self.ident(name),
                    None => self.out.null(),
                }
                self.close();
            }
        }
    }

    /// What is in the head of a `for`. `is_target`: it is assigned to.
    fn for_head(&mut self, head: Stmt<'a>, is_target: bool) {
        match head.kind() {
            StmtKind::Expr(e) if is_target => self.target(e),
            StmtKind::Expr(e) => self.expr(e),
            StmtKind::Var(declarations) => self.variable_declaration(head.span(), declarations, false),
            _ => self.out.null(),
        }
    }

    fn variable_declaration(&mut self, span: Span, declarations: List<'a, VarDecl<'a>>, is_declared: bool) {
        self.open(VariableDeclaration, span);
        self.list("declarations", declarations, |this, declaration| {
            this.open(VariableDeclarator, declaration.span());
            this.flag("definite", declaration.is_definite());
            this.field("id");
            this.declared(declaration);
            this.field("init");
            this.opt_expr(declaration.init());
            this.close();
        });
        self.flag("declare", is_declared);
        let kind: &[u8] = match declarations.first().map(VarDecl::var_kind) {
            Some(VarKind::Let) => b"let",
            Some(VarKind::Const) => b"const",
            Some(VarKind::Using) => b"using",
            Some(VarKind::AwaitUsing) => b"await using",
            Some(VarKind::Var) => b"var",
            // `for (let;;);`
            None => {
                let written = self.file.slice(span);
                written.get(..crate::tokens::token_len(written)).unwrap_or_default()
            }
        };
        self.text("kind", kind);
        self.close();
    }

    /// The pattern of `declaration` with its type annotation.
    fn declared(&mut self, declaration: VarDecl<'a>) {
        self.pat(
            declaration.pat(),
            Extras {
                ty: declaration.ty(),
                end: declaration.binding_span().end,
                ..Extras::default()
            },
        );
    }

    fn case(&mut self, case: Case<'a>) {
        self.open(SwitchCase, case.span());
        self.field("test");
        self.opt_expr(case.test());
        self.statements("consequent", case.body(), false);
        self.close();
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// The field `source`: the module specifier of `statement`, whose value is `spec`.
    fn source(&mut self, statement: Stmt<'a>, spec: Option<&[u8]>) {
        self.source_as("source", statement, spec);
    }

    fn source_as(&mut self, name: &'static str, statement: Stmt<'a>, spec: Option<&[u8]>) {
        self.field(name);
        match (spec, statement.module_specifier_span()) {
            (Some(spec), Some(span)) => self.string_literal(span, spec),
            _ => self.out.null(),
        }
    }

    /// The field `attributes`.
    fn attributes(&mut self, attributes: Option<ImportAttributes<'a>>) {
        let Some(attributes) = attributes else {
            return self.empty("attributes");
        };
        self.list("attributes", attributes.entries(), |this, entry: Prop<'a>| {
            this.open(ImportAttribute, entry.span());
            this.field("key");
            match entry.key() {
                Some(key) => this.key_value(key),
                None => this.out.null(),
            }
            this.field("value");
            this.opt_expr(entry.value());
            this.close();
        });
    }

    fn import_specifier(&mut self, specifier: ImportSpec<'a>) {
        self.open(ImportSpecifier, specifier.span());
        self.field("imported");
        self.module_export_name(specifier.imported());
        self.text("importKind", if specifier.is_type_only() { b"type" } else { b"value" });
        self.field("local");
        self.ident(specifier.local());
        self.close();
    }

    fn export_specifier(&mut self, specifier: ExportSpec<'a>) {
        self.open(ExportSpecifier, specifier.span());
        self.field("exported");
        self.module_export_name(specifier.exported());
        self.text("exportKind", if specifier.is_type_only() { b"type" } else { b"value" });
        self.field("local");
        self.module_export_name(specifier.local());
        self.close();
    }

    // ───────────────────────────── namespaces ─────────────────────────────

    fn module(&mut self, span: Span, module: Module<'a>, is_declared: bool) {
        self.open(TSModuleDeclaration, span);
        // `namespace A.B.C { .. }` is one declaration whose name is qualified.
        let mut innermost = module;
        let mut depth = 0;
        while let Some(nested) = innermost.nested() {
            innermost = nested;
            depth += 1;
        }
        self.field("id");
        match module.name() {
            ModuleName::String(name) => self.string_literal(name.span(), name.bytes()),
            ModuleName::Global => self.identifier(b"global", module.name_span()),
            ModuleName::Ident(first) => {
                for level in (1..=depth).rev() {
                    let mut last = module;
                    for _ in 0..level {
                        last = last.nested().unwrap_or(last);
                    }
                    self.open(TSQualifiedName, first.span().to(last.name_span()));
                    self.field("left");
                }
                self.ident(first);
                let mut at = module;
                while let Some(nested) = at.nested() {
                    self.field("right");
                    match nested.name() {
                        ModuleName::Ident(name) => self.ident(name),
                        _ => self.out.null(),
                    }
                    self.close();
                    at = nested;
                }
            }
        }
        if let Some(body) = innermost.body_span() {
            self.field("body");
            self.open(TSModuleBlock, body);
            self.statements("body", innermost.body(), true);
            self.close();
        }
        self.flag("declare", is_declared);
        let is_global = matches!(module.name(), ModuleName::Global);
        self.flag("global", is_global);
        let kind: &[u8] = match module.name() {
            ModuleName::Global => b"global",
            ModuleName::String(_) => b"module",
            ModuleName::Ident(_) if module.uses_module_keyword() => b"module",
            ModuleName::Ident(_) => b"namespace",
        };
        self.text("kind", kind);
        self.close();
    }
}
