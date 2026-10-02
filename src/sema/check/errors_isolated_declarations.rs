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
use super::errors::Diagnostic;
use super::errors_declaration_emit::{EmitResolver, EmitResolverLinks, Meaning};
use super::explain::Related;
use super::print::{DECLARATION_EMIT_NODE_BUILDER_FLAGS, Report, SymbolTracker};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::util::FxHashSet;

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
        func: FnId,
        param: PseudoParam,
    },
    Getter {
        func: FnId,
        ty: Pseudo,
    },
}

/// An error, with all that is said about it.
struct Said {
    start: u32,
    end: u32,
    code: u32,
    args: Vec<String>,
    related: Vec<Related>,
    /// It was reported more than once.
    is_merged: bool,
}

/// `DeclarationTransformer` and `SymbolTrackerSharedState`, for one file.
pub(super) struct Emit {
    file: FileId,
    said: Vec<Said>,
    links: EmitResolverLinks,
    /// `lateMarkedStatements`
    late: Vec<StmtId>,
    /// `expandoHosts`: the variable statements that are written as functions.
    hosts: FxHashSet<StmtId>,
    around: Enclosing,
    /// What `pseudoTypeEquivalentToType` has for `ReportInferenceFallback`, in order. Whoever asked it passes them on.
    pub(super) inference_fallbacks: Vec<Node>,
    /// The statement that declares each interface, enum and namespace of the file.
    interfaces: Vec<StmtId>,
    enums: Vec<StmtId>,
    modules: Vec<StmtId>,
    /// The scope of each namespace.
    module_scopes: Vec<ScopeId>,
}

impl Emit {
    /// For the node builder outside of declaration emit, which asks the pseudochecker about `file` and has nothing reported. The way up
    /// from a node ends at an interface, an enum or a namespace.
    pub(super) fn without_reports(file: FileId) -> Emit {
        Emit {
            file,
            said: Vec::new(),
            links: EmitResolverLinks::default(),
            late: Vec::new(),
            hosts: FxHashSet::default(),
            around: Enclosing::at_scope(file, ScopeId(0)),
            inference_fallbacks: Vec::new(),
            interfaces: Vec::new(),
            enums: Vec::new(),
            modules: Vec::new(),
            module_scopes: Vec::new(),
        }
    }

    /// `handleSymbolAccessibilityError`, of what is accessible: `AliasesToMakeVisible` are gone over later.
    fn add_late_marked_statements(&mut self, aliases: Vec<(FileId, StmtId)>) {
        for (file, statement) in aliases {
            if file == self.file && !self.late.contains(&statement) {
                self.late.push(statement);
            }
        }
    }
}

