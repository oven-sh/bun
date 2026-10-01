//! What a name, `this` or a property access comes to where it is written, and what a declaration is left with for a type:
//! 2815, 7005 7034, 2803 2806 18013 18014 (and 2339 2551 of private names), 4111, 7017 (and 2339 of `globalThis`), 2565, 7041,
//! 7018 7025 7055 (and 7006 7008 7010 7011 7019 where `null` and `undefined` widen), 2700, 2842.
//!
//! Follows `checkIdentifier`, `checkPropertyAccessExpressionOrQualifiedName`, `checkPrivateIdentifierPropertyAccess`,
//! `getFlowTypeOfAccessExpression`, `checkThisExpression`, `evaluateEnumMember`, `getBindingElementTypeFromParentType`,
//! `checkUnusedRenamedBindingElements`, `widenTypeForVariableLikeDeclaration`, `reportErrorsFromWidening`,
//! `reportWideningErrorsInType` and `reportImplicitAny` of TypeScript 7.0.2's checker.go, and, for variables that find out their type
//! as they go, `getFlowTypeOfReferenceEx` and what it calls of its flow.go.

use super::errors::{Diagnostic, is_close};
use super::*;
use crate::bind::{
    ClassOwner, Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent, PatParent, ScopeKind,
    SymbolId, UNREACHABLE,
};

impl Checker<'_> {
    pub(super) fn check_x_identifiers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &self.p.files.options;
        let (strict, no_implicit_any) = (options.strict_null_checks, options.no_implicit_any);
        let mut pass = Pass {
            c: self,
            out,
            file,
            hir,
            bound,
            strict,
            no_implicit_any,
            loops: Vec::new(),
            steps: 0,
            inline_level: 0,
            type_parents: None,
        };
        // Of the checks below, only `evaluateEnumMember` (2565) and `widenTypeForVariableLikeDeclaration` (7005) run on a declaration file.
        if hir.kind == FileKind::Declaration {
            pass.check_enum_initializers();
            pass.check_variables_without_a_type();
            return;
        }
        pass.check_identifiers();
        pass.check_this_expressions();
        pass.check_accesses();
        pass.check_enum_initializers();
        pass.check_variables_without_a_type();
        pass.check_widening();
        pass.check_rest_elements();
        pass.check_renamed_binding_elements();
    }
}

/// One file being gone over.
struct Pass<'c, 'p> {
    c: &'c mut Checker<'p>,
    out: &'c mut Vec<Diagnostic>,
    file: FileId,
    hir: &'p hir::File,
    bound: &'p Bound,
    /// `strictNullChecks`
    strict: bool,
    no_implicit_any: bool,
    /// `flowLoopStack`
    loops: Vec<LoopInProgress>,
    /// How much walking has been done for the name that is being looked at.
    steps: u32,
    /// `inlineLevel`
    inline_level: u32,
    /// What each type is written directly in. Worked out when first asked for.
    type_parents: Option<Vec<TypeNodeId>>,
}

/// What an expression is written in, as far out as is asked: the nodes of TypeScript's tree that the checks here tell apart.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Node {
    Expr(ExprId),
    Stmt(StmtId),
    /// The body of a function.
    Body(FnId),
    /// The parameters of a function.
    Params(FnId),
    /// Anything with parameters, or a static block, as a whole: its name and its decorators are directly in it.
    Fn(FnId),
    /// The initializer of a property of a class.
    Initializer(MemberId),
    /// The declaration of a property of a class.
    Property(MemberId),
    Class(ClassId),
    Enum(EnumId),
    Module(ModuleId),
    File,
    /// The binder does not say.
    Lost,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum AssignmentKind {
    None,
    Definite,
    Compound,
}

// ───────────────────────────── the way out ─────────────────────────────

impl Pass<'_, '_> {
    /// Nothing is said of the body of a `with` statement, which `checkWithStatement` does not look at.
    fn report(&mut self, start: u32, code: u32) {
        if !self.hir.is_in_with(start) {
            self.out.push(Diagnostic { start, code });
        }
    }

    fn is_bound(&self, e: ExprId) -> bool {
        !matches!(self.bound.expr_parent[e.idx()], Parent::None)
    }

    /// Whether `e` is written in parentheses of its own.
    fn is_parenthesized(&self, e: ExprId) -> bool {
        self.hir
            .parens
            .binary_search_by_key(&e.0, |p| p.0.0)
            .is_ok()
    }

    /// Whether `node` is the expression of a decorator.
    fn is_decorator(&self, node: Node) -> bool {
        matches!(node, Node::Expr(x) if matches!(self.bound.expr_parent[x.idx()], Parent::Decorator(..)))
    }

    /// The variable declaration or the parameter the pattern `pat` is part of.
    fn around_pattern(&self, mut pat: PatId) -> Node {
        loop {
            match self.bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return self.around_variable(d),
                PatParent::Param(p) => return Node::Params(self.bound.param_fn[p.idx()]),
                PatParent::None => return Node::Lost,
            }
        }
    }

    fn around_variable(&self, d: VarDeclId) -> Node {
        let stmt = self.bound.var_stmt[d.idx()];
        if stmt.is_some() {
            Node::Stmt(stmt)
        } else {
            Node::Lost
        }
    }

    fn member_or_its_function(&self, m: MemberId) -> Node {
        if !matches!(self.bound.member_owner[m.idx()], MemberOwner::Class(_)) {
            return Node::Lost;
        }
        let member = &self.hir[m];
        if member.func.is_some() {
            Node::Fn(member.func)
        } else {
            Node::Property(m)
        }
    }

    /// What has `below` for a computed name, of the members of classes and the methods of object literals.
    fn named_by(&self, below: ExprId) -> Node {
        let key = PropKey::Computed(below);
        if let Some(m) = self.hir.members.iter().position(|m| m.key == key) {
            return self.member_or_its_function(MemberId(m as u32));
        }
        if let Some(p) = self.hir.props.iter().find(|p| p.key == key)
            && p.value.is_some()
            && let ExprKind::Fn(f) = self.hir[p.value].kind
        {
            return Node::Fn(f);
        }
        Node::Lost
    }

    /// The node `slot` is a place in. `below`: the expression that is in that place, if it is one.
    fn node_of(&self, slot: Parent, below: ExprId) -> Node {
        let (hir, bound) = (self.hir, self.bound);
        match slot {
            Parent::None => Node::Lost,
            Parent::Expr(x) if x.is_some() => Node::Expr(x),
            Parent::Stmt(s) if s.is_some() => Node::Stmt(s),
            Parent::Expr(_) | Parent::Stmt(_) => Node::Lost,
            Parent::VarInit(d) => self.around_variable(d),
            Parent::ParamDefault(p) => Node::Params(bound.param_fn[p.idx()]),
            Parent::PatPropDefault(p) => self.around_pattern(hir[p].value),
            Parent::PatElemDefault(p) => self.around_pattern(hir[p].pat),
            Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                Node::Expr(bound.prop_owner[p.idx()])
            }
            Parent::Prop(_) => Node::Lost,
            Parent::Key(owner) if owner.is_some() => Node::Expr(owner),
            // In a pattern.
            Parent::Key(_) => match hir
                .pat_props
                .iter()
                .find(|p| p.key == PropKey::Computed(below))
            {
                Some(p) => self.around_pattern(p.value),
                None => Node::Lost,
            },
            Parent::MemberKey => self.named_by(below),
            Parent::MemberInit(m) => Node::Initializer(m),
            Parent::FnBody(f) => Node::Body(f),
            Parent::EnumInit(m) => Node::Enum(bound.enum_member_owner[m.idx()]),
            Parent::Case(c) => Node::Stmt(bound.case_stmt[c.idx()]),
            Parent::ClassExtends(c) | Parent::Decorator(c, DecoratorOwner::Class(_)) => {
                Node::Class(c)
            }
            Parent::Decorator(_, DecoratorOwner::Member(m)) => self.member_or_its_function(m),
            Parent::Decorator(_, DecoratorOwner::Param(p)) => Node::Fn(bound.param_fn[p.idx()]),
            Parent::Module(m) => Node::Module(m),
            Parent::File => Node::File,
        }
    }

    /// What `node` is directly in.
    fn parent(&self, node: Node) -> Node {
        let (hir, bound) = (self.hir, self.bound);
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Node::Class(c),
            _ => Node::Lost,
        };
        match node {
            Node::Expr(e) => self.node_of(bound.expr_parent[e.idx()], e),
            Node::Stmt(s) => self.node_of(bound.stmt_parent[s.idx()], ExprId::NONE),
            Node::Body(f) | Node::Params(f) => Node::Fn(f),
            Node::Fn(f) => match bound.fns[f.idx()].owner {
                FnOwner::Expr(e) => self.parent(Node::Expr(e)),
                FnOwner::Stmt(s) => self.parent(Node::Stmt(s)),
                FnOwner::Member(m) => of_member(m),
                FnOwner::Type(_) | FnOwner::None => Node::Lost,
            },
            Node::Initializer(m) => Node::Property(m),
            Node::Property(m) => of_member(m),
            Node::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(e) => self.parent(Node::Expr(e)),
                ClassOwner::Stmt(s) => self.parent(Node::Stmt(s)),
            },
            Node::Enum(en) => match hir
                .stmts
                .iter()
                .position(|s| matches!(s.kind, StmtKind::Enum(x) if x == en))
            {
                Some(s) => self.parent(Node::Stmt(StmtId(s as u32))),
                None => Node::Lost,
            },
            Node::Module(_) | Node::File | Node::Lost => Node::Lost,
        }
    }

    /// `GetImmediatelyInvokedFunctionExpression`
    fn is_immediately_invoked(&self, f: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow)
            && matches!(bound.fns[f.idx()].owner, FnOwner::Expr(e) if matches!(bound.expr_parent[e.idx()], Parent::Expr(call)
                if matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e)))
    }

    /// `getControlFlowContainer`
    fn control_flow_container(&self, mut node: Node) -> Node {
        loop {
            node = self.parent(node);
            match node {
                Node::Fn(f)
                    if self.hir[f].kind != FnKind::StaticBlock
                        && !self.is_immediately_invoked(f) =>
                {
                    return node;
                }
                Node::Module(_) | Node::File | Node::Property(_) | Node::Lost => return node,
                _ => {}
            }
        }
    }

    /// `getAssignmentTargetKind`
    fn assignment_kind(&self, e: ExprId) -> AssignmentKind {
        let (hir, bound) = (self.hir, self.bound);
        let mut node = e;
        loop {
            match bound.expr_parent[node.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Assign { op, target, .. } => {
                        return match op {
                            _ if target != node => AssignmentKind::None,
                            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                                AssignmentKind::Definite
                            }
                            Some(_) => AssignmentKind::Compound,
                        };
                    }
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return AssignmentKind::Compound,
                    ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::NonNull(_) => {
                        node = parent
                    }
                    _ => return AssignmentKind::None,
                },
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if !matches!(hir[owner].kind, ExprKind::Object(_)) {
                        return AssignmentKind::None;
                    }
                    node = owner;
                }
                // `for (x of xs)`
                Parent::Stmt(s) if s.is_some() => {
                    let is_loop_variable = matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
                    return if is_loop_variable {
                        AssignmentKind::Definite
                    } else {
                        AssignmentKind::None
                    };
                }
                _ => return AssignmentKind::None,
            }
        }
    }

    /// The expressions directly in `e`, but for what is in functions and classes.
    fn push_children(&self, e: ExprId, out: &mut Vec<ExprId>) {
        let hir = self.hir;
        let push_props = |props: Span<PropId>, out: &mut Vec<ExprId>| {
            for p in props.iter() {
                if let PropKey::Computed(key) = hir[p].key {
                    out.push(key);
                }
                if hir[p].value.is_some() {
                    out.push(hir[p].value);
                }
            }
        };
        match hir[e].kind {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget => {}
            ExprKind::Template { exprs, .. } => out.extend(hir.ids(exprs)),
            ExprKind::TaggedTemplate(c) | ExprKind::Call(c) | ExprKind::New(c) => {
                out.push(hir[c].callee);
                out.extend(hir.ids(hir[c].args));
            }
            ExprKind::Array(items) => out.extend(hir.ids(items)),
            ExprKind::Object(props) => push_props(props, out),
            ExprKind::Dot { obj, .. } => out.push(obj),
            ExprKind::Index { obj, index, .. } => out.extend([obj, index]),
            ExprKind::Unary { operand, .. } => out.push(operand),
            ExprKind::Binary { left, right, .. } => out.extend([left, right]),
            ExprKind::Assign { target, value, .. } => out.extend([target, value]),
            ExprKind::Cond { test, yes, no } => out.extend([test, yes, no]),
            ExprKind::Spread(x)
            | ExprKind::Await(x)
            | ExprKind::AsConst(x)
            | ExprKind::NonNull(x) => out.push(x),
            ExprKind::ImportCall(x) => {
                out.push(x);
                out.extend(hir.import_options.iter().filter(|o| o.0 == x).map(|o| o.1));
            }
            ExprKind::Yield { value, .. } => {
                if value.is_some() {
                    out.push(value);
                }
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::Instantiation { expr, .. } => out.push(expr),
            ExprKind::Jsx(j) => {
                for tag in [hir[j].tag, hir[j].close_tag] {
                    if tag.is_some() {
                        out.push(tag);
                    }
                }
                push_props(hir[j].attrs, out);
                out.extend(hir.ids(hir[j].children));
            }
        }
    }

    /// The text of a string literal, or of a template without substitutions. `IsStringLiteralLike`
    fn string_literal_like(&self, e: ExprId) -> Option<Atom> {
        match self.hir[e].kind {
            ExprKind::String(text) => Some(text),
            ExprKind::Template { exprs, texts } if exprs.is_empty() && !texts.is_empty() => {
                Some(self.hir.id_at(texts, 0))
            }
            _ => None,
        }
    }
}

// ───────────────────────────── `arguments` and `this` ─────────────────────────────

impl Pass<'_, '_> {
    /// `checkIdentifier`: 2815, 7005 7034.
    fn check_identifiers(&mut self) {
        for i in 0..self.hir.exprs.len() {
            let e = ExprId(i as u32);
            let ExprKind::Ident(name) = self.hir.exprs[i].kind else {
                continue;
            };
            if !self.is_bound(e) {
                continue;
            }
            if self.bound.expr_symbol[i].is_none() {
                if name == known::arguments && self.is_arguments_in_initializer(e) {
                    self.report(self.hir.exprs[i].pos, 2815);
                }
                continue;
            }
            self.steps = 0;
            self.check_auto_reference(e);
        }
    }

    /// Whether the `arguments` at `e` is that of a function, and `isInPropertyInitializerOrClassStaticBlock` says yes, arrow functions
    /// not counting. Only the block of a function ends the search: its parameters are as good as outside of it.
    fn is_arguments_in_initializer(&self, e: ExprId) -> bool {
        if self.bound.is_in_type_query(e) {
            return false;
        }
        let mut node = Node::Expr(e);
        let mut is_inside = None;
        let mut is_provided = false;
        loop {
            let below = node;
            node = self.parent(node);
            match node {
                Node::Property(_) => {
                    is_inside.get_or_insert(true);
                }
                Node::Body(f)
                    if !matches!(self.hir[f].kind, FnKind::Arrow | FnKind::StaticBlock) =>
                {
                    is_inside.get_or_insert(false);
                }
                Node::Fn(f) => match self.hir[f].kind {
                    FnKind::StaticBlock => {
                        is_inside.get_or_insert(true);
                    }
                    // The names in a decorator are looked up from the class.
                    FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor => {
                        is_provided |= !self.is_decorator(below);
                    }
                    _ => {}
                },
                Node::Module(_) | Node::File | Node::Lost => return false,
                _ => {}
            }
            match is_inside {
                Some(false) => return false,
                Some(true) if is_provided => return true,
                _ => {}
            }
        }
    }

    /// The `typeof` in a type that `e` is the operand of, or part of it.
    fn type_query_of(&self, e: ExprId) -> Option<TypeNodeId> {
        let mut top = e;
        while let Parent::Expr(x) = self.bound.expr_parent[top.idx()]
            && x.is_some()
        {
            top = x;
        }
        let node = self
            .hir
            .types
            .iter()
            .position(|t| matches!(t.kind, TypeNodeKind::Typeof { expr, .. } if expr == top))?;
        Some(TypeNodeId(node as u32))
    }

    /// `global_this`, of a `this` in the operand of a `typeof` in a type. The binder puts the operand in the function, namespace or file
    /// around: it is the scopes and the types around that tell what is in between.
    fn global_this_in_type_query(&mut self, e: ExprId) -> Option<bool> {
        let (hir, bound) = (self.hir, self.bound);
        let node = self.type_query_of(e)?;
        // The members of a type literal have a `this` of their own.
        let parents = self
            .type_parents
            .get_or_insert_with(|| Checker::type_node_parents(hir, bound));
        let mut at = parents[node.idx()];
        while at.is_some() {
            if matches!(hir[at].kind, TypeNodeKind::Object(_)) {
                return None;
            }
            at = parents[at.idx()];
        }
        let mut is_captured = false;
        let mut scope = bound.type_scope[node.idx()];
        while scope.is_some() {
            match bound.scopes[scope.idx()].kind {
                ScopeKind::File => return Some(is_captured),
                ScopeKind::Fn(f) => match hir[f].kind {
                    FnKind::Arrow => is_captured = true,
                    // `getThisContainer` goes past a function type.
                    FnKind::FunctionType | FnKind::ConstructorType => {}
                    _ => return None,
                },
                ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::Module(_)
                | ScopeKind::Enum(_) => return None,
                _ => {}
            }
            scope = bound.scopes[scope.idx()].parent;
        }
        None
    }

