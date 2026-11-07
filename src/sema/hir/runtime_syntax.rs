use super::{
    ClassId, ExprFlags, ExprId, ExprKind, File, FileIn, Flags, FnBody, FnId, FnKind, IdList,
    MemberId, MemberKind, ModifierId, ModifierKind, NameKind, PatPropId, Prop, PropId, PropKey,
    PropKind, Span, StmtId, StmtKind, Storage, VarDeclId, has_body, is_nested_namespace, rare,
};
use crate::atom::{Atom, known};
use crate::node::Node;
use bun_core::strings;
use std::ops::Range;

impl<S: Storage> FileIn<S> {
    #[inline]
    pub fn has_typescript_semantics(&self) -> bool {
        !self.is_js
    }

    fn runtime_key(&self, key: PropKey, name_pos: u32) -> PropKey {
        if self.bigint_names.is_empty() {
            return key;
        }
        let names = &self.bigint_names;
        match names.binary_search_by_key(&name_pos, |name| name.0) {
            Ok(at) => PropKey::Name(names[at].1),
            Err(_) => key,
        }
    }

    #[inline]
    pub fn runtime_property_key(&self, p: PropId) -> PropKey {
        self.runtime_key(self[p].key, self[p].pos)
    }

    #[inline]
    pub fn runtime_member_key(&self, m: MemberId) -> PropKey {
        self.runtime_key(self[m].key, self[m].name_pos)
    }

    #[inline]
    pub fn runtime_binding_key(&self, p: PatPropId) -> PropKey {
        self.runtime_key(self[p].key, self[p].key_pos)
    }

    #[inline]
    pub fn runtime_member_kind(&self, m: MemberId) -> MemberKind {
        match self[m].kind {
            MemberKind::Constructor if self[m].flags.contains(Flags::STATIC) => MemberKind::Method,
            kind => kind,
        }
    }

    #[inline]
    pub fn runtime_function_kind(&self, f: FnId) -> FnKind {
        match self[f].kind {
            FnKind::Constructor if self[f].flags.contains(Flags::STATIC) => FnKind::Method,
            kind => kind,
        }
    }

