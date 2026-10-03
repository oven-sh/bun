//! `isolatedDeclarations`: 9007 to 9039, what the declaration file cannot be written for from the syntax of the file alone.
//!
//! These are declaration diagnostics. tsgo finds them by writing the declaration file: `DeclarationTransformer`
//! (`transformers/declarations/transform.go`) goes over what can be seen from outside the file and asks the node builder for the types
//! that are not written. The node builder reads a type off the syntax (`pseudochecker`), holds it against what the checker says
//! (`pseudoTypeEquivalentToType`) and writes it (`pseudoTypeToNode`), or else writes what the checker says (`typeToTypeNode`). Whatever
//! takes the checker it reports (`ReportInferenceFallback`), and `createGetIsolatedDeclarationErrors` (`diagnostics.go`) makes the error.
//! The node builder is the printer (print.rs), which this listens to. What it writes is dropped: the way is gone for what is reported
//! on it and for the declarations that turn out to be needed on it (`lateMarkedStatements`), which are gone over in their turn.
//!
//! Left out: what CommonJS exports and `this.x = ..` declare in JavaScript, and the errors about names that cannot
//! be reached (4xxx), which `TrackSymbol` reports.

use super::decl::Predicate;
use super::enclosing_declaration::Enclosing;
use super::sink::held;
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, PatParent};
use bun_core::strings;
use std::ops::ControlFlow;

/// `PseudoType`
pub(super) enum Pseudo {
    Direct(TypeNodeId),
    Inferred {
        of: Node,
        errors: Vec<Node>,
        is_signature_return: bool,
    },
    NoResult(Node),
    MaybeConst {
        at: ExprId,
        constant: Box<Pseudo>,
        regular: Box<Pseudo>,
    },
    Union(Vec<Pseudo>),
    Undefined,
    Null,
    String,
    Number,
    BigInt,
    Boolean,
    False,
    True,
    Signature {
        func: FnId,
        params: Vec<PseudoParam>,
        returns: Box<Pseudo>,
    },
    Tuple(Vec<Pseudo>),
    Object(Vec<PseudoElement>),
    Literal(ExprId),
}

/// `PseudoParameter`. A leading `this` is none: its type is written, and is gone over where the others are written.
pub(super) struct PseudoParam {
    pub(super) param: ParamId,
    pub(super) is_optional: bool,
    pub(super) ty: Pseudo,
}

/// `PseudoObjectElement`
pub(super) struct PseudoElement {
    pub(super) prop: PropId,
    pub(super) kind: PseudoElementKind,
}

pub(super) enum PseudoElementKind {
    Method {
        func: FnId,
        params: Vec<PseudoParam>,
        returns: Pseudo,
    },
    Property(Pseudo),
    Setter {
        param: PseudoParam,
    },
    Getter {
        ty: Pseudo,
    },
}

/// An error, with all that is said about it.
struct Said {
    start: u32,
    end: u32,
    code: u32,
    args: Vec<Vec<u8>>,
    related: Vec<Reported>,
    /// It was reported more than once.
    is_merged: bool,
}

/// What the pseudochecker and `createGetIsolatedDeclarationErrors` go by, and what they have made, for one file.
pub(super) struct Emit {
    file: FileId,
    said: Vec<Said>,
    /// What `pseudoTypeEquivalentToType` has for `ReportInferenceFallback`, in order. Whoever asked it passes them on.
    pub(super) inference_fallbacks: Vec<Node>,
}

impl Emit {
    pub(super) fn new(file: FileId) -> Emit {
        Emit {
            file,
            said: Vec::new(),
            inference_fallbacks: Vec::new(),
        }
    }

    pub(super) fn has_diagnostics(&self) -> bool {
        !self.said.is_empty()
    }
}

impl<'p> Checker<'p> {
    /// `state.isolatedDeclarations`, for the transformer of `file`.
    pub(super) fn new_isolated_declarations(&self, file: FileId) -> Option<Emit> {
        let is_on = self.files().options.isolated_declarations
            && !self.hir(file).has_errors
            && !strings::contains(&self.files().module(file).path, b"/node_modules/");
        is_on.then(|| Emit::new(file))
    }

    /// What the transformer has reported is said.
    pub(super) fn finish_isolated_declarations(&mut self, tx: Emit) {
        self.iso_report_all(tx.file, tx.said);
    }

    /// `SortAndDeduplicateDiagnostics`, `compactAndMergeRelatedInfos`: what is reported twice is one error, with the related
    /// information of both in the order of the file.
    fn iso_report_all(&mut self, file: FileId, mut said: Vec<Said>) {
        said.sort_by(|a, b| {
            (a.start, a.end, a.code)
                .cmp(&(b.start, b.end, b.code))
                .then_with(|| a.args.cmp(&b.args))
        });
        let mut all: Vec<Said> = Vec::new();
        for next in said {
            match all.last_mut() {
                Some(last)
                    if (last.start, last.end, last.code) == (next.start, next.end, next.code)
                        && last.args == next.args =>
                {
                    last.related.extend(next.related);
                    last.is_merged = true;
                }
                _ => all.push(next),
            }
        }
        for mut one in all {
            if one.is_merged {
                one.related.sort_by(|a, b| {
                    (a.file, a.start, a.end)
                        .cmp(&(b.file, b.start, b.end))
                        .then(a.code.cmp(&b.code))
                        .then_with(|| a.args.cmp(&b.args))
                });
                one.related.dedup();
            }
            let at = (file, one.start, one.end);
            self.add_diagnostic(Reported::new(at, one.code, held(one.args)))
                .related_information = one.related;
        }
    }

    // ───────────────────────────── the tree ─────────────────────────────