    /// Whether the `this` at `e` is `globalThis`, and if so whether an arrow function is on the way there: what `checkThisExpression`
    /// finds for a container and `tryGetThisTypeAtEx` makes of it.
    fn global_this(&mut self, e: ExprId) -> Option<bool> {
        if self.c.files().module(self.file).is_module() {
            return None;
        }
        if self.bound.is_in_type_query(e) {
            return self.global_this_in_type_query(e);
        }
        let mut is_captured = false;
        let mut node = Node::Expr(e);
        loop {
            let below = node;
            node = self.parent(node);
            match node {
                Node::Fn(f) if below == Node::Body(f) || below == Node::Params(f) => {
                    if self.hir[f].kind != FnKind::Arrow {
                        return None;
                    }
                    is_captured = true;
                }
                // The computed name of a method of an object literal is not in the method.
                Node::Fn(f) if matches!(self.bound.fns[f.idx()].owner, FnOwner::Expr(_)) => {}
                // A decorator is applied outside of the class.
                Node::Fn(_) | Node::Property(_) if self.is_decorator(below) => {}
                Node::Fn(_) | Node::Property(_) | Node::Enum(_) | Node::Module(_) | Node::Lost => {
                    return None;
                }
                Node::File => return Some(is_captured),
                _ => {}
            }
        }
    }

    /// `checkThisExpression`: 7041.
    fn check_this_expressions(&mut self) {
        if !self.c.p.files.options.no_implicit_this {
            return;
        }
        for i in 0..self.hir.exprs.len() {
            let e = ExprId(i as u32);
            if matches!(self.hir.exprs[i].kind, ExprKind::This)
                && self.is_bound(e)
                && self.global_this(e) == Some(true)
            {
                self.report(self.hir.exprs[i].pos, 7041);
            }
        }
    }
}

// ───────────────────────────── variables that find out their type as they go ─────────────────────────────

/// `autoType`, `autoArrayType`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum AutoKind {
    Value,
    Array,
}

/// What the flow of control makes of such a variable at a place, as far as it decides whether that is still `autoType` or
/// `autoArrayType`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Abs {
    Auto,
    AutoArray,
    /// An evolving array that nothing has been put in yet.
    EvolvingEmpty,
    /// One that holds something.
    Evolving,
    Never,
    /// `unreachableNeverType`
    UnreachableNever,
    /// Some other type, and which.
    Is(TypeId),
    /// Some other type.
    Other,
    /// It cannot be told.
    Unknown,
}

/// How it shows in the flow graph that the start of something has been got back to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Entry {
    /// By a node.
    Node,
    /// A namespace goes on from where it is written: by getting there, or by a node if it has one after all.
    At(FlowId),
    /// A computed name or a decorator is bound before what it belongs to, which as far as TypeScript goes starts with it.
    Here,
}

/// Something on the way out of which the flow of control starts afresh.
#[derive(Copy, Clone)]
struct Frame {
    node: Node,
    entry: Entry,
    /// `getControlFlowContainer` stops here. Not so at a function that is called where it is written or at a static block.
    is_container: bool,
}

/// `getFlowReferenceKey`
#[derive(Copy, Clone, PartialEq, Eq)]
struct FlowKey {
    symbol: SymbolId,
    initial: Abs,
    container: Node,
}

/// `FlowLoopInfo`
struct LoopInProgress {
    flow: FlowId,
    key: FlowKey,
    types: Vec<Abs>,
}

/// `FlowState`
struct Walk {
    symbol: SymbolId,
    declared: Abs,
    initial: Abs,
    frames: Vec<Frame>,
    /// Which of `frames` is the flow container.
    stop: usize,
    /// What was found at labels: for good, and during each round of the loops being worked out.
    labels: Vec<FxHashMap<FlowId, Abs>>,
    /// The `finally` blocks being gone back through: where each starts, and the label whose edges count instead.
    reduced: Vec<(FlowId, FlowId)>,
}

impl Walk {
    fn key(&self) -> FlowKey {
        FlowKey {
            symbol: self.symbol,
            initial: self.initial,
            container: self.frames[self.stop].node,
        }
    }

    fn known_at(&self, label: FlowId) -> Option<Abs> {
        if !self.reduced.is_empty() {
            return None;
        }
        self.labels
            .iter()
            .rev()
            .find_map(|round| round.get(&label))
            .copied()
    }

    fn remember(&mut self, label: FlowId, ty: Abs) {
        if self.reduced.is_empty()
            && let Some(round) = self.labels.last_mut()
        {
            round.insert(label, ty);
        }
    }
}

const MAX_STEPS: u32 = 2_000_000;

/// `finalizeEvolvingArrayType`
fn finalize(ty: Abs) -> Abs {
    match ty {
        Abs::EvolvingEmpty => Abs::AutoArray,
        Abs::Evolving => Abs::Other,
        _ => ty,
    }
}

impl Pass<'_, '_> {
    fn is_loop_variable_statement(&self, stmt: StmtId) -> bool {
        matches!(self.bound.stmt_parent[stmt.idx()], Parent::Stmt(l) if l.is_some()
            && matches!(self.hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt))
    }

    /// `isNullOrUndefined`
    fn is_null_or_undefined(&self, e: ExprId) -> bool {
        match self.hir[e].kind {
            ExprKind::Null => true,
            ExprKind::Ident(known::undefined) => self.bound.expr_symbol[e.idx()].is_none(),
            _ => false,
        }
    }

    /// `isEmptyArrayLiteral`
    fn is_empty_array_literal(&self, e: ExprId) -> bool {
        matches!(self.hir[e].kind, ExprKind::Array(items) if items.is_empty())
            && !self.is_parenthesized(e)
    }

    /// The name bound by `symbol.ValueDeclaration`, if that is a variable declaration in this file. `addDeclarationToSymbol` only
    /// takes it from declarations of values: an interface, a type alias or an uninstantiated namespace declared first is skipped.
    fn variable_value_declaration(&self, symbol: SymbolId) -> Option<PatId> {
        let is_variable = |d: &Decl| matches!(d, Decl::Var(_) | Decl::Param(_));
        let s = &self.bound.symbols[symbol.idx()];
        let Some(&Decl::Var(pat)) = s.decls.iter().find(|&d| is_variable(d)) else {
            return None;
        };
        // `mergeSymbol`: the first file that declares a global as a value provides the value declaration.
        if s.flags.contains(SymFlags::MERGED) {
            let sym = self.c.files().sym(self.file, symbol);
            if self
                .c
                .files()
                .decls(sym)
                .into_iter()
                .find(|(_, d)| is_variable(d))
                != Some((self.file, Decl::Var(pat)))
            {
                return None;
            }
        }
        Some(pat)
    }

    /// `getTypeForVariableLikeDeclaration` of `symbol.ValueDeclaration`: the cases that return `autoType` and `autoArrayType`.
    fn auto_variable(&self, symbol: SymbolId) -> Option<(AutoKind, PatId, VarDeclId)> {
        let (hir, bound) = (self.hir, self.bound);
        // Every node of a declaration file has `NodeFlagsAmbient`.
        if !self.no_implicit_any || hir.kind == FileKind::Declaration {
            return None;
        }
        let s = &bound.symbols[symbol.idx()];
        if !s.flags.intersects(SymFlags::VARIABLE) || s.flags.contains(SymFlags::PARAMETER) {
            return None;
        }
        let pat = self.variable_value_declaration(symbol)?;
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let decl = &hir[d];
        let stmt = bound.var_stmt[d.idx()];
        if decl.ty.is_some()
            || decl.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
            || stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::Var(_))
            || self.is_loop_variable_statement(stmt)
        {
            return None;
        }
        let is_constant = matches!(
            decl.kind,
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
        );
        if !is_constant && (decl.init.is_none() || self.is_null_or_undefined(decl.init)) {
            return Some((AutoKind::Value, pat, d));
        }
        (decl.init.is_some() && self.is_empty_array_literal(decl.init)).then_some((
            AutoKind::Array,
            pat,
            d,
        ))
    }

    /// `isMutableLocalVariableDeclaration`
    fn is_mutable_local(&self, d: VarDeclId) -> bool {
        let decl = &self.hir[d];
        let stmt = self.bound.var_stmt[d.idx()];
        decl.kind == VarKind::Let
            && !decl.flags.contains(Flags::EXPORT)
            && !(matches!(self.bound.stmt_parent[stmt.idx()], Parent::File)
                && !self.c.files().module(self.file).is_module())
    }

    /// `isSymbolAssignedDefinitely`
    fn is_assigned_definitely(&self, symbol: SymbolId) -> bool {
        let assignments = &self.bound.assignments;
        let from = assignments.partition_point(|a| a.0.0 < symbol.0);
        assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
            .any(|a| self.assignment_kind(a.1) == AssignmentKind::Definite)
    }

    /// Whether the flow of control goes on outside of `node`, where it is written, if the flow container is further out: a function
    /// expression, an arrow function, a method or an accessor of an object literal or a class expression.
    fn continues_outside(&self, node: Node) -> bool {
        let Node::Fn(f) = node else { return false };
        match (self.hir[f].kind, self.bound.fns[f.idx()].owner) {
            (FnKind::Expr | FnKind::Arrow, _) => true,
            (FnKind::Method | FnKind::Getter | FnKind::Setter, FnOwner::Expr(_)) => true,
            (FnKind::Method | FnKind::Getter | FnKind::Setter, FnOwner::Member(m)) => {
                matches!(self.bound.member_owner[m.idx()], MemberOwner::Class(c) if matches!(self.bound.class_owner[c.idx()], ClassOwner::Expr(_)))
            }
            _ => false,
        }
    }

    /// What the flow of control starts afresh in, from `e` outwards, up to and including the first of them it cannot go on outside of.
    fn frames(&self, e: ExprId) -> Option<Vec<Frame>> {
        let (hir, bound) = (self.hir, self.bound);
        let mut frames = Vec::new();
        let mut node = Node::Expr(e);
        loop {
            let below = node;
            node = self.parent(node);
            let frame = match node {
                Node::Fn(f) => {
                    let entry = if below == Node::Body(f) || below == Node::Params(f) {
                        Entry::Node
                    } else {
                        Entry::Here
                    };
                    Frame {
                        node,
                        entry,
                        is_container: hir[f].kind != FnKind::StaticBlock
                            && !self.is_immediately_invoked(f),
                    }
                }
                Node::Property(m) => {
                    // To the binder a property without an initializer is nothing to start afresh in.
                    if hir[m].init.is_none() {
                        return None;
                    }
                    Frame {
                        node,
                        entry: if below == Node::Initializer(m) {
                            Entry::Node
                        } else {
                            Entry::Here
                        },
                        is_container: true,
                    }
                }
                Node::Module(m) => {
                    let stmt = hir
                        .stmts
                        .iter()
                        .position(|s| matches!(s.kind, StmtKind::Module(x) if x == m))?;
                    Frame {
                        node,
                        entry: Entry::At(bound.stmt_flow[stmt]),
                        is_container: true,
                    }
                }
                Node::File => Frame {
                    node,
                    entry: Entry::Node,
                    is_container: true,
                },
                Node::Lost => return None,
                _ => continue,
            };
            frames.push(frame);
            if frame.is_container && !self.continues_outside(node) {
                return Some(frames);
            }
        }
    }

    /// `isEvolvingArrayOperationTarget`
    fn is_evolving_array_operation_target(&mut self, e: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        // `getReferenceRoot`
        let mut root = e;
        let parent = loop {
            let Parent::Expr(parent) = bound.expr_parent[root.idx()] else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::Assign {
                    op: None, target, ..
                } if target == root => root = parent,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if right == root => root = parent,
                _ => break parent,
            }
        };
        match hir[parent].kind {
            ExprKind::Dot { name, .. } => {
                name == known::length
                    || (name == known::push || name == known::unshift)
                        && !self.is_parenthesized(parent)
                        && matches!(bound.expr_parent[parent.idx()], Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(_)))
            }
            ExprKind::Index { obj, index, .. } if obj == root && !self.is_parenthesized(parent) => {
                let Parent::Expr(assignment) = bound.expr_parent[parent.idx()] else {
                    return false;
                };
                if !matches!(hir[assignment].kind, ExprKind::Assign { op: None, target, .. } if target == parent)
                    || self.assignment_kind(assignment) != AssignmentKind::None
                {
                    return false;
                }
                let index = self.c.type_of_expr(self.file, index);
                self.c.is_assignable(index, TypeId::NUMBER)
            }
            _ => false,
        }
    }

    /// The part of `checkIdentifier` that is about variables of type `autoType` and `autoArrayType`: 7034 at the declaration and 7005 at
    /// `e` if that is still all `e` is where it is written.
    fn check_auto_reference(&mut self, e: ExprId) {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = bound.expr_symbol[e.idx()];
        // `checkWithStatement` does not look at the body.
        if symbol.is_none() || hir.is_in_with(hir[e].pos) {
            return;
        }
        let Some((kind, pat, d)) = self.auto_variable(symbol) else {
            return;
        };
        let assignment = self.assignment_kind(e);
        // A constant that is assigned to is an error, and that is all that is said.
        if assignment == AssignmentKind::Definite
            || assignment != AssignmentKind::None
                && bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST)
        {
            return;
        }
        let flow = bound.expr_flow[e.idx()];
        let Some(frames) = self.frames(e) else { return };
        let Some(first) = frames.iter().position(|f| f.is_container) else {
            return;
        };
        let declaration_container = self.control_flow_container(self.around_variable(d));
        if flow.is_none() || declaration_container == Node::Lost {
            return;
        }
        let is_outer_variable = frames[first].node != declaration_container;
        let is_mutable_local = self.is_mutable_local(d);
        // From a function expression and the like, what has been assigned still holds if nothing is assigned any more.
        let mut stop = first;
        let mut is_settled = None;
        while frames[stop].node != declaration_container
            && self.continues_outside(frames[stop].node)
            && is_mutable_local
            && *is_settled
                .get_or_insert_with(|| self.c.is_past_last_assignment(self.file, symbol, e))
        {
            let Some(next) = frames[stop + 1..].iter().position(|f| f.is_container) else {
                return;
            };
            stop += 1 + next;
        }
        let is_never_initialized = hir[d].init.is_none()
            && !hir[d].flags.contains(Flags::DEFINITE)
            && is_mutable_local
            && !self.is_assigned_definitely(symbol);
        let is_in_non_null = !self.is_parenthesized(e)
            && matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::NonNull(_)));
        let assume_initialized = is_outer_variable && !is_never_initialized
            || is_in_non_null
            || hir[d].flags.contains(Flags::DEFINITE);
        let declared = if kind == AutoKind::Value {
            Abs::Auto
        } else {
            Abs::AutoArray
        };
        let initial = if assume_initialized && !is_in_non_null {
            declared
        } else {
            Abs::Is(TypeId::UNDEFINED)
        };
        let is_operation_target = self.is_evolving_array_operation_target(e);
        if is_operation_target {
            return;
        }
        // `getFlowTypeOfReferenceEx`
        let mut walk = Walk {
            symbol,
            declared,
            initial,
            frames,
            stop,
            labels: vec![FxHashMap::default()],
            reduced: Vec::new(),
        };
        let mut ty = finalize(self.type_at(&mut walk, flow, 0));
        if is_in_non_null {
            let is_nothing_but_nullish = match ty {
                Abs::Is(t) => t != TypeId::NEVER && self.c.every_type(t, |c, m| c.is_nullish(m)),
                Abs::Other | Abs::Unknown => return,
                _ => false,
            };
            if is_nothing_but_nullish {
                ty = declared;
            }
        }
        if ty == Abs::UnreachableNever {
            ty = declared;
        }
        // `GetNonNullableType`
        if is_in_non_null {
            ty = self.adjusted(ty, Facts::NEUndefinedOrNull);
        }
        if matches!(ty, Abs::Auto | Abs::AutoArray) && !self.is_changed_out_of_sight(&walk, e) {
            let (file, declared_at) = (self.file, hir[pat].pos);
            let shown = if ty == Abs::Auto { "any" } else { "any[]" };
            for (start, code) in [(declared_at, 7034), (hir[e].pos, 7005)] {
                self.report(start, code);
                self.c.explain(start, code, |c| {
                    vec![c.declaration_name_at(file, declared_at), shown.to_owned()]
                });
            }
        }
    }

    /// The functions around `e` that run then and there as far as the flow of control goes: those that are called where they are
    /// written, but for `async` ones and generators, and static blocks. And what they are in.
    fn inline_functions_around(&self, e: ExprId) -> (Vec<FnId>, Node) {
        let hir = self.hir;
        let mut inline = Vec::new();
        let mut node = Node::Expr(e);
        loop {
            node = self.parent(node);
            match node {
                Node::Fn(f)
                    if hir[f].kind == FnKind::StaticBlock
                        || self.is_immediately_invoked(f)
                            && !hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR) =>
                {
                    inline.push(f);
                }
                Node::Fn(_) | Node::Property(_) | Node::Module(_) | Node::File | Node::Lost => {
                    return (inline, node);
                }
                _ => {}
            }
        }
    }

    /// Whether there is a loop around `e` in `container`, which `e` is in.
    fn is_in_loop(&self, e: ExprId, container: Node) -> bool {
        let mut node = Node::Expr(e);
        loop {
            node = self.parent(node);
            match node {
                _ if node == container => return false,
                Node::Stmt(s) => {
                    if matches!(
                        self.hir[s].kind,
                        StmtKind::For { .. }
                            | StmtKind::ForIn { .. }
                            | StmtKind::ForOf { .. }
                            | StmtKind::While { .. }
                            | StmtKind::DoWhile { .. }
                    ) {
                        return true;
                    }
                }
                Node::Module(_) | Node::File | Node::Lost => return false,
                _ => {}
            }
        }
    }

    /// Whether, on the way `w` went to `e`, the variable is named in a function that runs then and there and that `e` is not in.
    /// To TypeScript's binder control comes back out of those with what they did (`bindContainer`); the flow graph here goes past them.
    fn is_changed_out_of_sight(&self, w: &Walk, e: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_gone_through =
            |node: Node| w.frames[..=w.stop].iter().any(|frame| frame.node == node);
        let is_in_loop = self.is_in_loop(e, w.frames[w.stop].node);
        (0..hir.exprs.len()).any(|i| {
            // What comes later has not run yet, unless control comes round again.
            if bound.expr_symbol[i] != w.symbol || !is_in_loop && hir.exprs[i].pos > hir[e].pos {
                return false;
            }
            let (inline, container) = self.inline_functions_around(ExprId(i as u32));
            is_gone_through(container) && inline.iter().any(|&f| !is_gone_through(Node::Fn(f)))
        })
    }
}

