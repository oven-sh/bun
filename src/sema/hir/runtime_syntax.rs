use super::{
    ClassId, ExprFlags, ExprId, ExprKind, File, FileIn, Flags, FnBody, FnId, FnKind, IdList,
    MemberId, MemberKind, ModifierId, ModifierKind, ModuleName, NameKind, ParamId, PatKind,
    PatPropId, Prop, PropId, PropKey, PropKind, Span, StmtId, StmtKind, Storage, VarDeclId,
    has_body, is_nested_namespace,
};
use crate::atom::{Atom, known};
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
            StmtKind::ImportEquals(alias) => {
                let erased = Flags::TYPE_ONLY | Flags::AMBIENT;
                (self.import_equals.get(alias.idx())).is_some_and(|it| it.flags.intersects(erased))
            }
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

    pub fn erases_namespace(&self, flags: Flags, body: IdList<StmtId>) -> bool {
        let mut is_prologue = true;
        flags.intersects(Flags::AMBIENT | Flags::REPARSED)
            || self.ids(body).all(|statement| {
                let is_dropped_directive = is_prologue && self.is_dropped_directive(statement);
                is_prologue &= is_dropped_directive || self.is_erased_statement(statement);
                is_dropped_directive || !self.is_kept_in_namespace(statement)
            })
    }

    pub fn value_read_as_directive(&self, written: ExprId) -> Option<Atom> {
        let text = self.skip_type_assertions(written);
        match self.exprs.get(text.idx())?.kind {
            ExprKind::String(value)
                if !self.expr_flags(text).contains(ExprFlags::TEMPLATE_LITERAL) =>
            {
                Some(value)
            }
            _ => None,
        }
    }

    fn is_dropped_directive(&self, statement: StmtId) -> bool {
        let Some(StmtKind::Expr(written)) = self.stmts.get(statement.idx()).map(|it| it.kind)
        else {
            return false;
        };
        let value = self.value_read_as_directive(written);
        matches!(value, Some(known::use_strict | known::use_asm))
    }

    fn is_kept_in_namespace(&self, statement: StmtId) -> bool {
        let Some(kind) = self.stmts.get(statement.idx()).map(|it| it.kind) else {
            return true;
        };
        let is_member =
            |flags: Flags| !flags.contains(Flags::AMBIENT) || flags.contains(Flags::EXPORT);
        match kind {
            StmtKind::Empty => false,
            StmtKind::ImportEquals(alias) => {
                !self.is_erased_statement(statement)
                    && (self.import_equals.get(alias.idx()))
                        .is_none_or(|it| it.flags.contains(Flags::EXPORT))
            }
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

    pub fn is_module_for(&self, name: ModuleName) -> bool {
        self.has_module_syntax && !self.declares_as_script(name)
    }

    pub fn declares_as_script(&self, name: ModuleName) -> bool {
        self.is_script_for_project && matches!(name, ModuleName::String(_))
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
            let is_field = !node.flags.contains(Flags::ACCESSOR);
            !is_declaration_only || (is_field && has_decorator(hir, node.modifiers))
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

pub fn find_runtime_constructor(hir: &File, class: ClassId) -> Option<MemberId> {
    hir[class].members.iter().find(|&member| {
        has_runtime_member(hir, member)
            && hir.runtime_member_kind(member) == MemberKind::Constructor
    })
}

pub fn parameter_properties(hir: &File, constructor: FnId) -> impl Iterator<Item = ParamId> {
    hir[constructor].params.iter().filter(move |&parameter| {
        let node = hir[parameter];
        node.flags.contains(Flags::PARAMETER_PROPERTY)
            && matches!(hir[node.pat].kind, PatKind::Ident(_))
    })
}

pub fn find_super_call_statement(hir: &File, constructor: FnId) -> Option<(StmtId, ExprId)> {
    let FnBody::Block(statements) = hir[constructor].body else {
        return None;
    };
    hir.ids(statements).find_map(|statement| {
        if let StmtKind::Expr(expression) = hir[statement].kind
            && let ExprKind::Call(call) = hir[expression].kind
            && matches!(hir[hir[call].callee].kind, ExprKind::Super)
        {
            return Some((statement, expression));
        }
        None
    })
}

const TRANSPILED_MARK: &[u8] = b"// @bun";

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

pub fn is_marked_as_commonjs(mark: &[u8]) -> bool {
    let mut rest = &mark[TRANSPILED_MARK.len()..];
    while let Some(at) = strings::index_of_char_usize(rest, b'@') {
        let word = &rest[at + 1..];
        if word.starts_with(b"bun-cjs") {
            return true;
        }
        let passed = match word.starts_with(b"bytecode") {
            true => b"bytecode".len() + 1,
            false => 1,
        };
        rest = word.get(passed..).unwrap_or_default();
    }
    false
}

/// The bytes of the mark, without its line break, where its line says nothing else. `None` for `// @bun @bun-cjs`, and for a comment that only begins like the mark.
pub fn find_transpiled_mark_alone(text: &[u8]) -> Option<Range<usize>> {
    let line = find_transpiled_mark(text)?;
    let end = line.start + TRANSPILED_MARK.len();
    matches!(&text[end..line.end], b"" | b"\n" | b"\r\n").then_some(line.start..end)
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
