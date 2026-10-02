//! `checkGrammarModifiers` (TypeScript 7.0.2, grammarchecks.go), on `node.Modifiers()` as the tree has it.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{MemberOwner, Parent};

/// What `grammarErrorOnNode` is given: where the node is, the code of the message, and its arguments. `""`: no argument. An `end` of 0:
/// that of the token at `start`.
#[derive(Copy, Clone)]
pub(super) struct GrammarError {
    start: u32,
    end: u32,
    code: u32,
    args: [&'static str; 2],
}

impl GrammarError {
    fn some(start: u32, end: u32, code: u32, args: [&'static str; 2]) -> Option<Self> {
        Some(GrammarError {
            start,
            end,
            code,
            args,
        })
    }
}

/// `node`, of `checkGrammarModifiers(node)`.
#[derive(Copy, Clone)]
pub(super) enum HasModifiers {
    Statement(StmtId),
    Member(MemberId),
    Parameter(ParamId),
    TypeParameter(TypeParamId),
}

/// `node.Kind`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    PropertyDeclaration,
    PropertySignature,
    MethodDeclaration,
    MethodSignature,
    /// `KindGetAccessor`, `KindSetAccessor`
    Accessor,
    Constructor,
    IndexSignature,
    Parameter,
    TypeParameter,
    FunctionDeclaration,
    ClassDeclaration,
    EnumDeclaration,
    InterfaceDeclaration,
    TypeAliasDeclaration,
    VariableStatement,
    ModuleDeclaration,
    ImportDeclaration,
    ImportEqualsDeclaration,
    ExportDeclaration,
    ExportAssignment,
}

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);

/// `scanner.TokenToString(modifier.Kind)`
pub(super) fn modifier_text(modifier: Flags) -> &'static str {
    const TEXTS: [(Flags, &str); 15] = [
        (Flags::ABSTRACT, "abstract"),
        (Flags::ACCESSOR, "accessor"),
        (Flags::ASYNC, "async"),
        (Flags::CONST, "const"),
        (Flags::AMBIENT, "declare"),
        (Flags::DEFAULT, "default"),
        (Flags::EXPORT, "export"),
        (Flags::IN, "in"),
        (Flags::OUT, "out"),
        (Flags::OVERRIDE, "override"),
        (Flags::PRIVATE, "private"),
        (Flags::PROTECTED, "protected"),
        (Flags::PUBLIC, "public"),
        (Flags::READONLY, "readonly"),
        (Flags::STATIC, "static"),
    ];
    TEXTS
        .iter()
        .find(|text| text.0 == modifier)
        .map_or("", |text| text.1)
}