/// What is met on the way back, to be applied on the way forward again.
enum Pending {
    Cond(ExprId, bool),
    Switch(StmtId, u16, u16),
    /// A call that asserts something.
    Assert(ExprId),
    /// `a.push(x)`, `a[i] = x`
    Mutation(ExprId),
    /// `for (const k in a)`: there is an `a`.
    ForIn,
}

impl Pass<'_, '_> {
    /// Where control is when a static block is got to, which runs then and there.
    fn flow_around(&self, node: Node) -> FlowId {
        let (hir, bound) = (self.hir, self.bound);
        if let Node::Fn(f) = node
            && hir[f].kind == FnKind::StaticBlock
            && let FnOwner::Member(m) = bound.fns[f.idx()].owner
            && let MemberOwner::Class(c) = bound.member_owner[m.idx()]
            && let ClassOwner::Stmt(s) = bound.class_owner[c.idx()]
            // What a static block further up did does not show where the class starts.
            && !hir[c].members.iter().any(|x| x.0 < m.0 && hir[x].kind == MemberKind::StaticBlock)
        {
            return bound.stmt_flow[s.idx()];
        }
        FlowId::NONE
    }

    /// `getTypeAtFlowNode`. `level`: which of the frames of `w` `start` is in.
    fn type_at(&mut self, w: &mut Walk, start: FlowId, level: usize) -> Abs {
        let bound = self.bound;
        if self.c.is_stack_low() {
            return Abs::Unknown;
        }
        let (mut flow, mut level) = (start, level);
        let mut pending: Vec<Pending> = Vec::new();
        let mut ty = loop {
            self.steps += 1;
            if self.steps > MAX_STEPS || flow.is_none() {
                break Abs::Unknown;
            }
            let Some(&frame) = w.frames.get(level) else {
                break Abs::Unknown;
            };
            let node = bound.flow[flow.idx()];
            // Where it goes on, if this is where `frame` starts.
            let outside = match (frame.entry, node) {
                (Entry::Here, _) => Some(flow),
                (Entry::At(entry), _) if flow == entry => Some(FlowId::NONE),
                (Entry::At(_), Flow::Start { .. }) => Some(FlowId::NONE),
                (Entry::Node, Flow::Start { outer, .. } | Flow::StartInvoked { outer, .. }) => {
                    Some(if outer.is_some() {
                        outer
                    } else {
                        self.flow_around(frame.node)
                    })
                }
                _ => None,
            };
            if let Some(outside) = outside {
                if frame.is_container && level == w.stop {
                    break w.initial;
                }
                // Where control was before a computed name or a decorator is not looked for.
                if frame.entry == Entry::Here {
                    break Abs::Unknown;
                }
                flow = outside;
                level += 1;
                continue;
            }
            match node {
                // "Simply return the non-auto declared type to reduce follow-on errors."
                Flow::Unreachable => break Abs::Other,
                Flow::Start { .. } | Flow::StartInvoked { .. } => break Abs::Unknown,
                Flow::Assign { before, target } => {
                    if self.assigns_to(w.symbol, target) {
                        if !self.c.is_reachable(self.file, flow) {
                            break Abs::UnreachableNever;
                        }
                        // `getBaseTypeOfLiteralType` of what it was before, which makes no difference here.
                        if let FlowTarget::Expr(x) = target
                            && self.assignment_kind(x) == AssignmentKind::Compound
                        {
                            flow = before;
                            continue;
                        }
                        break self.assigned_type(w, target);
                    }
                    if self.is_for_in_over(w.symbol, target) {
                        pending.push(Pending::ForIn);
                    }
                    flow = before;
                }
                // `getTypeAtFlowCall`
                Flow::Call { before, call } => {
                    if let Some(sig) = self.effects_signature(call, true) {
                        match self.c.sig_predicate(sig) {
                            Some(predicate) if predicate.asserts => {
                                pending.push(Pending::Assert(call))
                            }
                            _ if self.c.sig_return(sig) == TypeId::NEVER => {
                                break Abs::UnreachableNever;
                            }
                            _ => {}
                        }
                    }
                    flow = before;
                }
                Flow::Cond {
                    before,
                    expr,
                    sense,
                } => {
                    pending.push(Pending::Cond(expr, sense));
                    flow = before;
                }
                Flow::Switch {
                    before,
                    stmt,
                    from,
                    to,
                } => {
                    pending.push(Pending::Switch(stmt, from, to));
                    flow = before;
                }
                Flow::ArrayMutation { before, expr } => {
                    if self.mutated_array(expr).is_some_and(|array| {
                        self.is_matching(w.symbol, self.reference_candidate(array))
                    }) {
                        pending.push(Pending::Mutation(expr));
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    w.reduced.push((label, instead));
                    let ty = self.type_at(w, before, level);
                    w.reduced.pop();
                    break ty;
                }
                Flow::Label { start, len } => break self.type_at_label(w, flow, start, len, level),
                Flow::Loop { start, len } => match *bound.edges(start, len) {
                    [] => break Abs::Never,
                    [only] => flow = only,
                    _ => break self.type_at_loop(w, flow, start, len, level),
                },
            }
        };
        for p in pending.into_iter().rev() {
            ty = match p {
                // `getTypeAtFlowCondition`
                Pending::Cond(expr, sense) => {
                    if matches!(ty, Abs::Never | Abs::UnreachableNever | Abs::Unknown) {
                        continue;
                    }
                    let seen = finalize(ty);
                    let narrowed = self.narrow(w, seen, expr, sense);
                    if narrowed == seen { ty } else { narrowed }
                }
                Pending::Switch(stmt, from, to) => {
                    self.type_at_switch_clause(w, ty, stmt, from as usize, to as usize)
                }
                Pending::Assert(call) => {
                    let seen = finalize(ty);
                    let narrowed = self.narrow_by_asserting_call(w, seen, call);
                    if narrowed == seen { ty } else { narrowed }
                }
                Pending::Mutation(expr) => self.type_after_array_mutation(ty, expr),
                // `getNonNullableTypeIfNeeded`, which `any` and an array do not need.
                Pending::ForIn => match finalize(ty) {
                    Abs::Is(_) => Abs::Other,
                    seen => seen,
                },
            };
        }
        ty
    }

    fn assigns_to(&self, symbol: SymbolId, target: FlowTarget) -> bool {
        match target {
            FlowTarget::Var(d) => self.bound.pat_symbol[self.hir[d].pat.idx()] == symbol,
            FlowTarget::Pat(p) => self.bound.pat_symbol[p.idx()] == symbol,
            FlowTarget::Expr(x) => self.is_matching(symbol, x),
        }
    }

    /// Whether `target` is the variable of a `for`-`in` loop over the variable `symbol`.
    fn is_for_in_over(&self, symbol: SymbolId, target: FlowTarget) -> bool {
        let FlowTarget::Var(d) = target else {
            return false;
        };
        let stmt = self.bound.var_stmt[d.idx()];
        if stmt.is_none() {
            return false;
        }
        let Parent::Stmt(l) = self.bound.stmt_parent[stmt.idx()] else {
            return false;
        };
        l.is_some()
            && matches!(self.hir[l].kind, StmtKind::ForIn { left, expr, .. }
                if left == stmt && (self.is_matching(symbol, expr) || self.optional_chain_contains(symbol, expr)))
    }

    /// What `getTypeAtFlowAssignment` makes of an assignment to a variable of type `autoType` or `autoArrayType`.
    fn assigned_type(&mut self, w: &Walk, target: FlowTarget) -> Abs {
        let (hir, bound) = (self.hir, self.bound);
        let (value, is_default) = match target {
            FlowTarget::Var(d) => (hir[d].init, false),
            FlowTarget::Pat(_) => (ExprId::NONE, false),
            FlowTarget::Expr(x) => match bound.expr_parent[x.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    // `[x = d] = v`: `d` is only for want of anything better.
                    ExprKind::Assign { target, value, .. } if target == x => {
                        (value, self.assignment_kind(parent) != AssignmentKind::None)
                    }
                    _ => (ExprId::NONE, false),
                },
                _ => (ExprId::NONE, false),
            },
        };
        if value.is_none() {
            return Abs::Other;
        }
        // `isEmptyArrayAssignment`
        if self.is_empty_array_literal(value) {
            return Abs::EvolvingEmpty;
        }
        if is_default {
            return Abs::Other;
        }
        // `getInitialOrAssignedType` looks at what is assigned, while the loops on the way here are still being worked out.
        if !self.loops.is_empty() {
            self.visit_for_type(value);
        }
        let assigned = self.c.type_of_expr(self.file, value);
        if !self.c.is_known(assigned) {
            return Abs::Other;
        }
        let assigned = self.c.widen_literal(assigned);
        if assigned == TypeId::NEVER {
            return Abs::Never;
        }
        if w.declared == Abs::AutoArray {
            let any_array = self.c.array_of(TypeId::ANY);
            if !self.c.is_assignable(assigned, any_array) {
                return Abs::Is(any_array);
            }
        }
        Abs::Is(assigned)
    }

