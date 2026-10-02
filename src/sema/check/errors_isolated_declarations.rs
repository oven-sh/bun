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
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent};
use bstr::ByteSlice;

/// A node of the tree, as far as an error is reported on it or the way up from it is gone.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Node {
    /// An expression itself, whatever parentheses it is in.
    Expr(ExprId),
    /// An expression with the parentheses around it, which it has.
    Written(ExprId),
    /// What an object literal is made of: `a: 1`, `a`, `...a`, a method, an accessor.
    Prop(PropId),
    /// The `[a]` that names one of those.
    PropName(PropId),
    /// A member of a class, an interface or a type literal.
    Member(MemberId),
    Var(VarDeclId),
    Param(ParamId),
    /// The binding elements of an object pattern and of an array pattern.
    PatProp(PatPropId),
    PatElem(PatElemId),
    Stmt(StmtId),
    Type(TypeNodeId),
    /// The name in a type reference, or after `typeof`.
    EntityName(TypeNodeId),
    /// The `extends` clause of a class.
    Extends(ClassId),
    /// A function the binder did not get to.
    Nowhere,
}

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
    args: Vec<String>,
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
}

impl<'p> Checker<'p> {
    /// `state.isolatedDeclarations`, for the transformer of `file`.
    pub(super) fn new_isolated_declarations(&self, file: FileId) -> Option<Emit> {
        let is_on = self.files().options.isolated_declarations
            && !self.hir(file).has_errors
            && !self
                .files()
                .module(file)
                .path
                .contains_str(b"/node_modules/");
        is_on.then(|| Emit::new(file))
    }

    /// What the transformer has reported is said.
    pub(super) fn finish_isolated_declarations(&mut self, tx: Emit) {
        self.iso_say_all(tx.said);
    }