/// `SymbolTrackerImpl` (tracker.go), as far as `isolatedDeclarations` goes. The rest of it is in errors_declaration_emit.rs.
impl<'p> SymbolTracker<'p> for Emit {
    /// `TrackSymbol`, for `AliasesToMakeVisible`.
    fn track_symbol(
        &mut self,
        c: &mut Checker<'p>,
        symbol: Sym,
        enclosing_declaration: Option<Enclosing>,
        meaning: SymFlags,
    ) -> bool {
        if let Some(at) = enclosing_declaration
            && !c.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER)
        {
            let access = EmitResolver {
                c: &mut *c,
                links: &mut self.links,
            }
            .is_symbol_accessible(symbol, at, Meaning::of(meaning, false), true);
            self.add_late_marked_statements(access.aliases);
        }
        false
    }

    fn report(&mut self, _: &mut Checker<'p>, _: Report) {}

    fn report_truncation_error(&mut self, _: &mut Checker<'p>) {}

    /// `ReportInferenceFallback`. What is in another file is reported for that file.
    fn report_inference_fallback(&mut self, c: &mut Checker<'p>, file: FileId, node: Node) {
        if file == self.file {
            c.iso_report(self, node);
        }
    }
}

impl<'p> Checker<'p> {
    pub(super) fn check_isolated_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `getSourceFilesToEmit`, `sourceFileMayBeEmitted`
        if !self.files().options.isolated_declarations
            || matches!(hir.kind, FileKind::Declaration | FileKind::Json)
            || hir.has_errors
            || self.files().module(file).path.contains("/node_modules/")
        {
            return;
        }
        let mut tx = Emit {
            file,
            said: Vec::new(),
            links: EmitResolverLinks::default(),
            late: Vec::new(),
            hosts: FxHashSet::default(),
            around: Enclosing::at_scope(file, ScopeId(0)),
            inference_fallbacks: Vec::new(),
            interfaces: vec![StmtId::NONE; hir.interfaces.len()],
            enums: vec![StmtId::NONE; hir.enums.len()],
            modules: vec![StmtId::NONE; hir.modules.len()],
            module_scopes: vec![ScopeId(0); hir.modules.len()],
        };
        for (i, stmt) in hir.stmts.iter().enumerate() {
            let s = StmtId(i as u32);
            match stmt.kind {
                StmtKind::Interface(x) => tx.interfaces[x.idx()] = s,
                StmtKind::Enum(x) => tx.enums[x.idx()] = s,
                StmtKind::Module(x) => tx.modules[x.idx()] = s,
                _ => {}
            }
        }
        for (i, scope) in bound.scopes.iter().enumerate() {
            if let ScopeKind::Module(m) = scope.kind {
                tx.module_scopes[m.idx()] = ScopeId(i as u32);
            }
        }
        // `visitSourceFile`, `transformSourceFile`
        self.iso_mark_exported_aliases(&mut tx);
        self.iso_transform_expando_assignments(&mut tx);
        self.iso_visit_statements(&mut tx, hir.body);
        // `transformAndReplaceLatePaintedStatements`
        while !tx.late.is_empty() {
            let next = tx.late.remove(0);
            self.iso_transform_top_level(&mut tx, next);
        }
        self.iso_say_all(tx.said, out);
    }

    /// `SortAndDeduplicateDiagnostics`, `compactAndMergeRelatedInfos`: what is reported twice is one error, with the related
    /// information of both in the order of the file.
    fn iso_say_all(&mut self, mut said: Vec<Said>, out: &mut Vec<Diagnostic>) {
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
                    a.at.cmp(&b.at)
                        .then(a.code.cmp(&b.code))
                        .then_with(|| a.args.cmp(&b.args))
                });
                one.related.dedup();
            }
            out.push(Diagnostic {
                start: one.start,
                code: one.code,
            });
            self.note(one.start, one.end, one.code, one.args);
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
    fn iso_written(&self, file: FileId, e: ExprId) -> Node {
        if is_parenthesized(self.hir(file), e) {
            Node::Written(e)
        } else {
            Node::Expr(e)
        }
    }

    /// What binds the pattern `pat`.
    fn iso_owner_of_pattern(&self, file: FileId, pat: PatId) -> Option<Node> {
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
        let statement = |s: Option<&StmtId>| s.copied().and_then(StmtId::some).map(Node::Stmt);
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
                Parent::PropKey(owner, _) => match hir.exprs.get(owner.idx())?.kind {
                    ExprKind::Object(props) => props
                        .iter()
                        .find(|&p| hir[p].key == PropKey::Computed(e))
                        .map(Node::PropName),
                    _ => None,
                },
                Parent::MemberKey(_) | Parent::MethodKey(_) => hir
                    .members
                    .iter()
                    .position(|m| m.key == PropKey::Computed(e))
                    .map(|m| Node::Member(MemberId(m as u32)))
                    .or_else(|| {
                        hir.props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(e))
                            .map(|p| Node::PropName(PropId(p as u32)))
                    }),
                Parent::MemberInit(m) => Some(Node::Member(m)),
                Parent::FnBody(f) => Some(self.iso_node_of_fn(file, f)),
                Parent::EnumInit(m) => {
                    statement(tx.enums.get(bound.enum_member_owner[m.idx()].idx()))
                }
                Parent::Case(c) => Some(Node::Stmt(bound.case_stmt[c.idx()])),
                Parent::ClassExtends(c) => Some(Node::Extends(c)),
                _ => None,
            },
            Node::Prop(p) => bound.prop_owner[p.idx()].some().map(Node::Expr),
            Node::PropName(p) => Some(Node::Prop(p)),
            Node::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(c) => Some(self.iso_node_of_class(file, c)),
                MemberOwner::Interface(i) => statement(tx.interfaces.get(i.idx())),
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
                Parent::Module(m) => statement(tx.modules.get(m.idx())),
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
        let (hir, bound) = (self.hir(file), self.bound(file));
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
        Self::type_node_parents(hir, bound)
            .get(t.idx())
            .copied()
            .and_then(TypeNodeId::some)
            .map(Node::Type)
    }

    /// `IsPrimitiveLiteralValue`, of `e` itself, whatever parentheses it is in.
    fn iso_is_primitive_literal(&self, file: FileId, e: ExprId, with_bigint: bool) -> bool {
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

    fn iso_related(&self, file: FileId, node: Node, code: u32, args: Vec<String>) -> Related {
        let (start, end) = self.iso_range(file, node);
        Related {
            at: Some((file, start, end)),
            code,
            args,
        }
    }

    /// `GetTextOfNode(node.Name())`, of a variable, a parameter or a property.
    fn iso_name_text(&self, file: FileId, node: Node) -> String {
        let hir = self.hir(file);
        let pat = match node {
            Node::Var(d) => hir[d].pat,
            Node::Param(p) => hir[p].pat,
            Node::Member(m) => {
                return self.source_text(file, hir[m].pos, self.end_of_member_name(file, m));
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
    fn iso_suggestion(&self, file: FileId, declaration: Node) -> Option<Related> {
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
        let adds_undefined = self.iso_requires_implicit_undefined(file, p, false);
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
    fn iso_report_expandos(&mut self, tx: &mut Emit, node: Node) {
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
    fn iso_report(&mut self, tx: &mut Emit, node: Node) {
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
                return Some(PseudoElementKind::Getter { func, ty });
            }
            let param = self.iso_pseudo_params(tx, func).into_iter().next()?;
            return Some(PseudoElementKind::Setter { func, param });
        }
        let other = if is_getter { setter } else { getter };
        // `allAccessors.FirstAccessor`
        if other.is_some_and(|other| hir[other].pos < hir[func].pos) {
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
    fn iso_is_optional_parameter(&mut self, file: FileId, p: ParamId) -> bool {
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

    /// `requiresAddingImplicitUndefinedWorker`. `in_function`: the enclosing declaration is function-like.
    pub(super) fn iso_requires_implicit_undefined(
        &mut self,
        file: FileId,
        p: ParamId,
        in_function: bool,
    ) -> bool {
        if !self.files().options.strict_null_checks {
            return false;
        }
        let param = &self.hir(file)[p];
        let is_property = param.flags.intersects(
            Flags::PUBLIC | Flags::PRIVATE | Flags::PROTECTED | Flags::READONLY | Flags::OVERRIDE,
        );
        let is_optional = self.iso_is_optional_parameter(file, p);
        // `isRequiredInitializedParameter`, `isOptionalUninitializedParameterProperty`
        let requires = if is_optional {
            param.default.is_none() && is_property
        } else {
            param.default.is_some() && (!is_property || in_function)
        };
        if !requires {
            return false;
        }
        // `declaredParameterTypeContainsUndefined`
        if param.ty.is_none() {
            return true;
        }
        let declared = self.type_from_node(file, param.ty);
        self.is_known(declared)
            && !self.is_error_type(declared)
            && !self.contains_undefined(declared)
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
                return if self.is_const_by_contextual_type(file, *at, true) {
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
            PropSource::Copy(_, of, _) => of.iter().map(|p| self.iso_declaration_count(p)).sum(),
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
        if !self.is_known(ty) || self.is_error_type(ty) {
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
                let TypeData::Tuple { elems, flags, .. } = self.data(stripped) else {
                    return false;
                };
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
                    self.iso_is_optional_parameter(file, declared)
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

    /// `tx.enclosingDeclaration = input`, of a function-like.
    fn iso_enter_scope(&self, tx: &mut Emit, func: FnId) -> Enclosing {
        let saved = tx.around;
        let scope = self.bound(tx.file).fns[func.idx()].scope;
        if scope.is_some() {
            tx.around.scope = scope;
        }
        saved
    }

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

    // ───────────────────────────── what can be seen: the `EmitResolver` is asked ─────────────────────────────

    /// `isDeclarationVisible`, of a declaration of the file.
    fn iso_is_declaration_visible(&mut self, tx: &mut Emit, decl: Decl) -> bool {
        EmitResolver {
            c: &mut *self,
            links: &mut tx.links,
        }
        .is_declaration_visible(tx.file, decl)
    }

    /// `getBindingNameVisible`, of what binds `pat`.
    fn iso_is_binding_name_visible(&mut self, tx: &mut Emit, pat: PatId) -> bool {
        let hir = self.hir(tx.file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => self.iso_is_declaration_visible(tx, Decl::Var(pat)),
            PatKind::Object(props) => props
                .iter()
                .any(|p| self.iso_is_binding_name_visible(tx, hir[p].value)),
            PatKind::Array(elems) => elems
                .iter()
                .any(|e| self.iso_is_binding_name_visible(tx, hir[e].pat)),
        }
    }

    /// `IsSymbolAccessible(sym, enclosingDeclaration, meaning, paints)`
    fn iso_is_symbol_accessible(
        &mut self,
        tx: &mut Emit,
        sym: Sym,
        meaning: SymFlags,
        paints: bool,
    ) -> bool {
        let access = EmitResolver {
            c: &mut *self,
            links: &mut tx.links,
        }
        .is_symbol_accessible(sym, tx.around, Meaning::of(meaning, false), paints);
        let is_accessible = access.is_accessible();
        tx.add_late_marked_statements(access.aliases);
        is_accessible
    }

    /// `TrackSymbol`
    fn iso_track_symbol(&mut self, tx: &mut Emit, sym: Sym, meaning: SymFlags) {
        if !self.files().flags(sym).contains(SymFlags::TYPE_PARAMETER) {
            self.iso_is_symbol_accessible(tx, sym, meaning, true);
        }
    }

    /// `checkEntityNameVisibility`, of a name whose first identifier is `name`, looked up in `scope`.
    fn iso_check_name_visibility(
        &mut self,
        tx: &mut Emit,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) {
        let at = Enclosing { scope, ..tx.around };
        let access = EmitResolver {
            c: &mut *self,
            links: &mut tx.links,
        }
        .is_entity_name_visible(name, None, Meaning::of(meaning, false), at, true);
        tx.add_late_marked_statements(access.aliases);
    }

    /// The same, of `a` or `a.b.c` written as an expression: a computed name, or what a class extends.
    fn iso_check_expression_visibility(&mut self, tx: &mut Emit, e: ExprId) {
        let first = first_identifier(self.hir(tx.file), e);
        let ExprKind::Ident(name) = self.hir(tx.file)[first].kind else {
            return;
        };
        let Some(sym) = self.symbol_of_identifier(tx.file, first, name) else {
            return;
        };
        let aliases = EmitResolver {
            c: &mut *self,
            links: &mut tx.links,
        }
        .has_visible_declarations(sym, true);
        tx.add_late_marked_statements(aliases.unwrap_or_default());
    }

    // ───────────────────────────── the way over the file (`transform.go`) ─────────────────────────────

    /// `PrecalculateDeclarationEmitVisibility`, `markLinkedAliases`: what `export { a }`, `export default a` and `export = a` name can be
    /// seen, and what `import a = b.c` leads to from there.
    fn iso_mark_exported_aliases(&self, tx: &mut Emit) {
        let file = tx.file;
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        let mut exported: Vec<Sym> = Vec::new();
        for (i, stmt) in hir.stmts.iter().enumerate() {
            match stmt.kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    if let ExprKind::Ident(name) = hir[e].kind
                        && !is_parenthesized(self.hir(file), e)
                    {
                        let scope = self.iso_scope_around(tx, StmtId(i as u32));
                        exported.extend(files.resolve_name(file, scope, name, any));
                    }
                }
                // `getTargetOfExportSpecifier`
                StmtKind::ExportNamed(x) if hir[x].spec.is_none() => {
                    for item in hir[x].items.iter() {
                        let found = files.resolve_name(
                            file,
                            bound.export_scope[x.idx()],
                            hir[item].local,
                            any,
                        );
                        exported.extend(found.and_then(|sym| files.resolve_alias(sym)));
                    }
                }
                _ => {}
            }
        }
        for sym in exported {
            let mut visited: Vec<Sym> = Vec::new();
            let mut at = Some(sym);
            while let Some(sym) = at.take() {
                if visited.contains(&sym) {
                    break;
                }
                visited.push(sym);
                for &(of, decl) in files.decls_of(sym).iter() {
                    if of != file {
                        continue;
                    }
                    tx.links.paint_visible(file, decl);
                    if let Decl::ImportEquals(i) = decl
                        && let ImportEqualsTarget::Entity(names) = hir[i].target
                        && !names.is_empty()
                    {
                        let scope = bound.import_equals_scope[i.idx()];
                        at = files.resolve_name(file, scope, hir.id_at(names, 0), any);
                    }
                }
            }
        }
    }

    /// The scope of what the statement `s` is directly in.
    fn iso_scope_around(&self, tx: &Emit, s: StmtId) -> ScopeId {
        match self.bound(tx.file).stmt_parent.get(s.idx()) {
            Some(Parent::File) => ScopeId(0),
            Some(&Parent::Module(m)) => tx.module_scopes[m.idx()],
            _ => tx.around.scope,
        }
    }

    /// `visitNestedExpression`, `transformExpandoAssignment`
    fn iso_transform_expando_assignments(&mut self, tx: &mut Emit) {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &e in bound.expando_declarations.iter() {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[e].kind
            else {
                continue;
            };
            // `GetLeftmostAccessExpression`
            let mut root = target;
            while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[root].kind {
                if is_parenthesized(self.hir(file), root) {
                    break;
                }
                root = obj;
            }
            let ExprKind::Ident(name) = hir[root].kind else {
                continue;
            };
            if is_parenthesized(self.hir(file), root) {
                continue;
            }
            // `GetReferencedValueDeclaration`
            let Some(host) = self.symbol_of_identifier(file, root, name) else {
                continue;
            };
            let host = self.files().export_symbol_of_value_symbol_if_exported(host);
            let declaration = self
                .files()
                .decls_of(host)
                .iter()
                .copied()
                .find(|&(_, decl)| {
                    !matches!(
                        decl,
                        Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_)
                    )
                });
            let Some((of, declaration)) = declaration else {
                continue;
            };
            if of != file {
                continue;
            }
            // The function that is written for a variable.
            let mut variable: Option<(VarDeclId, FnId)> = None;
            match declaration {
                Decl::Var(pat) => {
                    let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
                        continue;
                    };
                    let decl = &hir[d];
                    if decl.ty.is_some()
                        || decl.init.is_none()
                        || is_parenthesized(self.hir(file), decl.init)
                    {
                        continue;
                    }
                    let ExprKind::Fn(f) = hir[decl.init].kind else {
                        continue;
                    };
                    variable = Some((d, f));
                }
                Decl::Fn(f) => {
                    if hir.jsdoc_type(JsDocTypeOwner::Fn(f)).is_some() {
                        continue;
                    }
                }
                Decl::Class(_) | Decl::Enum(_) | Decl::Module(_) => {}
                _ => continue,
            }
            // `tryGetPropertyName`
            let property = match hir[target].kind {
                ExprKind::Dot { name, .. } => Some(name),
                ExprKind::Index { index, .. } => match hir[index].kind {
                    ExprKind::String(name) => Some(name),
                    // `tryGetNameFromEntityNameExpression`
                    _ if is_entity_name_expression(self.hir(file), index)
                        && self
                            .resolve_entity_name_expression(file, index, SymFlags::VALUE)
                            .is_some_and(|sym| {
                                self.files()
                                    .flags(sym)
                                    .intersects(SymFlags::CONST | SymFlags::ENUM_MEMBER)
                            }) =>
                    {
                        self.member_name(file, PropKey::Computed(index))
                    }
                    _ => None,
                },
                _ => None,
            };
            if !property
                .is_some_and(|name| bun_core::lexer::is_identifier(self.files().atoms.bytes(name)))
            {
                continue;
            }
            // `isDeclarationAndNotVisible`
            let is_visible = match declaration {
                Decl::Var(pat) => self.iso_is_binding_name_visible(tx, pat),
                _ => self.iso_is_declaration_visible(tx, declaration),
            };
            if !is_visible {
                continue;
            }
            // `shouldEmitFunctionProperties`
            if let Decl::Fn(f) = declaration
                && matches!(hir[f].body, FnBody::None)
            {
                let last = self
                    .files()
                    .decls_of(host)
                    .iter()
                    .rev()
                    .find(|(_, decl)| matches!(decl, Decl::Fn(_)))
                    .copied();
                if last != Some((file, declaration)) {
                    continue;
                }
            }
            // `transformExpandoHost`. A function declaration says the same when it is got to.
            if let Some((d, f)) = variable
                && tx.hosts.insert(bound.var_stmt[d.idx()])
            {
                self.iso_transform_function(tx, f);
                self.iso_report_expandos(tx, Node::Var(d));
            }
            if matches!(hir[value].kind, ExprKind::Ident(_))
                && !is_parenthesized(self.hir(file), value)
            {
                // `transformBinaryExpressionToExportDeclaration`
                self.iso_check_expression_visibility(tx, value);
            } else {
                self.iso_create_type_of_declaration(tx, Node::Expr(e));
            }
        }
    }

    fn iso_visit_statements(&mut self, tx: &mut Emit, list: IdList<StmtId>) {
        let hir = self.hir(tx.file);
        for s in hir.ids(list) {
            // `visit`, `visitDeclarationStatements`
            if self.should_strip_internal(tx.file, hir[s].loc.pos) {
                continue;
            }
            match hir[s].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    self.iso_transform_export_assignment(tx, s, e)
                }
                _ => self.iso_transform_top_level(tx, s),
            }
        }
    }

    /// `IsImplementationOfOverload`, of `func`, whose symbol has the signatures `signatures`.
    fn iso_is_overload_implementation(
        &self,
        file: FileId,
        func: FnId,
        signatures: &[SigId],
    ) -> bool {
        if matches!(self.hir(file)[func].body, FnBody::None) {
            return false;
        }
        match signatures {
            [] => false,
            [only] => self
                .sig_decl(*only)
                .is_none_or(|(of, declared, _)| (of, declared) != (file, func)),
            _ => true,
        }
    }

    /// `transformTopLevelDeclaration`
    fn iso_transform_top_level(&mut self, tx: &mut Emit, s: StmtId) {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.should_strip_internal(file, hir[s].loc.pos) {
            return;
        }
        let kind = hir[s].kind;
        // `isDeclarationAndNotVisible`
        let declared = match kind {
            StmtKind::Fn(f) => Some(Decl::Fn(f)),
            StmtKind::Class(c) => Some(Decl::Class(c)),
            StmtKind::Interface(i) => Some(Decl::Interface(i)),
            StmtKind::TypeAlias(a) => Some(Decl::Alias(a)),
            StmtKind::Enum(e) => Some(Decl::Enum(e)),
            StmtKind::Module(m) => Some(Decl::Module(m)),
            StmtKind::ImportEquals(i) => Some(Decl::ImportEquals(i)),
            StmtKind::Var(_) | StmtKind::Import(_) => None,
            _ => return,
        };
        tx.late.retain(|&other| other != s);
        if declared.is_some_and(|decl| !self.iso_is_declaration_visible(tx, decl)) {
            return;
        }
        let saved = tx.around;
        tx.around = Enclosing::at_scope(tx.file, self.iso_scope_around(tx, s));
        match kind {
            // `transformImportEqualsDeclaration`
            StmtKind::ImportEquals(i) => {
                if let ImportEqualsTarget::Entity(names) = hir[i].target
                    && !names.is_empty()
                {
                    let scope = bound.import_equals_scope[i.idx()];
                    let first = hir.id_at(names, 0);
                    self.iso_check_name_visibility(tx, scope, first, SymFlags::NAMESPACE);
                }
            }
            StmtKind::Import(i) => self.iso_transform_import(tx, s, i),
            // `transformFunctionDeclaration`
            StmtKind::Fn(f) => {
                let symbol = bound.fn_symbol[f.idx()];
                let is_implementation = symbol.is_some() && {
                    let ty = self.type_of_symbol(self.files().sym(file, symbol));
                    let signatures = self.signatures(ty, false);
                    self.iso_is_overload_implementation(file, f, &signatures)
                };
                if !is_implementation {
                    self.iso_report_expandos(tx, Node::Stmt(s));
                    self.iso_transform_function(tx, f);
                }
            }
            // `transformTypeAliasDeclaration`
            StmtKind::TypeAlias(a) => {
                self.iso_visit_type_params(tx, hir[a].type_params);
                self.iso_visit_type(tx, hir[a].ty);
            }
            // `transformInterfaceDeclaration`
            StmtKind::Interface(i) => {
                self.iso_visit_type_params(tx, hir[i].type_params);
                for t in hir.ids(hir[i].extends) {
                    self.iso_visit_type(tx, t);
                }
                for m in hir[i].members.iter() {
                    self.iso_visit_member(tx, m);
                }
            }
            // `transformModuleDeclaration`
            StmtKind::Module(m) => {
                tx.around.scope = tx.module_scopes[m.idx()];
                self.iso_visit_statements(tx, hir[m].body);
            }
            StmtKind::Class(c) => self.iso_transform_class(tx, c, true),
            StmtKind::Var(decls) if !tx.hosts.contains(&s) => {
                self.iso_transform_variable_statement(tx, decls)
            }
            StmtKind::Enum(e) => self.iso_transform_enum(tx, e),
            _ => {}
        }
        tx.around = saved;
    }

    /// `transformImportDeclaration`: 9026
    fn iso_transform_import(&mut self, tx: &mut Emit, s: StmtId, i: ImportId) {
        let file = tx.file;
        let (hir, files) = (self.hir(file), self.files());
        let import = &hir[i];
        if import.namespace.is_some() {
            return;
        }
        if import.named.is_empty() {
            // `import "mod"` and `import a from "mod"` have no list, `import {} from "mod"` has.
            let after = self.skip_trivia_from(file, hir[s].pos + 6);
            if import.default.is_some() || hir.text.get(after as usize) != Some(&b'{') {
                return;
            }
        }
        if import.default.is_some() && self.iso_is_declaration_visible(tx, Decl::ImportDefault(i))
            || import
                .named
                .iter()
                .any(|x| self.iso_is_declaration_visible(tx, Decl::ImportSpec(x)))
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
        let is_required =
            files
                .exports_of_module(files.file_symbol(file))
                .iter()
                .any(|&(_, export)| {
                    files.flags(export).contains(SymFlags::MERGED)
                        && files.decls_of(export).iter().any(|&(of, _)| of == target)
                });
        if is_required {
            let said = self.iso_said(file, Node::Stmt(s), 9026);
            tx.said.push(said);
        }
    }

    /// `transformExportAssignment`
    fn iso_transform_export_assignment(&mut self, tx: &mut Emit, s: StmtId, e: ExprId) {
        let file = tx.file;
        let hir = self.hir(file);
        if matches!(hir[e].kind, ExprKind::Ident(_)) && !is_parenthesized(self.hir(file), e) {
            return;
        }
        // `SkipOuterExpressions(expression, OEKExpressionTypePassthrough)`
        let mut unwrapped = e;
        while let ExprKind::Assign {
            op: None,
            value: right,
            ..
        }
        | ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } = hir[unwrapped].kind
        {
            unwrapped = right;
        }
        let saved = tx.around;
        tx.around = Enclosing::at_scope(tx.file, self.iso_scope_around(tx, s));
        match hir[unwrapped].kind {
            // `transformClassExpressionToDeclaration`
            ExprKind::Class(c) => self.iso_transform_class(tx, c, false),
            // `transformFunctionLikeToDeclaration`
            ExprKind::Fn(f) => self.iso_transform_function(tx, f),
            _ if self.iso_is_primitive_literal(file, e, true) => {}
            _ => {
                self.iso_create_type_of_declaration(tx, Node::Stmt(s));
            }
        }
        tx.around = saved;
    }

    /// `transformVariableStatement`, `transformVariableDeclaration`
    fn iso_transform_variable_statement(&mut self, tx: &mut Emit, decls: Span<VarDeclId>) {
        let file = tx.file;
        let hir = self.hir(file);
        for d in decls.iter() {
            let decl = &hir[d];
            if self.should_strip_internal(file, decl.loc.pos)
                || !self.iso_is_binding_name_visible(tx, decl.pat)
            {
                continue;
            }
            if !matches!(hir[decl.pat].kind, PatKind::Ident(_)) {
                self.iso_recreate_binding_pattern(tx, decl.pat);
                continue;
            }
            tx.around.variable = d;
            // `shouldPrintWithInitializer`, `IsLiteralConstDeclaration`
            let literal = if decl.init.is_some() && decl.kind == VarKind::Const {
                let ty = self.type_of_pat(file, decl.pat);
                self.is_fresh_literal(ty).then_some(ty)
            } else {
                None
            };
            if let Some(literal) = literal {
                self.iso_ensure_literal_initializer(tx, Node::Var(d), decl.init, literal);
            } else if decl.ty.is_some() {
                self.iso_visit_type(tx, decl.ty);
            } else {
                self.iso_create_type_of_declaration(tx, Node::Var(d));
            }
            tx.around.variable = VarDeclId::NONE;
        }
    }

    /// `ensureNoInitializer`, of a declaration that is written with its initializer: `const a = 1`. `literal` is its type.
    fn iso_ensure_literal_initializer(
        &mut self,
        tx: &mut Emit,
        node: Node,
        initializer: ExprId,
        literal: TypeId,
    ) {
        if !self.iso_is_primitive_literal(tx.file, initializer, true) {
            self.iso_report(tx, node);
        }
        // `CreateLiteralConstValue`: a member of an enum is named.
        match *self.data(literal) {
            TypeData::EnumLit { member: sym, .. } | TypeData::Enum { symbol: sym, .. } => {
                self.iso_track_symbol(tx, sym, SymFlags::VALUE)
            }
            _ => {}
        }
    }

    /// `recreateBindingPattern`, `recreateBindingElement`
    fn iso_recreate_binding_pattern(&mut self, tx: &mut Emit, pat: PatId) {
        let file = tx.file;
        let hir = self.hir(file);
        let elements: Vec<(PatId, Node)> = match hir[pat].kind {
            PatKind::Object(props) => props
                .iter()
                .map(|p| (hir[p].value, Node::PatProp(p)))
                .collect(),
            PatKind::Array(elems) => elems
                .iter()
                .map(|e| (hir[e].pat, Node::PatElem(e)))
                .collect(),
            _ => return,
        };
        for (name, element) in elements {
            if !self.iso_is_binding_name_visible(tx, name) {
                continue;
            }
            if matches!(hir[name].kind, PatKind::Ident(_)) {
                self.iso_create_type_of_declaration(tx, element);
            } else {
                self.iso_recreate_binding_pattern(tx, name);
            }
        }
    }

    /// `transformEnumDeclaration`: 9020
    fn iso_transform_enum(&mut self, tx: &mut Emit, e: EnumId) {
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

    /// `transformClassDeclaration`, or `transformClassExpressionToDeclaration` of the class expression a file exports by default.
    fn iso_transform_class(&mut self, tx: &mut Emit, c: ClassId, is_declaration: bool) {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let class = &hir[c];
        let saved = tx.around;
        if bound.class_scope[c.idx()].is_some() {
            tx.around.scope = bound.class_scope[c.idx()];
        }
        self.iso_visit_type_params(tx, class.type_params);
        // `buildClassMembers`: the properties the parameters of the constructor declare.
        let constructor = class.members.iter().find(|&m| {
            hir[m].kind == MemberKind::Constructor
                && hir[m].func.is_some()
                && !matches!(hir[hir[m].func].body, FnBody::None)
        });
        if let Some(constructor) = constructor {
            for p in hir[hir[constructor].func].params.iter() {
                let param = &hir[p];
                let is_property = param.flags.intersects(
                    Flags::PUBLIC
                        | Flags::PRIVATE
                        | Flags::PROTECTED
                        | Flags::READONLY
                        | Flags::OVERRIDE,
                );
                if !is_property || param.flags.contains(Flags::PRIVATE) {
                    continue;
                }
                if matches!(hir[param.pat].kind, PatKind::Ident(_)) {
                    self.iso_ensure_type_of_parameter(tx, p);
                } else {
                    // `walkBindingPattern`
                    self.iso_walk_binding_pattern(tx, param.pat);
                }
            }
        }
        self.iso_write_late_bound_index_signatures(tx, c);
        for m in class.members.iter() {
            self.iso_visit_member(tx, m);
        }
        if class.extends.is_some() {
            let is_name = is_entity_name_expression(self.hir(file), class.extends);
            let is_null = matches!(hir[class.extends].kind, ExprKind::Null)
                && !is_parenthesized(self.hir(file), class.extends);
            if is_name {
                // `transformExpressionWithTypeArguments`
                self.iso_check_expression_visibility(tx, class.extends);
            } else if is_declaration && !is_null {
                let extends = self.iso_written(file, class.extends);
                self.iso_report(tx, extends);
                // `CreateTypeOfExpression`
                self.serialize_type_for_expression(
                    file,
                    class.extends,
                    tx.around,
                    DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                    tx,
                );
            }
            if is_name || is_null || is_declaration {
                for t in hir.ids(class.extends_args) {
                    self.iso_visit_type(tx, t);
                }
            }
        }
        for t in hir.ids(class.implements) {
            self.iso_visit_type(tx, t);
        }
        tx.around = saved;
    }

    /// `walkBindingPattern`
    fn iso_walk_binding_pattern(&mut self, tx: &mut Emit, pat: PatId) {
        let file = tx.file;
        let hir = self.hir(file);
        let elements: Vec<(PatId, Node)> = match hir[pat].kind {
            PatKind::Object(props) => props
                .iter()
                .map(|p| (hir[p].value, Node::PatProp(p)))
                .collect(),
            PatKind::Array(elems) => elems
                .iter()
                .map(|e| (hir[e].pat, Node::PatElem(e)))
                .collect(),
            _ => return,
        };
        for (name, element) in elements {
            match hir[name].kind {
                PatKind::Missing => {}
                PatKind::Ident(_) => {
                    self.iso_create_type_of_declaration(tx, element);
                }
                _ => self.iso_walk_binding_pattern(tx, name),
            }
        }
    }

    /// `CreateLateBoundIndexSignatures`: what a class has an index signature for because of members whose names could be any string,
    /// number or symbol (`getIndexInfosOfIndexSymbol`).
    fn iso_write_late_bound_index_signatures(&mut self, tx: &mut Emit, c: ClassId) {
        let file = tx.file;
        let hir = self.hir(file);
        for is_static in [true, false] {
            // The members with a computed name that is written as a name: whether it names a property after all, and whether its
            // type is that of a symbol and that of a number.
            let mut computed: Vec<(MemberId, ExprId, bool, bool, bool)> = Vec::new();
            // Some computed name is a literal, which cannot be written as a name.
            let mut has_literal_names = false;
            for m in hir[c].members.iter() {
                let member = &hir[m];
                if member.flags.contains(Flags::STATIC) != is_static
                    || !matches!(
                        member.kind,
                        MemberKind::Property
                            | MemberKind::Method
                            | MemberKind::Getter
                            | MemberKind::Setter
                    )
                    || hir.text.get(member.pos as usize) != Some(&b'[')
                {
                    continue;
                }
                let Some(name) = self.iso_dynamic_name(file, member.key) else {
                    has_literal_names = true;
                    continue;
                };
                if !is_entity_name_expression(self.hir(file), name) {
                    continue;
                }
                let is_named = self.declared_member_name(file, member.key).is_some();
                let ty = self.type_of_expr(file, name);
                let is_symbol = self.is_assignable(ty, TypeId::SYMBOL);
                let is_numeric = self.is_assignable(ty, TypeId::NUMBER);
                if is_named || is_symbol || is_numeric || self.is_assignable(ty, TypeId::STRING) {
                    computed.push((m, name, is_named, is_symbol, is_numeric));
                }
            }
            if computed.iter().all(|x| x.2) {
                continue;
            }
            let class = self.class_sym(file, c);
            let holder = if is_static {
                self.type_of_symbol(class)
            } else {
                self.declared_type(class)
            };
            for key in [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL] {
                // The kind of key a member whose name is not known makes an index signature for.
                let makes = |x: &(MemberId, ExprId, bool, bool, bool)| {
                    !x.2 && match key {
                        TypeId::NUMBER => x.4,
                        TypeId::SYMBOL => x.3 && !x.4,
                        _ => !x.3 && !x.4,
                    }
                };
                if !computed.iter().any(makes) {
                    continue;
                }
                // `IndexInfo.components`
                let belongs = |x: &&(MemberId, ExprId, bool, bool, bool)| match key {
                    TypeId::NUMBER => x.4,
                    TypeId::SYMBOL => x.3,
                    _ => !x.3,
                };
                let components: Vec<(MemberId, ExprId, bool)> = computed
                    .iter()
                    .filter(belongs)
                    .map(|x| (x.0, x.1, x.2))
                    .collect();
                let mut are_all_written = !(has_literal_names && key == TypeId::STRING);
                for &(_, name, _) in &components {
                    are_all_written = are_all_written
                        && self.is_trivially_serializable_computed_name_at(file, name, tx.around);
                }
                if are_all_written {
                    for &(m, name, is_named) in &components {
                        if is_named {
                            continue;
                        }
                        self.iso_check_expression_visibility(tx, name);
                        let ty = self.type_of_member_declaration(file, m);
                        self.type_to_type_node(
                            ty,
                            tx.around,
                            DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                            tx,
                        );
                    }
                    continue;
                }
                // `IndexInfoToIndexSignatureDeclaration`
                let value = self.members(holder).and_then(|members| {
                    let info = members.shape().index.iter().find(|info| info.key == key)?;
                    Some((info.value, members.mapper))
                });
                if let Some((value, mapper)) = value {
                    let value = self.instantiate(value, mapper);
                    self.type_to_type_node(
                        value,
                        tx.around,
                        DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                        tx,
                    );
                }
            }
        }
    }

    /// `ensureTypeParams`
    fn iso_visit_type_params(&mut self, tx: &mut Emit, params: Span<TypeParamId>) {
        let hir = self.hir(tx.file);
        for tp in params.iter() {
            self.iso_visit_type(tx, hir[tp].constraint);
            self.iso_visit_type(tx, hir[tp].default);
        }
    }

    /// `ensureTypeParams`, `updateParamList` and `ensureType`, of a function-like that says what it returns or has to.
    fn iso_transform_function(&mut self, tx: &mut Emit, f: FnId) {
        let file = tx.file;
        let hir = self.hir(file);
        let saved = self.iso_enter_scope(tx, f);
        tx.around.variable = VarDeclId::NONE;
        self.iso_visit_type_params(tx, hir[f].type_params);
        self.iso_update_param_list(tx, f);
        if !matches!(hir[f].kind, FnKind::Constructor | FnKind::Setter) {
            if hir[f].ret.is_some() {
                self.iso_visit_type(tx, hir[f].ret);
            } else {
                // `CreateReturnTypeOfSignatureDeclaration`
                self.serialize_return_type_for_signature(
                    file,
                    f,
                    tx.around,
                    DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                    tx,
                );
            }
        }
        tx.around = saved;
    }

    /// `updateParamList`, `ensureParameter`
    fn iso_update_param_list(&mut self, tx: &mut Emit, f: FnId) {
        let hir = self.hir(tx.file);
        self.iso_visit_type(tx, hir[f].this_ty(hir));
        for p in hir[f].params.iter() {
            self.iso_visit_binding_name(tx, hir[p].pat);
            self.iso_ensure_type_of_parameter(tx, p);
        }
    }

    /// `visitBindingName`
    fn iso_visit_binding_name(&mut self, tx: &mut Emit, pat: PatId) {
        let hir = self.hir(tx.file);
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(name) = hir[p].key
                        && is_entity_name_expression(self.hir(tx.file), name)
                    {
                        self.iso_check_expression_visibility(tx, name);
                    }
                    self.iso_visit_binding_name(tx, hir[p].value);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.iso_visit_binding_name(tx, hir[e].pat);
                }
            }
            _ => {}
        }
    }

    /// `CreateTypeOfDeclaration`, of a declaration of the file.
    fn iso_create_type_of_declaration(&mut self, tx: &mut Emit, declaration: Node) {
        if let Some(ty) = self.iso_type_of_declared(tx.file, declaration) {
            self.serialize_type_for_declaration(
                tx.file,
                Some(declaration),
                ty,
                tx.around,
                DECLARATION_EMIT_NODE_BUILDER_FLAGS,
                tx,
            );
        }
    }

    /// `ensureType`, of a parameter
    fn iso_ensure_type_of_parameter(&mut self, tx: &mut Emit, p: ParamId) {
        let file = tx.file;
        let ty = self.hir(file)[p].ty;
        let in_function = self.is_function_like_declaration(tx.around);
        if ty.is_some() && !self.iso_requires_implicit_undefined(file, p, in_function) {
            return self.iso_visit_type(tx, ty);
        }
        self.iso_create_type_of_declaration(tx, Node::Param(p));
    }

    /// `visitDeclarationSubtree`, of a member of a class, an interface or a type literal
    fn iso_visit_member(&mut self, tx: &mut Emit, m: MemberId) {
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let member = &hir[m];
        if member.kind == MemberKind::StaticBlock
            || self.should_strip_internal(file, member.loc.pos)
        {
            return;
        }
        let dynamic = self.iso_dynamic_name(file, member.key);
        if let Some(name) = dynamic
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
                return;
            }
        }
        // `IsImplementationOfOverload`
        if matches!(member.kind, MemberKind::Method | MemberKind::Constructor)
            && member.func.is_some()
            && !matches!(hir[member.func].body, FnBody::None)
        {
            let signatures = if member.kind == MemberKind::Method {
                let ty = self.iso_type_of_member(file, m);
                self.signatures(ty, false)
            } else if let MemberOwner::Class(c) = bound.member_owner[m.idx()] {
                let ty = self.type_of_symbol(self.class_sym(file, c));
                self.signatures(ty, true)
            } else {
                List::default()
            };
            if self.iso_is_overload_implementation(file, member.func, &signatures) {
                return;
            }
        }
        if matches!(member.key, PropKey::Private(_)) {
            return;
        }
        let is_private = member.flags.contains(Flags::PRIVATE);
        match member.kind {
            _ if is_private => {}
            // `transformPropertyDeclaration`, `transformPropertySignatureDeclaration`
            MemberKind::Property => {
                // `shouldPrintWithInitializer`, `isDeclarationReadonly`
                let literal = if member.init.is_some() && member.flags.contains(Flags::READONLY) {
                    let ty = self.iso_type_of_member(file, m);
                    self.is_fresh_literal(ty).then_some(ty)
                } else {
                    None
                };
                if let Some(literal) = literal {
                    self.iso_ensure_literal_initializer(tx, Node::Member(m), member.init, literal);
                } else if member.ty.is_some() {
                    self.iso_visit_type(tx, member.ty);
                } else {
                    self.iso_create_type_of_declaration(tx, Node::Member(m));
                }
            }
            // `transformIndexSignatureDeclaration`
            MemberKind::IndexSignature => {
                self.iso_visit_type(tx, member.ty);
                if member.func.is_some() {
                    self.iso_update_param_list(tx, member.func);
                }
            }
            _ if member.func.is_some() => self.iso_transform_function(tx, member.func),
            _ => {}
        }
        // `checkName`
        if let Some(name) = dynamic
            && is_entity_name_expression(self.hir(file), name)
        {
            self.iso_check_expression_visibility(tx, name);
        }
    }

    /// `visitDeclarationSubtree`, of a type that is written
    fn iso_visit_type(&mut self, tx: &mut Emit, t: TypeNodeId) {
        if t.is_none() || self.is_stack_low() {
            return;
        }
        let file = tx.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let each = |c: &mut Self, tx: &mut Emit, list: IdList<TypeNodeId>| {
            for t in hir.ids(list) {
                c.iso_visit_type(tx, t);
            }
        };
        match hir[t].kind {
            // `transformTypeReference`
            TypeNodeKind::Ref { name, args } | TypeNodeKind::Typeof { name, args, .. } => {
                if !name.is_empty() {
                    let meaning = match hir[t].kind {
                        TypeNodeKind::Typeof { .. } => SymFlags::VALUE,
                        _ if name.len() > 1 => SymFlags::NAMESPACE,
                        _ => SymFlags::TYPE,
                    };
                    let scope = bound.type_scope[t.idx()];
                    self.iso_check_name_visibility(tx, scope, hir.id_at(name, 0), meaning);
                }
                each(self, tx, args);
            }
            TypeNodeKind::Import { args, .. } => each(self, tx, args),
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => each(self, tx, types),
            TypeNodeKind::Array(x)
            | TypeNodeKind::Keyof(x)
            | TypeNodeKind::Readonly(x)
            | TypeNodeKind::Predicate { ty: x, .. } => self.iso_visit_type(tx, x),
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.iso_visit_type(tx, hir[e].ty);
                }
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                for x in [check, extends, yes, no] {
                    self.iso_visit_type(tx, x);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.iso_visit_type(tx, obj);
                self.iso_visit_type(tx, index);
            }
            TypeNodeKind::Infer(tp) => self.iso_visit_type(tx, hir[tp].constraint),
            TypeNodeKind::Mapped(m) => {
                let mapped = &hir[m];
                self.iso_visit_type(tx, hir[mapped.param].constraint);
                self.iso_visit_type(tx, mapped.name_ty);
                self.iso_visit_type(tx, mapped.ty);
            }
            // `transformFunctionTypeNode`, `transformConstructorTypeNode`
            TypeNodeKind::Fn(f) => self.iso_transform_function(tx, f),
            TypeNodeKind::Object(members) => {
                for m in members.iter() {
                    self.iso_visit_member(tx, m);
                }
            }
            TypeNodeKind::Error
            | TypeNodeKind::Heritage(_)
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
        }
    }
}