    /// The `a` of `a.push(x)`, `a.unshift(x)` and `a[i] = x`. Neither `(a.push)(x)` nor `(a[i]) = x` is bound as one of them.
    fn mutated_array(&self, expr: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let (access, array) = match hir[expr].kind {
            ExprKind::Call(c) => match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, .. } => (hir[c].callee, obj),
                _ => return None,
            },
            ExprKind::Assign { target, .. } => match hir[target].kind {
                ExprKind::Index { obj, .. } => (target, obj),
                _ => return None,
            },
            _ => return None,
        };
        (!self.is_parenthesized(access)).then_some(array)
    }

    /// `getTypeAtFlowArrayMutation`, of a mutation of the variable.
    fn type_after_array_mutation(&mut self, ty: Abs, expr: ExprId) -> Abs {
        let hir = self.hir;
        if ty != Abs::EvolvingEmpty {
            return ty;
        }
        let added: Vec<ExprId> = match hir[expr].kind {
            ExprKind::Call(c) => hir.ids(hir[c].args).collect(),
            ExprKind::Assign { target, value, .. } => {
                let ExprKind::Index { index, .. } = hir[target].kind else {
                    return ty;
                };
                let index = self.c.type_of_expr(self.file, index);
                if !self.c.is_known(index) {
                    return Abs::Unknown;
                }
                if self.c.is_assignable(index, TypeId::NUMBER) {
                    vec![value]
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        };
        // `addEvolvingArrayElementType`: only `never` is part of nothing.
        let mut ty = ty;
        for value in added {
            if !self.loops.is_empty() {
                self.visit(value);
            }
            let element = match hir[value].kind {
                ExprKind::Spread(inner) => {
                    let spread = self.c.type_of_expr(self.file, inner);
                    self.c.iterated_type(spread, false)
                }
                _ => self.c.type_of_expr(self.file, value),
            };
            if !self.c.is_known(element) {
                return Abs::Unknown;
            }
            if element != TypeId::NEVER {
                ty = Abs::Evolving;
            }
        }
        ty
    }

    /// `getTypeAtFlowBranchLabel`
    fn type_at_label(
        &mut self,
        w: &mut Walk,
        flow: FlowId,
        start: u32,
        len: u32,
        level: usize,
    ) -> Abs {
        let bound = self.bound;
        // Where a `finally` block that is being gone back through starts: on with the ways in that count.
        if let Some(at) = w.reduced.iter().rposition(|r| r.0 == flow) {
            let entry = w.reduced.remove(at);
            let ty = self.type_at(w, entry.1, level);
            w.reduced.insert(at, entry);
            return ty;
        }
        if let Some(known) = w.known_at(flow) {
            return known;
        }
        let is_always_assigned = w.declared == w.initial;
        let mut types: Vec<Abs> = Vec::with_capacity(len as usize);
        // The way past a `switch` none of whose cases matched.
        let mut bypass = None;
        for &edge in bound.edges(start, len) {
            if bypass.is_none()
                && let Flow::Switch { from, to, .. } = bound.flow[edge.idx()]
                && from == to
            {
                bypass = Some(edge);
                continue;
            }
            let ty = self.type_at(w, edge, level);
            if ty == w.declared && is_always_assigned {
                w.remember(flow, ty);
                return ty;
            }
            if !types.contains(&ty) {
                types.push(ty);
            }
        }
        if let Some(edge) = bypass {
            let ty = self.type_at(w, edge, level);
            // There is no such way if the cases cover everything.
            if !matches!(ty, Abs::Never | Abs::UnreachableNever)
                && !types.contains(&ty)
                && self.c.is_reachable(self.file, edge)
            {
                if ty == w.declared && is_always_assigned {
                    w.remember(flow, ty);
                    return ty;
                }
                types.push(ty);
            }
        }
        let ty = self.join(&types, true);
        w.remember(flow, ty);
        ty
    }

    /// `getTypeAtFlowLoopLabel`
    fn type_at_loop(
        &mut self,
        w: &mut Walk,
        flow: FlowId,
        start: u32,
        len: u32,
        level: usize,
    ) -> Abs {
        let bound = self.bound;
        if let Some(known) = w.known_at(flow) {
            return known;
        }
        let key = w.key();
        // Being worked out already: what has reached it so far, none of which is taken out for being a subtype of another. It is
        // not all there is yet, so that there is nothing is not to say that control cannot get here (`newFlowType`).
        if let Some(l) = self
            .loops
            .iter()
            .find(|l| l.flow == flow && l.key == key && !l.types.is_empty())
        {
            let types = l.types.clone();
            return match self.join(&types, false) {
                Abs::UnreachableNever => Abs::Never,
                ty => ty,
            };
        }
        let mut types: Vec<Abs> = Vec::new();
        for (i, &edge) in bound.edges(start, len).iter().enumerate() {
            // The first is the way in, the rest are the ways back.
            let ty = if i == 0 {
                self.type_at(w, edge, level)
            } else {
                self.loops.push(LoopInProgress {
                    flow,
                    key,
                    types: types.clone(),
                });
                w.labels.push(FxHashMap::default());
                let ty = self.type_at(w, edge, level);
                w.labels.pop();
                self.loops.pop();
                ty
            };
            if !types.contains(&ty) {
                types.push(ty);
            }
            if ty == w.declared {
                break;
            }
        }
        let ty = self.join(&types, true);
        w.remember(flow, ty);
        ty
    }

    /// `getUnionOrEvolvingArrayType`, of types no two of which are the same. `is_reduced`: with `UnionReductionSubtype`, which is
    /// called for wherever paths meet by whatever is not what the variable started as; if not, with `UnionReductionLiteral`.
    fn join(&mut self, types: &[Abs], is_reduced: bool) -> Abs {
        if let [only] = types {
            return *only;
        }
        if types.contains(&Abs::Unknown) {
            return Abs::Unknown;
        }
        let rest: Vec<Abs> = types
            .iter()
            .copied()
            .filter(|t| !matches!(t, Abs::Never | Abs::UnreachableNever))
            .collect();
        if rest.is_empty() {
            return Abs::Never;
        }
        // `isEvolvingArrayTypeList`
        if rest
            .iter()
            .all(|t| matches!(t, Abs::EvolvingEmpty | Abs::Evolving))
        {
            return if rest.contains(&Abs::Evolving) {
                Abs::Evolving
            } else {
                Abs::EvolvingEmpty
            };
        }
        // A union with `autoType` in it is `any`, the ordinary one.
        if rest.contains(&Abs::Auto) {
            return Abs::Other;
        }
        if !rest
            .iter()
            .any(|t| matches!(t, Abs::AutoArray | Abs::EvolvingEmpty))
        {
            return if let [only] = rest[..] {
                finalize(only)
            } else {
                Abs::Other
            };
        }
        if !is_reduced {
            // Nothing goes but `null` and `undefined`, which without `strictNullChecks` are part of everything.
            let is_alone = rest.iter().all(|t| match t {
                Abs::AutoArray | Abs::EvolvingEmpty => true,
                Abs::Is(t) => !self.strict && (t.is_null() || t.is_undefined()),
                _ => false,
            });
            return if is_alone { Abs::AutoArray } else { Abs::Other };
        }
        // Subtype reduction leaves `autoArrayType` alone if all the others are subtypes of it. The ordinary `any[]` is older and
        // stays in its place.
        let any_array = self.c.array_of(TypeId::ANY);
        for t in rest {
            match t {
                Abs::AutoArray | Abs::EvolvingEmpty => {}
                Abs::Is(t) if t != any_array && self.c.is_strict_subtype(t, any_array) => {}
                Abs::Is(_) => return Abs::Other,
                _ => return Abs::Unknown,
            }
        }
        Abs::AutoArray
    }

    // ───────────────────────────── looking at an expression the way TypeScript does on its way ─────────────────────────────

    /// `getTypeOfExpression`: the names in `e` are looked at, with the loops that are being worked out as they stand.
    fn visit_for_type(&mut self, e: ExprId) {
        if !self.visit_quickly(e) {
            self.visit(e);
        }
    }

    /// `getQuickTypeOfExpression`: whether the type of `e` is to be had without looking at all of it.
    fn visit_quickly(&mut self, e: ExprId) -> bool {
        let hir = self.hir;
        match hir[e].kind {
            ExprKind::Await(x) => self.visit_quickly(x),
            ExprKind::Call(c) | ExprKind::New(c)
                if !matches!(hir[hir[c].callee].kind, ExprKind::Super) =>
            {
                let is_new = matches!(hir[e].kind, ExprKind::New(_));
                self.visit(hir[c].callee);
                // `getReturnTypeOfSingleNonGenericSignature`
                let callee = self.c.type_of_expr(self.file, hir[c].callee);
                let callee = self.c.non_nullable(callee);
                if !self.c.is_object_type(callee) {
                    return false;
                }
                let (wanted, other) = (
                    self.c.signatures(callee, is_new),
                    self.c.signatures(callee, !is_new),
                );
                matches!(wanted[..], [only] if other.is_empty() && self.c.sig_type_params(only).is_empty())
            }
            ExprKind::As { .. }
            | ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::True
            | ExprKind::False => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => false,
        }
    }

    /// `checkExpression`, as far as the names in `e` go. What is in functions, classes and JSX elements is looked at later.
    fn visit(&mut self, e: ExprId) {
        let mut pending = vec![e];
        while let Some(x) = pending.pop() {
            if self.steps > MAX_STEPS {
                return;
            }
            match self.hir[x].kind {
                ExprKind::Ident(_) => self.check_auto_reference(x),
                // `checkJsxElement`, `checkJsxSelfClosingElement`. Not so a fragment.
                ExprKind::Jsx(j) if self.hir[j].tag.is_some() => {}
                _ => self.push_children(x, &mut pending),
            }
        }
    }

    // ───────────────────────────── calls that assert or never return ─────────────────────────────

    /// `getExplicitTypeOfSymbol`
    fn explicit_type_of_symbol(&mut self, sym: Sym) -> Option<TypeId> {
        let sym = self.c.files().resolve_alias_if_needed(sym)?;
        let flags = self.c.files().flags(sym);
        if flags.intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::VALUE_MODULE) {
            return Some(self.c.type_of_symbol(sym));
        }
        if !flags.intersects(SymFlags::VARIABLE) {
            return None;
        }
        let (file, decl) = *self.c.files().decls(sym).first()?;
        let (Decl::Var(pat) | Decl::Param(pat)) = decl else {
            return None;
        };
        let annotation = match self.c.bound(file).pat_parent[pat.idx()] {
            PatParent::Var(d) => self.c.hir(file)[d].ty,
            PatParent::Param(p) => self.c.hir(file)[p].ty,
            _ => TypeNodeId::NONE,
        };
        if annotation.is_some() {
            Some(self.c.type_of_symbol(sym))
        } else {
            None
        }
    }

    /// `getTypeOfDottedName`: the type of `e` as far as annotations say.
    fn type_of_dotted_name(&mut self, e: ExprId) -> Option<TypeId> {
        match self.hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.c.symbol_of_identifier(self.file, e, name)?;
                self.explicit_type_of_symbol(sym)
            }
            ExprKind::This => Some(self.c.type_of_expr(self.file, e)),
            ExprKind::Dot { obj, name, .. } => {
                let obj = self.type_of_dotted_name(obj)?;
                let apparent = self.c.apparent_type(obj);
                let (prop, mapper) = self.c.prop_of(apparent, name)?;
                let is_explicit = match prop.source {
                    PropSource::Members(ref members) => {
                        let (file, m) = *members.first()?;
                        let member = &self.c.hir(file)[m];
                        member.kind == MemberKind::Method
                            || member.kind == MemberKind::Property && member.ty.is_some()
                    }
                    PropSource::Parameter(file, p) => self.c.hir(file)[p].ty.is_some(),
                    PropSource::Symbol(sym) => self.explicit_type_of_symbol(sym).is_some(),
                    _ => false,
                };
                if is_explicit {
                    Some(self.c.type_of_prop(&prop, mapper))
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// `hasTypePredicateOrNeverReturnType`
    fn has_type_predicate_or_never_return_type(&mut self, sig: SigId) -> bool {
        if self.c.sig_predicate(sig).is_some() {
            return true;
        }
        match self.c.sig_decl(sig) {
            Some((file, func, _)) if self.c.hir(file)[func].ret.is_some() => {
                self.c.sig_return(sig) == TypeId::NEVER
            }
            _ => false,
        }
    }

    /// `getEffectsSignature`. Of a call that is a statement, only what annotations say of what is called counts.
    fn effects_signature(&mut self, call: ExprId, is_statement: bool) -> Option<SigId> {
        let ExprKind::Call(c) = self.hir[call].kind else {
            return None;
        };
        let callee = self.hir[c].callee;
        if matches!(self.hir[callee].kind, ExprKind::Super) {
            return None;
        }
        let callee = if is_statement {
            self.type_of_dotted_name(callee)?
        } else {
            let ty = self.c.type_of_expr(self.file, callee);
            self.c.non_nullable(ty)
        };
        let sigs = self.c.signatures(callee, false);
        let sig = match sigs[..] {
            [only] if self.c.sig_type_params(only).is_empty() => only,
            _ => {
                if !sigs
                    .iter()
                    .any(|&s| self.has_type_predicate_or_never_return_type(s))
                {
                    return None;
                }
                self.c.resolve_call(self.file, call).sig?
            }
        };
        self.has_type_predicate_or_never_return_type(sig)
            .then_some(sig)
    }
}

// ───────────────────────────── narrowing `autoType` and `autoArrayType` ─────────────────────────────

/// The `TypeFacts` that are asked for here.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Facts {
    Truthy,
    Falsy,
    NEUndefinedOrNull,
    EQUndefinedOrNull,
    NEUndefined,
    EQUndefined,
    NENull,
    EQNull,
}

/// `getUnionType`
fn union_of(types: &[Abs]) -> Abs {
    if let [only] = types {
        return *only;
    }
    if types.contains(&Abs::Unknown) {
        return Abs::Unknown;
    }
    // Not `autoType`: the ordinary `any`.
    if types.contains(&Abs::Auto) {
        return Abs::Other;
    }
    let mut rest: Vec<Abs> = Vec::new();
    for &t in types {
        if !matches!(t, Abs::Never | Abs::UnreachableNever) && !rest.contains(&t) {
            rest.push(t);
        }
    }
    match rest[..] {
        [] => Abs::Never,
        [only] => only,
        _ => Abs::Other,
    }
}

impl Pass<'_, '_> {
    /// `isMatchingReference(reference, e)`, where the reference is the variable `symbol`.
    fn is_matching(&self, symbol: SymbolId, mut e: ExprId) -> bool {
        loop {
            match self.hir[e].kind {
                ExprKind::NonNull(x) => e = x,
                ExprKind::Assign { target, .. } => e = target,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => e = right,
                ExprKind::Ident(_) => return self.bound.expr_symbol[e.idx()] == symbol,
                _ => return false,
            }
        }
    }

    /// `isMatchingReference(e, reference)`
    fn is_the_reference(&self, symbol: SymbolId, mut e: ExprId) -> bool {
        loop {
            match self.hir[e].kind {
                ExprKind::NonNull(x)
                | ExprKind::Satisfies { expr: x, .. }
                | ExprKind::Binary {
                    op: BinOp::Comma,
                    right: x,
                    ..
                } => e = x,
                ExprKind::Ident(_) => return self.bound.expr_symbol[e.idx()] == symbol,
                _ => return false,
            }
        }
    }

    /// `getReferenceCandidate`
    fn reference_candidate(&self, mut e: ExprId) -> ExprId {
        loop {
            match self.hir[e].kind {
                ExprKind::Assign {
                    op: None | Some(BinOp::Or | BinOp::And | BinOp::Nullish),
                    target,
                    ..
                } => e = target,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => e = right,
                _ => return e,
            }
        }
    }

    /// `optionalChainContainsReference`
    fn optional_chain_contains(&self, symbol: SymbolId, e: ExprId) -> bool {
        let hir = self.hir;
        let mut at = e;
        while self.c.is_in_optional_chain(self.file, at) {
            at = match hir[at].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(c) => hir[c].callee,
                ExprKind::NonNull(x) => x,
                _ => return false,
            };
            if self.is_the_reference(symbol, at) {
                return true;
            }
        }
        false
    }

    /// `IsExpressionOfOptionalChainRoot`, or the left of `??` or `??=`.
    fn is_tested_for_presence(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let Parent::Expr(parent) = self.bound.expr_parent[e.idx()] else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Dot {
                obj,
                chain: Chain::Start,
                ..
            }
            | ExprKind::Index {
                obj,
                chain: Chain::Start,
                ..
            } => obj == e,
            ExprKind::Call(c) => hir[c].chain == Chain::Start && hir[c].callee == e,
            ExprKind::Binary {
                op: BinOp::Nullish,
                left,
                ..
            } => left == e,
            ExprKind::Assign {
                op: Some(BinOp::Nullish),
                target,
                ..
            } => target == e,
            _ => false,
        }
    }

    /// Whether the variable `symbol` is named anywhere in `e`, functions and classes aside.
    fn mentions(&self, e: ExprId, symbol: SymbolId) -> bool {
        let mut pending = vec![e];
        while let Some(x) = pending.pop() {
            if matches!(self.hir[x].kind, ExprKind::Ident(_)) {
                // A constant may stand for a test of it.
                let named = self.bound.expr_symbol[x.idx()];
                if named == symbol
                    || named.is_some()
                        && self.bound.symbols[named.idx()]
                            .flags
                            .contains(SymFlags::CONST)
                {
                    return true;
                }
            } else {
                self.push_children(x, &mut pending);
            }
        }
        false
    }

    /// `getAdjustedTypeWithFacts`
    fn adjusted(&self, ty: Abs, facts: Facts) -> Abs {
        if !self.strict {
            return ty;
        }
        match (ty, facts) {
            // `NonNullable<any>`, `any & {}`: the ordinary `any`.
            (
                Abs::Auto,
                Facts::Truthy | Facts::NEUndefinedOrNull | Facts::NEUndefined | Facts::NENull,
            ) => Abs::Other,
            (
                Abs::AutoArray,
                Facts::Falsy | Facts::EQUndefinedOrNull | Facts::EQUndefined | Facts::EQNull,
            ) => Abs::Never,
            _ => ty,
        }
    }

    /// Whether `undefined` or `null`, whichever `nullish` is, is still what the variable `symbol` can be where `e` has come out as
    /// `sense`. `None`: `e` is none of the plain tests of the variable that this is told of.
    fn is_still_nullish(
        &self,
        symbol: SymbolId,
        nullish: TypeId,
        mut e: ExprId,
        mut sense: bool,
    ) -> Option<bool> {
        let hir = self.hir;
        loop {
            // `narrowTypeByOptionality`
            if self.is_tested_for_presence(e) {
                return self.is_matching(symbol, e).then_some(!sense);
            }
            match hir[e].kind {
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => (e, sense) = (operand, !sense),
                // `narrowTypeByTruthiness`
                ExprKind::Ident(_) | ExprKind::NonNull(_) => {
                    return self.is_matching(symbol, e).then_some(!sense);
                }
                // `narrowTypeByEquality`
                ExprKind::Binary {
                    op: op @ (BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq),
                    left,
                    right,
                } => {
                    let (left, right) = (
                        self.reference_candidate(left),
                        self.reference_candidate(right),
                    );
                    let is_equal = sense == matches!(op, BinOp::EqEq | BinOp::EqEqEq);
                    // `narrowTypeByTypeof`
                    for (a, b) in [(left, right), (right, left)] {
                        if let ExprKind::Unary {
                            op: UnOp::Typeof,
                            operand,
                        } = hir[a].kind
                            && let Some(text) = self.string_literal_like(b)
                        {
                            let is_its_name = text
                                == if nullish.is_null() {
                                    known::object
                                } else {
                                    known::undefined
                                };
                            return self
                                .is_matching(symbol, self.reference_candidate(operand))
                                .then_some(is_equal == is_its_name);
                        }
                    }
                    let value = if self.is_matching(symbol, left) {
                        right
                    } else if self.is_matching(symbol, right) {
                        left
                    } else {
                        return None;
                    };
                    if !self.is_null_or_undefined(value) {
                        return None;
                    }
                    let is_same = matches!(op, BinOp::EqEq | BinOp::NotEq)
                        || matches!(hir[value].kind, ExprKind::Null) == nullish.is_null();
                    return Some(!self.strict || is_equal == is_same);
                }
                _ => return None,
            }
        }
    }

    /// `narrowType`. Only of `autoType` and `autoArrayType` is it told what becomes of them, and of `undefined` and `null` under the
    /// plainest of tests.
    fn narrow(&mut self, w: &Walk, ty: Abs, e: ExprId, sense: bool) -> Abs {
        let hir = self.hir;
        if let Abs::Is(nullish) = ty
            && (nullish.is_undefined() || nullish.is_null())
            && let Some(is_still) = self.is_still_nullish(w.symbol, nullish, e, sense)
        {
            return if is_still { ty } else { Abs::Never };
        }
        if !matches!(ty, Abs::Auto | Abs::AutoArray) {
            return if matches!(ty, Abs::Is(_)) && self.mentions(e, w.symbol) {
                Abs::Other
            } else {
                ty
            };
        }
        // `narrowTypeByOptionality`
        if self.is_tested_for_presence(e) {
            let facts = if sense {
                Facts::NEUndefinedOrNull
            } else {
                Facts::EQUndefinedOrNull
            };
            return if self.is_matching(w.symbol, e) {
                self.adjusted(ty, facts)
            } else {
                ty
            };
        }
        match hir[e].kind {
            ExprKind::Ident(_) => {
                // A constant that holds a test stands for the test, if what is tested cannot have changed since.
                if !self.is_matching(w.symbol, e)
                    && self.inline_level < 5
                    && let Some(test) = self.aliased_condition(e)
                    && self.is_constant_reference(w.symbol)
                {
                    self.inline_level += 1;
                    let narrowed = self.narrow(w, ty, test, sense);
                    self.inline_level -= 1;
                    return narrowed;
                }
                self.narrow_by_truthiness(w, ty, e, sense)
            }
            ExprKind::This | ExprKind::Super | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.narrow_by_truthiness(w, ty, e, sense)
            }
            ExprKind::Call(_) => self.narrow_by_call(w, ty, e, sense),
            ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.narrow(w, ty, x, sense)
            }
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.narrow(w, ty, operand, !sense),
            // `narrowTypeByBinaryExpression`
            ExprKind::Assign {
                op: None | Some(BinOp::Or | BinOp::And | BinOp::Nullish),
                target,
                value,
            } => {
                let ty = self.narrow(w, ty, value, sense);
                self.narrow_by_truthiness(w, ty, target, sense)
            }
            ExprKind::Binary {
                op: op @ (BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq),
                left,
                right,
            } => self.narrow_by_comparison(w, ty, op, left, right, sense),
            ExprKind::Binary {
                op: BinOp::Instanceof,
                left,
                right,
            } => self.narrow_by_instanceof(w, ty, left, right, sense),
            ExprKind::Binary {
                op: BinOp::In,
                left,
                right,
            } => {
                if !self.is_matching(w.symbol, self.reference_candidate(right)) {
                    return ty;
                }
                let key = self.c.type_of_expr(self.file, left);
                if !self.c.is_known(key) || ty == Abs::AutoArray {
                    return Abs::Unknown;
                }
                // Nothing is known to be in `any`: with the property it is `any & Record<K, unknown>`.
                if self.c.property_name_of_type(key).is_some() && sense {
                    Abs::Other
                } else {
                    ty
                }
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.narrow(w, ty, right, sense),
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                left,
                right,
            } => {
                if (op == BinOp::And) == sense {
                    let ty = self.narrow(w, ty, left, sense);
                    self.narrow(w, ty, right, sense)
                } else {
                    union_of(&[
                        self.narrow(w, ty, left, sense),
                        self.narrow(w, ty, right, sense),
                    ])
                }
            }
            _ => ty,
        }
    }

    /// The initializer of the constant `e` names, if its type is left to the initializer.
    fn aliased_condition(&self, e: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() || !bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST) {
            return None;
        }
        let Some(&Decl::Var(pat)) = bound.symbols[symbol.idx()].decls.first() else {
            return None;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        (hir[d].ty.is_none() && hir[d].init.is_some()).then_some(hir[d].init)
    }

    /// `isConstantReference`, of a variable of type `autoType` or `autoArrayType`.
    fn is_constant_reference(&self, symbol: SymbolId) -> bool {
        let flags = self.bound.symbols[symbol.idx()].flags;
        flags.contains(SymFlags::CONST)
            || !flags.contains(SymFlags::ASSIGNED)
                && self
                    .auto_variable(symbol)
                    .is_some_and(|(_, _, d)| self.is_mutable_local(d))
    }

    /// `narrowTypeByTruthiness`
    fn narrow_by_truthiness(&mut self, w: &Walk, ty: Abs, e: ExprId, sense: bool) -> Abs {
        if self.is_matching(w.symbol, e) {
            return self.adjusted(ty, if sense { Facts::Truthy } else { Facts::Falsy });
        }
        if sense && self.optional_chain_contains(w.symbol, e) {
            return self.adjusted(ty, Facts::NEUndefinedOrNull);
        }
        ty
    }

    /// The part of `narrowTypeByBinaryExpression` for `==`, `!=`, `===` and `!==`.
    fn narrow_by_comparison(
        &mut self,
        w: &Walk,
        ty: Abs,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        sense: bool,
    ) -> Abs {
        let hir = self.hir;
        let (left, right) = (
            self.reference_candidate(left),
            self.reference_candidate(right),
        );
        for (a, b) in [(left, right), (right, left)] {
            if let ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } = hir[a].kind
                && let Some(text) = self.string_literal_like(b)
            {
                return self.narrow_by_typeof(w, ty, operand, op, text, sense);
            }
        }
        for (a, b) in [(left, right), (right, left)] {
            if self.is_matching(w.symbol, a) {
                return self.narrow_by_equality(ty, op, b, sense);
            }
        }
        let mut ty = ty;
        if self.strict {
            for (a, b) in [(left, right), (right, left)] {
                if self.optional_chain_contains(w.symbol, a) {
                    ty = self.narrow_by_optional_chain_containment(ty, op, b, sense);
                    break;
                }
            }
        }
        // `isMatchingConstructorReference`
        for a in [left, right] {
            let (obj, is_constructor) = match hir[a].kind {
                ExprKind::Dot { obj, name, .. } => (obj, name == known::constructor),
                ExprKind::Index { obj, index, .. } => (
                    obj,
                    self.string_literal_like(index) == Some(known::constructor),
                ),
                _ => continue,
            };
            if is_constructor && self.is_matching(w.symbol, obj) {
                return Abs::Unknown;
            }
        }
        // `narrowTypeByBooleanComparison`
        for (a, b) in [(left, right), (right, left)] {
            if matches!(hir[b].kind, ExprKind::True | ExprKind::False)
                && !matches!(hir[a].kind, ExprKind::Dot { .. } | ExprKind::Index { .. })
            {
                let is_true = matches!(hir[b].kind, ExprKind::True);
                let sense = (sense != is_true) != !matches!(op, BinOp::NotEqEq | BinOp::NotEq);
                return self.narrow(w, ty, a, sense);
            }
        }
        ty
    }

    /// `narrowTypeByEquality`
    fn narrow_by_equality(&mut self, ty: Abs, op: BinOp, value: ExprId, sense: bool) -> Abs {
        if ty != Abs::AutoArray {
            return ty;
        }
        let sense = if matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
            !sense
        } else {
            sense
        };
        let value = self.c.type_of_expr(self.file, value);
        if !self.c.is_known(value) {
            return Abs::Unknown;
        }
        if value.is_null() || value.is_undefined() {
            let facts = match (
                matches!(op, BinOp::EqEq | BinOp::NotEq),
                value.is_null(),
                sense,
            ) {
                (true, _, true) => Facts::EQUndefinedOrNull,
                (true, _, false) => Facts::NEUndefinedOrNull,
                (false, true, true) => Facts::EQNull,
                (false, true, false) => Facts::NENull,
                (false, false, true) => Facts::EQUndefined,
                (false, false, false) => Facts::NEUndefined,
            };
            return self.adjusted(ty, facts);
        }
        // An array is no single value: that it is not this one says nothing.
        if !sense {
            return ty;
        }
        let any_array = self.c.array_of(TypeId::ANY);
        if self.c.are_comparable(any_array, value) {
            ty
        } else {
            Abs::Never
        }
    }

    /// `narrowTypeByOptionalChainContainment`
    fn narrow_by_optional_chain_containment(
        &mut self,
        ty: Abs,
        op: BinOp,
        value: ExprId,
        sense: bool,
    ) -> Abs {
        let is_equals = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
        let with_null = matches!(op, BinOp::EqEq | BinOp::NotEq);
        let value = self.c.type_of_expr(self.file, value);
        if !self.c.is_known(value) {
            return Abs::Unknown;
        }
        let is_nullable = |m: TypeId| m.is_undefined() || with_null && m.is_null();
        let remove_nullable = is_equals != sense && self.c.every_type(value, |_, m| is_nullable(m))
            || is_equals == sense
                && self.c.every_type(value, |c, m| {
                    !(c.is_any(m) || m == TypeId::UNKNOWN || is_nullable(m))
                });
        if remove_nullable {
            self.adjusted(ty, Facts::NEUndefinedOrNull)
        } else {
            ty
        }
    }

    /// `narrowTypeByTypeof`
    fn narrow_by_typeof(
        &mut self,
        w: &Walk,
        ty: Abs,
        operand: ExprId,
        op: BinOp,
        text: Atom,
        sense: bool,
    ) -> Abs {
        let sense = if matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
            !sense
        } else {
            sense
        };
        let target = self.reference_candidate(operand);
        if !self.is_matching(w.symbol, target) {
            if self.optional_chain_contains(w.symbol, target) && sense == (text != known::undefined)
            {
                return self.adjusted(ty, Facts::NEUndefinedOrNull);
            }
            return ty;
        }
        // `narrowTypeByLiteralExpression`
        if sense {
            return self.narrow_by_type_name(ty, text);
        }
        match (ty, text) {
            (_, known::undefined) => self.adjusted(ty, Facts::NEUndefined),
            (
                Abs::AutoArray,
                known::string
                | known::number
                | known::bigint
                | known::boolean
                | known::symbol
                | known::function,
            ) => ty,
            // `typeof` of an array is `"object"`, or whatever a host says of its objects.
            (Abs::AutoArray, _) => Abs::Never,
            _ => ty,
        }
    }

    /// `narrowTypeByTypeName`
    fn narrow_by_type_name(&self, ty: Abs, text: Atom) -> Abs {
        if ty == Abs::AutoArray {
            return match text {
                known::string
                | known::number
                | known::bigint
                | known::boolean
                | known::symbol
                | known::function => Abs::Never,
                known::undefined if self.strict => Abs::Never,
                known::undefined => Abs::Other,
                _ => ty,
            };
        }
        match text {
            known::object | known::function => ty,
            known::string => Abs::Is(TypeId::STRING),
            known::number => Abs::Is(TypeId::NUMBER),
            known::bigint => Abs::Is(TypeId::BIGINT),
            known::boolean => Abs::Is(TypeId::BOOLEAN),
            known::symbol => Abs::Is(TypeId::SYMBOL),
            known::undefined => Abs::Is(TypeId::UNDEFINED),
            _ => Abs::Is(TypeId::OBJECT),
        }
    }

    /// `getNarrowedType`
    fn narrow_to(&mut self, ty: Abs, candidate: TypeId, sense: bool, check_derived: bool) -> Abs {
        if !self.c.is_known(candidate) {
            return Abs::Unknown;
        }
        if ty == Abs::Auto {
            return match sense {
                true if candidate == TypeId::NEVER => Abs::Never,
                true => Abs::Is(candidate),
                false => ty,
            };
        }
        // Where both will do, what was there is kept.
        let any_array = self.c.array_of(TypeId::ANY);
        match self
            .c
            .narrowed_to(any_array, candidate, sense, check_derived)
        {
            TypeId::NEVER => Abs::Never,
            narrowed if narrowed == any_array => ty,
            narrowed => Abs::Is(narrowed),
        }
    }

    /// `getInstanceType`
    fn instance_type(&mut self, constructor: TypeId) -> TypeId {
        if let Some(prototype) = self.c.type_of_property(constructor, known::prototype)
            && !self.c.is_any(prototype)
        {
            return prototype;
        }
        let mut returns = Vec::new();
        for sig in self.c.signatures(constructor, true) {
            let erased = self.c.erased_sig(sig);
            returns.push(self.c.sig_return(erased));
        }
        if returns.is_empty() {
            TypeId::EMPTY_OBJECT
        } else {
            self.c.union(&returns)
        }
    }

    /// `narrowTypeByInstanceof`
    fn narrow_by_instanceof(
        &mut self,
        w: &Walk,
        ty: Abs,
        left: ExprId,
        right: ExprId,
        sense: bool,
    ) -> Abs {
        let left = self.reference_candidate(left);
        if !self.is_matching(w.symbol, left) {
            return if sense && self.optional_chain_contains(w.symbol, left) {
                self.adjusted(ty, Facts::NEUndefinedOrNull)
            } else {
                ty
            };
        }
        let constructor = self.c.type_of_expr(self.file, right);
        if !self.c.is_known(constructor) {
            return Abs::Unknown;
        }
        let (object, function) = (
            self.c.global_ref(known::Object, &[]),
            self.c.global_ref(known::Function, &[]),
        );
        if !self.c.is_type_derived_from(constructor, object) {
            return ty;
        }
        // A `[Symbol.hasInstance]` that is a type guard has the say.
        let has_instance = [
            symbol_name_prefix(&self.c.files().atoms),
            &b"hasInstance"[..],
        ]
        .concat();
        if let Some(name) = self.c.files().atoms.lookup(&has_instance)
            && let Some(method) = self.c.type_of_property(constructor, name)
            && let Some(sig) = self.c.single_call_signature(method, true)
            && let Some(predicate) = self.c.sig_predicate(sig)
            && !predicate.asserts
            && predicate.param == Some(0)
            && let Some(guarded) = predicate.ty
        {
            return self.narrow_to(ty, guarded, sense, true);
        }
        if !self.c.is_type_derived_from(constructor, function) {
            return ty;
        }
        if self.c.is_union(constructor) {
            return Abs::Unknown;
        }
        let instance = self.instance_type(constructor);
        if ty == Abs::Auto && (instance == object || instance == function)
            || !sense
                && !(self.c.is_object_type(instance)
                    && !self.c.is_empty_anonymous_object_type(instance))
        {
            return ty;
        }
        self.narrow_to(ty, instance, sense, true)
    }

    /// `narrowTypeByCallExpression`
    fn narrow_by_call(&mut self, w: &Walk, ty: Abs, call: ExprId, sense: bool) -> Abs {
        let hir = self.hir;
        let ExprKind::Call(c) = hir[call].kind else {
            return ty;
        };
        // `hasMatchingArgument`
        let is_concerned = hir
            .ids(hir[c].args)
            .any(|a| self.is_matching(w.symbol, a) || self.optional_chain_contains(w.symbol, a))
            || matches!(hir[hir[c].callee].kind, ExprKind::Dot { obj, .. } if self.is_matching(w.symbol, obj));
        if !is_concerned || !sense && hir[c].chain != Chain::No {
            return ty;
        }
        let callee = self.c.type_of_expr(self.file, hir[c].callee);
        if !self.c.is_known(callee) {
            return Abs::Unknown;
        }
        let Some(sig) = self.effects_signature(call, false) else {
            return ty;
        };
        match self.c.sig_predicate(sig) {
            Some(predicate) if !predicate.asserts => {
                self.narrow_by_type_predicate(w, ty, predicate.param, predicate.ty, call, sense)
            }
            _ => ty,
        }
    }

    /// `narrowTypeByTypePredicate`. `param`: which parameter it is about, `this` if none.
    fn narrow_by_type_predicate(
        &mut self,
        w: &Walk,
        ty: Abs,
        param: Option<usize>,
        guarded: Option<TypeId>,
        call: ExprId,
        sense: bool,
    ) -> Abs {
        let hir = self.hir;
        let (ExprKind::Call(c), Some(guarded)) = (hir[call].kind, guarded) else {
            return ty;
        };
        // `any` is not narrowed to `Object` or `Function`.
        if ty == Abs::Auto
            && (guarded == self.c.global_ref(known::Object, &[])
                || guarded == self.c.global_ref(known::Function, &[]))
        {
            return ty;
        }
        // `getTypePredicateArgument`
        let argument = match param {
            Some(i) => hir.ids(hir[c].args).nth(i),
            None => match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
                _ => None,
            },
        };
        let Some(argument) = argument else { return ty };
        if self.is_matching(w.symbol, argument) {
            return self.narrow_to(ty, guarded, sense, false);
        }
        // Whether `null` and `undefined` go depends on what is guarded for.
        if self.strict && ty == Abs::Auto && self.optional_chain_contains(w.symbol, argument) {
            return Abs::Unknown;
        }
        ty
    }

    /// What `getTypeAtFlowCall` makes of a call that asserts something.
    fn narrow_by_asserting_call(&mut self, w: &Walk, ty: Abs, call: ExprId) -> Abs {
        let hir = self.hir;
        let ExprKind::Call(c) = hir[call].kind else {
            return ty;
        };
        let Some(sig) = self.effects_signature(call, true) else {
            return ty;
        };
        let Some(predicate) = self.c.sig_predicate(sig) else {
            return ty;
        };
        if predicate.ty.is_some() {
            if !matches!(ty, Abs::Auto | Abs::AutoArray) {
                return if matches!(ty, Abs::Is(_)) && self.mentions(call, w.symbol) {
                    Abs::Other
                } else {
                    ty
                };
            }
            return self.narrow_by_type_predicate(w, ty, predicate.param, predicate.ty, call, true);
        }
        match predicate.param.and_then(|i| hir.ids(hir[c].args).nth(i)) {
            Some(argument) => self.narrow_by_assertion(w, ty, argument),
            None => ty,
        }
    }

    /// `narrowTypeByAssertion`
    fn narrow_by_assertion(&mut self, w: &Walk, ty: Abs, e: ExprId) -> Abs {
        match self.hir[e].kind {
            ExprKind::False => Abs::UnreachableNever,
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                let ty = self.narrow_by_assertion(w, ty, left);
                self.narrow_by_assertion(w, ty, right)
            }
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => union_of(&[
                self.narrow_by_assertion(w, ty, left),
                self.narrow_by_assertion(w, ty, right),
            ]),
            _ => self.narrow(w, ty, e, true),
        }
    }

    /// `getTypeAtSwitchClause`: the clauses `from..to` of `stmt` were entered.
    fn type_at_switch_clause(
        &mut self,
        w: &Walk,
        ty: Abs,
        stmt: StmtId,
        from: usize,
        to: usize,
    ) -> Abs {
        let hir = self.hir;
        let StmtKind::Switch { expr, cases } = hir[stmt].kind else {
            return ty;
        };
        let is_true = matches!(hir[expr].kind, ExprKind::True);
        let seen = finalize(ty);
        if !matches!(seen, Abs::Auto | Abs::AutoArray) {
            return if matches!(ty, Abs::Is(_)) && (is_true || self.mentions(expr, w.symbol)) {
                Abs::Other
            } else {
                ty
            };
        }
        let is_default = |i: usize| hir[cases.at(i)].test.is_none();
        let has_default = from == to || (from..to).any(is_default);
        let narrowed = if self.is_matching(w.symbol, expr) {
            // `narrowTypeBySwitchOnDiscriminant`: `any` is comparable to anything, and is no single value. What the cases leave of it
            // and what the default leaves of it are put together, which makes it the ordinary `any`.
            match seen {
                Abs::Auto if has_default && (from..to).any(|i| !is_default(i)) => Abs::Other,
                Abs::Auto => seen,
                _ => Abs::Unknown,
            }
        } else if let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = hir[expr].kind
            && self.is_matching(w.symbol, operand)
        {
            // `narrowTypeBySwitchOnTypeOf`, `getSwitchClauseTypeOfWitnesses`
            let mut witnesses: Vec<Atom> = Vec::with_capacity(cases.len());
            for case in cases.iter() {
                let test = hir[case].test;
                if test.is_none() {
                    witnesses.push(Atom::NONE);
                    continue;
                }
                let Some(text) = self.string_literal_like(test) else {
                    return ty;
                };
                witnesses.push(if text == known::empty || witnesses.contains(&text) {
                    Atom::NONE
                } else {
                    text
                });
            }
            if has_default {
                // `any` may be whatever is left.
                if seen == Abs::Auto {
                    seen
                } else {
                    Abs::Unknown
                }
            } else {
                let types: Vec<Abs> = witnesses[from..to]
                    .iter()
                    .map(|&text| {
                        if text.is_some() {
                            self.narrow_by_type_name(seen, text)
                        } else {
                            Abs::Never
                        }
                    })
                    .collect();
                union_of(&types)
            }
        } else if is_true {
            // `narrowTypeBySwitchOnTrue`
            let mut narrowed = seen;
            for i in (0..from).chain(if has_default { to..cases.len() } else { 0..0 }) {
                if !is_default(i) {
                    narrowed = self.narrow(w, narrowed, hir[cases.at(i)].test, false);
                }
            }
            if has_default {
                narrowed
            } else {
                let mut types = Vec::with_capacity(to - from);
                for i in from..to {
                    types.push(self.narrow(w, narrowed, hir[cases.at(i)].test, true));
                }
                union_of(&types)
            }
        } else {
            // `narrowTypeBySwitchOptionalChainContainment` takes `null` and `undefined` out, of which neither has any to show.
            seen
        };
        if narrowed == seen { ty } else { narrowed }
    }
}

