//! `checkGrammarModifiers` (TypeScript 7.0.2, grammarchecks.go), on `node.Modifiers()` as stored in
//! the HIR.

use super::*;
use crate::bind::{Decl, MemberOwner, Parent};
use smallvec::SmallVec;

/// The arguments of `grammarErrorOnNode`: the span of the node, the message code, and the message
/// arguments. `""`: no argument. An `end` of 0 means the end of the token at `start`.
#[derive(Copy, Clone)]
pub(super) struct GrammarError {
    start: u32,
    end: u32,
    code: u32,
    args: [&'static str; 2],
    /// `AddRelatedInfo(createDiagnosticForNode(firstDecorator, ..))`: the span of that decorator.
    /// `(0, 0)`: there is no related information.
    first_decorator: (u32, u32),
}

impl GrammarError {
    fn some(start: u32, end: u32, code: u32, args: [&'static str; 2]) -> Option<Self> {
        Some(GrammarError {
            start,
            end,
            code,
            args,
            first_decorator: (0, 0),
        })
    }
}

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);

/// `CanHaveIllegalDecorators`
fn can_have_illegal_decorators(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::FunctionDeclaration
            | Kind::Constructor
            | Kind::IndexSignature
            | Kind::ClassStaticBlockDeclaration
            | Kind::MissingDeclaration
            | Kind::VariableStatement
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::EnumDeclaration
            | Kind::ModuleDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ImportDeclaration
            | Kind::JSImportDeclaration
            | Kind::NamespaceExportDeclaration
            | Kind::ExportDeclaration
            | Kind::ExportAssignment
    )
}

fn is_decorator(modifier: &Modifier) -> bool {
    matches!(modifier.kind, ModifierKind::Decorator(_))
}

impl Checker<'_, '_> {
    /// `checkGrammarModifiers`
    pub(super) fn check_grammar_modifiers(&mut self, file: FileId, node: impl ToNode) -> bool {
        // `grammarErrorOnNode`
        if has_parse_diagnostics(self.hir(file)) {
            return false;
        }
        let error = self.grammar_error_in_modifiers(file, node);
        error.is_some_and(|error| self.report_grammar_error(file, error))
    }