    /// `SortAndDeduplicateDiagnostics`, `compactAndMergeRelatedInfos`: what is reported twice is one error, with the related
    /// information of both in the order of the file.
    fn iso_say_all(&mut self, mut said: Vec<Said>) {
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
            self.add_diagnostic(Reported::new(
                (self.checking.unwrap(), one.start, one.end),
                one.code,
                held(one.args),
            ));
            let related = one.related;
            if !related.is_empty() {
                self.relate(one.start, one.code, move |_| related);
            }
        }
    }

    // ───────────────────────────── the tree ─────────────────────────────

    pub(super) fn iso_node_of_fn(&self, file: FileId, f: FnId) -> Node {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[f.idx()].owner {
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p)
                    if hir[p].value == e
                        && matches!(
                            hir[p].kind,
                            PropKind::Method | PropKind::Getter | PropKind::Setter
                        ) =>
                {
                    Node::Prop(p)
                }
                _ => Node::Expr(e),
            },
            FnOwner::Stmt(s) => Node::Stmt(s),
            FnOwner::Member(m) => Node::Member(m),
            FnOwner::Type(t) => Node::Type(t),
            FnOwner::None => Node::Nowhere,
        }
    }

    fn iso_node_of_class(&self, file: FileId, c: ClassId) -> Node {
        match self.bound(file).class_owner[c.idx()] {
            ClassOwner::Expr(e) => Node::Expr(e),
            ClassOwner::Stmt(s) => Node::Stmt(s),
        }
    }

    /// The function-like `node` is.
    pub(super) fn iso_fn_of_node(&self, file: FileId, node: Node) -> Option<FnId> {
        let hir = self.hir(file);
        match node {
            Node::Expr(e) => match hir[e].kind {
                ExprKind::Fn(f) => Some(f),
                _ => None,
            },
            Node::Prop(p) => match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    match hir.exprs.get(hir[p].value.idx())?.kind {
                        ExprKind::Fn(f) => Some(f),
                        _ => None,
                    }
                }
                _ => None,
            },
            Node::Member(m) => hir[m].func.some(),
            Node::Stmt(s) => match hir[s].kind {
                StmtKind::Fn(f) => Some(f),
                _ => None,
            },
            Node::Type(t) => match hir[t].kind {
                TypeNodeKind::Fn(f) => Some(f),
                _ => None,
            },
            _ => None,
        }
    }

    /// The expression as it is written.
    pub(super) fn iso_written(&self, file: FileId, e: ExprId) -> Node {
        if is_parenthesized(self.hir(file), e) {
            Node::Written(e)
        } else {
            Node::Expr(e)
        }
    }

    /// What binds the pattern `pat`.
    pub(super) fn iso_owner_of_pattern(&self, file: FileId, pat: PatId) -> Option<Node> {
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Var(d) => Some(Node::Var(d)),
            PatParent::Param(p) => Some(Node::Param(p)),
            PatParent::Prop(_, p) => Some(Node::PatProp(p)),
            PatParent::Elem(_, p) => Some(Node::PatElem(p)),
            PatParent::None => None,
        }
    }

    /// `node.Parent`, leaving out parentheses, and the lists, blocks and clauses nothing is asked of.
    fn iso_parent(&self, tx: &Emit, node: Node) -> Option<Node> {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        match node {
            Node::Expr(e) | Node::Written(e) => match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) => Some(Node::Expr(parent)),
                Parent::Stmt(s) => s.some().map(Node::Stmt),
                Parent::VarInit(d) => Some(Node::Var(d)),
                Parent::ParamDefault(p) => Some(Node::Param(p)),
                Parent::PatPropDefault(p) => Some(Node::PatProp(p)),
                Parent::PatElemDefault(p) => Some(Node::PatElem(p)),
                Parent::Prop(p) => Some(Node::Prop(p)),
                Parent::PatKey(_) => None,
                Parent::PropKey(_, p) | Parent::MethodKey(p) => Some(Node::PropName(p)),
                Parent::MemberKey(m) => Some(Node::Member(m)),
                Parent::MemberInit(m) => Some(Node::Member(m)),
                Parent::FnBody(f) => Some(self.iso_node_of_fn(file, f)),
                Parent::EnumInit(m) => bound.enum_member_owner[m.idx()]
                    .some()
                    .and_then(|owner| hir[owner].stmt.some())
                    .map(Node::Stmt),
                Parent::Case(c) => Some(Node::Stmt(bound.case_stmt[c.idx()])),
                Parent::ClassExtends(c) => Some(Node::Extends(c)),
                _ => None,
            },
            Node::Prop(p) => bound.prop_owner[p.idx()].some().map(Node::Expr),
            Node::PropName(p) => Some(Node::Prop(p)),
            Node::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(c) => Some(self.iso_node_of_class(file, c)),
                MemberOwner::Interface(i) => hir[i].stmt.some().map(Node::Stmt),
                MemberOwner::TypeLiteral(t) => Some(Node::Type(t)),
                MemberOwner::None => None,
            },
            Node::Var(d) => bound.var_stmt[d.idx()].some().map(Node::Stmt),
            Node::Param(p) => bound.param_fn[p.idx()]
                .some()
                .map(|f| self.iso_node_of_fn(file, f)),
            Node::PatProp(p) => match bound.pat_parent[hir[p].value.idx()] {
                PatParent::Prop(outer, _) => self.iso_owner_of_pattern(file, outer),
                _ => None,
            },
            Node::PatElem(p) => match bound.pat_parent[hir[p].pat.idx()] {
                PatParent::Elem(outer, _) => self.iso_owner_of_pattern(file, outer),
                _ => None,
            },
            Node::Stmt(s) => match bound.stmt_parent[s.idx()] {
                Parent::Stmt(parent) => parent.some().map(Node::Stmt),
                Parent::FnBody(f) => Some(self.iso_node_of_fn(file, f)),
                Parent::Case(c) => Some(Node::Stmt(bound.case_stmt[c.idx()])),
                Parent::Module(m) => hir[m].stmt.some().map(Node::Stmt),
                _ => None,
            },
            Node::Type(t) => self.iso_holder_of_type(file, t),
            Node::EntityName(t) => Some(Node::Type(t)),
            Node::Extends(c) => Some(self.iso_node_of_class(file, c)),
            Node::Nowhere => None,
        }
    }

    /// What the type node `t` is written directly in. It is looked for: only an error asks.
    fn iso_holder_of_type(&self, file: FileId, t: TypeNodeId) -> Option<Node> {
        let hir = self.hir(file);
        if let Some(p) = hir.params.iter().position(|p| p.ty == t) {
            return Some(Node::Param(ParamId(p as u32)));
        }
        if let Some(d) = hir.var_decls.iter().position(|d| d.ty == t) {
            return Some(Node::Var(VarDeclId(d as u32)));
        }
        if let Some(m) = hir.members.iter().position(|m| m.ty == t) {
            return Some(Node::Member(MemberId(m as u32)));
        }
        if let Some(f) = hir.fns.iter().position(|f| f.ret == t) {
            return Some(self.iso_node_of_fn(file, FnId(f as u32)));
        }
        let asserts = |e: &Expr| match e.kind {
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => ty == t,
            _ => false,
        };
        if let Some(e) = hir.exprs.iter().position(asserts) {
            return Some(Node::Expr(ExprId(e as u32)));
        }
        Self::type_node_parent(hir, t).some().map(Node::Type)
    }

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

    fn iso_is_property_declaration(&self, file: FileId, m: MemberId) -> bool {
        self.hir(file)[m].kind == MemberKind::Property
            && matches!(
                self.bound(file).member_owner[m.idx()],
                MemberOwner::Class(_)
            )
    }

    /// `IsDeclaration`, of what an expression can be directly in.
    fn iso_is_declaration(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        match node {
            Node::Var(_)
            | Node::Param(_)
            | Node::Member(_)
            | Node::Prop(_)
            | Node::PatProp(_)
            | Node::PatElem(_) => true,
            Node::Stmt(s) => matches!(
                hir[s].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            ),
            Node::Expr(e) => matches!(
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

    /// `GetErrorRangeForNode`
    fn iso_range(&self, file: FileId, node: Node) -> (u32, u32) {
        let hir = self.hir(file);
        match node {
            Node::Expr(e) => (
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            Node::Written(e) => self.error_range_of_expr(file, e),
            Node::Prop(p) => match hir[p].kind {
                PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    (hir[p].pos, self.end_of_prop_name(file, p))
                }
                PropKind::Spread => {
                    let value = self.start_of(file, hir[p].value);
                    let before = hir
                        .text
                        .get(..value as usize)
                        .unwrap_or_default()
                        .trim_ascii_end();
                    let start = if before.ends_with(b"...") {
                        before.len() as u32 - 3
                    } else {
                        value.saturating_sub(3)
                    };
                    (start, self.end_of_prop(file, p))
                }
                PropKind::Init | PropKind::Shorthand => (hir[p].pos, self.end_of_prop(file, p)),
            },
            Node::PropName(p) => (hir[p].pos, self.end_of_prop_name(file, p)),
            Node::Member(m) => self.error_range_of_member(file, m),
            Node::Var(d) => self.error_range_of_var_decl(file, d),
            Node::Param(p) => (hir[p].pos, self.end_of_param(file, p)),
            Node::PatProp(p) => self.error_range_of_pat_prop(file, p),
            Node::PatElem(p) => self.error_range_of_pat_elem(file, p),
            Node::Stmt(s) => self.error_range_of_stmt(file, s),
            Node::Type(t) => (hir[t].pos, self.end_of_type_node(file, t)),
            Node::EntityName(t) => match hir[t].kind {
                TypeNodeKind::Typeof { expr, .. } if expr.is_some() => {
                    (self.start_of(file, expr), self.end_of_expr(file, expr))
                }
                TypeNodeKind::Ref { name, .. } => {
                    let start = hir[t].pos;
                    let mut end = self.end_of_name_at(file, start);
                    for _ in 1..name.len() {
                        let dot = self.skip_trivia_from(file, end);
                        if hir.text.get(dot as usize) != Some(&b'.') {
                            break;
                        }
                        let next = self.skip_trivia_from(file, dot + 1);
                        end = self.end_of_name_at(file, next);
                    }
                    (start, end)
                }
                _ => (hir[t].pos, self.end_of_type_node(file, t)),
            },
            Node::Extends(c) => (
                self.start_of(file, hir[c].extends),
                self.end_of_class_extends(file, c),
            ),
            Node::Nowhere => (0, 0),
        }
    }

    fn iso_said(&self, file: FileId, node: Node, code: u32) -> Said {
        let (start, end) = self.iso_range(file, node);
        Said {
            start,
            end,
            code,
            args: Vec::new(),
            related: Vec::new(),
            is_merged: false,
        }
    }

    fn iso_related(&self, file: FileId, node: Node, code: u32, args: Vec<String>) -> Reported {
        let (start, end) = self.iso_range(file, node);
        Reported::new((file, start, end), code, held(args))
    }

    /// `GetTextOfNode(node.Name())`, of a variable, a parameter or a property.
    fn iso_name_text(&self, file: FileId, node: Node) -> String {
        let hir = self.hir(file);
        let pat = match node {
            Node::Var(d) => hir[d].pat,
            Node::Param(p) => hir[p].pat,
            Node::Member(m) => {
                return self.source_text(file, hir[m].name_pos, self.end_of_member_name(file, m));
            }
            _ => return String::new(),
        };
        self.source_text(file, hir[pat].pos, self.end_of_pat(file, pat))
    }

    /// `getErrorByDeclarationKind`, `getRelatedSuggestionByDeclarationKind`. 0: there is none.
    fn iso_codes_of_declaration(&self, file: FileId, node: Node) -> (u32, u32) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match node {
            Node::Var(_) => (9010, 9027),
            Node::Param(_) => (9011, 9028),
            Node::Stmt(s) => match hir[s].kind {
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => (9037, 9036),
                StmtKind::Fn(_) => (9007, 9031),
                _ => (0, 0),
            },
            Node::Expr(e) if matches!(hir[e].kind, ExprKind::Fn(_)) => (9007, 9030),
            Node::Prop(p) => match hir[p].kind {
                PropKind::Method => (9008, 9034),
                PropKind::Getter => (9009, 9032),
                PropKind::Setter => (9009, 9033),
                _ => (0, 0),
            },
            Node::Member(m) => {
                let is_in_class = matches!(bound.member_owner[m.idx()], MemberOwner::Class(_));
                match hir[m].kind {
                    MemberKind::Property => (9012, 9029),
                    MemberKind::Method if is_in_class => (9008, 9034),
                    MemberKind::Getter => (9009, 9032),
                    MemberKind::Setter => (9009, 9033),
                    MemberKind::ConstructSignature => (9008, 9031),
                    _ => (0, 0),
                }
            }
            _ => (0, 0),
        }
    }

    /// The suggestion at `declaration`: `Add a type annotation to the variable {0}.` and the like.
    fn iso_suggestion(&self, file: FileId, declaration: Node) -> Option<Reported> {
        let code = self.iso_codes_of_declaration(file, declaration).1;
        let args = match code {
            0 => return None,
            9027..=9029 => vec![self.iso_name_text(file, declaration)],
            _ => Vec::new(),
        };
        Some(self.iso_related(file, declaration, code, args))
    }

    /// `findNearestDeclaration`
    fn iso_nearest_declaration(&self, tx: &Emit, node: Node) -> Option<Node> {
        let hir = self.hir(tx.file);
        let mut at = Some(node);
        while let Some(n) = at {
            match n {
                Node::Stmt(s) => {
                    return match hir[s].kind {
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Some(n),
                        StmtKind::Return(_) => self.iso_function_around(tx, n),
                        _ => None,
                    };
                }
                Node::Var(_) | Node::Param(_) => return Some(n),
                Node::Member(m) if self.iso_is_property_declaration(tx.file, m) => return Some(n),
                _ => {}
            }
            at = self.iso_parent(tx, n);
        }
        None
    }

    /// `FindAncestor(node, isFunctionLikeAndNotConstructor)`
    fn iso_function_around(&self, tx: &Emit, node: Node) -> Option<Node> {
        let hir = self.hir(tx.file);
        let mut at = self.iso_parent(tx, node);
        while let Some(n) = at {
            if self.iso_fn_of_node(tx.file, n).is_some_and(|f| {
                matches!(
                    hir[f].kind,
                    FnKind::Decl
                        | FnKind::Expr
                        | FnKind::Arrow
                        | FnKind::Method
                        | FnKind::Getter
                        | FnKind::Setter
                )
            }) {
                return Some(n);
            }
            at = self.iso_parent(tx, n);
        }
        None
    }

    /// `addParentDeclarationRelatedInfo`
    fn iso_add_parent_declaration(&self, tx: &Emit, node: Node, said: &mut Said) {
        if let Some(declaration) = self.iso_nearest_declaration(tx, node)
            && let Some(suggestion) = self.iso_suggestion(tx.file, declaration)
        {
            said.related.push(suggestion);
        }
    }

    /// `createExpressionErrorEx`. `message`: what is said instead of 9013.
    fn iso_expression_error(&self, tx: &Emit, node: Node, message: Option<u32>) -> Said {
        let file = tx.file;
        let hir = self.hir(file);
        let Some(declaration) = self.iso_nearest_declaration(tx, node) else {
            return self.iso_said(file, node, message.unwrap_or(9013));
        };
        // `isParentForIDDIagnostic`
        let mut parent = self.iso_parent(tx, node);
        while let Some(n) = parent {
            match n {
                Node::Stmt(s) => {
                    if !matches!(
                        hir[s].kind,
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                    ) {
                        parent = None;
                    }
                    break;
                }
                Node::Expr(e)
                    if matches!(hir[e].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) => {}
                _ => break,
            }
            parent = self.iso_parent(tx, n);
        }
        let suggestion = self.iso_suggestion(file, declaration);
        if parent == Some(declaration) {
            let code = self.iso_codes_of_declaration(file, declaration).0;
            let mut said = self.iso_said(file, node, message.unwrap_or(code));
            said.related.extend(suggestion);
            said
        } else {
            let mut said = self.iso_said(file, node, message.unwrap_or(9013));
            said.related.extend(suggestion);
            said.related
                .push(self.iso_related(file, node, 9035, Vec::new()));
            said
        }
    }

    /// `createAccessorTypeError`
    fn iso_accessor_error(&mut self, tx: &Emit, func: FnId) -> Said {
        let file = tx.file;
        let hir = self.hir(file);
        let (getter, setter) = self.iso_accessors(file, func);
        let target = match hir[func].params.iter().next() {
            Some(param) if hir[func].kind == FnKind::Setter => Node::Param(param),
            _ => self.iso_node_of_fn(file, func),
        };
        let mut said = self.iso_said(file, target, 9009);
        if let Some(setter) = setter {
            let node = self.iso_node_of_fn(file, setter);
            said.related
                .push(self.iso_related(file, node, 9033, Vec::new()));
        }
        if let Some(getter) = getter {
            let node = self.iso_node_of_fn(file, getter);
            said.related
                .push(self.iso_related(file, node, 9032, Vec::new()));
        }
        said
    }

    /// `createReturnTypeError`
    fn iso_return_type_error(&self, tx: &Emit, node: Node) -> Said {
        let (code, suggestion) = self.iso_codes_of_declaration(tx.file, node);
        let mut said = self.iso_said(tx.file, node, code);
        self.iso_add_parent_declaration(tx, node, &mut said);
        said.related
            .push(self.iso_related(tx.file, node, suggestion, Vec::new()));
        said
    }

    /// `createObjectLiteralError`, `createArrayLiteralError`
    fn iso_literal_error(&self, tx: &Emit, node: Node, code: u32) -> Said {
        let mut said = self.iso_said(tx.file, node, code);
        self.iso_add_parent_declaration(tx, node, &mut said);
        said
    }

    /// `createVariableOrPropertyError`
    fn iso_variable_or_property_error(&self, tx: &Emit, node: Node) -> Said {
        let code = self.iso_codes_of_declaration(tx.file, node).0;
        let mut said = self.iso_said(tx.file, node, code);
        said.related.extend(self.iso_suggestion(tx.file, node));
        said
    }

    /// `createParameterError`
    fn iso_parameter_error(&mut self, tx: &Emit, p: ParamId) -> Said {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = bound.param_fn[p.idx()];
        if func.is_some() && hir[func].kind == FnKind::Setter {
            return self.iso_accessor_error(tx, func);
        }
        let adds_undefined = self.requires_adding_implicit_undefined(file, p, None);
        if !adds_undefined && hir[p].default.is_some() {
            let default = self.iso_written(file, hir[p].default);
            return self.iso_expression_error(tx, default, None);
        }
        let mut said = self.iso_said(
            file,
            Node::Param(p),
            if adds_undefined { 9025 } else { 9011 },
        );
        said.related
            .extend(self.iso_suggestion(file, Node::Param(p)));
        said
    }

    /// `createGetIsolatedDeclarationErrors`
    fn iso_error_for(&mut self, tx: &Emit, node: Node) -> Said {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `FindAncestor(node, IsHeritageClause)`
        let mut at = Some(node);
        while let Some(n) = at {
            if matches!(n, Node::Extends(_)) {
                return self.iso_said(file, node, 9021);
            }
            at = self.iso_parent(tx, n);
        }
        // `createEntityInTypeNodeError`
        if matches!(node, Node::Type(_) | Node::EntityName(_))
            || matches!(node, Node::Expr(e) if matches!(hir[e].kind, ExprKind::Ident(_))
                || is_property_access_entity_name_expression(hir, e))
        {
            let mut said = self.iso_said(file, node, 9039);
            said.args = vec![self.source_text(file, said.start, said.end)];
            self.iso_add_parent_declaration(tx, node, &mut said);
            return said;
        }
        match node {
            Node::Member(m) => {
                let is_in_class = matches!(bound.member_owner[m.idx()], MemberOwner::Class(_));
                match hir[m].kind {
                    MemberKind::Getter | MemberKind::Setter => {
                        self.iso_accessor_error(tx, hir[m].func)
                    }
                    MemberKind::Method if is_in_class => self.iso_return_type_error(tx, node),
                    MemberKind::ConstructSignature => self.iso_return_type_error(tx, node),
                    MemberKind::Property if is_in_class => {
                        self.iso_variable_or_property_error(tx, node)
                    }
                    _ => self.iso_expression_error(tx, node, None),
                }
            }
            Node::Prop(p) => match (hir[p].kind, self.iso_fn_of_node(file, node)) {
                (PropKind::Getter | PropKind::Setter, Some(func)) => {
                    self.iso_accessor_error(tx, func)
                }
                (PropKind::Method, _) => self.iso_return_type_error(tx, node),
                (PropKind::Shorthand, _) => self.iso_literal_error(tx, node, 9016),
                (PropKind::Spread, _) => self.iso_literal_error(tx, node, 9015),
                (PropKind::Init, _) if hir[p].value.is_some() => {
                    let value = self.iso_written(file, hir[p].value);
                    self.iso_expression_error(tx, value, None)
                }
                _ => self.iso_expression_error(tx, node, None),
            },
            Node::PropName(_) => self.iso_literal_error(tx, node, 9038),
            Node::Expr(e) => match hir[e].kind {
                ExprKind::Array(_) => self.iso_literal_error(tx, node, 9017),
                ExprKind::Spread(_) => self.iso_literal_error(tx, node, 9018),
                ExprKind::Fn(_) => self.iso_return_type_error(tx, node),
                ExprKind::Class(_) => self.iso_expression_error(tx, node, Some(9022)),
                _ => self.iso_expression_error(tx, node, None),
            },
            Node::Stmt(s) if matches!(hir[s].kind, StmtKind::Fn(_)) => {
                self.iso_return_type_error(tx, node)
            }
            Node::PatProp(_) | Node::PatElem(_) => self.iso_said(file, node, 9019),
            Node::Var(_) => self.iso_variable_or_property_error(tx, node),
            Node::Param(p) => self.iso_parameter_error(tx, p),
            _ => self.iso_expression_error(tx, node, None),
        }
    }

    /// `getTypeOfSymbol(getSymbolOfDeclaration(node))`. `None`: `node` declares nothing.
    pub(super) fn iso_type_of_declared(&mut self, file: FileId, node: Node) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_pattern = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_)).then_some(pat);
        let pat = match node {
            Node::Expr(e) => {
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
            Node::Prop(p) => {
                return (hir[p].kind != PropKind::Spread)
                    .then(|| self.type_of_literal_prop(file, p));
            }
            Node::Member(m) => return Some(self.iso_type_of_member(file, m)),
            Node::Stmt(s) => {
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
            Node::Var(d) => of_pattern(hir[d].pat)?,
            Node::Param(p) => return Some(self.type_of_param(file, p)),
            Node::PatProp(p) => of_pattern(hir[p].value)?,
            Node::PatElem(p) => of_pattern(hir[p].pat)?,
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
            for prop in &members.shape().props {
                if let PropSource::Members(list) = &prop.source
                    && list.contains(&(file, m))
                {
                    return self.type_of_prop(prop, MapperId::IDENTITY);
                }
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
            let said = self.iso_said(tx.file, Node::Expr(target), 9023);
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
            if let PropSource::Assigned(of, assignments) = &prop.source
                && *of == file
                && let Some(&first) = assignments.first()
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
                .any(|prop| matches!(prop.source, PropSource::Assigned(..)))
        })
    }

    /// `isChildOfBoundExpando`
    fn iso_is_child_of_bound_expando(&mut self, tx: &Emit, node: Node) -> bool {
        let (hir, bound) = (self.hir(tx.file), self.bound(tx.file));
        let mut at = Some(node);
        while let Some(n) = at {
            match n {
                Node::Stmt(s) => {
                    // A block, the body of a function too.
                    if matches!(hir[s].kind, StmtKind::Block(_))
                        || matches!(bound.stmt_parent[s.idx()], Parent::FnBody(_))
                    {
                        return false;
                    }
                }
                Node::Expr(e) | Node::Written(e) => {
                    if self.iso_is_bound_expando(tx.file, e) {
                        return true;
                    }
                }
                _ => {}
            }
            at = self.iso_parent(tx, n);
        }
        false
    }

    /// `SymbolTrackerImpl.ReportInferenceFallback`, of a node of the file.
    pub(super) fn iso_report(&mut self, tx: &mut Emit, node: Node) {
        if node == Node::Nowhere {
            return;
        }
        self.iso_report_expandos(tx, node);
        if !self.iso_is_child_of_bound_expando(tx, node) {
            let said = self.iso_error_for(tx, node);
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
    fn iso_is_contextually_typed(&self, tx: &Emit, node: Node) -> bool {
        let hir = self.hir(tx.file);
        let mut at = self.iso_parent(tx, node);
        while let Some(n) = at {
            let is_typed = match n {
                Node::Expr(e) => matches!(
                    hir[e].kind,
                    ExprKind::Call(_)
                        | ExprKind::ImportCall { .. }
                        | ExprKind::Satisfies { .. }
                        | ExprKind::As { .. }
                        | ExprKind::Jsx(_)
                ),
                Node::Var(d) => hir[d].ty.is_some(),
                Node::Param(p) => hir[p].ty.is_some(),
                Node::Member(m) => hir[m].kind == MemberKind::Property && hir[m].ty.is_some(),
                _ => false,
            };
            if is_typed {
                return true;
            }
            at = self.iso_parent(tx, n);
        }
        false
    }

    /// `pseudochecker.IsInConstContext`
    fn iso_is_in_const_context(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::AsConst(_) => return true,
                    ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::Unary {
                        op:
                            UnOp::Plus
                            | UnOp::Minus
                            | UnOp::BitNot
                            | UnOp::Not
                            | UnOp::PreInc
                            | UnOp::PreDec,
                        ..
                    } => parent,
                    _ => return false,
                },
                Parent::Prop(p) if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) => {
                    let owner = bound.prop_owner[p.idx()];
                    if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return false;
                    }
                    owner
                }
                _ => return false,
            };
        }
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
    fn iso_pseudo_of_expr(&mut self, tx: &Emit, e: ExprId) -> Pseudo {
        let file = tx.file;
        let hir = self.hir(file);
        if self.is_stack_low() {
            return Self::iso_inferred(Node::Expr(e));
        }
        match hir[e].kind {
            // `OmittedExpression`. What the parser makes up where an expression is missing is an identifier without a text.
            ExprKind::Missing => match self.bound(file).expr_parent[e.idx()] {
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                    Pseudo::Undefined
                }
                _ => Self::iso_inferred(Node::Expr(e)),
            },
            ExprKind::Ident(known::undefined) => Pseudo::Undefined,
            ExprKind::Null => Pseudo::Null,
            ExprKind::Fn(f) if matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow) => {
                // `typeFromFunctionLikeExpression`
                let full = hir.jsdoc_type(JsDocTypeOwner::Fn(f));
                if full.is_some() {
                    return Pseudo::Direct(full);
                }
                let returns = self.iso_pseudo_of_return(tx, f);
                let params = self.iso_pseudo_params(tx, f);
                Pseudo::Signature {
                    func: f,
                    params,
                    returns: Box::new(returns),
                }
            }
            ExprKind::As { ty, .. } => Pseudo::Direct(ty),
            ExprKind::AsConst(x) => self.iso_pseudo_of_expr(tx, x),
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
                        of: Node::Expr(e),
                        errors: vec![Node::Expr(error)],
                        is_signature_return: false,
                    };
                }
                if self.iso_is_contextually_typed(tx, Node::Expr(e)) {
                    return Self::iso_inferred(Node::Expr(e));
                }
                let mut elements = Vec::with_capacity(items.len());
                for item in hir.ids(items) {
                    elements.push(self.iso_pseudo_of_expr(tx, item));
                }
                Pseudo::Tuple(elements)
            }
            ExprKind::Object(props) => self.iso_pseudo_of_object(tx, e, props),
            ExprKind::Class(_) => Pseudo::Inferred {
                of: Node::Expr(e),
                errors: vec![Node::Expr(e)],
                is_signature_return: false,
            },
            ExprKind::Template { exprs, .. } if !exprs.is_empty() => {
                if self.iso_is_in_const_context(file, e) {
                    Self::iso_inferred(Node::Expr(e))
                } else {
                    Self::iso_maybe_const(e, Self::iso_inferred(Node::Expr(e)), Pseudo::String)
                }
            }
            ExprKind::Number(_) => Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::Number),
            ExprKind::Template { .. } | ExprKind::String(_) => {
                Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::String)
            }
            ExprKind::BigInt(_) => Self::iso_maybe_const(e, Pseudo::Literal(e), Pseudo::BigInt),
            ExprKind::True => Self::iso_maybe_const(e, Pseudo::True, Pseudo::Boolean),
            ExprKind::False => Self::iso_maybe_const(e, Pseudo::False, Pseudo::Boolean),
            _ => Self::iso_inferred(Node::Expr(e)),
        }
    }

    /// `typeFromObjectLiteral`, `canGetTypeFromObjectLiteral`
    fn iso_pseudo_of_object(&mut self, tx: &Emit, e: ExprId, props: Span<PropId>) -> Pseudo {
        let file = tx.file;
        let hir = self.hir(file);
        let mut errors = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            match (prop.kind, prop.key) {
                (PropKind::Shorthand | PropKind::Spread, _) | (_, PropKey::Private(_)) => {
                    errors.push(Node::Prop(p))
                }
                (_, PropKey::Computed(name))
                    if is_parenthesized(self.hir(file), name)
                        || !self.iso_is_primitive_literal(file, name, false) =>
                {
                    errors.push(Node::PropName(p))
                }
                _ => {}
            }
        }
        if !errors.is_empty() {
            return Pseudo::Inferred {
                of: Node::Expr(e),
                errors,
                is_signature_return: false,
            };
        }
        let mut elements = Vec::with_capacity(props.len());
        for p in props.iter() {
            let prop = &hir[p];
            let func = self.iso_fn_of_node(file, Node::Prop(p));
            let kind = match (prop.kind, func) {
                (PropKind::Method, Some(func)) => {
                    let full = hir.jsdoc_type(JsDocTypeOwner::Fn(func));
                    if full.is_some() {
                        PseudoElementKind::Property(Pseudo::Direct(full))
                    } else {
                        let params = self.iso_pseudo_params(tx, func);
                        let returns = self.iso_pseudo_of_signature(tx, func);
                        PseudoElementKind::Method {
                            func,
                            params,
                            returns,
                        }
                    }
                }
                (PropKind::Init, _) if prop.value.is_some() => {
                    PseudoElementKind::Property(self.iso_pseudo_of_expr(tx, prop.value))
                }
                (PropKind::Getter | PropKind::Setter, Some(func)) => {
                    match self.iso_pseudo_accessor_member(tx, func) {
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
    fn iso_pseudo_accessor_member(&mut self, tx: &Emit, func: FnId) -> Option<PseudoElementKind> {
        let file = tx.file;
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
                let ty = self.iso_pseudo_of_accessor(tx, func);
                return Some(PseudoElementKind::Getter { ty });
            }
            let param = self.iso_pseudo_params(tx, func).into_iter().next()?;
            return Some(PseudoElementKind::Setter { param });
        }
        let other = if is_getter { setter } else { getter };
        // `allAccessors.FirstAccessor`
        if other.is_some_and(|other| hir[other].start < hir[func].start) {
            return None;
        }
        Some(PseudoElementKind::Property(
            self.iso_pseudo_of_accessor(tx, func),
        ))
    }

    /// `typeFromAccessor`
    pub(super) fn iso_pseudo_of_accessor(&mut self, tx: &Emit, func: FnId) -> Pseudo {
        let file = tx.file;
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
            return Pseudo::NoResult(self.iso_node_of_fn(file, func));
        };
        match self.iso_pseudo_of_signature(tx, getter) {
            Pseudo::Inferred {
                of,
                errors,
                is_signature_return,
            } if errors.is_empty() => {
                let mut errors = vec![self.iso_node_of_fn(file, getter)];
                if let Some(setter) = setter {
                    errors.push(self.iso_node_of_fn(file, setter));
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
    pub(super) fn iso_pseudo_of_return(&mut self, tx: &Emit, func: FnId) -> Pseudo {
        if self.hir(tx.file)[func].kind == FnKind::Getter {
            self.iso_pseudo_of_accessor(tx, func)
        } else {
            self.iso_pseudo_of_signature(tx, func)
        }
    }

    /// `createReturnFromSignature`, `typeFromSingleReturnExpression`
    fn iso_pseudo_of_signature(&mut self, tx: &Emit, func: FnId) -> Pseudo {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if f.ret.is_some() {
            return Pseudo::Direct(f.ret);
        }
        let node = self.iso_node_of_fn(file, func);
        // `isValueSignatureDeclaration`
        let is_value = match f.kind {
            FnKind::Expr
            | FnKind::Arrow
            | FnKind::Decl
            | FnKind::Constructor
            | FnKind::Getter
            | FnKind::Setter => true,
            FnKind::Method => match node {
                Node::Member(m) => matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
                _ => true,
            },
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
        if !self.iso_is_contextually_typed(tx, Node::Expr(candidate)) {
            return self.iso_pseudo_of_expr(tx, candidate);
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
    fn iso_pseudo_params(&mut self, tx: &Emit, func: FnId) -> Vec<PseudoParam> {
        let hir = self.hir(tx.file);
        let params = hir[func].params;
        let last_required = Self::iso_last_required(hir, params);
        let mut all = Vec::with_capacity(params.len());
        for (i, p) in params.iter().enumerate() {
            let is_optional = hir[p].flags.contains(Flags::OPTIONAL)
                || hir[p].default.is_some() && i + 1 >= last_required;
            let ty = self.iso_pseudo_of_param(tx, p);
            all.push(PseudoParam {
                param: p,
                is_optional,
                ty,
            });
        }
        all
    }

    /// `typeFromParameter`, `typeFromParameterWorker`
    fn iso_pseudo_of_param(&mut self, tx: &Emit, p: ParamId) -> Pseudo {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let param = &hir[p];
        let func = bound.param_fn[p.idx()];
        if func.is_none() {
            return Pseudo::NoResult(Node::Param(p));
        }
        if hir[func].kind == FnKind::Setter {
            return self.iso_pseudo_of_accessor(tx, func);
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
            || self.iso_is_contextually_typed(tx, Node::Param(p))
        {
            return Pseudo::NoResult(Node::Param(p));
        }
        let from_default = match self.iso_pseudo_of_expr(tx, param.default) {
            // The error moves up to the parameter.
            Pseudo::Inferred { of, errors, .. } if errors.is_empty() => Pseudo::Inferred {
                of,
                errors: vec![Node::Param(p)],
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
    pub(super) fn iso_pseudo_of_declaration(&mut self, tx: &Emit, node: Node) -> Pseudo {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        match node {
            Node::Param(p) => self.iso_pseudo_of_param(tx, p),
            // `typeFromVariable`
            Node::Var(d) => {
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
                    || self.iso_is_contextually_typed(tx, node)
                    || decl.kind == VarKind::Const
                        && self.iso_is_template_expression(file, decl.init)
                {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(tx, decl.init);
                if Self::iso_is_plainly_inferred(&from_initializer) {
                    return Pseudo::NoResult(node);
                }
                from_initializer
            }
            // `typeFromProperty`
            Node::Member(m) => {
                let member = &hir[m];
                if member.ty.is_some() {
                    return Pseudo::Direct(member.ty);
                }
                if !self.iso_is_property_declaration(file, m)
                    || member.init.is_none()
                    || self.iso_is_contextually_typed(tx, node)
                    || member.flags.contains(Flags::READONLY)
                        && self.iso_is_template_expression(file, member.init)
                {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(tx, member.init);
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
            Node::Stmt(s) => match hir[s].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    self.iso_pseudo_of_expr(tx, e)
                }
                _ => Pseudo::NoResult(node),
            },
            // `typeFromExpandoProperty`
            Node::Expr(e) => {
                let written = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
                if written.is_some() {
                    Pseudo::Direct(written)
                } else {
                    Pseudo::NoResult(node)
                }
            }
            // `typeFromPropertyAssignment`
            Node::Prop(p) => {
                let written = hir.jsdoc_type(JsDocTypeOwner::Prop(p));
                if written.is_some() {
                    return Pseudo::Direct(written);
                }
                if hir[p].kind != PropKind::Init || hir[p].value.is_none() {
                    return Pseudo::NoResult(node);
                }
                let from_initializer = self.iso_pseudo_of_expr(tx, hir[p].value);
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
    fn is_optional_parameter(&mut self, file: FileId, p: ParamId) -> bool {
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
                let func = self.iso_fn_of_node(file, *of)?;
                let sig = self.sig_of_fn(file, func);
                self.sig_return(sig)
            }
            Pseudo::Inferred { of, .. } => {
                let Node::Expr(e) = *of else {
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
            PropSource::Literal(file, p) => match self.iso_fn_of_node(*file, Node::Prop(*p)) {
                Some(func) if self.hir(*file)[*p].kind != PropKind::Method => {
                    let (getter, setter) = self.iso_accessors(*file, func);
                    usize::from(getter.is_some()) + usize::from(setter.is_some())
                }
                _ => 1,
            },
            PropSource::Members(members) => members.len(),
            PropSource::Assigned(_, assignments) => assignments.len(),
            PropSource::Parameter(..) => 1,
            PropSource::Symbol(sym) => self.files().decls_of(*sym).len(),
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
                let node = self.iso_node_of_fn(file, *func);
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
            let node = Node::Prop(element.prop);
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
                    tx.inference_fallbacks.push(Node::Param(param.param));
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

    /// Of the expression of a `PseudoTypeInferred`: `node.Parent`, which is a pair of parentheses if there is one, and that again if
    /// `IsDeclaration`.
    pub(super) fn iso_parent_of_inferred(
        &self,
        tx: &Emit,
        of: Node,
    ) -> (Option<Node>, Option<Node>) {
        let parent = match of {
            Node::Expr(e) if !is_parenthesized(self.hir(tx.file), e) => self.iso_parent(tx, of),
            _ => None,
        };
        let declaration = parent.filter(|&parent| self.iso_is_declaration(tx.file, parent));
        (parent, declaration)
    }

    /// What `pseudoTypeToNode` reports of a `PseudoTypeInferred`.
    pub(super) fn iso_error_nodes_of_inferred(
        &self,
        tx: &Emit,
        of: Node,
        errors: &[Node],
    ) -> Vec<Node> {
        if !errors.is_empty() {
            return errors.to_vec();
        }
        let hir = self.hir(tx.file);
        match (of, self.iso_parent_of_inferred(tx, of).1) {
            (Node::Expr(e), Some(declaration))
                if matches!(hir[e].kind, ExprKind::Ident(_))
                    || is_property_access_entity_name_expression(hir, e) =>
            {
                vec![declaration]
            }
            _ => vec![of],
        }
    }

    /// `HasInferredType`
    pub(super) fn iso_has_inferred_type(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        match node {
            Node::Param(_) | Node::Var(_) | Node::PatProp(_) | Node::PatElem(_) => true,
            Node::Member(m) => hir[m].kind == MemberKind::Property,
            Node::Prop(p) => matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand),
            Node::Stmt(s) => matches!(
                hir[s].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            ),
            Node::Expr(e) => matches!(
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
            let said = self.iso_said(file, Node::Stmt(s), 9026);
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
        let bound = self.bound(file);
        if let Some(name) = self.iso_dynamic_name(file, self.hir(file)[m].key)
            && !self.iso_is_global_symbol_reference(file, name)
        {
            let code = match bound.member_owner[m.idx()] {
                MemberOwner::Class(c)
                    if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) =>
                {
                    9038
                }
                MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_)
                    if !is_entity_name_expression(self.hir(file), name) =>
                {
                    9014
                }
                _ => 0,
            };
            if code != 0 {
                let said = self.iso_said(file, Node::Member(m), code);
                tx.said.push(said);
                return true;
            }
        }
        false
    }
}