// ───────────────────────────── property accesses ─────────────────────────────

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax. They
/// are told apart by the code: these are the ones only parser.go and scanner.go give, and 1003 and 1005, which are only ever
/// noted for what the parser expected and did not find. Not 18016: the parser's own sets `hir.has_parse_diagnostics`, one that is left
/// in `early_errors` without it is `checkGrammarObjectLiteralExpression`'s.
fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1069 | 1084 | 1109 | 1121 | 1124..=1132 | 1134 | 1135
                    | 1137..=1140 | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1223 | 1260 | 1327 | 1328
                    | 1351..=1353 | 1357 | 1381 | 1382 | 1385..=1390 | 1434..=1443 | 1472 | 1477 | 1478 | 1487..=1490 | 2754 | 2809
                    | 2819 | 6188 | 6189 | 17002 | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

/// The private name `text` as it is written: without what is put after it to tell the `#x` of one class from that of another.
fn written_private_name(text: &[u8]) -> &[u8] {
    &text[..text
        .iter()
        .position(|&b| b == b'@' || b == b'\'')
        .unwrap_or(text.len())]
}

/// What the name of a property that a symbol names starts with.
fn symbol_name_prefix(atoms: &crate::atom::Interner) -> &[u8] {
    atoms
        .bytes(known::sym_iterator)
        .strip_suffix(b"iterator")
        .unwrap_or_default()
}

