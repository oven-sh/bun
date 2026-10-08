//! `checkJSSyntax`: what only TypeScript has is parsed in a JavaScript file too, and reported.

use super::{Parser, ctx};
use bun_sema::hir::*;

impl Parser<'_> {
    /// `jsErrorAtRange`. An end of 0: the end of the token at the start. `what`: the `{0}` of the
    /// message, if it has one. Nothing inside a type is reported.
    #[cold]
    #[inline(never)]
    pub(crate) fn js_error(&mut self, at: (u32, u32), code: u32, what: &[u8]) {
        if self.options.is_javascript && !self.has_context(ctx::TYPE) && !self.is_flow {
            let args: &[&[u8]] = if what.is_empty() { &[] } else { &[what] };
            self.flag(DiagnosticKind::Js, code, at, args);
        }
    }

    /// `js_error` at a type.
    #[cold]
    pub(crate) fn js_error_at_type(&mut self, ty: TypeNodeId, code: u32) {
        self.js_error_at_types(ty, ty, code);
    }

    fn js_error_at_types(&mut self, first: TypeNodeId, last: TypeNodeId, code: u32) {
        if let (Some(first), Some(last)) = (self.f.types.get(first.idx()), self.f.types.get(last.idx()))
        {
            self.js_error((first.pos, last.end), code, b"");
        }
    }

    /// For type arguments.
    #[cold]
    pub(crate) fn check_js_type_arguments(&mut self, list: IdList<TypeNodeId>) {
        if self.options.is_javascript && !list.is_empty() {
            let last = self.f.id_at(list, list.len() - 1);
            self.js_error_at_types(self.f.id_at(list, 0), last, 8011);
        }
    }

    /// The modifiers that are not in `ModifierFlagsJavaScript`. `check_js_decorators`, if
    /// `decorators`.
    #[cold]
    pub(crate) fn check_js_modifiers(&mut self, list: Span<ModifierId>, decorators: bool) {
        const JAVASCRIPT: Flags = Flags::EXPORT
            .union(Flags::STATIC)
            .union(Flags::ACCESSOR)
            .union(Flags::ASYNC)
            .union(Flags::DEFAULT);
        for index in 0..list.len() {
            let Modifier { kind, pos } = self.f.modifier_list(list)[index];
            if let ModifierKind::Keyword(flag) = kind
                && !JAVASCRIPT.intersects(flag)
            {
                self.js_error((pos, 0), 8009, modifier_text(flag).as_bytes());
            }
        }
        if decorators {
            self.check_js_decorators(list, false);
        }
    }

    /// `checkJSDecoratorSyntax` for a node whose modifiers are `list`: a class declaration
    /// (`is_class_declaration`), or a node for which `CanHaveIllegalDecorators` is true.
    #[cold]
    pub(crate) fn check_js_decorators(&mut self, list: Span<ModifierId>, is_class_declaration: bool) {
        // Nodes can be missing.
        if self.has_failed() {
            return;
        }
        let file = &self.f;
        let modifiers = file.modifier_list(list);
        // Each with its index and its range.
        let decorators = || {
            let modifiers = modifiers.iter().enumerate();
            modifiers.filter_map(move |(index, modifier)| match modifier.kind {
                ModifierKind::Decorator(e) => Some((index, (modifier.pos, end_of_expr(file, e)))),
                ModifierKind::Keyword(_) => None,
            })
        };
        let index_of = |keyword: Flags| {
            let mut modifiers = modifiers.iter();
            modifiers.position(|modifier| modifier.kind == ModifierKind::Keyword(keyword))
        };
        let Some((decorator_index, first)) = decorators().next() else {
            return;
        };
        if !is_class_declaration {
            return self.js_error(first, 1206, b"");
        }
        let Some(export_index) = index_of(Flags::EXPORT) else {
            return;
        };
        let default_index = index_of(Flags::DEFAULT);
        let trailing = decorators().find(|&(index, _)| index > export_index);
        if decorator_index > export_index {
            if default_index.is_some_and(|default_index| decorator_index < default_index) {
                self.js_error(first, 1206, b"");
            }
        } else if let Some((_, trailing)) = trailing {
            let mut diagnostic = Diagnostic::new(DiagnosticKind::Js, trailing, 8038, &[]);
            let related = Diagnostic::new(DiagnosticKind::Js, first, 1486, &[]);
            diagnostic.related.push(related);
            self.f.diagnostics.push(diagnostic);
        }
    }

    /// For the declaration `id`.
    #[cold]
    pub(crate) fn check_js_statement(&mut self, id: StmtId) {
        let Some(&stmt) = self.f.stmts.get(id.idx()).filter(|_| !self.has_failed()) else {
            return;
        };
        match stmt.kind {
            // `parseAmbientExternalModuleDeclaration` does not perform this check.
            StmtKind::Module(m) if !matches!(self.f[m].name, ModuleName::Ident(_)) => return,
            StmtKind::Class(_) => self.check_js_decorators(stmt.modifiers, true),
            StmtKind::Var(_)
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_) => self.check_js_decorators(stmt.modifiers, false),
            // Nor does `parseNamespaceExportDeclaration`.
            _ => return,
        }
        if let StmtKind::Fn(_) | StmtKind::Var(_) | StmtKind::Class(_) = stmt.kind {
            self.check_js_modifiers(stmt.modifiers, false);
        }
        let (file, whole) = (&self.f, (stmt.start, stmt.loc.end));
        let (at, code, what): (_, _, &[u8]) = match stmt.kind {
            StmtKind::Fn(f) if !has_body_node(&file[f]) => (whole, 8017, b""),
            StmtKind::Import(i) if file[i].type_only => (whole, 8006, b"import type"),
            StmtKind::ExportNamed(e) if file[e].type_only => (whole, 8006, b"export type"),
            StmtKind::ExportStar { type_only, .. } if type_only => (whole, 8006, b"export type"),
            StmtKind::ImportEquals(_) => (whole, 8002, b""),
            StmtKind::ExportAssign(_) => (whole, 8003, b""),
            StmtKind::Interface(i) => ((file[i].name_pos, 0), 8006, b"interface"),
            StmtKind::Module(m) if file[m].specifies_module => {
                ((file[m].name_pos, 0), 8006, b"module")
            }
            StmtKind::Module(m) => ((file[m].name_pos, 0), 8006, b"namespace"),
            StmtKind::Enum(e) => ((file[e].name_pos, 0), 8006, b"enum"),
            StmtKind::TypeAlias(a) => ((file[a].name_pos, 0), 8008, b""),
            _ => return,
        };
        self.js_error(at, code, what);
    }

    /// For a method or an accessor in an object literal.
    #[cold]
    pub(crate) fn check_js_method_of_object(&mut self, prop: &Prop, modifiers: Span<ModifierId>) {
        if self.has_failed() {
            return;
        }
        let postfix = self.lx.src.get(prop.postfix_token as usize);
        if prop.kind == PropKind::Method && prop.postfix_token != 0 && postfix == Some(&b'?') {
            self.js_error((prop.postfix_token, 0), 8009, b"?");
        }
        if let Some(&Expr {
            kind: ExprKind::Fn(func),
            ..
        }) = self.f.exprs.get(prop.value.idx())
            && !has_body_node(&self.f[func])
        {
            self.js_error((prop.start, prop.end), 8017, b"");
        }
        self.check_js_modifiers(modifiers, false);
    }

    /// For a class member. `question`: the position of the `?` after its name.
    #[cold]
    pub(crate) fn check_js_member(&mut self, member: &Member, question: Option<u32>) {
        if self.has_failed() {
            return;
        }
        if matches!(member.kind, MemberKind::Property | MemberKind::Method)
            && let Some(question) = question
        {
            self.js_error((question, 0), 8009, b"?");
        }
        if self.f.fns.get(member.func.idx()).is_some_and(|it| !has_body_node(it)) {
            self.js_error((member.start, member.loc.end), 8017, b"");
        }
        match member.kind {
            MemberKind::IndexSignature => self.check_js_decorators(member.modifiers, false),
            kind => self.check_js_modifiers(member.modifiers, kind == MemberKind::Constructor),
        }
    }
}