    pub fn directives(
        &self,
        statements: IdList<StmtId>,
    ) -> impl Iterator<Item = (StmtId, Atom)> + '_ {
        self.ids(statements).filter_map(|stmt| {
            match self.stmts.get(stmt.idx()).map(|statement| statement.kind) {
                Some(StmtKind::Directive { raw, .. }) => Some((stmt, raw)),
                _ => None,
            }
        })
    }

    pub fn has_use_strict_directive(&self, body: FnBody) -> bool {
        match body {
            FnBody::None | FnBody::Expr(_) => false,
            FnBody::Block(statements) => {
                (self.directives(statements)).any(|directive| directive.1 == known::use_strict)
            }
        }
    }

    pub fn is_erased_statement(&self, stmt: StmtId) -> bool {
        let Some(statement) = self.stmts.get(stmt.idx()) else {
            return false;
        };
        match statement.kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::ExportAsNamespace(_) => {
                true
            }
            StmtKind::Import(import) => self.is_type_only_import(import),
            StmtKind::ExportNamed(export) => self.is_type_only_export(export),
            StmtKind::ExportStar { type_only, .. } => type_only,
            StmtKind::Var(declarations) => {
                let is_ambient = |it: VarDeclId| self[it].flags.contains(Flags::AMBIENT);
                !declarations.is_empty() && declarations.iter().all(is_ambient)
            }
            StmtKind::Fn(function) => (self.fns.get(function.idx()))
                .is_some_and(|it| it.flags.contains(Flags::AMBIENT) || !has_body(it)),
            StmtKind::Class(class) => {
                (self.classes.get(class.idx())).is_some_and(|it| it.flags.contains(Flags::AMBIENT))
            }
            StmtKind::Enum(enumeration) => (self.enums.get(enumeration.idx()))
                .is_some_and(|it| it.flags.contains(Flags::AMBIENT)),
            StmtKind::Module(module) => {
                (self.modules.get(module.idx())).is_some_and(|it| it.is_erased)
            }
            _ => false,
        }
    }

    /// Whether `bun run` drops a namespace that has these modifiers and this body: it keeps no statement of the body.
    /// The namespaces in the body have their answers already.
    pub fn erases_namespace(&self, flags: Flags, body: IdList<StmtId>) -> bool {
        let mut is_prologue = true;
        flags.intersects(Flags::AMBIENT | Flags::REPARSED)
            || self.ids(body).all(|statement| {
                let is_dropped_directive = is_prologue && self.is_use_strict(statement);
                is_prologue &= is_dropped_directive || self.is_erased_statement(statement);
                is_dropped_directive || !self.is_kept_in_namespace(statement)
            })
    }

    fn is_use_strict(&self, statement: StmtId) -> bool {
        let Some(StmtKind::Expr(text)) = self.stmts.get(statement.idx()).map(|it| it.kind) else {
            return false;
        };
        let kind = self.exprs.get(text.idx()).map(|it| it.kind);
        matches!(kind, Some(ExprKind::String(known::use_strict)))
            && !self.expr_flags(text).contains(ExprFlags::TEMPLATE_LITERAL)
    }

    fn is_kept_in_namespace(&self, statement: StmtId) -> bool {
        let Some(kind) = self.stmts.get(statement.idx()).map(|it| it.kind) else {
            return true;
        };
        // `export declare` names a member of the object, so the object is there.
        let is_member =
            |flags: Flags| !flags.contains(Flags::AMBIENT) || flags.contains(Flags::EXPORT);
        match kind {
            StmtKind::Empty => false,
            StmtKind::ImportEquals(alias) => (self.import_equals.get(alias.idx()))
                .is_none_or(|it| it.flags.contains(Flags::EXPORT)),
            StmtKind::Var(declarations) => declarations.iter().any(|it| is_member(self[it].flags)),
            StmtKind::Fn(function) => self.fns.get(function.idx()).is_none_or(|it| {
                is_member(it.flags) && (has_body(it) || it.flags.contains(Flags::AMBIENT))
            }),
            StmtKind::Class(class) => {
                (self.classes.get(class.idx())).is_none_or(|it| is_member(it.flags))
            }
            StmtKind::Enum(enumeration) => {
                (self.enums.get(enumeration.idx())).is_none_or(|it| is_member(it.flags))
            }
            // The `b` of `namespace a.b` is kept as a statement of `a` even where it is dropped itself.
            StmtKind::Module(inner) => {
                self.modules.get(inner.idx()).is_none_or(|it| !it.is_erased)
                    || is_nested_namespace(self, statement)
            }
            _ => !self.is_erased_statement(statement),
        }
    }

    pub fn only_declares(&self) -> bool {
        let mut statements = self.ids(self.body);
        self.has_typescript_semantics()
            && statements.len() != 0
            && statements.all(|statement| self.is_erased_statement(statement))
    }

    pub fn declares_beside_code(&self) -> bool {
        self.has_typescript_semantics()
            && self
                .ids(self.body)
                .any(|statement| self.is_erased_statement(statement))
    }

    pub fn set_strict_by_syntax(&mut self) {
        self.is_strict = true;
        self.is_strict_by_syntax = true;
        for function in self.fns.iter_mut() {
            function.is_strict = true;
            function.is_strict_by_syntax = true;
        }
    }
}

impl File<'_> {
    pub fn follows_dropped_directive(&self, node: Node) -> bool {
        if self.rare_syntax & rare::DROPPED_STRICT_DIRECTIVE == 0 {
            return false;
        }
        let start = self.start(node);
        let mut enclosing = self.get_containing_function(node);
        while enclosing.is_some() {
            let directive = self.find_own_strict_directive(self.function_of(enclosing));
            if directive.is_some_and(|directive| self[directive].start < start) {
                return true;
            }
            enclosing = self.get_containing_function(enclosing);
        }
        false
    }

    pub fn has_parameters_read_as_strict(&self, function: FnId) -> bool {
        self.rare_syntax & rare::DROPPED_STRICT_DIRECTIVE != 0
            && (self.find_own_strict_directive(function).is_some()
                || self.follows_dropped_directive(self.node(function)))
    }

    fn find_own_strict_directive(&self, function: FnId) -> Option<StmtId> {
        let FnBody::Block(statements) = self.fns.get(function.idx())?.body else {
            return None;
        };
        let mut directives = self.directives(statements);
        directives
            .find(|directive| directive.1 == known::use_strict)
            .map(|directive| directive.0)
    }

    pub fn set_strict(&mut self) {
        self.is_strict = true;
        for function in self.fns.iter_mut() {
            function.is_strict = true;
        }
    }

    pub fn reset_strict(&mut self) {
        self.is_strict = self.is_strict_by_syntax;
        for function in self.fns.iter_mut() {
            function.is_strict = function.is_strict_by_syntax;
        }
    }
}