    /// `IsPrimitiveLiteralValue`, of `e` itself, whatever parentheses it is in.
    pub(super) fn iso_is_primitive_literal(
        &self,
        file: FileId,
        e: ExprId,
        with_bigint: bool,
    ) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            ExprKind::BigInt(_) => with_bigint,
            ExprKind::Unary {
                op: op @ (UnOp::Minus | UnOp::Plus),
                operand,
            } => {
                !is_parenthesized(self.hir(file), operand)
                    && match hir[operand].kind {
                        ExprKind::Number(_) => true,
                        ExprKind::BigInt(_) => with_bigint && op == UnOp::Minus,
                        _ => false,
                    }
            }
            _ => false,
        }
    }

    /// `HasDynamicName`: the expression in the `[..]` of a name that the binder cannot tell.
    fn iso_dynamic_name(&self, file: FileId, key: PropKey) -> Option<ExprId> {
        match key {
            PropKey::Computed(e) if is_dynamic_name(self.hir(file), e) => Some(e),
            _ => None,
        }
    }

    /// `IsDefinitelyReferenceToGlobalSymbolObject`
    fn iso_is_global_symbol_reference(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if !is_entity_name_expression(self.hir(file), e) {
            return false;
        }
        let ExprKind::Dot { obj, .. } = hir[e].kind else {
            return false;
        };
        match hir[obj].kind {
            ExprKind::Ident(known::Symbol) => {
                let global = self.files().global(known::Symbol, SymFlags::VALUE);
                global.is_some() && self.symbol_of_identifier(file, obj, known::Symbol) == global
            }
            ExprKind::Dot {
                obj: root,
                name: known::Symbol,
                ..
            } => {
                matches!(hir[root].kind, ExprKind::Ident(known::globalThis))
                    && self.symbol_of_identifier(file, root, known::globalThis)
                        == Some(self.files().global_this_symbol)
            }
            _ => false,
        }
    }

    /// `IsDeclaration`, of what an expression can be directly in.
    pub(super) fn iso_is_declaration(hir: &hir::File, node: Node) -> bool {
        match hir.data(node) {
            NodeData::VarDecl(_)
            | NodeData::Param(_)
            | NodeData::Member(_)
            | NodeData::Prop(_)
            | NodeData::PatProp(_)
            | NodeData::PatElem(_) => true,
            NodeData::Stmt(s) => matches!(
                hir[s].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            ),
            NodeData::Expr(e) => matches!(
                hir[e].kind,
                ExprKind::Fn(_)
                    | ExprKind::Class(_)
                    | ExprKind::Binary { .. }
                    | ExprKind::Assign { .. }
                    | ExprKind::Call(_)
            ),
            _ => false,
        }
    }

    // ───────────────────────────── the errors ─────────────────────────────

    fn iso_diagnostic(&self, file: FileId, node: Node, code: u32) -> Said {
        let (start, end) = self.get_error_range_for_node(file, node);
        Said {
            start,
            end,
            code,
            args: Vec::new(),
            related: Vec::new(),
            is_merged: false,
        }
    }

    fn iso_related(&self, file: FileId, node: Node, code: u32, args: Vec<Vec<u8>>) -> Reported {
        let (start, end) = self.get_error_range_for_node(file, node);
        Reported::new((file, start, end), code, held(args))
    }

    /// `GetTextOfNode(node.Name())`
    fn iso_name_text(&self, file: FileId, node: Node) -> Vec<u8> {
        let hir = self.hir(file);
        let name = hir.name(node);
        self.source_text(file, hir.start(name), self.end_of_node(file, name))
    }

    /// `getErrorByDeclarationKind`, `getRelatedSuggestionByDeclarationKind`. 0: there is none.
    fn iso_codes_of_declaration(kind: Kind) -> (u32, u32) {
        match kind {
            Kind::FunctionExpression | Kind::ArrowFunction => (9007, 9030),
            Kind::FunctionDeclaration => (9007, 9031),
            Kind::MethodDeclaration => (9008, 9034),
            Kind::ConstructSignature => (9008, 9031),
            Kind::GetAccessor => (9009, 9032),
            Kind::SetAccessor => (9009, 9033),
            Kind::VariableDeclaration => (9010, 9027),
            Kind::Parameter => (9011, 9028),
            Kind::PropertyDeclaration | Kind::PropertySignature => (9012, 9029),
            Kind::SpreadAssignment => (9015, 0),
            Kind::ShorthandPropertyAssignment => (9016, 0),
            Kind::ArrayLiteralExpression => (9017, 0),
            Kind::SpreadElement => (9018, 0),
            Kind::ExportAssignment => (9037, 9036),
            Kind::ComputedPropertyName => (9038, 0),
            _ => (0, 0),
        }
    }

    /// The suggestion at `declaration`: `Add a type annotation to the variable {0}.` and the like.
    fn iso_suggestion(&self, file: FileId, declaration: Node) -> Option<Reported> {
        let code = Self::iso_codes_of_declaration(self.hir(file).kind(declaration)).1;
        let args = match code {
            0 => return None,
            9027..=9029 => vec![self.iso_name_text(file, declaration)],
            _ => Vec::new(),
        };
        Some(self.iso_related(file, declaration, code, args))
    }

    /// `findNearestDeclaration`
    fn iso_nearest_declaration(&self, file: FileId, node: Node) -> Node {
        let hir = self.hir(file);
        // `isDeclarationEnoughForErrors`
        let result = hir.find_ancestor(node, |n| {
            let kind = hir.kind(n);
            is_statement(hir, n)
                || matches!(
                    kind,
                    Kind::VariableDeclaration | Kind::PropertyDeclaration | Kind::Parameter
                )
        });
        match hir.kind(result) {
            Kind::ExportAssignment => result,
            // `isFunctionLikeAndNotConstructor`
            Kind::ReturnStatement => hir.find_ancestor(result, |n| {
                let kind = hir.kind(n);
                kind.is_function_like_declaration() && kind != Kind::Constructor
            }),
            _ if is_statement(hir, result) => Node::NONE,
            _ => result,
        }
    }

    /// `addParentDeclarationRelatedInfo`
    fn iso_add_parent_declaration(&self, file: FileId, node: Node, said: &mut Said) {
        let declaration = self.iso_nearest_declaration(file, node);
        said.related.extend(self.iso_suggestion(file, declaration));
    }

    /// `createExpressionErrorEx`. `message` overrides TS9013.
    fn iso_expression_error(&self, file: FileId, node: Node, message: Option<u32>) -> Said {
        let hir = self.hir(file);
        let declaration = self.iso_nearest_declaration(file, node);
        if declaration.is_none() {
            return self.iso_diagnostic(file, node, message.unwrap_or(9013));
        }
        // `isParentForIDDIagnostic`
        let parent = hir.find_ancestor_or_quit(hir.parent(node), |n| match hir.kind(n) {
            Kind::ExportAssignment => ControlFlow::Break(true),
            _ if is_statement(hir, n) => ControlFlow::Break(false),
            Kind::ParenthesizedExpression | Kind::AsExpression | Kind::TypeAssertionExpression => {
                ControlFlow::Continue(())
            }
            _ => ControlFlow::Break(true),
        });
        let is_direct = parent == declaration;
        let code = match is_direct {
            true => Self::iso_codes_of_declaration(hir.kind(declaration)).0,
            false => 9013,
        };
        let mut said = self.iso_diagnostic(file, node, message.unwrap_or(code));
        said.related.extend(self.iso_suggestion(file, declaration));
        if !is_direct {
            said.related
                .push(self.iso_related(file, node, 9035, Vec::new()));
        }
        said
    }

    /// `createAccessorTypeError`
    fn iso_accessor_error(&mut self, file: FileId, node: Node) -> Said {
        let hir = self.hir(file);
        let func = hir.function_of(node);
        let (getter, setter) = self.iso_accessors(file, func);
        let target = match hir[func].params.iter().next() {
            Some(param) if hir[func].kind == FnKind::Setter => hir.node(param),
            _ => node,
        };
        let mut said = self.iso_diagnostic(file, target, 9009);
        for (accessor, code) in [(setter, 9033), (getter, 9032)] {
            let related = accessor.map(|f| self.iso_related(file, hir.node(f), code, Vec::new()));
            said.related.extend(related);
        }
        said
    }

    /// `createReturnTypeError`
    fn iso_return_type_error(&self, file: FileId, node: Node) -> Said {
        let (code, suggestion) = Self::iso_codes_of_declaration(self.hir(file).kind(node));
        let mut said = self.iso_diagnostic(file, node, code);
        self.iso_add_parent_declaration(file, node, &mut said);
        said.related
            .push(self.iso_related(file, node, suggestion, Vec::new()));
        said
    }

    /// `createObjectLiteralError`, `createArrayLiteralError`
    fn iso_literal_error(&self, file: FileId, node: Node) -> Said {
        let code = Self::iso_codes_of_declaration(self.hir(file).kind(node)).0;
        let mut said = self.iso_diagnostic(file, node, code);
        self.iso_add_parent_declaration(file, node, &mut said);
        said
    }

    /// `createVariableOrPropertyError`
    fn iso_variable_or_property_error(&self, file: FileId, node: Node) -> Said {
        let code = Self::iso_codes_of_declaration(self.hir(file).kind(node)).0;
        let mut said = self.iso_diagnostic(file, node, code);
        said.related.extend(self.iso_suggestion(file, node));
        said
    }

    /// `createParameterError`
    fn iso_parameter_error(&mut self, file: FileId, node: Node, p: ParamId) -> Said {
        let hir = self.hir(file);
        if hir.kind(hir.parent(node)) == Kind::SetAccessor {
            return self.iso_accessor_error(file, hir.parent(node));
        }
        let adds_undefined = self.requires_adding_implicit_undefined(file, p, None);
        if !adds_undefined && hir.initializer(node).is_some() {
            return self.iso_expression_error(file, hir.initializer(node), None);
        }
        let mut said = self.iso_diagnostic(file, node, if adds_undefined { 9025 } else { 9011 });
        said.related.extend(self.iso_suggestion(file, node));
        said
    }

    /// `createGetIsolatedDeclarationErrors`
    fn iso_error_for(&mut self, file: FileId, node: Node) -> Said {
        let hir = self.hir(file);
        if hir.find_ancestor_kind(node, Kind::HeritageClause).is_some() {
            return self.iso_diagnostic(file, node, 9021);
        }
        let (kind, data) = (hir.kind(node), hir.data(node));
        // `IsPartOfTypeNode`, `IsTypeQueryNode`, `IsEntityName`, `IsEntityNameExpression`: `createEntityInTypeNodeError`
        if matches!(kind, Kind::Identifier | Kind::QualifiedName)
            || matches!(data, NodeData::Type(_))
            || matches!(data, NodeData::Expr(e) if is_property_access_entity_name_expression(hir, e))
        {
            let mut said = self.iso_diagnostic(file, node, 9039);
            said.args = vec![self.source_text(file, said.start, said.end)];
            self.iso_add_parent_declaration(file, node, &mut said);
            return said;
        }
        match (kind, data) {
            (Kind::GetAccessor | Kind::SetAccessor, _) => self.iso_accessor_error(file, node),
            (
                Kind::ComputedPropertyName
                | Kind::ShorthandPropertyAssignment
                | Kind::SpreadAssignment
                | Kind::ArrayLiteralExpression
                | Kind::SpreadElement,
                _,
            ) => self.iso_literal_error(file, node),
            (
                Kind::MethodDeclaration
                | Kind::ConstructSignature
                | Kind::FunctionExpression
                | Kind::ArrowFunction
                | Kind::FunctionDeclaration,
                _,
            ) => self.iso_return_type_error(file, node),
            (Kind::BindingElement, _) => self.iso_diagnostic(file, node, 9019),
            (Kind::PropertyDeclaration | Kind::VariableDeclaration, _) => {
                self.iso_variable_or_property_error(file, node)
            }
            (_, NodeData::Param(p)) => self.iso_parameter_error(file, node, p),
            (Kind::PropertyAssignment, _) if hir.initializer(node).is_some() => {
                self.iso_expression_error(file, hir.initializer(node), None)
            }
            (Kind::ClassExpression, _) => self.iso_expression_error(file, node, Some(9022)),
            _ => self.iso_expression_error(file, node, None),
        }
    }

    /// `getTypeOfSymbol(getSymbolOfDeclaration(node))`. `None`: `node` declares nothing.
    pub(super) fn iso_type_of_declared(&mut self, file: FileId, node: Node) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_pattern = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_)).then_some(pat);
        let pat = match hir.data(node) {
            NodeData::Expr(e) => {
                return match hir[e].kind {
                    ExprKind::Fn(_) | ExprKind::Class(_) => Some(self.type_of_expr(file, e)),
                    ExprKind::Assign { value, .. } if bound.is_expando_declaration(e) => {
                        let ty = self.type_of_expr(file, value);
                        let ty = self.widen_literal(ty);
                        Some(self.regular_object(ty))
                    }
                    _ => None,
                };
            }
            NodeData::Prop(p) => {
                return (hir[p].kind != PropKind::Spread)
                    .then(|| self.type_of_literal_prop(file, p));
            }
            NodeData::Member(m) => return Some(self.iso_type_of_member(file, m)),
            NodeData::Stmt(s) => {
                let symbol = match hir[s].kind {
                    StmtKind::Fn(f) => bound.fn_symbol[f.idx()],
                    StmtKind::Class(c) => bound.class_symbol[c.idx()],
                    StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                        let ty = self.type_of_expr(file, e);
                        return Some(self.regular_object(ty));
                    }
                    _ => return None,
                };
                if symbol.is_none() {
                    return None;
                }
                return Some(self.type_of_symbol(self.files().sym(file, symbol)));
            }
            NodeData::VarDecl(d) => of_pattern(hir[d].pat)?,
            NodeData::Param(p) => return Some(self.type_of_param(file, p)),
            NodeData::PatProp(p) => of_pattern(hir[p].value)?,
            NodeData::PatElem(p) => of_pattern(hir[p].pat)?,
            _ => return None,
        };
        Some(self.type_of_pat(file, pat))
    }

    /// `getTypeOfSymbol`, of what the member `m` of a class, an interface or a type literal declares: of the symbol itself, which is
    /// not instantiated. A generic signature that is has type parameters of its own.
    pub(super) fn iso_type_of_member(&mut self, file: FileId, m: MemberId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let holder = match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => {
                let class = self.class_sym(file, c);
                if hir[m].flags.contains(Flags::STATIC) {
                    self.type_of_symbol(class)
                } else {
                    self.declared_type(class)
                }
            }
            MemberOwner::Interface(i) => {
                let interface = self.files().sym(file, bound.interface_symbol[i.idx()]);
                self.declared_type(interface)
            }
            MemberOwner::TypeLiteral(t) => self.type_from_node(file, t),
            MemberOwner::None => return TypeId::UNRESOLVED,
        };
        if let Some(members) = self.members(holder) {
            let source = PropSource::Symbol(self.symbol_of_member(file, m));
            if let Some(prop) = members.shape().props.iter().find(|it| it.source == source) {
                return self.type_of_prop(prop, MapperId::IDENTITY);
            }
        }
        self.type_of_member_declaration(file, m)
    }

    /// `reportExpandoFunctionErrors`: 9023 at what first assigns each property to the function `node` declares.
    pub(super) fn iso_report_expandos(&mut self, tx: &mut Emit, node: Node) {
        let Some(ty) = self.iso_type_of_declared(tx.file, node) else {
            return;
        };
        for target in self.iso_expando_targets(tx.file, ty) {
            let said = self.iso_diagnostic(tx.file, self.hir(tx.file).node(target), 9023);
            tx.said.push(said);
        }
    }

    /// `GetPropertiesOfContainerFunction`, `IsExpandoPropertyDeclaration`: the left sides of the assignments in `file` that are the
    /// `ValueDeclaration` of a property of `ty`.
    fn iso_expando_targets(&mut self, file: FileId, ty: TypeId) -> Vec<ExprId> {
        let Some(members) = self.members(ty) else {
            return Vec::new();
        };
        let mut targets = Vec::new();
        for prop in &members.shape().props {
            if let PropSource::Symbol(sym) = prop.source
                && let Some((of, Decl::Expando(first) | Decl::ThisProperty(first))) =
                    self.files().value_declaration(sym)
                && of == file
                && let ExprKind::Assign { target, .. } = self.hir(file)[first].kind
            {
                targets.push(target);
            }
        }
        targets
    }

    /// `isBoundExpando`
    fn iso_is_bound_expando(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let left = match hir[e].kind {
            ExprKind::Assign { target, .. } => target,
            ExprKind::Binary { left, .. } => left,
            _ => return false,
        };
        if !matches!(hir[left].kind, ExprKind::Dot { .. }) || is_parenthesized(self.hir(file), left)
        {
            return false;
        }
        // `GetLeftmostExpression(left, stopAtCallExpressions)`
        let mut at = left;
        loop {
            let next = match hir[at].kind {
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                ExprKind::Binary { left, .. } => left,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Cond { test, .. } => test,
                ExprKind::TaggedTemplate(call) => hir[call].callee,
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } => expr,
                ExprKind::AsConst(x) | ExprKind::NonNull(x) => x,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                _ => break,
            };
            if is_parenthesized(self.hir(file), next) {
                return false;
            }
            at = next;
        }
        let ExprKind::Ident(name) = hir[at].kind else {
            return false;
        };
        let Some(sym) = self.symbol_of_identifier(file, at, name) else {
            return false;
        };
        if !self.files().flags(sym).intersects(SymFlags::VALUE) {
            return false;
        }
        let ty = self.type_of_symbol(sym);
        self.members(ty).is_some_and(|members| {
            members
                .shape()
                .props
                .iter()
                .any(|prop| matches!(prop.source, PropSource::Symbol(sym) if self.is_declared_by_assignment(sym)))
        })
    }

    /// `isChildOfBoundExpando`
    fn iso_is_child_of_bound_expando(&mut self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let expando = hir.find_ancestor_or_quit(node, |n| match (hir.kind(n), hir.data(n)) {
            (Kind::SourceFile | Kind::Block, _) => ControlFlow::Break(false),
            (_, NodeData::Expr(e)) if self.iso_is_bound_expando(file, e) => {
                ControlFlow::Break(true)
            }
            _ => ControlFlow::Continue(()),
        });
        expando.is_some()
    }

    /// `SymbolTrackerImpl.ReportInferenceFallback`, of a node of the file.
    pub(super) fn iso_report(&mut self, tx: &mut Emit, node: Node) {
        if node.is_none() {
            return;
        }
        self.iso_report_expandos(tx, node);
        if !self.iso_is_child_of_bound_expando(tx.file, node) {
            let said = self.iso_error_for(tx.file, node);
            tx.said.push(said);
        }
    }

    // ───────────────────────────── types read off the syntax (`pseudochecker/lookup.go`) ─────────────────────────────

    /// `GetAllAccessorDeclarationsForDeclaration`: the getter and the setter that are one symbol with the accessor `func`.
    fn iso_accessors(&mut self, file: FileId, func: FnId) -> (Option<FnId>, Option<FnId>) {
        if self.hir(file)[func].kind == FnKind::Getter {
            let setter = self.sibling_accessor(file, func, FnKind::Setter);
            (Some(func), setter)
        } else {
            let getter = self.sibling_accessor(file, func, FnKind::Getter);
            (getter, Some(func))
        }
    }

    /// `isContextuallyTyped`
    fn iso_is_contextually_typed(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        // By what the row is, not by `kind`, which asks for the parent of a member: this goes up to the file for every declaration without a type.
        let typed = hir.find_ancestor(hir.parent(node), |n| match hir.data(n) {
            // `as const` is apart. An expression in JSX is in a `JsxExpression`, which is no node here.
            NodeData::Expr(e) => matches!(
                hir[e].kind,
                ExprKind::Call(_)
                    | ExprKind::ImportCall { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::As { .. }
                    | ExprKind::Jsx(_)
            ),
            // `IsVariableParameterOrProperty`
            NodeData::VarDecl(d) => hir[d].ty.is_some(),
            NodeData::Param(p) => hir[p].ty.is_some(),
            NodeData::Member(m) => hir[m].kind == MemberKind::Property && hir[m].ty.is_some(),
            _ => false,
        });
        typed.is_some()
    }

    /// `pseudochecker.IsInConstContext`
    fn iso_is_in_const_context(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        // `isConstContextPropagatingKind`
        let assertion = hir.find_ancestor(hir.parent(hir.node(e)), |n| {
            !matches!(
                hir.kind(n),
                Kind::ArrayLiteralExpression
                    | Kind::ObjectLiteralExpression
                    | Kind::ParenthesizedExpression
                    | Kind::SpreadElement
                    | Kind::PropertyAssignment
                    | Kind::ShorthandPropertyAssignment
                    | Kind::TemplateSpan
                    | Kind::PrefixUnaryExpression
            )
        });
        matches!(hir.data(assertion), NodeData::Expr(a) if matches!(hir[a].kind, ExprKind::AsConst(_)))
    }

    /// `typeNodeCouldReferToUndefined`
    fn iso_type_node_could_be_undefined(hir: &hir::File, t: TypeNodeId) -> bool {
        match hir[t].kind {
            TypeNodeKind::Ref { .. }
            | TypeNodeKind::IndexedAccess { .. }
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::Import { .. }
            | TypeNodeKind::Cond { .. }
            | TypeNodeKind::Keyof(_)
            | TypeNodeKind::Readonly(_)
            | TypeNodeKind::UniqueSymbol
            | TypeNodeKind::Predicate { .. }
            | TypeNodeKind::Keyword(Keyword::Undefined) => true,
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => hir
                .ids(types)
                .any(|t| Self::iso_type_node_could_be_undefined(hir, t)),
            _ => false,
        }
    }

    /// `CouldAlreadyReferToUndefinedType`
    pub(super) fn iso_could_be_undefined(hir: &hir::File, pt: &Pseudo) -> bool {
        match pt {
            Pseudo::NoResult(_) | Pseudo::Inferred { .. } | Pseudo::Undefined => true,
            Pseudo::MaybeConst {
                constant, regular, ..
            } => {
                // `isUndefinedPseudoType`
                let mut innermost = &**constant;
                while let Pseudo::MaybeConst { constant, .. } = innermost {
                    innermost = &**constant;
                }
                matches!(innermost, Pseudo::Undefined) || Self::iso_could_be_undefined(hir, regular)
            }
            Pseudo::Direct(t) => Self::iso_type_node_could_be_undefined(hir, *t),
            Pseudo::Union(members) => members.iter().any(|m| Self::iso_could_be_undefined(hir, m)),
            _ => false,
        }
    }

    /// `addUndefinedIfDefinitelyRequired`
    fn iso_add_undefined(hir: &hir::File, pt: Pseudo) -> Pseudo {
        if Self::iso_could_be_undefined(hir, &pt) {
            pt
        } else {
            Pseudo::Union(vec![pt, Pseudo::Undefined])
        }
    }

    fn iso_inferred(of: Node) -> Pseudo {
        Pseudo::Inferred {
            of,
            errors: Vec::new(),
            is_signature_return: false,
        }
    }

    fn iso_maybe_const(at: ExprId, constant: Pseudo, regular: Pseudo) -> Pseudo {
        Pseudo::MaybeConst {
            at,
            constant: Box::new(constant),
            regular: Box::new(regular),
        }
    }

    /// Whether `pt` is `PseudoTypeInferred` without error nodes.
    fn iso_is_plainly_inferred(pt: &Pseudo) -> bool {
        matches!(pt, Pseudo::Inferred { errors, .. } if errors.is_empty())
    }

    /// `typeFromExpression`
    fn iso_pseudo_of_expr(&mut self, file: FileId, e: ExprId) -> Pseudo {
        let hir = self.hir(file);
        if self.is_stack_low() {
            return Self::iso_inferred(hir.node(e));
        }
        match hir[e].kind {
            // `OmittedExpression`. What the parser makes up where an expression is missing is an identifier without a text.
            ExprKind::Missing => match self.bound(file).expr_parent[e.idx()] {
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                    Pseudo::Undefined
                }
                _ => Self::iso_inferred(hir.node(e)),
            },
            ExprKind::Ident(known::undefined) => Pseudo::Undefined,
            ExprKind::Null => Pseudo::Null,
            ExprKind::Fn(f) if matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow) => {
                // `typeFromFunctionLikeExpression`
                let full = hir.jsdoc_type(JsDocTypeOwner::Fn(f));
                if full.is_some() {
                    return Pseudo::Direct(full);
                }
                let returns = self.iso_pseudo_of_return(file, f);
                let params = self.iso_pseudo_params(file, f);
                Pseudo::Signature {
                    func: f,
                    params,
                    returns: Box::new(returns),
                }
            }
            ExprKind::As { ty, .. } => Pseudo::Direct(ty),
            ExprKind::AsConst(x) => self.iso_pseudo_of_expr(file, x),
            // `typeFromPrimitiveLiteralPrefix`
            ExprKind::Unary { op, operand } if self.iso_is_primitive_literal(file, e, true) => {
                let literal = Pseudo::Literal(if op == UnOp::Plus { operand } else { e });
                let regular = if matches!(hir[operand].kind, ExprKind::BigInt(_)) {
                    Pseudo::BigInt
                } else {
                    Pseudo::Number
                };
                Self::iso_maybe_const(e, literal, regular)
            }
            // `typeFromArrayLiteral`, `canGetTypeFromArrayLiteral`
            ExprKind::Array(items) => {
                let error = if !self.iso_is_in_const_context(file, e) {
                    Some(e)
                } else {
                    hir.ids(items)
                        .find(|&item| matches!(hir[item].kind, ExprKind::Spread(_)))
                };
                if let Some(error) = error {
                    return Pseudo::Inferred {
                        of: hir.node(e),
                        errors: vec![hir.node(error)],
                        is_signature_return: false,
                    };
                }
                if self.iso_is_contextually_typed(file, hir.node(e)) {
                    return Self::iso_inferred(hir.node(e));
                }
                let mut elements = Vec::with_capacity(items.len());
                for item in hir.ids(items) {
                    elements.push(self.iso_pseudo_of_expr(file, item));
                }
                Pseudo::Tuple(elements)
            }
            ExprKind::Object(props) => self.iso_pseudo_of_object(file, e, props),
            ExprKind::Class(_) => Pseudo::Inferred {
                of: hir.node(e),
                errors: vec![hir.node(e)],
                is_signature_return: false,
            },
            ExprKind::Template { exprs, .. } if !exprs.is_empty() => {
                if self.iso_is_in_const_context(file, e) {
                    Self::iso_inferred(hir.node(e))
                } else {
                    Self::iso_maybe_const(e, Self::iso_inferred(hir.node(e)), Pseudo::String)
                }
            }
            ExprKind::Number(_) => Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::Number),
            ExprKind::Template { .. } | ExprKind::String(_) => {
                Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::String)
            }
            ExprKind::BigInt(_) => Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::BigInt),
            ExprKind::True => Self::iso_maybe_const(e, Pseudo::True, Pseudo::Boolean),
            ExprKind::False => Self::iso_maybe_const(e, Pseudo::False, Pseudo::Boolean),
            _ => Self::iso_inferred(hir.node(e)),
        }
    }

    /// `typeFromObjectLiteral`, `canGetTypeFromObjectLiteral`
    fn iso_pseudo_of_object(&mut self, file: FileId, e: ExprId, props: Span<PropId>) -> Pseudo {
        let hir = self.hir(file);
        let mut errors = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            match (prop.kind, prop.key) {
                (PropKind::Shorthand | PropKind::Spread, _) | (_, PropKey::Private(_)) => {
                    errors.push(hir.node(p))
                }
                (_, PropKey::Computed(name))
                    if is_parenthesized(self.hir(file), name)
                        || !self.iso_is_primitive_literal(file, name, false) =>
                {
                    errors.push(hir.node(p).with(Part::Name))
                }
                _ => {}
            }
        }
        if !errors.is_empty() {
            return Pseudo::Inferred {
                of: hir.node(e),
                errors,
                is_signature_return: false,
            };
        }
        let mut elements = Vec::with_capacity(props.len());
        for p in props.iter() {
            let prop = &hir[p];
            let func = hir.function_of(hir.node(p)).some();
            let kind = match (prop.kind, func) {
                (PropKind::Method, Some(func)) => {
                    let full = hir.jsdoc_type(JsDocTypeOwner::Fn(func));
                    if full.is_some() {
                        PseudoElementKind::Property(Pseudo::Direct(full))
                    } else {
                        let params = self.iso_pseudo_params(file, func);
                        let returns = self.iso_pseudo_of_signature(file, func);
                        PseudoElementKind::Method {
                            func,
                            params,
                            returns,
                        }
                    }
                }
                (PropKind::Init, _) if prop.value.is_some() => {
                    PseudoElementKind::Property(self.iso_pseudo_of_expr(file, prop.value))
                }
                (PropKind::Getter | PropKind::Setter, Some(func)) => {
                    match self.iso_pseudo_accessor_member(file, func) {
                        Some(kind) => kind,
                        None => continue,
                    }
                }
                _ => continue,
            };
            elements.push(PseudoElement { prop: p, kind });
        }
        Pseudo::Object(elements)
    }

    /// `getAccessorMember`
    fn iso_pseudo_accessor_member(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> Option<PseudoElementKind> {
        let hir = self.hir(file);
        let (getter, setter) = self.iso_accessors(file, func);
        let is_getter = hir[func].kind == FnKind::Getter;
        if let (Some(getter), Some(setter)) = (getter, setter)
            && hir[getter].ret.is_some()
            && hir[setter]
                .params
                .iter()
                .next()
                .is_some_and(|p| hir[p].ty.is_some())
        {
            // Both say what they are, which need not be the same: both are kept.
            if is_getter {
                let ty = self.iso_pseudo_of_accessor(file, func);
                return Some(PseudoElementKind::Getter { ty });
            }
            let param = self.iso_pseudo_params(file, func).into_iter().next()?;
            return Some(PseudoElementKind::Setter { param });
        }
        let other = if is_getter { setter } else { getter };
        // `allAccessors.FirstAccessor`
        if other.is_some_and(|other| hir[other].start < hir[func].start) {
            return None;
        }
        Some(PseudoElementKind::Property(
            self.iso_pseudo_of_accessor(file, func),
        ))
    }

    /// `typeFromAccessor`
    pub(super) fn iso_pseudo_of_accessor(&mut self, file: FileId, func: FnId) -> Pseudo {
        let hir = self.hir(file);
        let (getter, setter) = self.iso_accessors(file, func);
        // `getTypeAnnotationFromAccessor`
        let annotation = |accessor: Option<FnId>| -> TypeNodeId {
            match accessor {
                Some(f) if hir[f].kind == FnKind::Getter => hir[f].ret,
                Some(f) => hir[f]
                    .params
                    .iter()
                    .next()
                    .map_or(TypeNodeId::NONE, |p| hir[p].ty),
                None => TypeNodeId::NONE,
            }
        };
        let other = if hir[func].kind == FnKind::Getter {
            setter
        } else {
            getter
        };
        let mut written = annotation(Some(func));
        if written.is_none() {
            written = annotation(other);
        }
        if written.is_some() && !matches!(hir[written].kind, TypeNodeKind::Predicate { .. }) {
            return Pseudo::Direct(written);
        }
        let Some(getter) = getter else {
            return Pseudo::NoResult(hir.node(func));
        };
        match self.iso_pseudo_of_signature(file, getter) {
            Pseudo::Inferred {
                of,
                errors,
                is_signature_return,
            } if errors.is_empty() => {
                let mut errors = vec![hir.node(getter)];
                if let Some(setter) = setter {
                    errors.push(hir.node(setter));
                }
                Pseudo::Inferred {
                    of,
                    errors,
                    is_signature_return,
                }
            }
            other => other,
        }
    }

    /// `GetReturnTypeOfSignature`
    pub(super) fn iso_pseudo_of_return(&mut self, file: FileId, func: FnId) -> Pseudo {
        if self.hir(file)[func].kind == FnKind::Getter {
            self.iso_pseudo_of_accessor(file, func)
        } else {
            self.iso_pseudo_of_signature(file, func)
        }
    }

    /// `createReturnFromSignature`, `typeFromSingleReturnExpression`
    fn iso_pseudo_of_signature(&mut self, file: FileId, func: FnId) -> Pseudo {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if f.ret.is_some() {
            return Pseudo::Direct(f.ret);
        }
        let node = hir.node(func);
        // `isValueSignatureDeclaration`
        let is_value = match f.kind {
            FnKind::Expr
            | FnKind::Arrow
            | FnKind::Decl
            | FnKind::Constructor
            | FnKind::Getter
            | FnKind::Setter => true,
            FnKind::Method => hir.kind(node) == Kind::MethodDeclaration,
            _ => false,
        };
        if !is_value {
            return Pseudo::NoResult(node);
        }
        let of_signature = Pseudo::Inferred {
            of: node,
            errors: Vec::new(),
            is_signature_return: true,
        };
        let mut candidate = ExprId::NONE;
        match f.body {
            FnBody::None => {}
            _ if f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) => return of_signature,
            FnBody::Expr(body) => candidate = body,
            FnBody::Block(_) => {
                for s in bound.ids(bound.fns[func.idx()].returns) {
                    let StmtKind::Return(returned) = hir[s].kind else {
                        continue;
                    };
                    if bound.stmt_parent[s.idx()] != Parent::FnBody(func) || candidate.is_some() {
                        candidate = ExprId::NONE;
                        break;
                    }
                    candidate = returned;
                }
            }
        }
        if candidate.is_none() {
            return of_signature;
        }
        if !self.iso_is_contextually_typed(file, hir.node(candidate)) {
            return self.iso_pseudo_of_expr(file, candidate);
        }
        match hir[candidate].kind {
            ExprKind::As { ty, .. } if !is_parenthesized(self.hir(file), candidate) => {
                Pseudo::Direct(ty)
            }
            _ => of_signature,
        }
    }

    /// `lastRequiredParamIndex`
    fn iso_last_required(hir: &hir::File, params: Span<ParamId>) -> usize {
        params
            .iter()
            .rposition(|p| {
                !hir[p].flags.intersects(Flags::REST | Flags::OPTIONAL) && hir[p].default.is_none()
            })
            .map_or(0, |i| i + 1)
    }

    /// `cloneParameters`
    fn iso_pseudo_params(&mut self, file: FileId, func: FnId) -> Vec<PseudoParam> {
        let hir = self.hir(file);
        let params = hir[func].params;
        let last_required = Self::iso_last_required(hir, params);
        let mut all = Vec::with_capacity(params.len());
        for (i, p) in params.iter().enumerate() {
            let is_optional = hir[p].flags.contains(Flags::OPTIONAL)
                || hir[p].default.is_some() && i + 1 >= last_required;
            let ty = self.iso_pseudo_of_param(file, p);
            all.push(PseudoParam {
                param: p,
                is_optional,
                ty,
            });
        }
        all
    }

    /// `typeFromParameter`, `typeFromParameterWorker`
    fn iso_pseudo_of_param(&mut self, file: FileId, p: ParamId) -> Pseudo {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let param = &hir[p];
        let func = bound.param_fn[p.idx()];
        if func.is_none() {
            return Pseudo::NoResult(hir.node(p));
        }
        if hir[func].kind == FnKind::Setter {
            return self.iso_pseudo_of_accessor(file, func);
        }
        let is_strict = self.files().options.strict_null_checks;
        let params = hir[func].params;
        let has_required_after =
            (p.0 - params.start) as usize + 1 < Self::iso_last_required(hir, params);
        if param.ty.is_some() {
            let written = Pseudo::Direct(param.ty);
            return if is_strict && param.default.is_some() && has_required_after {
                Self::iso_add_undefined(hir, written)
            } else {
                written
            };
        }
        if param.default.is_none()
            || !matches!(hir[param.pat].kind, PatKind::Ident(_))
            || self.iso_is_contextually_typed(file, hir.node(p))
        {
            return Pseudo::NoResult(hir.node(p));
        }
        let from_default = match self.iso_pseudo_of_expr(file, param.default) {
            // The error moves up to the parameter.
            Pseudo::Inferred { of, errors, .. } if errors.is_empty() => Pseudo::Inferred {
                of,
                errors: vec![hir.node(p)],
                is_signature_return: false,
            },
            other => other,
        };
        if is_strict && has_required_after {
            Self::iso_add_undefined(hir, from_default)
        } else {
            from_default
        }
    }

    /// `GetTypeOfDeclaration`
    pub(super) fn iso_pseudo_of_declaration(&mut self, file: FileId, node: Node) -> Pseudo {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir.data(node) {
            NodeData::Param(p) => self.iso_pseudo_of_param(file, p),
            // `typeFromVariable`
            NodeData::VarDecl(d) => {
                let decl = &hir[d];
                if decl.ty.is_some() {
                    return Pseudo::Direct(decl.ty);
                }
                let symbol = bound.pat_symbol[decl.pat.idx()];
                let is_declared_once = symbol.is_none()
                    || {
                        let decls = bound.symbols[symbol.idx()].decls.as_slice();
                        decls.len() == 1
                        || decls
                            .iter()
                            .filter(|decl| {
                                matches!(decl, Decl::Var(pat) if matches!(bound.pat_parent[pat.idx()], PatParent::Var(_)))
                            })
                            .count()
                            == 1
                    };
                if decl.init.is_none()
                    || !is_declared_once
                    || self.iso_is_contextually_typed(file, node)
                    || decl.kind == VarKind::Const
                        && self.iso_is_template_expression(file, decl.init)
                {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(file, decl.init);
                if Self::iso_is_plainly_inferred(&from_initializer) {
                    return Pseudo::NoResult(node);
                }
                from_initializer
            }
            // `typeFromProperty`
            NodeData::Member(m) => {
                let member = &hir[m];
                if member.ty.is_some() {
                    return Pseudo::Direct(member.ty);
                }
                if member.init.is_none()
                    || hir.kind(node) != Kind::PropertyDeclaration
                    || self.iso_is_contextually_typed(file, node)
                    || member.flags.contains(Flags::READONLY)
                        && self.iso_is_template_expression(file, member.init)
                {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(file, member.init);
                if Self::iso_is_plainly_inferred(&from_initializer) {
                    return Pseudo::NoResult(node);
                }
                if member.flags.contains(Flags::OPTIONAL)
                    && !matches!(from_initializer, Pseudo::Direct(_))
                {
                    return Self::iso_add_undefined(hir, from_initializer);
                }
                from_initializer
            }
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    self.iso_pseudo_of_expr(file, e)
                }
                _ => Pseudo::NoResult(node),
            },
            // `typeFromExpandoProperty`
            NodeData::Expr(e) => {
                let written = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
                if written.is_some() {
                    Pseudo::Direct(written)
                } else {
                    Pseudo::NoResult(node)
                }
            }
            // `typeFromPropertyAssignment`
            NodeData::Prop(p) => {
                let written = hir.jsdoc_type(JsDocTypeOwner::Prop(p));
                if written.is_some() {
                    return Pseudo::Direct(written);
                }
                if hir[p].kind != PropKind::Init || hir[p].value.is_none() {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(file, hir[p].value);
                if Self::iso_is_plainly_inferred(&from_initializer) {
                    return Pseudo::NoResult(node);
                }
                from_initializer
            }
            _ => Pseudo::NoResult(node),
        }
    }

    /// `IsTemplateExpression`, of `e` as it is written.
    fn iso_is_template_expression(&self, file: FileId, e: ExprId) -> bool {
        matches!(self.hir(file)[e].kind, ExprKind::Template { exprs, .. } if !exprs.is_empty())
            && !is_parenthesized(self.hir(file), e)
    }

    // ───────────────────────────── optional parameters ─────────────────────────────

    /// `isOptionalParameter`
    pub(super) fn is_optional_parameter(&mut self, file: FileId, p: ParamId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let param = &hir[p];
        if param.flags.contains(Flags::OPTIONAL) {
            return true;
        }
        let func = bound.param_fn[p.idx()];
        if func.is_none() {
            return false;
        }
        let params = hir[func].params;
        let index = (p.0 - params.start) as usize;
        // `getImmediatelyInvokedFunctionExpression`: how many arguments it is called with where it is written.
        let given = bound
            .get_immediately_invoked_function_expression(hir, func)
            .map(|call| hir[call].args.len());
        if param.default.is_none() {
            return given.is_some_and(|given| {
                param.ty.is_none() && !param.flags.contains(Flags::REST) && index >= given
            });
        }
        // `getMinArgumentCountEx`, with `StrongArityForUntypedJS` and `VoidIsNonOptional`
        if let Some(last) = params.iter().next_back()
            && hir[last].flags.contains(Flags::REST)
        {
            let rest = self.type_of_param(file, last);
            if let TypeData::Tuple { flags, .. } = self.data(rest) {
                let required = flags
                    .iter()
                    .position(|f| !f.contains(ElemFlags::REQUIRED))
                    .unwrap_or(flags.len());
                if required > 0 {
                    return index >= params.len() - 1 + required;
                }
            }
        }
        let minimum = params
            .iter()
            .enumerate()
            .rev()
            .find(|&(i, q)| {
                !hir[q].flags.intersects(Flags::OPTIONAL | Flags::REST)
                    && hir[q].default.is_none()
                    && !given.is_some_and(|given| i >= given && hir[q].ty.is_none())
            })
            .map_or(0, |(i, _)| i + 1);
        index >= minimum
    }

    /// `requiresAddingImplicitUndefined`, of a parameter
    pub(super) fn requires_adding_implicit_undefined(
        &mut self,
        file: FileId,
        p: ParamId,
        enclosing_declaration: Option<Enclosing>,
    ) -> bool {
        if !self.files().options.strict_null_checks {
            return false;
        }
        let param = &self.hir(file)[p];
        let is_property = param.flags.intersects(
            Flags::PUBLIC | Flags::PRIVATE | Flags::PROTECTED | Flags::READONLY | Flags::OVERRIDE,
        );
        let is_optional = self.is_optional_parameter(file, p);
        // `isRequiredInitializedParameter`, `isOptionalUninitializedParameterProperty`
        let requires = if is_optional {
            param.default.is_none() && is_property
        } else {
            param.default.is_some()
                && (!is_property
                    || enclosing_declaration
                        .is_some_and(|at| self.is_function_like_declaration(at)))
        };
        if !requires {
            return false;
        }
        // `declaredParameterTypeContainsUndefined`
        if param.ty.is_none() {
            return true;
        }
        let declared = self.type_from_node(file, param.ty);
        !self.is_error_type(declared) && !self.contains_undefined(declared)
    }

    // ───────────────────────────── held against the checker (`pseudotypenodebuilder.go`) ─────────────────────────────

    /// `pseudoTypeToType`. `None`: it is made of parts that are held against the type one by one.
    pub(super) fn iso_type_of_pseudo(&mut self, file: FileId, pt: &Pseudo) -> Option<TypeId> {
        Some(match pt {
            Pseudo::Direct(t) => self.type_from_node(file, *t),
            Pseudo::Inferred {
                of,
                is_signature_return: true,
                ..
            } => {
                let func = self.hir(file).function_of(*of).some()?;
                let sig = self.sig_of_fn(file, func);
                self.sig_return(sig)
            }
            Pseudo::Inferred { of, .. } => {
                let NodeData::Expr(e) = self.hir(file).data(*of) else {
                    return None;
                };
                let ty = self.type_of_expr(file, e);
                let ty = self.regular(ty);
                self.regular_object(ty)
            }
            Pseudo::MaybeConst {
                at,
                constant,
                regular,
            } => {
                return if self.is_const_context(file, *at) {
                    self.iso_type_of_pseudo(file, constant)
                } else {
                    self.iso_type_of_pseudo(file, regular)
                };
            }
            Pseudo::Union(members) => {
                let is_strict = self.files().options.strict_null_checks;
                let mut types = Vec::with_capacity(members.len());
                let mut has_elided = false;
                for member in members {
                    if !is_strict && matches!(member, Pseudo::Undefined | Pseudo::Null) {
                        has_elided = true;
                        continue;
                    }
                    types.push(self.iso_type_of_pseudo(file, member)?);
                }
                match types[..] {
                    [] if has_elided => TypeId::ANY,
                    [] => TypeId::NEVER,
                    [only] => only,
                    _ => self.union(&types),
                }
            }
            Pseudo::Undefined => TypeId::UNDEFINED,
            Pseudo::Null => TypeId::NULL,
            Pseudo::String => TypeId::STRING,
            Pseudo::Number => TypeId::NUMBER,
            Pseudo::BigInt => TypeId::BIGINT,
            Pseudo::Boolean => TypeId::BOOLEAN,
            Pseudo::False => TypeId::FALSE,
            Pseudo::True => TypeId::TRUE,
            Pseudo::Literal(e) => {
                let ty = self.type_of_expr(file, *e);
                self.regular(ty)
            }
            Pseudo::NoResult(_)
            | Pseudo::Signature { .. }
            | Pseudo::Tuple(_)
            | Pseudo::Object(_) => return None,
        })
    }

    /// `isStructuralPseudoType`
    fn iso_is_structural(pt: &Pseudo) -> bool {
        match pt {
            Pseudo::Object(_) | Pseudo::Tuple(_) | Pseudo::Signature { .. } => true,
            Pseudo::MaybeConst {
                constant, regular, ..
            } => Self::iso_is_structural(constant) || Self::iso_is_structural(regular),
            _ => false,
        }
    }

    /// `len(prop.Declarations)`
    fn iso_declaration_count(&mut self, prop: &Prop) -> usize {
        match &prop.source {
            PropSource::Literal(file, p) => {
                match self.hir(*file).function_of(self.hir(*file).node(*p)).some() {
                    Some(func) if self.hir(*file)[*p].kind != PropKind::Method => {
                        let (getter, setter) = self.iso_accessors(*file, func);
                        usize::from(getter.is_some()) + usize::from(setter.is_some())
                    }
                    _ => 1,
                }
            }
            PropSource::Symbol(sym) => self.declarations_of_property(*sym).len(),
            PropSource::Copy(_, of, _) | PropSource::ReverseMapped(_, of) => {
                of.iter().map(|p| self.iso_declaration_count(p)).sum()
            }
            PropSource::Type(_) | PropSource::Intersected(..) | PropSource::Mapped(..) => 0,
        }
    }

    /// `pseudoTypeEquivalentToType`
    pub(super) fn iso_is_equivalent(
        &mut self,
        tx: &mut Emit,
        pt: &Pseudo,
        ty: TypeId,
        is_optional_annotated: bool,
        reports: bool,
    ) -> bool {
        let file = tx.file;
        if self.is_error_type(ty) {
            return true;
        }
        let from = self.iso_type_of_pseudo(file, pt);
        if from == Some(ty) {
            return true;
        }
        // `getTypeWithFacts(ty, TypeFactsNEUndefined)`
        let stripped = if is_optional_annotated {
            self.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
        } else {
            ty
        };
        if let Some(from) = from {
            if is_optional_annotated
                && (stripped == from
                    || self.is_union(from)
                        && self.is_union(stripped)
                        && self.is_identical(from, stripped))
            {
                return true;
            }
            let (regular_from, regular_ty) = (self.regular(from), self.regular(ty));
            if regular_from == regular_ty
                || self.is_union(from) && self.is_union(ty) && self.is_identical(from, ty)
            {
                return true;
            }
        }
        match pt {
            Pseudo::Inferred { of, errors, .. } => {
                if reports {
                    if errors.is_empty() {
                        tx.inference_fallbacks.push(*of);
                    }
                    for &node in errors {
                        tx.inference_fallbacks.push(node);
                    }
                }
                false
            }
            Pseudo::Object(elements) => {
                self.iso_is_object_equivalent(tx, elements, stripped, reports)
            }
            Pseudo::Tuple(elements) => {
                let TypeData::Tuple { flags, .. } = self.data(stripped) else {
                    return false;
                };
                let elems = self.type_arguments(stripped);
                if flags.iter().any(|f| !f.contains(ElemFlags::REQUIRED))
                    || elements.len() != elems.len()
                {
                    return false;
                }
                for (element, &ty) in elements.iter().zip(elems.iter()) {
                    if !self.iso_is_equivalent(tx, element, ty, false, reports) {
                        return false;
                    }
                }
                true
            }
            Pseudo::Signature {
                func,
                params,
                returns,
            } => {
                let Some(sig) = self.single_call_signature(stripped, false) else {
                    return false;
                };
                let node = self.hir(file).node(*func);
                if self.sig_type_params(sig).len() != self.hir(file)[*func].type_params.len() {
                    if reports {
                        tx.inference_fallbacks.push(node);
                    }
                    return false;
                }
                if !self.iso_are_params_equivalent(tx, params, sig, reports, node) {
                    return false;
                }
                match self.sig_predicate(sig) {
                    Some(predicate) => {
                        let matches = self.iso_matches_predicate(file, returns, sig, predicate);
                        if !matches && reports {
                            tx.inference_fallbacks.push(node);
                        }
                        matches
                    }
                    None => {
                        let returned = self.sig_return(sig);
                        self.iso_is_equivalent(tx, returns, returned, false, reports)
                    }
                }
            }
            Pseudo::NoResult(node) => {
                if reports {
                    tx.inference_fallbacks.push(*node);
                }
                false
            }
            _ => false,
        }
    }

    /// `pseudoTypeEquivalentToType`, of `PseudoTypeKindObjectLiteral`
    fn iso_is_object_equivalent(
        &mut self,
        tx: &mut Emit,
        elements: &[PseudoElement],
        ty: TypeId,
        reports: bool,
    ) -> bool {
        let file = tx.file;
        let hir = self.hir(file);
        let (props, mapper): (&[Prop], MapperId) = match self.members(ty) {
            Some(members) => (&members.shape().props[..], members.mapper),
            None => (&[], MapperId::IDENTITY),
        };
        // A getter and a setter are two elements and one property.
        let mut declared = 0;
        for prop in props {
            declared += self.iso_declaration_count(prop);
        }
        if elements.len() != declared {
            return false;
        }
        for element in elements {
            let node = hir.node(element.prop);
            let name = self.member_name(file, hir[element.prop].key);
            let target = props
                .iter()
                .find(|prop| Some(prop.name) == name)
                .or_else(|| {
                    props.iter().find(|prop| {
                        matches!(prop.source, PropSource::Literal(f, p) if f == file && p == element.prop)
                    })
                });
            // No element says that it may be left out.
            let Some(target) = target.filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL))
            else {
                if reports {
                    tx.inference_fallbacks.push(node);
                }
                return false;
            };
            let prop_type = self.type_of_prop(target, mapper);
            let is_same = match &element.kind {
                PseudoElementKind::Property(pt) => {
                    if self.iso_is_equivalent(tx, pt, prop_type, false, false) {
                        continue;
                    }
                    if reports {
                        match pt {
                            Pseudo::Inferred { errors, .. } if !errors.is_empty() => {
                                for &error in errors {
                                    tx.inference_fallbacks.push(error);
                                }
                            }
                            _ if Self::iso_is_structural(pt) => {}
                            _ => tx.inference_fallbacks.push(node),
                        }
                    }
                    return false;
                }
                PseudoElementKind::Method {
                    params, returns, ..
                } => {
                    let Some(sig) = self.single_call_signature(prop_type, false) else {
                        continue;
                    };
                    if !self.iso_are_params_equivalent(tx, params, sig, reports, node) {
                        return false;
                    }
                    match self.sig_predicate(sig) {
                        Some(predicate) => {
                            self.iso_matches_predicate(file, returns, sig, predicate)
                        }
                        None => {
                            let returned = self.sig_return(sig);
                            self.iso_is_equivalent(tx, returns, returned, false, false)
                        }
                    }
                }
                PseudoElementKind::Getter { ty, .. } => {
                    self.iso_is_equivalent(tx, ty, prop_type, false, false)
                }
                PseudoElementKind::Setter { param, .. } => {
                    let written = self.write_type_of_prop(target, mapper);
                    self.iso_is_equivalent(tx, &param.ty, written, false, false)
                }
            };
            if !is_same {
                if reports {
                    tx.inference_fallbacks.push(node);
                }
                return false;
            }
        }
        true
    }

    /// `pseudoParametersEquivalentToParameters`. `elsewhere`: where it is reported that there are more or fewer.
    fn iso_are_params_equivalent(
        &mut self,
        tx: &mut Emit,
        params: &[PseudoParam],
        sig: SigId,
        reports: bool,
        elsewhere: Node,
    ) -> bool {
        let targets = self.sig_params(sig);
        if targets.len() != params.len() {
            if reports {
                tx.inference_fallbacks.push(elsewhere);
            }
            return false;
        }
        let declared = self.sig_decl(sig);
        for (i, param) in params.iter().enumerate() {
            let target = targets[i];
            let is_optional = match declared {
                Some((file, func, _)) if i < self.hir(file)[func].params.len() => {
                    let declared = self.hir(file)[func].params.at(i);
                    self.is_optional_parameter(file, declared)
                }
                _ => target.optional,
            };
            if param.is_optional != is_optional
                || !self.iso_is_equivalent(tx, &param.ty, target.ty, param.is_optional, false)
            {
                if reports {
                    tx.inference_fallbacks
                        .push(self.hir(tx.file).node(param.param));
                }
                return false;
            }
        }
        true
    }

    /// `pseudoReturnTypeMatchesPredicate`. `sig`: what `predicate` is the predicate of.
    pub(super) fn iso_matches_predicate(
        &mut self,
        file: FileId,
        returns: &Pseudo,
        sig: SigId,
        predicate: Predicate,
    ) -> bool {
        let hir = self.hir(file);
        let Pseudo::Direct(node) = returns else {
            return false;
        };
        let TypeNodeKind::Predicate { param, ty, asserts } = hir[*node].kind else {
            return false;
        };
        if asserts != predicate.asserts || (param == known::this) != predicate.param.is_none() {
            return false;
        }
        if let Some(index) = predicate.param {
            let name = self.sig_params(sig).get(index).map(|p| p.name);
            if name != Some(param) {
                return false;
            }
        }
        match predicate.ty {
            Some(narrowed) => {
                if ty.is_none() {
                    return false;
                }
                let written = self.type_from_node(file, ty);
                written == narrowed || self.is_identical(written, narrowed)
            }
            None => ty.is_none(),
        }
    }

    // ───────────────────────────── what `pseudoTypeToNode` asks ─────────────────────────────

    /// What `pseudoTypeToNode` reports of a `PseudoTypeInferred`.
    pub(super) fn iso_error_nodes_of_inferred(
        &self,
        file: FileId,
        of: Node,
        errors: &[Node],
    ) -> Vec<Node> {
        let hir = self.hir(file);
        match hir.data(of) {
            _ if !errors.is_empty() => errors.to_vec(),
            NodeData::Expr(e)
                if is_entity_name_expression(hir, e)
                    && Self::iso_is_declaration(hir, hir.parent(of)) =>
            {
                vec![hir.parent(of)]
            }
            _ => vec![of],
        }
    }

    /// `HasInferredType`
    pub(super) fn iso_has_inferred_type(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        match hir.data(node) {
            NodeData::Param(_)
            | NodeData::VarDecl(_)
            | NodeData::PatProp(_)
            | NodeData::PatElem(_) => true,
            NodeData::Member(m) => hir[m].kind == MemberKind::Property,
            NodeData::Prop(p) => matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand),
            NodeData::Stmt(s) => matches!(
                hir[s].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            ),
            NodeData::Expr(e) => matches!(
                hir[e].kind,
                ExprKind::Assign { .. }
                    | ExprKind::Binary { .. }
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::Call(_)
            ),
            _ => false,
        }
    }

    // ───────────────────────────── what `transform.go` reports by itself ─────────────────────────────

    /// `transformImportDeclaration`: 9026
    pub(super) fn iso_transform_import(&mut self, tx: &mut Emit, s: StmtId, i: ImportId) {
        let file = tx.file;
        let (hir, files) = (self.hir(file), self.files());
        let import = &hir[i];
        if import.namespace.is_some() {
            return;
        }
        if import.named.is_empty() {
            // `import "mod"` and `import a from "mod"` have no list, `import {} from "mod"` has.
            let after = self.skip_trivia_from(file, self.start_after_modifiers(file, s) + 6);
            if import.default.is_some() || hir.text.get(after as usize) != Some(&b'{') {
                return;
            }
        }
        let mut is_visible = |decl: Decl| self.is_declaration_visible(file, decl);
        if import.default.is_some() && is_visible(Decl::ImportDefault(i))
            || import.named.iter().any(|x| is_visible(Decl::ImportSpec(x)))
        {
            return;
        }
        // `IsImportRequiredByAugmentation`
        if !files.module(file).is_module() {
            return;
        }
        let mode = files.mode_of_import(file, import.mode);
        let Some(module) = files.module_of_specifier_as(file, import.spec, mode) else {
            return;
        };
        let target = files
            .decls_of(module)
            .iter()
            .find(|(_, decl)| matches!(decl, Decl::File))
            .map(|&(of, _)| of);
        let Some(target) = target.filter(|&target| target != file) else {
            return;
        };
        // `file.Symbol` is the symbol the binder made. What an `export *` adds comes out of the table of a merged module, which has the
        // merged symbols themselves.
        let bound = self.bound(file);
        let is_required = bound
            .table(bound.symbols[bound.file_symbol.idx()].exports)
            .iter()
            .any(|&(_, id)| {
                let merged = files.sym(file, id);
                merged != (Sym { file, id })
                    && files.decls_of(merged).iter().any(|&(of, _)| of == target)
            });
        if is_required {
            let said = self.iso_diagnostic(file, self.hir(file).node(s), 9026);
            tx.said.push(said);
        }
    }

    /// `transformEnumDeclaration`: 9020
    pub(super) fn iso_transform_enum(&mut self, tx: &mut Emit, e: EnumId) {
        let file = tx.file;
        let hir = self.hir(file);
        for m in hir[e].members.iter() {
            let member = &hir[m];
            if member.init.is_some()
                && !self.should_strip_internal(file, member.loc.pos)
                && hir.text.get(member.pos as usize) != Some(&b'[')
                && self.get_enum_member_value(file, m).has_external_references
            {
                let (start, end) = self.error_range_of_enum_member(file, m);
                tx.said.push(Said {
                    start,
                    end,
                    code: 9020,
                    args: Vec::new(),
                    related: Vec::new(),
                    is_merged: false,
                });
            }
        }
    }

    /// `visitDeclarationSubtree`, of a member with a dynamic name under `isolatedDeclarations`: 9038, 9014. Whether it is left out.
    pub(super) fn iso_report_dynamic_name(&mut self, tx: &mut Emit, m: MemberId) -> bool {
        let file = tx.file;
        let hir = self.hir(file);
        if let Some(name) = self.iso_dynamic_name(file, hir[m].key)
            && !self.iso_is_global_symbol_reference(file, name)
        {
            let code = match hir.kind(hir.parent(hir.node(m))) {
                Kind::ClassDeclaration => 9038,
                Kind::InterfaceDeclaration | Kind::TypeLiteral
                    if !is_entity_name_expression(hir, name) =>
                {
                    9014
                }
                _ => return false,
            };
            let said = self.iso_diagnostic(file, hir.node(m), code);
            tx.said.push(said);
            return true;
        }
        false
    }
}

/// `IsStatement`
fn is_statement(hir: &hir::File, node: Node) -> bool {
    matches!(hir.data(node), NodeData::Stmt(_))
}