impl Pass<'_, '_> {
    /// `checkPropertyAccessExpressionOrQualifiedName`, `checkElementAccessExpression`, `getFlowTypeOfAccessExpression`
    fn check_accesses(&mut self) {
        for i in 0..self.hir.exprs.len() {
            let e = ExprId(i as u32);
            if !self.is_bound(e) {
                continue;
            }
            match self.hir.exprs[i].kind {
                ExprKind::Dot {
                    obj,
                    name,
                    name_pos,
                    chain,
                } => {
                    let text = self.c.files().atoms.bytes(name);
                    if text.first() == Some(&b'#') {
                        self.check_private_name_access(e, obj, name, name_pos, chain);
                    } else if !text.is_empty() {
                        self.check_named_access(e, obj, name, name_pos, chain);
                    }
                    self.check_used_before_assigned(e, obj, name, name_pos, ExprId::NONE);
                }
                ExprKind::Index { obj, index, .. }
                    if matches!(self.hir[obj].kind, ExprKind::This)
                        || self.has_assignment_declarations() =>
                {
                    let key = self.c.type_of_expr(self.file, index);
                    if let Some(name) = self.c.property_name_of_type(key) {
                        let at = self.c.start_of(self.file, index);
                        self.check_used_before_assigned(e, obj, name, at, index);
                    }
                }
                _ => {}
            }
        }
    }

    /// The classes `e` is written in, from the inside out; a decorator of a class is not in the class. `None`: it cannot be told.
    /// `getContainingClassExcludingClassDecorators`, `GetContainingClass`
    fn containing_classes(&self, e: ExprId) -> Option<Vec<ClassId>> {
        let mut classes = Vec::new();
        let mut node = Node::Expr(e);
        loop {
            let below = node;
            node = self.parent(node);
            match node {
                Node::Class(c) => {
                    let is_decorator = matches!(below, Node::Expr(x) if matches!(self.bound.expr_parent[x.idx()], Parent::Decorator(_, DecoratorOwner::Class(_))));
                    if !is_decorator {
                        classes.push(c);
                    }
                }
                Node::Module(_) | Node::File => return Some(classes),
                Node::Lost => return None,
                _ => {}
            }
        }
    }

    /// `getPrivateIdentifierPropertyOfType`: whether `ty` has what `class` declares by a private name, on its instances or on itself.
    fn has_private_member_of(&mut self, ty: TypeId, class: Sym, is_static: bool) -> bool {
        let ty = self.c.apparent_type(ty);
        match self.c.data(ty) {
            TypeData::Union(parts) => parts
                .iter()
                .all(|&p| self.has_private_member_of(p, class, is_static)),
            TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.has_private_member_of(p, class, is_static)),
            // What is static and private is not inherited.
            TypeData::Anon {
                origin: Origin::ClassStatic(sym),
                ..
            } => is_static && *sym == class,
            _ => !is_static && self.c.has_base(ty, class, 0),
        }
    }

    /// The class that declares the first property of `ty` that goes by a private name written like `name`.
    fn class_of_private_property(&mut self, ty: TypeId, name: Atom) -> Option<(FileId, ClassId)> {
        let ty = self.c.apparent_type(ty);
        if let TypeData::Union(parts) = self.c.data(ty) {
            // What all members have is what one class declares.
            let first = self.class_of_private_property(*parts.first()?, name)?;
            return parts[1..]
                .iter()
                .all(|&p| self.class_of_private_property(p, name) == Some(first))
                .then_some(first);
        }
        let atoms = &self.c.files().atoms;
        let written = written_private_name(atoms.bytes(name));
        let members = self.c.members(ty)?;
        for prop in &members.shape().props {
            if written_private_name(atoms.bytes(prop.name)) != written {
                continue;
            }
            let PropSource::Members(declarations) = &prop.source else {
                continue;
            };
            let Some(&(file, m)) = declarations.first() else {
                continue;
            };
            let MemberOwner::Class(c) = self.c.bound(file).member_owner[m.idx()] else {
                continue;
            };
            let member = &self.c.hir(file)[m];
            // What is static and private is not inherited.
            let is_of_a_base = member.flags.contains(Flags::STATIC)
                && !matches!(self.c.data(ty), TypeData::Anon { origin: Origin::ClassStatic(sym), .. } if *sym == self.c.class_sym(file, c));
            if matches!(member.key, PropKey::Private(_)) && !is_of_a_base {
                return Some((file, c));
            }
        }
        None
    }

    /// The part of `checkPropertyAccessExpressionOrQualifiedName` for `a.#b`: 2803, 2806, 18013 18014, 2339 2551.
    fn check_private_name_access(
        &mut self,
        e: ExprId,
        obj: ExprId,
        name: Atom,
        name_pos: u32,
        chain: Chain,
    ) {
        let hir = self.hir;
        // After `typeof` in a type a private name is a mistake of syntax, and that is all that is said of it.
        if self.bound.is_in_type_query(e) {
            return;
        }
        let assignment = self.assignment_kind(e);
        let Some(classes) = self.containing_classes(e) else {
            return;
        };
        // `lookupSymbolForPrivateIdentifierDeclaration`: what the instances have comes first.
        let declared_in = |c: ClassId, is_static: bool| {
            hir[c].members.iter().find(|&m| {
                hir[m].key == PropKey::Private(name)
                    && hir[m].flags.contains(Flags::STATIC) == is_static
            })
        };
        let lexical = classes.iter().enumerate().find_map(|(i, &c)| {
            declared_in(c, false)
                .or_else(|| declared_in(c, true))
                .map(|m| (i, c, m))
        });
        if assignment != AssignmentKind::None
            && lexical.is_some_and(|(_, _, m)| hir[m].kind == MemberKind::Method)
            // `grammarErrorOnNode`
            && !has_parse_diagnostics(hir)
        {
            self.report(name_pos, 2803);
        }
        let (receiver, _) = self.c.chain_receiver(self.file, obj, chain);
        if !self.c.is_known(receiver) || self.c.is_uncertain(self.file, obj) {
            return;
        }
        // `checkNonNullType`: on with what is left.
        let left = self.c.check_not_nullish(self.file, obj, receiver, self.out);
        let apparent = self.c.apparent_type(left);
        if !self.c.is_known(apparent)
            || self.c.is_any(apparent) && (lexical.is_some() || classes.is_empty())
        {
            return;
        }
        // `#x in o` is narrowed here like `"#x" in o`, not to the class: a `#x` that no class declares comes of that, and what `o`
        // is by rights is not known.
        if self
            .c
            .prop_of(apparent, name)
            .is_some_and(|(prop, _)| !matches!(prop.source, PropSource::Members(_)))
        {
            return;
        }
        if let Some((_, c, m)) = lexical {
            let is_static = hir[m].flags.contains(Flags::STATIC);
            let class = self.c.class_sym(self.file, c);
            if self.has_private_member_of(left, class, is_static) {
                let is_one_of_them = |x: MemberId| {
                    hir[x].key == PropKey::Private(name)
                        && hir[x].flags.contains(Flags::STATIC) == is_static
                };
                let is_set_only = hir[m].kind == MemberKind::Setter
                    && !hir[c]
                        .members
                        .iter()
                        .any(|x| is_one_of_them(x) && hir[x].kind == MemberKind::Getter);
                if is_set_only && assignment != AssignmentKind::Definite {
                    let start = self.c.start_inside_parentheses(self.file, e);
                    self.report(start, 2806);
                    let end = self.c.end_inside_parentheses(self.file, e);
                    self.c.explain_to(start, end, 2806, |_| Vec::new());
                }
                return;
            }
        }
        // `checkPrivateIdentifierPropertyAccess`
        if let Some((file, type_class)) = self.class_of_private_property(left, name) {
            let is_shadowed = lexical
                .is_some_and(|(i, _, _)| file == self.file && classes[i..].contains(&type_class));
            let code = if is_shadowed { 18014 } else { 18013 };
            self.report(name_pos, code);
            let here = self.file;
            self.c.explain(name_pos, code, |c| {
                let on = if is_shadowed {
                    c.type_to_string(left)
                } else {
                    let class = c.class_sym(file, type_class);
                    c.symbol_to_string(class)
                };
                vec![c.declaration_name_at(here, name_pos), on]
            });
            return;
        }
        // 1111, through `grammarErrorOnNode`.
        if !classes.is_empty() && self.c.is_plain_js(self.file) && !has_parse_diagnostics(hir) {
            self.report(name_pos, 1111);
        }
        // `isJSLiteralType(leftType)`: a property missing from a JS literal type is `any`, and nothing is said of it.
        if self.c.is_js_literal_type(left) {
            return;
        }
        // `reportNonexistentProperty`, `getSuggestedSymbolForNonexistentProperty`
        let containing = if matches!(self.c.data(left), TypeData::ThisParam(_)) {
            apparent
        } else {
            left
        };
        let atoms = &self.c.files().atoms;
        let text = written_private_name(atoms.bytes(name));
        if let Some(members) = self.c.members(apparent) {
            for prop in &members.shape().props {
                let candidate = atoms.bytes(prop.name);
                let candidate = if candidate.starts_with(b"#") {
                    written_private_name(candidate)
                } else {
                    candidate
                };
                if candidate.starts_with(symbol_name_prefix(atoms)) || !is_close(text, candidate) {
                    continue;
                }
                // `isValidPropertyAccessForCompletions`
                if candidate.starts_with(b"#") {
                    let PropSource::Members(declarations) = &prop.source else {
                        return;
                    };
                    let Some(&(file, m)) = declarations.first() else {
                        return;
                    };
                    let MemberOwner::Class(c) = self.c.bound(file).member_owner[m.idx()] else {
                        return;
                    };
                    // What is static and private is not inherited.
                    let is_of_a_base = self.c.hir(file)[m].flags.contains(Flags::STATIC)
                        && !matches!(self.c.data(apparent), TypeData::Anon { origin: Origin::ClassStatic(sym), .. } if *sym == self.c.class_sym(file, c));
                    if is_of_a_base
                        || chain != Chain::No
                        || file != self.file
                        || !classes.contains(&c)
                    {
                        continue;
                    }
                } else if prop
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                {
                    return;
                }
                self.report(name_pos, 2551);
                self.c
                    .explain_no_property(self.file, e, containing, name, name_pos, 2551);
                return;
            }
        }
        self.report(name_pos, 2339);
        self.c
            .explain_no_property(self.file, e, containing, name, name_pos, 2339);
    }

    /// Whether `name` is no property of `apparent` and an index signature stands in for it.
    fn comes_from_index_signature(&mut self, apparent: TypeId, name: Atom) -> bool {
        if let TypeData::Union(parts) = self.c.data(apparent) {
            // `getUnionIndexInfos`: a signature of a union is one that all members have.
            for &part in parts.iter() {
                let part = self.c.apparent_type(part);
                let Some(members) = self.c.members(part) else {
                    return false;
                };
                if self.c.property_of_type(&members, name).is_some()
                    || !members
                        .shape()
                        .index
                        .iter()
                        .any(|i| i.key == TypeId::STRING)
                {
                    return false;
                }
            }
            return true;
        }
        let Some(members) = self.c.members(apparent) else {
            return false;
        };
        self.c.property_of_type(&members, name).is_none()
            && self
                .c
                .applicable_index_info(&members, TypeId::STRING, Some(name))
                .is_some()
    }

    /// The part of `checkPropertyAccessExpressionOrQualifiedName` for a name nothing declares: 7017 and 2339 on `globalThis`, 4111.
    fn check_named_access(
        &mut self,
        e: ExprId,
        obj: ExprId,
        name: Atom,
        name_pos: u32,
        chain: Chain,
    ) {
        let left =
            if matches!(self.hir[obj].kind, ExprKind::This) && self.global_this(obj).is_some() {
                self.c.intern(TypeData::Anon {
                    origin: Origin::GlobalThis,
                    mapper: MapperId::IDENTITY,
                })
            } else {
                let (receiver, _) = self.c.chain_receiver(self.file, obj, chain);
                if !self.c.is_known(receiver) || self.c.is_uncertain(self.file, obj) {
                    return;
                }
                self.c.non_nullable(receiver)
            };
        if matches!(
            self.c.data(left),
            TypeData::Anon {
                origin: Origin::GlobalThis,
                ..
            }
        ) {
            if self.c.type_of_property(left, name).is_some() {
                return;
            }
            // `let`, `const`, classes and enums are global without being properties of it.
            let is_block_scoped = self.c.files().globals.get(&name).is_some_and(|&global| {
                self.c
                    .files()
                    .flags(global)
                    .intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
            });
            if is_block_scoped {
                self.report(name_pos, 2339);
                self.c.explain(name_pos, 2339, |c| {
                    vec![c.atom_text(name), c.type_to_string(left)]
                });
            } else if self.no_implicit_any {
                self.report(name_pos, 7017);
            }
            return;
        }
        if !self
            .c
            .p
            .files
            .options
            .no_property_access_from_index_signature
            || self.bound.is_in_type_query(e)
            || self.c.is_any(left)
        {
            return;
        }
        let apparent = self.c.apparent_type(left);
        if !self.c.is_known(apparent) || self.c.is_any(apparent) {
            return;
        }
        // What is yet to be known cannot be written to on the strength of a signature of what it extends.
        if self.assignment_kind(e) != AssignmentKind::None
            && self.c.is_generic_object_type(left)
            && !matches!(self.c.data(left), TypeData::ThisParam(_))
        {
            return;
        }
        if self.comes_from_index_signature(apparent, name) {
            self.report(name_pos, 4111);
        }
    }

    /// `getFlowTypeOfAccessExpression`: reports 2565 at `at` if `e`, an access to the property `name` of `obj`, can read the property
    /// before it is assigned (`assumeUninitialized`). `index`: what is at `at`, if that is not just the name.
    fn check_used_before_assigned(
        &mut self,
        e: ExprId,
        obj: ExprId,
        name: Atom,
        at: u32,
        index: ExprId,
    ) {
        // `getFlowTypeOfReferenceEx` returns the declared type of a reference without a flow node.
        if !self.strict
            || self.bound.expr_flow[e.idx()] == UNREACHABLE
            || self.assignment_kind(e) == AssignmentKind::Definite
        {
            return;
        }
        let declared = self
            .uninitialized_field_type(e, obj, name)
            .or_else(|| self.uninitialized_expando_type(e, obj, name));
        if let Some(declared) = declared
            && self.c.is_known(declared)
            && !self.c.contains_undefined(declared)
            && self.c.may_be_unassigned(self.file, e, declared)
        {
            self.report(at, 2565);
            let file = self.file;
            let end = if index.is_some() {
                self.c.end_of_expr(file, index)
            } else {
                0
            };
            self.c.explain_to(at, end, 2565, |c| {
                let object = c.type_of_expr(file, obj);
                let apparent = c.apparent_type(object);
                vec![match c.prop_of(apparent, name) {
                    Some((prop, _)) => c.property_to_string(&prop),
                    None => c.atom_text(name),
                }]
            });
        }
    }

    /// The first case of `assumeUninitialized`: `e` is `this.name` or `this[..]` in a constructor, and the class of the constructor
    /// declares `name` as an instance property without an initializer. Returns the declared type of the property.
    fn uninitialized_field_type(&mut self, e: ExprId, obj: ExprId, name: Atom) -> Option<TypeId> {
        let (hir, bound) = (self.hir, self.bound);
        if !self.c.p.files.options.strict_property_initialization
            || !matches!(hir[obj].kind, ExprKind::This)
            || self.is_parenthesized(obj)
            // `typeof this.x` in a type is a qualified name, not an access expression.
            || bound.is_in_type_query(e)
        {
            return None;
        }
        let Node::Fn(f) = self.control_flow_container(Node::Expr(e)) else {
            return None;
        };
        let FnOwner::Member(constructor) = bound.fns[f.idx()].owner else {
            return None;
        };
        let MemberOwner::Class(c) = bound.member_owner[constructor.idx()] else {
            return None;
        };
        if hir[f].kind != FnKind::Constructor {
            return None;
        }
        let mut declaration = None;
        for m in hir[c].members.iter() {
            if !hir[m].flags.contains(Flags::STATIC)
                && matches!(
                    hir[m].kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                )
                && self.c.member_name(self.file, hir[m].key) == Some(name)
            {
                declaration = Some(m);
                break;
            }
        }
        let m = declaration?;
        // `isPropertyWithoutInitializer`
        if hir[m].kind != MemberKind::Property
            || hir[m].init.is_some()
            || hir[m]
                .flags
                .intersects(Flags::ABSTRACT | Flags::DEFINITE | Flags::AMBIENT | Flags::OPTIONAL)
            || hir[c].flags.contains(Flags::AMBIENT)
        {
            return None;
        }
        Some(self.c.type_of_member_declaration(self.file, m))
    }

    /// Whether an assignment in this file declares a property: `f.x = v`, or `this.x = v` and `o.x = v` in JavaScript.
    fn has_assignment_declarations(&self) -> bool {
        let bound = self.bound;
        !bound.declared_fn_expandos.is_empty()
            || !bound.fn_expr_expandos.is_empty()
            || !bound.object_expandos.is_empty()
            || !bound.this_properties.is_empty()
    }

    /// The second case of `assumeUninitialized`: `prop.ValueDeclaration` is an assignment `a.name = value` in the control flow
    /// container of `e`. The receiver `obj` can be any expression. Returns the declared type of the property.
    fn uninitialized_expando_type(&mut self, e: ExprId, obj: ExprId, name: Atom) -> Option<TypeId> {
        let hir = self.hir;
        if !self.has_assignment_declarations() {
            return None;
        }
        let object = self.c.type_of_expr(self.file, obj);
        let apparent = self.c.apparent_type(object);
        let (prop, mapper) = self.c.prop_of(apparent, name)?;
        let PropSource::Assigned(file, assignments) = &prop.source else {
            return None;
        };
        let &first = assignments.first()?;
        let container = self.control_flow_container(Node::Expr(e));
        if *file != self.file
            // The left side of `f[key] = value` is not a property access.
            || !matches!(hir[first].kind, ExprKind::Assign { target, .. } if matches!(hir[target].kind, ExprKind::Dot { .. }))
            || container == Node::Lost
            || container != self.control_flow_container(Node::Expr(first))
            // `isThisPropertyAccessInConstructor`: the property type is `autoType`, which `getFlowTypeOfProperty` resolves.
            || self.c.auto_this_property(self.file, e, object, name).is_some()
        {
            return None;
        }
        Some(self.c.type_of_prop(&prop, mapper))
    }

    // ───────────────────────────── the initializers of enum members ─────────────────────────────

    /// `computeConstantEnumMemberValue`, for what `evaluateEnumMember` says on the way: 2565.
    fn check_enum_initializers(&mut self) {
        for m in 0..self.hir.enum_members.len() {
            let init = self.hir.enum_members[m].init;
            if init.is_some() && self.is_bound(init) {
                self.evaluate(init, EnumMemberId(m as u32));
            }
        }
    }

    /// `IsEntityNameExpression`
    fn is_entity_name_expression(&self, e: ExprId) -> bool {
        match self.hir[e].kind {
            ExprKind::Ident(_) => true,
            ExprKind::Dot { obj, .. } => {
                !self.is_parenthesized(obj) && self.is_entity_name_expression(obj)
            }
            _ => false,
        }
    }

    /// `resolveEntityName`, of a value.
    fn entity_symbol(&self, e: ExprId) -> Option<Sym> {
        let files = self.c.files();
        let sym = match self.hir[e].kind {
            ExprKind::Ident(name) => self.c.symbol_of_identifier(self.file, e, name)?,
            ExprKind::Dot { obj, name, .. } => {
                files.namespace_member(self.entity_symbol(obj)?, name)?
            }
            _ => return None,
        };
        files.resolve_alias_if_needed(sym)
    }

    /// What the evaluator looks at of the initializer `e` of `member`: a member that is worked out from itself is used before it is
    /// assigned.
    fn evaluate(&mut self, e: ExprId, member: EnumMemberId) {
        let hir = self.hir;
        if self.c.is_stack_low() {
            return;
        }
        let referenced = match hir[e].kind {
            ExprKind::Unary {
                op:
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::PreInc | UnOp::PreDec,
                operand,
            } => {
                return self.evaluate(operand, member);
            }
            ExprKind::Binary { left, right, .. }
            | ExprKind::Assign {
                target: left,
                value: right,
                ..
            } => {
                self.evaluate(left, member);
                return self.evaluate(right, member);
            }
            ExprKind::Template { exprs, .. } => {
                for span in hir.ids(exprs) {
                    self.evaluate(span, member);
                    // Once there is no telling what it comes to, the rest is not looked at.
                    if self.c.constant_value(self.file, span).is_none() {
                        return;
                    }
                }
                return;
            }
            ExprKind::Ident(_) | ExprKind::Dot { .. } if self.is_entity_name_expression(e) => {
                self.entity_symbol(e)
            }
            ExprKind::Index { obj, index, .. }
                if !self.is_parenthesized(obj)
                    && !self.is_parenthesized(index)
                    && self.is_entity_name_expression(obj) =>
            {
                match (self.entity_symbol(obj), self.string_literal_like(index)) {
                    (Some(root), Some(name))
                        if self.c.files().flags(root).contains(SymFlags::ENUM) =>
                    {
                        self.c.files().export(root, name)
                    }
                    _ => None,
                }
            }
            _ => None,
        };
        let symbol = self.bound.enum_member_symbol[member.idx()];
        if referenced == Some(self.c.files().sym(self.file, symbol))
            && self.bound.symbols[symbol.idx()].decls.first() == Some(&Decl::EnumMember(member))
        {
            let start = self.c.start_inside_parentheses(self.file, e);
            self.report(start, 2565);
            let end = self.c.end_inside_parentheses(self.file, e);
            let member = self.c.files().sym(self.file, symbol);
            self.c
                .explain_to(start, end, 2565, |c| vec![c.symbol_to_string(member)]);
        }
    }
}