pub fn is_proto_setter(property: &Prop) -> bool {
    let is_literal_name = matches!(
        property.name_kind,
        NameKind::Identifier | NameKind::StringLiteral
    );
    is_literal_name
        && property.kind == PropKind::Init
        && property.key == PropKey::Name(known::__proto__)
}

pub fn has_runtime_member(hir: &File, member: MemberId) -> bool {
    let node = hir[member];
    let is_declaration_only = node.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT);
    match node.kind {
        MemberKind::Property => {
            let is_decorator =
                |modifier: ModifierId| matches!(hir[modifier].kind, ModifierKind::Decorator(_));
            !is_declaration_only || node.modifiers.iter().any(is_decorator)
        }
        MemberKind::StaticBlock => !is_declaration_only,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => {
            !is_declaration_only && hir.fns.get(node.func.idx()).is_some_and(has_body)
        }
        MemberKind::CallSignature | MemberKind::ConstructSignature | MemberKind::IndexSignature => {
            false
        }
    }
}

const TRANSPILED_MARK: &[u8] = b"// @bun";

/// The line that starts with `// @bun`, if it is the first line or follows a hashbang. `bun run` hands such a file to the engine as it is written.
pub fn find_transpiled_mark(text: &[u8]) -> Option<Range<usize>> {
    let end_of_line = |start: usize| {
        let length = strings::index_of_char_usize(&text[start..], b'\n')?;
        Some(start + length + 1)
    };
    let start = match text.starts_with(b"#!") {
        true => end_of_line(0)?,
        false => 0,
    };
    text[start..]
        .starts_with(TRANSPILED_MARK)
        .then(|| start..end_of_line(start).unwrap_or(text.len()))
}

/// The text behind such a line is the function that the loader calls with the five values of a CommonJS file. Behind any other mark stands an ES module.
pub fn is_marked_as_commonjs(mark: &[u8]) -> bool {
    let mut rest = &mark[TRANSPILED_MARK.len()..];
    while let Some(at) = strings::index_of_char_usize(rest, b'@') {
        let word = &rest[at + 1..];
        if word.starts_with(b"bun-cjs") {
            return true;
        }
        // `bun run` does not look at the byte behind a word that it knows, nor at the one behind an `@` that starts none.
        let passed = match word.starts_with(b"bytecode") {
            true => b"bytecode".len() + 1,
            false => 1,
        };
        rest = word.get(passed..).unwrap_or_default();
    }
    false
}

pub fn is_moved_to_file_start(hir: &File, statement: StmtId) -> bool {
    let can_move = match hir[statement].kind {
        StmtKind::Class(class) => can_move_class(hir, class),
        StmtKind::ExportDefault(value) => can_move_expression(hir, value),
        _ => false,
    };
    can_move && find_transpiled_mark(&hir.text).is_none()
}

fn can_move_class(hir: &File, class: ClassId) -> bool {
    let node = hir[class];
    node.extends.is_none()
        && !has_decorator(hir, node.modifiers)
        && node
            .members
            .iter()
            .all(|member| can_move_member(hir, member))
}

fn can_move_member(hir: &File, member: MemberId) -> bool {
    let node = hir[member];
    if has_decorator(hir, node.modifiers) {
        return false;
    }
    if !has_runtime_member(hir, member) {
        return true;
    }
    let parameters = node
        .func
        .some()
        .map_or(Span::EMPTY, |function| hir[function].params);
    let has_bracketed_name = hir.text.get(node.name_pos as usize) == Some(&b'[');
    if node.kind == MemberKind::StaticBlock
        || has_bracketed_name
        || parameters
            .iter()
            .any(|parameter| has_decorator(hir, hir.param_modifiers(parameter)))
    {
        return false;
    }
    let is_static_field = node.kind == MemberKind::Property && node.flags.contains(Flags::STATIC);
    !is_static_field || node.init.is_none() || can_move_expression(hir, node.init)
}

fn can_move_expression(hir: &File, expression: ExprId) -> bool {
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Class(class) => can_move_class(hir, class),
        ExprKind::Template { exprs } => exprs.is_empty(),
        ExprKind::Fn(_)
        | ExprKind::Number(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::BigInt(_)
        | ExprKind::String(_)
        | ExprKind::ImportMeta => true,
        _ => false,
    }
}

fn has_decorator(hir: &File, modifiers: Span<ModifierId>) -> bool {
    modifiers
        .iter()
        .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
}