impl Checker<'_> {
    /// `checkGrammarModifiers`, of every statement, member, parameter and type parameter that has modifiers.
    pub(super) fn check_grammar_modifiers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `grammarErrorOnNode`
        if has_parse_diagnostics(hir) {
            return;
        }
        let report = |error: GrammarError, out: &mut Vec<Diagnostic>| {
            let (start, code) = (error.start, error.code);
            out.push(Diagnostic { start, code });
            let args = error.args.iter().filter(|arg| !arg.is_empty());
            self.note(
                start,
                error.end,
                code,
                args.map(|&arg| arg.to_owned()).collect(),
            );
        };
        for (s, statement) in hir.stmts.iter().enumerate() {
            if statement.modifiers.is_empty() || matches!(bound.stmt_parent[s], Parent::None) {
                continue;
            }
            let node = HasModifiers::Statement(StmtId(s as u32));
            let error = self.grammar_error_in_modifiers(file, node);
            // `checkGrammarClassDeclarationHeritageClauses`, `checkInterfaceDeclaration`: `!c.checkGrammarModifiers(node) && ..`. The
            // front end reports the clauses.
            if error.is_some() {
                let members = match statement.kind {
                    StmtKind::Class(c) => hir[c].members,
                    StmtKind::Interface(i) => hir[i].members,
                    _ => Span::EMPTY,
                };
                let first_member = members.iter().next().map(|m| hir[m].start);
                let header = statement.start..first_member.unwrap_or(statement.loc.end);
                out.retain(|d| !matches!(d.code, 1097 | 1172..=1176) || !header.contains(&d.start));
            }
            // `checkImportDeclaration`, `checkExportDeclaration`, `checkExportAssignment`: these take none.
            let takes_none = match (statement.kind, bound.stmt_parent[s]) {
                (StmtKind::Import(_), Parent::File | Parent::Module(_)) => 1191,
                (
                    StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. },
                    Parent::File | Parent::Module(_),
                ) => 1193,
                (StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_), Parent::File) => 1120,
                (StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_), Parent::Module(m))
                    if !matches!(hir[m].name, ModuleName::Ident(_)) =>
                {
                    1120
                }
                _ => 0,
            };
            let takes_none = GrammarError::some(statement.start, 0, takes_none, ["", ""]);
            if let Some(error) = error.or(takes_none.filter(|error| error.code != 0)) {
                report(error, out);
            }
        }
        for (m, member) in hir.members.iter().enumerate() {
            if member.modifiers.is_empty() || bound.member_owner[m] == MemberOwner::None {
                continue;
            }
            let node = HasModifiers::Member(MemberId(m as u32));
            let Some(error) = self.grammar_error_in_modifiers(file, node) else {
                continue;
            };
            // `checkGrammarIndexSignature`: `c.checkGrammarModifiers(node) || c.checkGrammarIndexSignatureParameters(node)`. The front
            // end reports the parameters.
            if member.kind == MemberKind::IndexSignature {
                let signature = member.start..member.loc.end;
                out.retain(|d| {
                    !matches!(d.code, 1017..=1020 | 1022 | 1025 | 1096)
                        || !signature.contains(&d.start)
                });
            }
            report(error, out);
        }
        for p in 0..hir.modifiers_of_params.len() {
            if bound.param_fn[p].is_some()
                && let Some(error) = self
                    .grammar_error_in_modifiers(file, HasModifiers::Parameter(ParamId(p as u32)))
            {
                report(error, out);
            }
        }
        for p in 0..hir.type_params.len() {
            let node = HasModifiers::TypeParameter(TypeParamId(p as u32));
            if let Some(error) = self.grammar_error_in_modifiers(file, node) {
                report(error, out);
            }
        }
    }

    /// What `checkGrammarModifiers(node)` reports. The arms for decorators on members and parameters are still in decorators.rs.
    pub(super) fn grammar_error_in_modifiers(
        &self,
        file: FileId,
        node: HasModifiers,
    ) -> Option<GrammarError> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (kind, modifiers) = match node {
            HasModifiers::Statement(s) if s.is_none() => return None,
            HasModifiers::Statement(s) => {
                let kind = match hir[s].kind {
                    StmtKind::Fn(_) => Kind::FunctionDeclaration,
                    StmtKind::Class(_) => Kind::ClassDeclaration,
                    StmtKind::Enum(_) => Kind::EnumDeclaration,
                    StmtKind::Interface(_) => Kind::InterfaceDeclaration,
                    StmtKind::TypeAlias(_) => Kind::TypeAliasDeclaration,
                    StmtKind::Var(_) => Kind::VariableStatement,
                    StmtKind::Module(_) => Kind::ModuleDeclaration,
                    StmtKind::Import(_) => Kind::ImportDeclaration,
                    StmtKind::ImportEquals(_) => Kind::ImportEqualsDeclaration,
                    StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
                        Kind::ExportDeclaration
                    }
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => {
                        Kind::ExportAssignment
                    }
                    // The binder objects to those of `export as namespace N`. Nothing else has any.
                    _ => return None,
                };
                (kind, hir[s].modifiers)
            }
            HasModifiers::Member(m) => {
                let is_in_class = matches!(bound.member_owner[m.idx()], MemberOwner::Class(_));
                let kind = match hir[m].kind {
                    MemberKind::Property if is_in_class => Kind::PropertyDeclaration,
                    MemberKind::Property => Kind::PropertySignature,
                    MemberKind::Method if is_in_class => Kind::MethodDeclaration,
                    MemberKind::Method => Kind::MethodSignature,
                    MemberKind::Getter | MemberKind::Setter => Kind::Accessor,
                    MemberKind::Constructor => Kind::Constructor,
                    MemberKind::IndexSignature => Kind::IndexSignature,
                    // `parseTypeMember` reads no modifiers before a signature without a name. Those of a static block are the front
                    // end's (`findFirstIllegalModifier`).
                    MemberKind::CallSignature
                    | MemberKind::ConstructSignature
                    | MemberKind::StaticBlock => return None,
                };
                (kind, hir[m].modifiers)
            }
            HasModifiers::Parameter(p) => (Kind::Parameter, hir.param_modifiers(p)),
            HasModifiers::TypeParameter(p) => (Kind::TypeParameter, hir[p].modifiers),
        };
        if modifiers.is_empty() {
            return None;
        }
        // `node.Parent`, of a type parameter: a class, or an interface or a type alias.
        let is_type_parameter_of = |list: Span<TypeParamId>| matches!(node, HasModifiers::TypeParameter(p) if list.iter().any(|it| it == p));
        let is_type_parameter = kind == Kind::TypeParameter;
        let is_of_class = is_type_parameter
            && hir
                .classes
                .iter()
                .any(|it| is_type_parameter_of(it.type_params));
        let is_of_interface_or_alias = is_type_parameter
            && (hir
                .interfaces
                .iter()
                .any(|it| is_type_parameter_of(it.type_params))
                || hir
                    .aliases
                    .iter()
                    .any(|it| is_type_parameter_of(it.type_params)));
        let parent = match node {
            HasModifiers::Statement(s) => bound.stmt_parent[s.idx()],
            _ => Parent::None,
        };
        // `IsClassLike(node.Parent)`
        let class = match node {
            HasModifiers::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => Some(class),
                _ => None,
            },
            _ => None,
        };
        // `IsPrivateIdentifier(node.Name())`
        let has_private_name =
            matches!(node, HasModifiers::Member(m) if matches!(hir[m].key, PropKey::Private(_)));
        // `grammarErrorOnNode(node, ..)`
        let error_on_node = |code: u32, args: [&'static str; 2]| {
            let (start, end) = match node {
                HasModifiers::Statement(s) => (hir[s].start, 0),
                HasModifiers::Member(m) => self.error_range_of_member(file, m),
                HasModifiers::Parameter(p) => (hir[p].pos, self.end_of_param(file, p)),
                HasModifiers::TypeParameter(p) => (hir[p].start, hir[p].end),
            };
            GrammarError::some(start, end, code, args)
        };
        // `node.Parent.Kind == KindModuleBlock || node.Parent.Kind == KindSourceFile`
        let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
        let keywords =
            hir.modifier_list(modifiers)
                .iter()
                .filter_map(|modifier| match modifier.kind {
                    ModifierKind::Keyword(flag) => Some((flag, modifier.pos)),
                    ModifierKind::Decorator(_) => None,
                });
        // `container.Kind == KindModuleDeclaration && !IsAmbientModule(container)`
        let is_in_namespace =
            matches!(parent, Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)));
        // `reportObviousModifierErrors`, `findFirstIllegalModifier`: the only modifier that may come first.
        let allowed_first = match kind {
            // `checkGrammarModuleElementContext`: elsewhere these are given up on before their modifiers are looked at.
            Kind::ModuleDeclaration
            | Kind::ImportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ExportDeclaration => match is_module_element {
                true => None,
                false => return None,
            },
            // `checkExportAssignment`: so is one in a namespace.
            Kind::ExportAssignment => match is_module_element && !is_in_namespace {
                true => None,
                false => return None,
            },
            _ if is_module_element => None,
            Kind::FunctionDeclaration => Some(Flags::ASYNC),
            Kind::ClassDeclaration => Some(Flags::ABSTRACT),
            Kind::EnumDeclaration => Some(Flags::CONST),
            Kind::InterfaceDeclaration | Kind::TypeAliasDeclaration | Kind::VariableStatement => {
                Some(Flags::empty())
            }
            _ => None,
        };
        // `reportObviousDecoratorErrors`, `CanHaveIllegalDecorators`
        let is_decorator =
            |modifier: &&Modifier| matches!(modifier.kind, ModifierKind::Decorator(_));
        if matches!(node, HasModifiers::Statement(_))
            && kind != Kind::ClassDeclaration
            && let Some(decorator) = hir.modifier_list(modifiers).iter().find(is_decorator)
        {
            return GrammarError::some(decorator.pos, 0, 1206, ["", ""]);
        }
        if let (Some(allowed), Some((first, start))) = (allowed_first, keywords.clone().next())
            && first != allowed
        {
            return GrammarError::some(start, 0, 1184, ["", ""]);
        }
        let statement = match node {
            HasModifiers::Statement(s) => hir[s].kind,
            _ => StmtKind::Empty,
        };
        // `node.Flags&NodeFlagsAmbient`
        let is_ambient = match statement {
            StmtKind::Var(decls) => decls.iter().next().map_or(Flags::empty(), |d| hir[d].flags),
            StmtKind::Fn(f) => hir[f].flags,
            StmtKind::Class(c) => hir[c].flags,
            StmtKind::Enum(e) => hir[e].flags,
            StmtKind::ImportEquals(i) => hir[i].flags,
            _ => Flags::empty(),
        }
        .contains(Flags::AMBIENT);
        // `node.Parent.Flags&NodeFlagsAmbient`
        let is_parent_ambient = match (node, parent) {
            (HasModifiers::Member(_), _) => {
                class.is_some_and(|class| hir[class].flags.contains(Flags::AMBIENT))
            }
            (HasModifiers::Parameter(p), _) => hir
                .fns
                .get(bound.param_fn[p.idx()].idx())
                .is_some_and(|function| function.flags.contains(Flags::AMBIENT)),
            (_, Parent::File) => hir.kind == FileKind::Declaration,
            (_, Parent::Module(m)) => hir[m].flags.contains(Flags::AMBIENT),
            _ => false,
        };
        // `blockScopeKind`: the code for a modifier that a `using` or an `await using` declaration cannot have.
        let on_using = match statement {
            StmtKind::Var(decls) => match decls.iter().next().map(|d| hir[d].kind) {
                Some(VarKind::Using) => 1491,
                Some(VarKind::AwaitUsing) => 1495,
                _ => 0,
            },
            _ => 0,
        };
        let mut seen = Flags::empty();
        let (mut last_static, mut last_declare, mut last_async, mut last_override) = (0, 0, 0, 0);
        for (modifier, start) in keywords {
            // `modifier.Flags&NodeFlagsReparsed == 0`. One that is made from a tag of a JSDoc comment is as long as the tag.
            let is_written = !modifier.contains(Flags::REPARSED);
            let end = match is_written {
                true => 0,
                false => self.end_of_jsdoc_tag(file, start),
            };
            let modifier = modifier.difference(Flags::REPARSED);
            let text = modifier_text(modifier);
            let error = |code: u32, args| GrammarError::some(start, end, code, args);
            // The first of `later` that has been seen: `modifier` must precede it.
            let follows = |later: &[Flags]| {
                later
                    .iter()
                    .find(|&&other| is_written && seen.contains(other))
                    .map(|&other| modifier_text(other))
            };
            if modifier != Flags::READONLY {
                if matches!(kind, Kind::PropertySignature | Kind::MethodSignature) {
                    return error(1070, [text, ""]);
                }
                if kind == Kind::IndexSignature && (modifier != Flags::STATIC || class.is_none()) {
                    return error(1071, [text, ""]);
                }
            }
            if is_type_parameter && !(Flags::IN | Flags::OUT | Flags::CONST).contains(modifier) {
                return error(1273, [text, ""]);
            }
            if modifier == Flags::CONST {
                if kind != Kind::EnumDeclaration && !is_type_parameter {
                    return error_on_node(1248, [text, ""]);
                }
                if is_of_interface_or_alias {
                    return error(1277, [text, ""]);
                }
            } else if modifier == Flags::OVERRIDE {
                if seen.contains(Flags::OVERRIDE) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::AMBIENT) {
                    return error(1243, [text, "declare"]);
                } else if let Some(later) =
                    follows(&[Flags::READONLY, Flags::ACCESSOR, Flags::ASYNC])
                {
                    return error(1029, [text, later]);
                }
                last_override = start;
            } else if ACCESSIBILITY.contains(modifier) {
                if seen.intersects(ACCESSIBILITY) {
                    return error(1028, ["", ""]);
                } else if let Some(later) = follows(&[
                    Flags::OVERRIDE,
                    Flags::STATIC,
                    Flags::ACCESSOR,
                    Flags::READONLY,
                    Flags::ASYNC,
                ]) {
                    return error(1029, [text, later]);
                } else if is_module_element {
                    return error(1044, [text, ""]);
                } else if seen.contains(Flags::ABSTRACT) {
                    if modifier == Flags::PRIVATE {
                        return error(1243, [text, "abstract"]);
                    } else if is_written {
                        return error(1029, [text, "abstract"]);
                    }
                } else if has_private_name {
                    return error(18010, ["", ""]);
                }
            } else if modifier == Flags::STATIC {
                if seen.contains(Flags::STATIC) {
                    return error(1030, [text, ""]);
                } else if let Some(later) =
                    follows(&[Flags::READONLY, Flags::ASYNC, Flags::ACCESSOR])
                {
                    return error(1029, [text, later]);
                } else if is_module_element {
                    return error(1044, [text, ""]);
                } else if kind == Kind::Parameter {
                    return error(1090, [text, ""]);
                } else if seen.contains(Flags::ABSTRACT) {
                    return error(1243, [text, "abstract"]);
                } else if let Some(later) = follows(&[Flags::OVERRIDE]) {
                    return error(1029, [text, later]);
                }
                last_static = start;
            } else if modifier == Flags::ACCESSOR {
                if seen.contains(Flags::ACCESSOR) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::READONLY) {
                    return error(1243, [text, "readonly"]);
                } else if seen.contains(Flags::AMBIENT) {
                    return error(1243, [text, "declare"]);
                } else if kind != Kind::PropertyDeclaration {
                    return error(1275, ["", ""]);
                }
            } else if modifier == Flags::READONLY {
                if seen.contains(Flags::READONLY) {
                    return error(1030, [text, ""]);
                } else if !matches!(
                    kind,
                    Kind::PropertyDeclaration
                        | Kind::PropertySignature
                        | Kind::IndexSignature
                        | Kind::Parameter
                ) {
                    return error(1024, ["", ""]);
                } else if seen.contains(Flags::ACCESSOR) {
                    return error(1243, [text, "accessor"]);
                }
            } else if modifier == Flags::EXPORT {
                if self.files().options.verbatim_module_syntax
                    && !is_ambient
                    && !matches!(
                        kind,
                        Kind::TypeAliasDeclaration
                            | Kind::InterfaceDeclaration
                            | Kind::ModuleDeclaration
                    )
                    && parent == Parent::File
                    && self.xm_emits_commonjs(file)
                {
                    return error(1287, ["", ""]);
                }
                if seen.contains(Flags::EXPORT) {
                    return error(1030, [text, ""]);
                } else if let Some(later) =
                    follows(&[Flags::AMBIENT, Flags::ABSTRACT, Flags::ASYNC])
                {
                    return error(1029, [text, later]);
                } else if class.is_some() {
                    return error(1031, [text, ""]);
                } else if kind == Kind::Parameter {
                    return error(1090, [text, ""]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                }
            } else if modifier == Flags::DEFAULT {
                if is_in_namespace {
                    return error(1319, ["", ""]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                } else if !seen.contains(Flags::EXPORT) && is_written {
                    return error(1029, ["export", text]);
                }
            } else if modifier == Flags::AMBIENT {
                if seen.contains(Flags::AMBIENT) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::ASYNC) {
                    return error(1040, ["async", ""]);
                } else if seen.contains(Flags::OVERRIDE) {
                    return error(1040, ["override", ""]);
                } else if class.is_some() && kind != Kind::PropertyDeclaration {
                    return error(1031, [text, ""]);
                } else if kind == Kind::Parameter {
                    return error(1090, [text, ""]);
                } else if on_using != 0 {
                    return error(on_using, [text, ""]);
                } else if is_parent_ambient && matches!(parent, Parent::Module(_)) {
                    return error(1038, ["", ""]);
                } else if has_private_name {
                    return error(18019, [text, ""]);
                } else if seen.contains(Flags::ACCESSOR) {
                    return error(1243, [text, "accessor"]);
                }
                last_declare = start;
            } else if modifier == Flags::ABSTRACT {
                if seen.contains(Flags::ABSTRACT) {
                    return error(1030, [text, ""]);
                }
                if kind != Kind::ClassDeclaration {
                    if !matches!(
                        kind,
                        Kind::MethodDeclaration | Kind::PropertyDeclaration | Kind::Accessor
                    ) {
                        return error(1242, ["", ""]);
                    }
                    if !class.is_some_and(|class| hir[class].flags.contains(Flags::ABSTRACT)) {
                        let is_property = kind == Kind::PropertyDeclaration;
                        return error(if is_property { 1253 } else { 1244 }, ["", ""]);
                    }
                    if seen.contains(Flags::STATIC) {
                        return error(1243, ["static", text]);
                    }
                    if seen.contains(Flags::PRIVATE) {
                        return error(1243, ["private", text]);
                    }
                    if seen.contains(Flags::ASYNC) {
                        return GrammarError::some(last_async, 0, 1243, ["async", text]);
                    }
                    if let Some(later) = follows(&[Flags::OVERRIDE, Flags::ACCESSOR]) {
                        return error(1029, [text, later]);
                    }
                }
                if has_private_name {
                    return error(18019, [text, ""]);
                }
            } else if modifier == Flags::ASYNC {
                if seen.contains(Flags::ASYNC) {
                    return error(1030, [text, ""]);
                } else if seen.contains(Flags::AMBIENT) || is_parent_ambient {
                    return error(1040, [text, ""]);
                } else if kind == Kind::Parameter {
                    return error(1090, [text, ""]);
                }
                if seen.contains(Flags::ABSTRACT) {
                    return error(1243, [text, "abstract"]);
                }
                last_async = start;
            } else if modifier == Flags::IN || modifier == Flags::OUT {
                if !is_of_class && !is_of_interface_or_alias {
                    return error(1274, [text, ""]);
                } else if seen.contains(modifier) {
                    return error(1030, [text, ""]);
                } else if modifier == Flags::IN && seen.contains(Flags::OUT) {
                    return error(1029, [text, "out"]);
                }
            }
            seen |= modifier;
        }
        let error_at =
            |start: u32, code: u32, modifier| GrammarError::some(start, 0, code, [modifier, ""]);
        if kind == Kind::Constructor {
            return if seen.contains(Flags::STATIC) {
                error_at(last_static, 1089, "static")
            } else if seen.contains(Flags::OVERRIDE) {
                error_at(last_override, 1089, "override")
            } else if seen.contains(Flags::ASYNC) {
                error_at(last_async, 1089, "async")
            } else {
                None
            };
        }
        if matches!(
            kind,
            Kind::ImportDeclaration | Kind::ImportEqualsDeclaration
        ) && seen.contains(Flags::AMBIENT)
        {
            return error_at(last_declare, 1079, "declare");
        }
        // `ModifierFlagsParameterPropertyModifier`
        if let HasModifiers::Parameter(p) = node
            && seen.intersects(ACCESSIBILITY | Flags::READONLY | Flags::OVERRIDE)
        {
            let is_binding_pattern =
                |pat: &Pat| matches!(pat.kind, PatKind::Object(_) | PatKind::Array(_));
            if hir
                .pats
                .get(hir[p].pat.idx())
                .is_some_and(is_binding_pattern)
            {
                return error_on_node(1187, ["", ""]);
            } else if hir[p].flags.contains(Flags::REST) {
                return error_on_node(1317, ["", ""]);
            }
        }
        // `checkGrammarAsyncModifier`
        let takes_async = matches!(kind, Kind::MethodDeclaration | Kind::FunctionDeclaration);
        if seen.contains(Flags::ASYNC) && !takes_async {
            return error_at(last_async, 1042, "async");
        }
        None
    }
}