// ───────────────────────────── declarations that are left with `any` ─────────────────────────────

/// What the type of an expression has of the `null` and `undefined` that widen to `any` (`ObjectFlagsContainsWideningType`), as far as
/// the way it is written tells. There are none under `strictNullChecks`.
enum Widening {
    No,
    /// `nullWideningType`, `undefinedWideningType`
    Nullish,
    /// An array or a tuple, and what its type arguments have.
    Elements(Vec<Widening>),
    /// An object literal in which something was written that has some: where each of its properties that still does is written.
    Object(Vec<(u32, Widening)>),
    /// It cannot be told.
    Unknown,
}

impl Widening {
    fn is_unknown(&self) -> bool {
        match self {
            Widening::Unknown => true,
            Widening::Elements(args) => args.iter().any(Widening::is_unknown),
            Widening::Object(props) => props.iter().any(|p| p.1.is_unknown()),
            _ => false,
        }
    }

    fn contains_widening_type(&self) -> bool {
        match self {
            Widening::Nullish | Widening::Object(_) => true,
            Widening::Elements(args) => args.iter().any(Widening::contains_widening_type),
            _ => false,
        }
    }
}

impl Pass<'_, '_> {
    /// The name bound by `d`, if `d` binds a plain identifier without a type annotation, is `symbol.ValueDeclaration` (the only
    /// declaration `getTypeOfVariableOrParameterOrPropertyWorker` reports errors for) and is not auto-typed.
    fn untyped_variable(&self, d: VarDeclId) -> Option<PatId> {
        let (hir, bound) = (self.hir, self.bound);
        let decl = &hir[d];
        let stmt = bound.var_stmt[d.idx()];
        if !matches!(hir[decl.pat].kind, PatKind::Ident(_))
            || decl.ty.is_some()
            || stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::Var(_))
            || matches!(bound.stmt_parent[stmt.idx()], Parent::None)
            || self.is_loop_variable_statement(stmt)
        {
            return None;
        }
        let symbol = bound.pat_symbol[decl.pat.idx()];
        (symbol.is_some()
            && self.variable_value_declaration(symbol) == Some(decl.pat)
            && self.auto_variable(symbol).is_none())
        .then_some(decl.pat)
    }

    /// `widenTypeForVariableLikeDeclaration`, of a variable of which nothing at all is said: 7005.
    fn check_variables_without_a_type(&mut self) {
        if !self.no_implicit_any {
            return;
        }
        for d in 0..self.hir.var_decls.len() {
            if self.hir.var_decls[d].init.is_none()
                && let Some(pat) = self.untyped_variable(VarDeclId(d as u32))
            {
                let (file, start) = (self.file, self.hir[pat].pos);
                self.report(start, 7005);
                self.c.explain(start, 7005, |c| {
                    vec![c.declaration_name_at(file, start), "any".to_owned()]
                });
            }
        }
    }

    /// Notes what `reportImplicitAny` and `reportWideningErrorsInType` say of a declaration that takes its type from the expression
    /// `from`. `name`: where its name is written.
    fn explain_implicit_any(&mut self, start: u32, end: u32, code: u32, name: u32, from: ExprId) {
        let file = self.file;
        self.c.explain_to(start, end, code, |c| {
            let ty = c.type_of_expr(file, from);
            let ty = c.widened(ty);
            vec![c.declaration_name_at(file, name), c.type_to_string(ty)]
        });
    }

    /// `reportErrorsFromWidening`, wherever a type is taken from an expression: 7018, or else 7005, 7006 7019, 7008, 7010 7011, 7025 7055.
    fn check_widening(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        if !self.no_implicit_any || self.strict {
            return;
        }
        for d in 0..hir.var_decls.len() {
            let init = hir.var_decls[d].init;
            if init.is_some()
                && let Some(pat) = self.untyped_variable(VarDeclId(d as u32))
            {
                let widening = self.widening_of(init);
                let start = hir[pat].pos;
                if self.report_errors_from_widening(&widening, start, 7005) {
                    self.explain_implicit_any(start, 0, 7005, start, init);
                }
            }
        }
        for m in 0..hir.members.len() {
            let member = &hir.members[m];
            if member.kind == MemberKind::Property
                && member.ty.is_none()
                && member.init.is_some()
                && matches!(bound.member_owner[m], MemberOwner::Class(_))
            {
                let widening = self.widening_of(member.init);
                if self.report_errors_from_widening(&widening, member.pos, 7008) {
                    let end = self.c.end_of_name_at(self.file, member.pos);
                    self.explain_implicit_any(member.pos, end, 7008, member.pos, member.init);
                }
            }
        }
        for f in 0..hir.fns.len() {
            let owner = bound.fns[f].owner;
            if matches!(owner, FnOwner::None) {
                continue;
            }
            let func = FnId(f as u32);
            // What is expected of a function expression comes before what its parameters default to.
            let is_context_known = match owner {
                FnOwner::Expr(e) => self.c.is_context_known(self.file, e),
                _ => true,
            };
            if !is_context_known {
                continue;
            }
            for (index, p) in hir.fns[f].params.iter().enumerate() {
                let param = &hir[p];
                if param.ty.is_some()
                    || param.default.is_none()
                    || !matches!(hir[param.pat].kind, PatKind::Ident(_))
                    || matches!(owner, FnOwner::Expr(_))
                        && self
                            .c
                            .contextual_param_type(self.file, func, index)
                            .is_some()
                {
                    continue;
                }
                let widening = self.widening_of(param.default);
                let code = if param.flags.contains(Flags::REST) {
                    7019
                } else {
                    7006
                };
                if self.report_errors_from_widening(&widening, param.pos, code) {
                    let end = self.c.end_of_param(self.file, p);
                    let name = hir[param.pat].pos;
                    self.explain_implicit_any(param.pos, end, code, name, param.default);
                }
            }
            self.check_widening_of_results(func);
        }
    }

    /// `GetAssignedName`: where what the function expression `e` is given to is named.
    fn start_of_assigned_name(&self, e: ExprId) -> Option<u32> {
        let (hir, bound) = (self.hir, self.bound);
        if self.is_parenthesized(e) {
            return None;
        }
        match bound.expr_parent[e.idx()] {
            Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                Some(hir[hir[d].pat].pos)
            }
            Parent::Prop(p)
                if hir[p].kind == PropKind::Init
                    && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
            {
                Some(hir[p].pos)
            }
            Parent::PatPropDefault(p) => Some(hir[hir[p].value].pos),
            Parent::PatElemDefault(p) => Some(hir[hir[p].pat].pos),
            Parent::Expr(parent) => {
                let (ExprKind::Assign {
                    target: left,
                    value: right,
                    ..
                }
                | ExprKind::Binary { left, right, .. }) = hir[parent].kind
                else {
                    return None;
                };
                if right != e || self.is_parenthesized(left) {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(_) => Some(hir[left].pos),
                    ExprKind::Dot { name_pos, .. } => Some(name_pos),
                    ExprKind::Index { index, .. }
                        if matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_)) =>
                    {
                        Some(hir[index].pos)
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Whether the getter `func` goes with a setter that says what it takes.
    fn has_annotated_setter(&self, func: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_annotated = |setter: FnId| {
            setter.is_some()
                && hir[setter]
                    .params
                    .iter()
                    .next()
                    .is_some_and(|p| hir[p].ty.is_some())
        };
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => {
                let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                    return false;
                };
                hir[c].members.iter().any(|x| {
                    hir[x].kind == MemberKind::Setter
                        && hir[x].key == hir[m].key
                        && hir[x].flags.contains(Flags::STATIC)
                            == hir[m].flags.contains(Flags::STATIC)
                        && is_annotated(hir[x].func)
                })
            }
            FnOwner::Expr(e) => {
                let Parent::Prop(p) = bound.expr_parent[e.idx()] else {
                    return false;
                };
                let ExprKind::Object(props) = hir[bound.prop_owner[p.idx()]].kind else {
                    return false;
                };
                props.iter().any(|x| {
                    hir[x].kind == PropKind::Setter
                        && hir[x].key == hir[p].key
                        && hir[x].value.is_some()
                        && matches!(hir[hir[x].value].kind, ExprKind::Fn(setter) if is_annotated(setter))
                })
            }
            _ => false,
        }
    }

    /// `checkAndAggregateReturnExpressionTypes`: whether `e`, which `func` returns, is a bare call of `func` itself, which says nothing of
    /// what it returns.
    fn is_call_of_itself(&self, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut call = e;
        if hir[func].flags.contains(Flags::ASYNC)
            && let ExprKind::Await(awaited) = hir[call].kind
        {
            call = awaited;
        }
        let ExprKind::Call(c) = hir[call].kind else {
            return false;
        };
        let callee = hir[c].callee;
        let symbol = bound.expr_symbol[callee.idx()];
        if !matches!(hir[callee].kind, ExprKind::Ident(_))
            || self.is_parenthesized(callee)
            || symbol.is_none()
        {
            return false;
        }
        if bound.fn_symbol[func.idx()] == symbol {
            return true;
        }
        // A function expression by the name of the variable it is given to, if that holds nothing else (`isConstantReference`).
        let FnOwner::Expr(owner) = bound.fns[func.idx()].owner else {
            return false;
        };
        let s = &bound.symbols[symbol.idx()];
        let Some(&Decl::Var(pat)) = s.decls.first() else {
            return false;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow)
            && hir[d].init == owner
            && hir[d].ty.is_none()
            && (s.flags.contains(SymFlags::CONST)
                || !s.flags.contains(SymFlags::ASSIGNED) && self.is_mutable_local(d))
    }

    /// The call and its argument that what is expected of `e` is taken from: `e` itself, or a literal or the like that `e` is in.
    fn argument_around(&self, mut e: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, bound) = (self.hir, self.bound);
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                    e = bound.prop_owner[p.idx()]
                }
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) => {
                        return (hir[c].callee != e).then_some((parent, e));
                    }
                    ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_) => e = parent,
                    _ => return None,
                },
                _ => return None,
            }
        }
    }

    /// What the parameter that `arg` is given for in `call` is declared as, if what is called has type parameters that are left to be
    /// worked out from the arguments.
    fn declared_parameter_type(&mut self, call: ExprId, arg: ExprId) -> Option<TypeId> {
        let hir = self.hir;
        let (ExprKind::Call(c) | ExprKind::New(c)) = hir[call].kind else {
            return None;
        };
        if !hir[c].type_args.is_empty() {
            return None;
        }
        let index = hir.ids(hir[c].args).position(|a| a == arg)?;
        if hir
            .ids(hir[c].args)
            .take(index)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let (file, func, _) = self
            .c
            .resolve_call(self.file, call)
            .sig
            .and_then(|sig| self.c.sig_decl(sig))?;
        let callee = self.c.type_of_expr(self.file, hir[c].callee);
        let callee = self.c.non_nullable(callee);
        for sig in self
            .c
            .signatures(callee, matches!(hir[call].kind, ExprKind::New(_)))
        {
            if !self.c.sig_type_params(sig).is_empty()
                && self
                    .c
                    .sig_decl(sig)
                    .is_some_and(|d| (d.0, d.1) == (file, func))
            {
                let params = self.c.sig_params(sig);
                return self.c.param_type_at(&params, index);
            }
        }
        None
    }

    /// What the signature expected of `func` returns (`getContextualSignatureForFunctionLikeDeclaration`). In an argument it is what the
    /// parameter is declared as that counts: `instantiateContextualType` fills in what is a type parameter itself, not what mentions one.
    fn contextual_return_type(&mut self, func: FnId) -> Option<TypeId> {
        let declared = match self.bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => self
                .argument_around(e)
                .and_then(|(call, arg)| Some((arg, self.declared_parameter_type(call, arg)?))),
            _ => None,
        };
        if let Some((arg, ty)) = declared {
            self.c.contextual.push((self.file, arg, ty));
        }
        let sig = self.c.contextual_signature(self.file, func);
        if declared.is_some() {
            self.c.contextual.pop();
        }
        sig.map(|sig| self.c.sig_return(sig))
    }

    /// The part of `getReturnTypeFromBody` that reports what widens in what `func` yields and returns.
    fn check_widening_of_results(&mut self, func: FnId) {
        let (hir, bound) = (self.hir, self.bound);
        let f = &hir[func];
        let owner = bound.fns[func.idx()].owner;
        if f.ret.is_some()
            || !matches!(
                f.kind,
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter
            )
        {
            return;
        }
        // `getTypeOfAccessors`, `getReturnTypeFromAnnotation`: a getter gives what its setter says it takes, and its body is not asked.
        if f.kind == FnKind::Getter && self.has_annotated_setter(func) {
            return;
        }
        let returned = match f.body {
            FnBody::None => return,
            FnBody::Expr(body) => self.widening_of(body),
            FnBody::Block(_) => {
                let mut returned = Vec::new();
                for s in bound.ids(bound.fns[func.idx()].returns) {
                    if let StmtKind::Return(e) = hir[s].kind
                        && e.is_some()
                        && !self.is_call_of_itself(func, e)
                    {
                        returned.push((self.widening_of(e), e));
                    }
                }
                self.union_of_widenings(returned)
            }
        };
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let is_async = f.flags.contains(Flags::ASYNC);
        let mut yielded = Vec::new();
        if is_generator {
            for y in bound.ids(bound.fns[func.idx()].yields) {
                let ExprKind::Yield { value, star } = hir[y].kind else {
                    continue;
                };
                yielded.push(if value.is_none() {
                    (Widening::Nullish, ExprId::NONE)
                } else if star {
                    (self.widening_of_what_is_spread(value), ExprId::NONE)
                } else {
                    (self.widening_of(value), value)
                });
            }
        }
        let yielded = self.union_of_widenings(yielded);
        if !returned.contains_widening_type() && !yielded.contains_widening_type() {
            return;
        }
        // `reportImplicitAny`: at the name, of which a function expression may have none but that of what it is given to.
        let (start, is_named) = match (f.kind, owner) {
            (FnKind::Method | FnKind::Getter, FnOwner::Member(m)) => (hir[m].pos, true),
            (FnKind::Method | FnKind::Getter, _) => (f.name_pos, true),
            (FnKind::Decl | FnKind::Expr, _) if f.name.is_some() => (f.name_pos, true),
            (FnKind::Expr, FnOwner::Expr(e)) => {
                (self.start_of_assigned_name(e).unwrap_or(f.pos), false)
            }
            (FnKind::Arrow, _) => (f.pos, false),
            _ => return,
        };
        // `shouldReportErrorsFromWideningWithContextualSignature`. What `next` is given is what is expected of the `yield`s, which comes
        // of annotations: there is nothing in it to widen.
        let expected = self.contextual_return_type(func);
        let iteration = expected
            .filter(|_| is_generator)
            .and_then(|ty| self.c.iteration_types(ty, is_async));
        let reports_yield = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.yielded)),
        };
        let reports_return = match expected {
            None => true,
            Some(ty) => {
                let ty = if is_generator {
                    iteration.map_or(ty, |t| t.returned)
                } else if is_async {
                    self.c.awaited(ty)
                } else {
                    ty
                };
                self.c.is_generic(ty)
            }
        };
        for (reports, widening, code, is_yield) in [
            (
                reports_yield,
                &yielded,
                if is_named { 7055 } else { 7025 },
                true,
            ),
            (
                reports_return,
                &returned,
                if is_named { 7010 } else { 7011 },
                false,
            ),
        ] {
            if !reports || !self.report_errors_from_widening(widening, start, code) {
                continue;
            }
            // `GetErrorRangeForNode`
            let file = self.file;
            let end = match (f.kind, owner) {
                (FnKind::Arrow, FnOwner::Expr(e)) => self.c.error_end_inside_parentheses(file, e),
                // The first token of a function expression that nothing names.
                (FnKind::Expr, _) if start == f.pos => 0,
                _ => self.c.end_of_name_at(file, start),
            };
            self.c.explain_to(start, end, code, |c| {
                let sig = c.sig_of_fn(file, func);
                let result = c.sig_return(sig);
                let ty = if is_generator {
                    c.iteration_types(result, is_async)
                        .map_or(TypeId::ANY, |types| {
                            if is_yield {
                                types.yielded
                            } else {
                                types.returned
                            }
                        })
                } else if is_async {
                    c.awaited(result)
                } else {
                    result
                };
                let ty = c.type_to_string(ty);
                if is_named {
                    vec![c.source_text(file, start, end), ty]
                } else {
                    vec![ty]
                }
            });
        }
    }

    /// `reportErrorsFromWidening`. `start`, `code`: what `reportImplicitAny` says of the declaration if there is nothing in the type
    /// to point at. Whether it did say that.
    fn report_errors_from_widening(&mut self, widening: &Widening, start: u32, code: u32) -> bool {
        let is_reported = !widening.is_unknown()
            && widening.contains_widening_type()
            && !self.report_widening_errors_in_type(widening);
        if is_reported {
            self.report(start, code);
        }
        is_reported
    }

    /// `reportWideningErrorsInType`: 7018
    fn report_widening_errors_in_type(&mut self, widening: &Widening) -> bool {
        let mut is_reported = false;
        match widening {
            Widening::Elements(args) => {
                for arg in args {
                    is_reported = is_reported || self.report_widening_errors_in_type(arg);
                }
            }
            Widening::Object(props) => {
                for (start, prop) in props {
                    is_reported = self.report_widening_errors_in_type(prop);
                    if !is_reported {
                        self.report(*start, 7018);
                        if let Some(p) = self.hir.props.iter().position(|p| p.pos == *start) {
                            let p = PropId(p as u32);
                            let end = self.c.end_of_prop(self.file, p);
                            self.explain_implicit_any(*start, end, 7018, *start, self.hir[p].value);
                        }
                        is_reported = true;
                    }
                }
            }
            _ => {}
        }
        is_reported
    }

    /// What the elements of `e` have, which is gone through by `...e` or `yield* e`.
    fn widening_of_what_is_spread(&mut self, e: ExprId) -> Widening {
        match self.widening_of(e) {
            Widening::No => Widening::No,
            Widening::Elements(mut args) if args.len() == 1 => args.remove(0),
            _ => Widening::Unknown,
        }
    }

    fn widening_of(&mut self, e: ExprId) -> Widening {
        let hir = self.hir;
        if self.c.is_stack_low() {
            return Widening::Unknown;
        }
        match hir[e].kind {
            ExprKind::Null | ExprKind::Missing | ExprKind::Unary { op: UnOp::Void, .. } => {
                Widening::Nullish
            }
            ExprKind::Ident(name) => {
                let symbol = self.bound.expr_symbol[e.idx()];
                if symbol.is_none() {
                    if name == known::undefined {
                        Widening::Nullish
                    } else {
                        Widening::No
                    }
                } else if self.auto_variable(symbol).is_some() {
                    // It is whatever was last assigned to it.
                    Widening::Unknown
                } else {
                    Widening::No
                }
            }
            ExprKind::NonNull(x)
            | ExprKind::AsConst(x)
            | ExprKind::Await(x)
            | ExprKind::Satisfies { expr: x, .. } => self.widening_of(x),
            ExprKind::Binary {
                op: BinOp::Comma,
                right: x,
                ..
            }
            | ExprKind::Assign {
                op: None, value: x, ..
            } => self.widening_of(x),
            ExprKind::Spread(x) => self.widening_of_what_is_spread(x),
            ExprKind::Cond { yes, no, .. } => {
                let branches = vec![(self.widening_of(yes), yes), (self.widening_of(no), no)];
                self.union_of_widenings(branches)
            }
            ExprKind::Array(items) => {
                let ty = self.c.type_of_expr(self.file, e);
                let is_tuple = self.c.is_tuple(ty);
                let mut elements = Vec::with_capacity(items.len());
                for item in hir.ids(items) {
                    elements.push((self.widening_of(item), item));
                }
                if is_tuple {
                    return Widening::Elements(elements.into_iter().map(|x| x.0).collect());
                }
                // Nothing in it: an array of `undefined`.
                if elements.is_empty() {
                    return Widening::Elements(vec![Widening::Nullish]);
                }
                match self.union_of_widenings(elements) {
                    Widening::No => Widening::No,
                    Widening::Unknown => Widening::Unknown,
                    element => Widening::Elements(vec![element]),
                }
            }
            ExprKind::Object(props) => self.widening_of_object(props),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                target: left,
                value: right,
            } => match (self.widening_of(left), self.widening_of(right)) {
                (Widening::No, Widening::No) => Widening::No,
                _ => Widening::Unknown,
            },
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                match self.widening_of(obj) {
                    Widening::No => Widening::No,
                    _ => Widening::Unknown,
                }
            }
            _ => Widening::No,
        }
    }

    /// What a union, reduced to what is no subtype of anything else in it, has: `null` and `undefined` go where there is anything
    /// else. Each with the expression it is the type of, if there is one.
    fn union_of_widenings(&mut self, members: Vec<(Widening, ExprId)>) -> Widening {
        let mut structured = None;
        let mut plain = Vec::new();
        let mut has_nullish = false;
        for (widening, e) in members {
            match widening {
                Widening::Unknown => return Widening::Unknown,
                Widening::Nullish => has_nullish = true,
                Widening::No => plain.push(e),
                // Which of two would be left, or both, is a matter of what is in them.
                _ if structured.is_some() => return Widening::Unknown,
                _ => structured = Some(widening),
            }
        }
        let Some(structured) = structured else {
            return if plain.is_empty() && has_nullish {
                Widening::Nullish
            } else {
                Widening::No
            };
        };
        // A primitive has nothing to do with an object.
        for e in plain {
            if e.is_none() {
                return Widening::Unknown;
            }
            let ty = self.c.type_of_expr(self.file, e);
            if !self.c.is_known(ty) || !self.c.every_type(ty, |c, m| c.is_primitive(m)) {
                return Widening::Unknown;
            }
        }
        structured
    }

    /// `getSpreadType`: whether spreading a `part` after a property `name` that is `null` or `undefined` leaves nothing of that.
    /// `is_partial`: all the properties of `part` may be left out.
    fn overrides(&mut self, part: TypeId, name: Atom, is_partial: bool) -> bool {
        let Some((prop, mapper)) = self.c.prop_of(part, name) else {
            return false;
        };
        // What is private or protected is not spread, and what was there by the name goes with it.
        if prop
            .flags
            .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
        {
            return !is_partial;
        }
        // `isSpreadableProperty`: nor are the methods and accessors of a class.
        if prop
            .flags
            .intersects(PropFlags::METHOD | PropFlags::ACCESSOR | PropFlags::WRITE_ONLY)
            && let PropSource::Members(members) = &prop.source
            && members.iter().any(|&(file, m)| {
                matches!(
                    self.c.bound(file).member_owner[m.idx()],
                    MemberOwner::Class(_)
                )
            })
        {
            return false;
        }
        if !is_partial && !prop.flags.contains(PropFlags::OPTIONAL) {
            return true;
        }
        // What may be left out is put together with what was there.
        let ty = self.c.type_of_prop(&prop, mapper);
        self.c.remove_missing_or_undefined_type(ty) != TypeId::NEVER
    }

    fn widening_of_object(&mut self, props: Span<PropId>) -> Widening {
        let hir = self.hir;
        // What is written that has some: which property it is, its name, where it is, what it has.
        let mut found: Vec<(usize, Atom, u32, Widening)> = Vec::new();
        let mut is_flagged = false;
        // What is spread: after which property, what it may be, and whether all its properties may be left out.
        let mut spreads: Vec<(usize, Vec<TypeId>, bool)> = Vec::new();
        for (i, p) in props.iter().enumerate() {
            let prop = &hir[p];
            if prop.value.is_none() {
                continue;
            }
            if prop.kind == PropKind::Spread {
                let ty = self.c.type_of_expr(self.file, prop.value);
                if !self.c.is_known(ty) {
                    return Widening::Unknown;
                }
                // With `any` in it, it is `any`.
                if self.c.is_any(ty) {
                    return Widening::No;
                }
                // Nothing that could be spread: an error, and what is in error has nothing to widen.
                let truthy = self.c.remove_definitely_falsy(ty);
                if truthy == TypeId::NEVER {
                    return Widening::No;
                }
                let mut parts = self.c.parts(truthy).to_vec();
                // `false` and the like spread nothing.
                if truthy != ty {
                    parts.push(TypeId::EMPTY_OBJECT);
                }
                spreads.push((i, parts, false));
                continue;
            }
            // A later property of the same name takes the place of an earlier one.
            let name = self.c.member_name(self.file, prop.key);
            if let Some(name) = name {
                found.retain(|x| x.1 != name);
            }
            if !matches!(prop.kind, PropKind::Init | PropKind::Shorthand) {
                continue;
            }
            let widening = self.widening_of(prop.value);
            if widening.is_unknown() {
                return Widening::Unknown;
            }
            if widening.contains_widening_type() {
                is_flagged = true;
                // Under a name that is worked out it goes into an index signature, where there is nothing to point at.
                if let Some(name) = name {
                    found.push((i, name, prop.pos, widening));
                }
            }
        }
        if !is_flagged {
            return Widening::No;
        }
        // With something in it that is yet to be known it is an intersection, which is not looked into.
        for (_, parts, _) in &spreads {
            for &part in parts {
                if self.c.is_generic_object_type(part) {
                    return Widening::Object(Vec::new());
                }
                if !self.c.is_object_type(part) {
                    return Widening::Unknown;
                }
            }
        }
        // `tryMergeUnionOfObjectTypeAndEmptyObject`: a union with no more than one member that has anything in it is that member, all
        // of whose properties may be left out.
        for (_, parts, is_partial) in &mut spreads {
            if parts.len() > 1 {
                let mut full = Vec::new();
                for &part in parts.iter() {
                    if !self.c.is_empty_object_type(part) {
                        full.push(part);
                    }
                }
                if full.len() <= 1 {
                    (*parts, *is_partial) = (full, true);
                }
            }
        }
        spreads.retain(|s| !s.1.is_empty());
        // It is one object for each choice of what is spread. The first that has something to report is reported: which that is
        // makes no difference if they all have the same.
        let choices: usize = spreads.iter().map(|s| s.1.len()).product();
        if choices > 16 {
            return Widening::Unknown;
        }
        let mut surviving: Option<Vec<usize>> = None;
        for choice in 0..choices {
            let mut rest = choice;
            let mut chosen = Vec::with_capacity(spreads.len());
            for (after, parts, is_partial) in &spreads {
                chosen.push((*after, parts[rest % parts.len()], *is_partial));
                rest /= parts.len();
            }
            let mut left = Vec::new();
            for (k, x) in found.iter().enumerate() {
                let mut is_overridden = false;
                for &(after, part, is_partial) in &chosen {
                    is_overridden |= after > x.0 && self.overrides(part, x.1, is_partial);
                }
                if !is_overridden {
                    left.push(k);
                }
            }
            if left.is_empty() {
                continue;
            }
            if surviving.as_ref().is_some_and(|others| *others != left) {
                return Widening::Unknown;
            }
            surviving = Some(left);
        }
        let surviving = surviving.unwrap_or_default();
        Widening::Object(
            found
                .into_iter()
                .enumerate()
                .filter(|(k, _)| surviving.contains(k))
                .map(|(_, x)| (x.2, x.3))
                .collect(),
        )
    }

    // ───────────────────────────── patterns ─────────────────────────────

    /// `isValidSpreadType`
    fn is_valid_spread_type(&mut self, ty: TypeId) -> bool {
        let ty = self.c.force(ty);
        let ty = self
            .c
            .map_type(ty, |c, m| c.base_constraint_of(m).unwrap_or(m));
        let ty = self.c.remove_definitely_falsy(ty);
        match self.c.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().all(|&p| self.is_valid_spread_type(p))
            }
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::NoInfer(_) => true,
            _ => self.c.is_any(ty) || ty == TypeId::OBJECT || self.c.is_object_type(ty),
        }
    }

    /// `getBindingElementTypeFromParentType`: 2700, `...rest` of what is no object.
    fn check_rest_elements(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for p in 0..hir.pats.len() {
            let PatKind::Object(props) = hir.pats[p].kind else {
                continue;
            };
            if matches!(bound.pat_parent[p], PatParent::None) {
                continue;
            }
            let Some(rest) = props.iter().find(|&x| hir[x].is_rest) else {
                continue;
            };
            let given = self.c.type_of_pat(self.file, PatId(p as u32));
            if !self.c.is_known(given) || self.c.is_any(given) {
                continue;
            }
            let given = self.c.reduced(given);
            if given == TypeId::UNKNOWN || !self.is_valid_spread_type(given) {
                self.report(hir[hir[rest].value].pos, 2700);
            }
        }
    }

    /// `checkUnusedRenamedBindingElements`: 2842. In `({ a: string }) => void`, `string` is a name nobody can use.
    fn check_renamed_binding_elements(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        // `{ a }` has no property name.
        let is_renamed = |prop: &PatProp| {
            !prop.is_rest
                && matches!(hir[prop.value].kind, PatKind::Ident(_))
                && hir[prop.value].pos != prop.pos
        };
        // `NodeIsMissing(body)`
        let is_body_missing = |func: &Func| {
            matches!(func.body, FnBody::None) && !func.flags.contains(Flags::BODY_DROPPED)
        };
        for prop in hir.pat_props.iter().filter(|prop| is_renamed(prop)) {
            let Node::Params(f) = self.around_pattern(prop.value) else {
                continue;
            };
            if !is_body_missing(&hir[f]) || matches!(bound.fns[f.idx()].owner, FnOwner::None) {
                continue;
            }
            let symbol = bound.pat_symbol[prop.value.idx()];
            if symbol.is_some() && !bound.expr_symbol.contains(&symbol) {
                let (file, start, property) = (self.file, hir[prop.value].pos, prop.pos);
                self.report(start, 2842);
                let is_missing = matches!(hir[prop.value].kind, PatKind::Ident(name) if self.c.files().atoms.bytes(name).is_empty());
                self.c.explain(start, 2842, |c| {
                    let name = if is_missing {
                        "(Missing)".to_owned()
                    } else {
                        c.declaration_name_at(file, start)
                    };
                    vec![name, c.declaration_name_at(file, property)]
                });
            }
        }
        if !self.no_implicit_any {
            return;
        }
        // `checkVariableLikeDeclaration` returns before it asks for the type of a renamed element. 7031 comes from
        // `getTypeFromBindingPattern`, which only runs once the type of the parameter is asked for: by another element of the
        // pattern, by a call, or by a comparison with another signature.
        for (i, func) in hir.fns.iter().enumerate() {
            if func.kind != FnKind::Decl || !is_body_missing(func) {
                continue;
            }
            let mut cached = None;
            for p in func.params.iter() {
                let PatKind::Object(props) = hir[hir[p].pat].kind else {
                    continue;
                };
                if !props.iter().all(|q| is_renamed(&hir[q])) {
                    continue;
                }
                let symbol = bound.fn_symbol[i];
                let is_unused = *cached.get_or_insert_with(|| {
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && !bound.expr_symbol.contains(&symbol)
                });
                if is_unused {
                    self.out.retain(|d| {
                        d.code != 7031 || !props.iter().any(|q| hir[hir[q].value].pos == d.start)
                    });
                }
            }
        }
    }
}