    fn report_grammar_error(&mut self, file: FileId, error: GrammarError) -> bool {
        let args = error.args.iter().filter(|arg| !arg.is_empty());
        let args: SmallVec<[Arg<'_>; 2]> = args.map(|&arg| Arg::Text(arg)).collect();
        let reported = self.error_at((file, error.start, error.end), error.code, &args);
        if let (start, end @ 1..) = error.first_decorator {
            reported.add_related_info(Reported::bare((file, start, end), 1486));
        }
        true
    }

    /// The same for a statement that has modifiers, with the checks that depend on the result.
    pub(super) fn check_grammar_modifiers_of_statement(&mut self, file: FileId, s: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        let statement = &hir[s];
        if let StmtKind::Class(class) = statement.kind {
            self.check_grammar_class_like_declaration(file, class);
            return;
        }
        let error = self.grammar_error_in_modifiers(file, s);
        // `checkInterfaceDeclaration`: `if !c.checkGrammarModifiers(node) { .. }`
        if error.is_some() && matches!(statement.kind, StmtKind::Interface(_)) {
            self.take_back_grammar_errors_of_heritage_clauses(file, hir.node(s));
        }
        // `checkImportDeclaration`, `checkExportDeclaration`, `checkExportAssignment`: these accept
        // no modifiers.
        let takes_none = match (statement.kind, bound.stmt_parent[s.idx()]) {
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
        if let Some(error) = error.or_else(|| takes_none.filter(|error| error.code != 0)) {
            self.report_grammar_error(file, error);
        }
    }

    /// `checkGrammarClassLikeDeclaration`, for a class that has modifiers. The front end reports
    /// the heritage clauses and the type parameter list. No query may be in progress: it takes
    /// diagnostics back.
    pub(super) fn check_grammar_class_like_declaration(&mut self, file: FileId, class: ClassId) {
        // `checkGrammarClassDeclarationHeritageClauses`: `!c.checkGrammarModifiers(node) && ..`
        if !self.check_grammar_modifiers(file, class) {
            return;
        }
        let node = self.hir(file).node(class);
        self.take_back_grammar_errors_of_heritage_clauses(file, node);
        // `.. || c.checkGrammarTypeParameterList(..)`: the front end does not report the list after
        // an error in the clauses that ends their check.
        self.check_grammar_type_parameter_list_of_class(file, class);
    }

    /// Takes back what the front end reported for `node`, a class or an interface, in place of
    /// `checkGrammarClassDeclarationHeritageClauses` or `checkGrammarInterfaceDeclaration`. That is
    /// reported between the elements of the clauses, at the first token of an element, and for the
    /// type arguments of the base class.
    fn take_back_grammar_errors_of_heritage_clauses(&mut self, file: FileId, node: Node) {
        let hir = self.hir(file);
        // The spans of what is checked on its own.
        let mut others: SmallVec<[(u32, u32); 16]> = SmallVec::new();
        let mut open: SmallVec<[Node; 4]> = SmallVec::new();
        open.push(node);
        while let Some(parent) = open.pop() {
            hir.for_each_child(parent, &mut |child| {
                match child.part() {
                    Some(Part::Extends | Part::Implements | Part::Base) => open.push(child),
                    _ => others.push((hir.start(child), self.end_of_node(file, child))),
                }
                false
            });
        }
        let whole = hir.start(node)..self.end_of_node(file, node);
        self.reported.retain(|d| {
            d.file != file
                || !matches!(d.code, 1009 | 1097 | 1099 | 1172..=1176 | 1326)
                || !whole.contains(&d.start)
                || others
                    .iter()
                    .any(|&(start, end)| start < d.start && d.start < end)
        });
    }

    /// `checkGrammarTypeParameterList`: `<>` after the name of a class, or after `class`.
    fn check_grammar_type_parameter_list_of_class(&mut self, file: FileId, class: ClassId) -> bool {
        let hir = self.hir(file);
        let (text, name) = (&hir.text[..], hir[class].name_pos as usize);
        let open = skip_trivia(text, name + word_at(text, name).len());
        let close = skip_trivia(text, open + 1);
        text.get(open) == Some(&b'<')
            && text.get(close) == Some(&b'>')
            && self.grammar_error_at((file, open as u32, close as u32 + 1), 1098, &[])
    }

    /// The same for a member that has modifiers.
    pub(super) fn check_grammar_modifiers_of_member(&mut self, file: FileId, m: MemberId) {
        let member = &self.hir(file)[m];
        // `checkGrammarIndexSignature`: `c.checkGrammarModifiers(node) || c.checkGrammarIndexSignatureParameters(node)`. The front
        // end reports the parameters.
        if self.check_grammar_modifiers(file, m) && member.kind == MemberKind::IndexSignature {
            let signature = member.start..member.loc.end;
            self.reported.retain(|d| {
                !matches!(d.code, 1017..=1020 | 1022 | 1025 | 1096) || !signature.contains(&d.start)
            });
        }
    }

    /// `HasDecorators(accessors.FirstAccessor) && node == accessors.SecondAccessor`, for the
    /// accessor `m`: `GetAllAccessorDeclarationsForDeclaration`, among the declarations of
    /// `getSymbolOfDeclaration(node)`.
    fn is_second_accessor_after_decorated_one(&mut self, file: FileId, m: MemberId) -> bool {
        let hir = self.hir(file);
        let other_kind = match hir[m].kind {
            MemberKind::Setter => MemberKind::Getter,
            _ => MemberKind::Setter,
        };
        let declarations = self.declarations_of_symbol_of_declaration(file, Decl::Member(m));
        let other_accessor = declarations
            .iter()
            .find_map(|&declaration| match declaration {
                (of, Decl::Member(other)) if of == file && hir[other].kind == other_kind => {
                    Some(&hir[other])
                }
                _ => None,
            });
        other_accessor.is_some_and(|other| {
            other.start < hir[m].start
                && hir.modifier_list(other.modifiers).iter().any(is_decorator)
        })
    }

    /// `grammarErrorOnNode(node, ..)`
    fn grammar_error_on(
        &self,
        file: FileId,
        node: Node,
        code: u32,
        args: [&'static str; 2],
    ) -> Option<GrammarError> {
        let (start, end) = match self.hir(file).data(node) {
            NodeData::Stmt(s) => (self.hir(file)[s].start, 0),
            _ => self.get_error_range_for_node(file, node),
        };
        GrammarError::some(start, end, code, args)
    }

    /// The error `checkGrammarModifiers(node)` reports.
    pub(super) fn grammar_error_in_modifiers(
        &mut self,
        file: FileId,
        node: impl ToNode,
    ) -> Option<GrammarError> {
        self.grammar_error_in_modifiers_of_node(file, self.hir(file).node(node))
    }

    /// `grammar_error_in_modifiers` for the node `location`.
    fn grammar_error_in_modifiers_of_node(
        &mut self,
        file: FileId,
        location: Node,
    ) -> Option<GrammarError> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let node = hir.data(location);
        let only_async;
        // `node.ModifierNodes()`
        let modifiers = match node {
            NodeData::Stmt(s) => hir.modifier_list(hir[s].modifiers),
            NodeData::Member(m) => hir.modifier_list(hir[m].modifiers),
            NodeData::Prop(p) => hir.modifier_list(hir.prop_modifiers(p)),
            NodeData::Param(p) => hir.modifier_list(hir.param_modifiers(p)),
            NodeData::TypeParam(p) => hir.modifier_list(hir[p].modifiers),
            NodeData::Expr(e) => match hir[e].kind {
                ExprKind::Class(class) => hir.modifier_list(hir[class].modifiers),
                // `parseFunctionExpression`, `parseModifiersForArrowFunction`: `async`, which is
                // the first token, is the only modifier there can be.
                ExprKind::Fn(function) if hir[function].flags.contains(Flags::ASYNC) => {
                    only_async = [Modifier {
                        kind: ModifierKind::Keyword(Flags::ASYNC),
                        pos: hir[function].start,
                    }];
                    &only_async[..]
                }
                _ => return None,
            },
            _ => return None,
        };
        if modifiers.is_empty() {
            return None;
        }
        let kind = hir.kind(location);
        // The binder reports those of `export as namespace N`. `parseTypeMember` parses none before
        // a signature without a name.
        if matches!(
            kind,
            Kind::NamespaceExportDeclaration | Kind::CallSignature | Kind::ConstructSignature
        ) {
            return None;
        }
        // `node.Parent`, of a type parameter
        let is_type_parameter = kind == Kind::TypeParameter;
        let around = if is_type_parameter {
            hir.kind(hir.parent(location))
        } else {
            Kind::Unknown
        };
        let parent = match node {
            NodeData::Stmt(s) => bound.stmt_parent[s.idx()],
            _ => Parent::None,
        };
        // `IsClassLike(node.Parent)`
        let class = match node {
            NodeData::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => Some(class),
                _ => None,
            },
            _ => None,
        };
        // `IsPrivateIdentifier(node.Name())`. Outside a class the key of `#a` is `PropKey::None`.
        let has_private_name = match node {
            NodeData::Member(m) => is_private_name_at(hir, hir[m].name_pos),
            NodeData::Prop(p) => is_private_name_at(hir, hir[p].pos),
            _ => false,
        };
        // `grammarErrorOnFirstToken(node, ..)`
        let error_on_first_token =
            |code: u32| GrammarError::some(hir.start(location), 0, code, ["", ""]);
        // `node.Parent.Kind == KindModuleBlock || node.Parent.Kind == KindSourceFile`
        let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
        // `container.Kind == KindModuleDeclaration && !IsAmbientModule(container)`
        let is_in_namespace =
            matches!(parent, Parent::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)));
        // `reportObviousModifierErrors`, `findFirstIllegalModifier`: the only modifier that may come first.
        let allowed_first = match kind {
            // `checkGrammarModuleElementContext`: elsewhere the check of these bails out before
            // their modifiers are checked.
            Kind::ModuleDeclaration
            | Kind::ImportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ExportDeclaration => match is_module_element {
                true => None,
                false => return None,
            },
            // `checkExportAssignment`: the same applies to one in a namespace.
            Kind::ExportAssignment => match is_module_element && !is_in_namespace {
                true => None,
                false => return None,
            },
            Kind::ClassStaticBlockDeclaration
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment => Some(Flags::empty()),
            _ if is_module_element => None,
            Kind::FunctionDeclaration => Some(Flags::ASYNC),
            Kind::ClassDeclaration => Some(Flags::ABSTRACT),
            Kind::EnumDeclaration => Some(Flags::CONST),
            Kind::ClassExpression
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::VariableStatement => Some(Flags::empty()),
            _ => None,
        };
        // `reportObviousDecoratorErrors`
        if can_have_illegal_decorators(kind)
            && let Some(decorator) = modifiers.iter().find(|modifier| is_decorator(modifier))
        {
            return GrammarError::some(decorator.pos, 0, 1206, ["", ""]);
        }
        if let Some(allowed) = allowed_first
            && let Some(first) = modifiers.iter().find(|modifier| !is_decorator(modifier))
            && first.kind != ModifierKind::Keyword(allowed)
        {
            return GrammarError::some(first.pos, 0, 1184, ["", ""]);
        }
        // `node.Name()`, of a parameter
        let parameter_name = match node {
            NodeData::Param(p) => hir.pats.get(hir[p].pat.idx()).map(|name| name.kind),
            _ => None,
        };
        // `IsThisParameter(node)`
        if matches!(parameter_name, Some(PatKind::Ident(known::this))) {
            return error_on_first_token(1433);
        }
        // `node.Parent.Flags&NodeFlagsAmbient`
        let is_parent_ambient = || hir.is_ambient(hir.parent(location));
        // `blockScopeKind`: the code for a modifier that a `using` or an `await using` declaration cannot have.
        let on_using = match node {
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::Var(decls) => match decls.iter().next().map(|d| hir[d].kind) {
                    Some(VarKind::Using) => 1491,
                    Some(VarKind::AwaitUsing) => 1495,
                    _ => 0,
                },
                _ => 0,
            },
            _ => 0,
        };
        let mut seen = Flags::empty();
        let (mut last_static, mut last_declare, mut last_async, mut last_override) = (0, 0, 0, 0);
        // The span of `firstDecorator`.
        let mut first_decorator = None;
        let (mut saw_export_before_decorators, mut has_leading_decorators) = (false, false);
        for &Modifier {
            kind: written,
            pos: start,
        } in modifiers
        {
            let modifier = match written {
                ModifierKind::Keyword(modifier) => modifier,
                ModifierKind::Decorator(e) => {
                    // `!NodeCanBeDecorated(..)`
                    if bound.refused_decorators.contains(&e) {
                        let function = hir.fns.get(hir.function_of(location).idx());
                        let is_overload =
                            kind == Kind::MethodDeclaration && !function.is_some_and(has_body);
                        return error_on_first_token(if is_overload { 1249 } else { 1206 });
                    }
                    if let NodeData::Member(m) = node
                        && hir.legacy_decorators
                        && matches!(kind, Kind::GetAccessor | Kind::SetAccessor)
                        && self.is_second_accessor_after_decorated_one(file, m)
                    {
                        return error_on_first_token(1207);
                    }
                    let end = self.end_of_expr(file, e);
                    if !(Flags::EXPORT | Flags::DEFAULT).contains(seen) {
                        return GrammarError::some(start, end, 1206, ["", ""]);
                    }
                    if has_leading_decorators && !seen.is_empty() {
                        return Some(GrammarError {
                            start,
                            end,
                            code: 8038,
                            args: ["", ""],
                            first_decorator: first_decorator.unwrap_or_default(),
                        });
                    }
                    if seen.is_empty() {
                        has_leading_decorators = true;
                    } else if seen.contains(Flags::EXPORT) {
                        saw_export_before_decorators = true;
                    }
                    first_decorator.get_or_insert((start, end));
                    continue;
                }
            };
            // `modifier.Flags&NodeFlagsReparsed == 0`. A modifier synthesized from a JSDoc tag has
            // the length of the tag.
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
                    return self.grammar_error_on(file, location, 1248, [text, ""]);
                }
                if is_type_parameter
                    && !around.is_function_like_declaration()
                    && !around.is_class_like()
                    && !matches!(
                        around,
                        Kind::FunctionType
                            | Kind::ConstructorType
                            | Kind::CallSignature
                            | Kind::ConstructSignature
                            | Kind::MethodSignature
                    )
                {
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
                    && !hir.is_ambient(location)
                    && !matches!(
                        kind,
                        Kind::TypeAliasDeclaration
                            | Kind::InterfaceDeclaration
                            | Kind::ModuleDeclaration
                    )
                    && parent == Parent::File
                    && self.modules_emits_commonjs(file)
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
                } else if saw_export_before_decorators && let Some((start, end)) = first_decorator {
                    return GrammarError::some(start, end, 1206, ["", ""]);
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
                } else if matches!(parent, Parent::Module(_)) && is_parent_ambient() {
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
                if !matches!(kind, Kind::ClassDeclaration | Kind::ConstructorType) {
                    if !matches!(
                        kind,
                        Kind::MethodDeclaration
                            | Kind::PropertyDeclaration
                            | Kind::GetAccessor
                            | Kind::SetAccessor
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
                } else if seen.contains(Flags::AMBIENT) || is_parent_ambient() {
                    return error(1040, [text, ""]);
                } else if kind == Kind::Parameter {
                    return error(1090, [text, ""]);
                }
                if seen.contains(Flags::ABSTRACT) {
                    return error(1243, [text, "abstract"]);
                }
                last_async = start;
            } else if modifier == Flags::IN || modifier == Flags::OUT {
                if !around.is_class_like()
                    && !matches!(
                        around,
                        Kind::InterfaceDeclaration
                            | Kind::TypeAliasDeclaration
                            | Kind::JSTypeAliasDeclaration
                    )
                {
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
            Kind::ImportDeclaration | Kind::JSImportDeclaration | Kind::ImportEqualsDeclaration
        ) && seen.contains(Flags::AMBIENT)
        {
            return error_at(last_declare, 1079, "declare");
        }
        // `ModifierFlagsParameterPropertyModifier`
        if let NodeData::Param(p) = node
            && seen.intersects(ACCESSIBILITY | Flags::READONLY | Flags::OVERRIDE)
        {
            if matches!(parameter_name, Some(PatKind::Object(_) | PatKind::Array(_))) {
                return self.grammar_error_on(file, location, 1187, ["", ""]);
            } else if hir[p].flags.contains(Flags::REST) {
                return self.grammar_error_on(file, location, 1317, ["", ""]);
            }
        }
        // `checkGrammarAsyncModifier`
        let takes_async = matches!(
            kind,
            Kind::MethodDeclaration
                | Kind::FunctionDeclaration
                | Kind::FunctionExpression
                | Kind::ArrowFunction
        );
        if seen.contains(Flags::ASYNC) && !takes_async {
            return error_at(last_async, 1042, "async");
        }
        None
    }
}
