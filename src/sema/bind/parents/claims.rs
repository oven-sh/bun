//! The parents that a parser notes while it builds the nodes.
//!
//! [`fill`] looks at every expression, statement and type of a finished file, and what it does next depends on the kind
//! of the node, which nothing predicts there. Where a parser finishes a node it knows the kind, so all that's left of
//! the same work is a few stores. A node "claims" its children: [`Claims::expr`], [`Claims::stmt`] and [`Claims::ty`]
//! write what the three loops of `fill` write for one node. **They have to stay in step with those loops.** In a debug
//! build [`try_bind_for_format_with`] compares the result with that of `fill`.
//!
//! Nodes are claimed in the order of their ids, as in `fill`, so if two nodes claim a child the later one wins here too.
//! What a parser takes back is forgotten: [`Claims::forget_since`]. A child whose claim is forgotten has no parent until
//! another node claims it. A file in which a node is left without a parent goes to `fill`, and so does one with a node
//! that was never reported, because nothing has claimed its children.

use super::*;

/// How many nodes of each kind a file has.
#[derive(Copy, Clone)]
pub struct ClaimLens {
    pub exprs: u32,
    pub stmts: u32,
    pub types: u32,
    pub props: u32,
    pub members: u32,
    pub var_decls: u32,
    pub cases: u32,
    pub classes: u32,
    pub fns: u32,
    pub type_params: u32,
    pub tuple_elems: u32,
}

/// The parent of each type, type parameter and element of a tuple type of a file, indexed like the file's lists. What
/// has none, or is an argument of `import<T>()`, has `TypeParent::None` or `TypeParent::File`.
#[derive(Copy, Clone)]
pub struct TypeParents<'a> {
    pub types: &'a [PackedTypeParent],
    pub type_params: &'a [PackedTypeParent],
    pub tuple_elems: &'a [PackedTypeParent],
}

/// See the [module](self). The lists are those of a [`BoundBuilder`] with the same names, and [`TypeParents`], which a
/// `BoundBuilder` doesn't have. Each is as long as it had to be so far: what is beyond its end is empty, like what nothing
/// has claimed.
#[derive(Default)]
pub struct Claims {
    expr_parent: Vec<PackedParent>,
    stmt_parent: Vec<PackedParent>,
    type_parent: Vec<PackedTypeParent>,
    type_param_parent: Vec<PackedTypeParent>,
    tuple_elem_parent: Vec<PackedTypeParent>,
    prop_owner: Vec<ExprId>,
    member_owner: Vec<MemberOwner>,
    var_stmt: Vec<StmtId>,
    case_stmt: Vec<StmtId>,
    class_owner: Vec<ClassOwner>,
    class_scope: Vec<ScopeId>,
    /// `FnInfo::owner`
    fn_owner: Vec<FnOwner>,
    /// There is, or was, a `typeof` type.
    has_type_queries: bool,
    /// The nodes of the file are reported, and none of them needs the binder.
    is_complete: bool,
    /// [`try_bind_for_format_with`] has completed [`Claims::type_parents`].
    has_type_parents: bool,
}

const NO_CLASS_OWNER: ClassOwner = ClassOwner::Stmt(StmtId::NONE);
const NO_TYPE_PARENT: PackedTypeParent = PackedTypeParent::NONE;

/// `list[at] = value`, where `list` ends before `at`. There are `nodes` nodes, so an `at` beyond that is `NONE`.
#[cold]
#[inline(never)]
fn put_beyond_end<T: Copy>(list: &mut Vec<T>, nodes: usize, at: usize, value: T, empty: T) {
    if at < nodes {
        list.resize((2 * list.len()).max(at + 1).max(64), empty);
        if let Some(slot) = list.get_mut(at) {
            *slot = value;
        }
    }
}

/// `list[at] = value`. With `UNDO`, takes that back.
#[inline(always)]
fn put<const UNDO: bool, T: Copy + PartialEq>(
    list: &mut Vec<T>,
    nodes: usize,
    at: usize,
    value: T,
    empty: T,
) {
    match list.get_mut(at) {
        Some(slot) if !UNDO => *slot = value,
        Some(slot) if *slot == value => *slot = empty,
        Some(_) => {}
        None if !UNDO => put_beyond_end(list, nodes, at, value, empty),
        None => {}
    }
}

/// Defines `fn $name(&mut self, f, child, value)`, which is `self.$list[child] = value`.
macro_rules! lists {
    ($($name:ident: $list:ident[$id:ty] = $value:ty, $nodes:ident, $empty:expr;)*) => {
        $(
            #[inline(always)]
            fn $name<const UNDO: bool>(&mut self, f: &FileBuilder, child: $id, value: $value) {
                put::<UNDO, $value>(&mut self.$list, f.$nodes.len(), child.idx(), value, $empty);
            }
        )*

        /// Call before the first node of a file. `reports`: the parser reports the nodes.
        pub fn begin(&mut self, reports: bool) {
            $(self.$list.clear();)*
            self.has_type_queries = false;
            self.is_complete = reports;
            self.has_type_parents = false;
        }

        fn truncate(&mut self, lens: &ClaimLens) {
            $(self.$list.truncate(lens.$nodes as usize);)*
        }
    };
}

impl Claims {
    lists! {
        expr_of: expr_parent[ExprId] = PackedParent, exprs, PackedParent::default();
        stmt_of: stmt_parent[StmtId] = PackedParent, stmts, PackedParent::default();
        type_of: type_parent[TypeNodeId] = PackedTypeParent, types, NO_TYPE_PARENT;
        type_param_of: type_param_parent[TypeParamId] = PackedTypeParent, type_params, NO_TYPE_PARENT;
        tuple_elem_of: tuple_elem_parent[TupleElemId] = PackedTypeParent, tuple_elems, NO_TYPE_PARENT;
        prop_of: prop_owner[PropId] = ExprId, props, ExprId::NONE;
        member_of: member_owner[MemberId] = MemberOwner, members, MemberOwner::None;
        var_decl_of: var_stmt[VarDeclId] = StmtId, var_decls, StmtId::NONE;
        case_of: case_stmt[CaseId] = StmtId, cases, StmtId::NONE;
        class_of: class_owner[ClassId] = ClassOwner, classes, NO_CLASS_OWNER;
        class_is: class_scope[ClassId] = ScopeId, classes, ScopeId::NONE;
        fn_of: fn_owner[FnId] = FnOwner, fns, FnOwner::None;
    }

    /// `None` until [`try_bind_for_format_with`] has used the claims, and if it couldn't.
    pub fn type_parents(&self) -> Option<TypeParents<'_>> {
        self.has_type_parents.then_some(TypeParents {
            types: &self.type_parent,
            type_params: &self.type_param_parent,
            tuple_elems: &self.tuple_elem_parent,
        })
    }

    /// Call after adding the expression `id` to `f`.
    #[inline(always)]
    pub fn expr(&mut self, f: &FileBuilder, id: ExprId, kind: &ExprKind) {
        self.children_of_expr::<false>(f, id, kind);
    }

    /// Call after adding the statement `id` to `f`.
    #[inline(always)]
    pub fn stmt(&mut self, f: &FileBuilder, id: StmtId, kind: &StmtKind) {
        self.children_of_stmt::<false>(f, id, kind);
    }

    /// Call after adding the type `id` to `f`.
    #[inline(always)]
    pub fn ty(&mut self, f: &FileBuilder, id: TypeNodeId, kind: &TypeNodeKind) {
        self.children_of_type::<false>(f, id, kind);
    }

    /// Call before removing the nodes of `f` from `lens` on.
    #[inline(never)]
    pub fn forget_since(&mut self, f: &FileBuilder, lens: &ClaimLens) {
        // From here on, what goes is out of range. So below only what stays loses its parent.
        self.truncate(lens);
        for (i, e) in f.exprs.iter().enumerate().skip(lens.exprs as usize) {
            self.children_of_expr::<true>(f, ExprId(i as u32), &e.kind);
        }
        for (i, s) in f.stmts.iter().enumerate().skip(lens.stmts as usize) {
            self.children_of_stmt::<true>(f, StmtId(i as u32), &s.kind);
        }
        for (i, ty) in f.types.iter().enumerate().skip(lens.types as usize) {
            self.children_of_type::<true>(f, TypeNodeId(i as u32), &ty.kind);
        }
    }

    /// Call before removing the last expression of `f`.
    #[inline(never)]
    pub fn forget_last_expr(&mut self, f: &FileBuilder) {
        if let Some((last, before)) = f.exprs.split_last() {
            let id = ExprId(before.len() as u32);
            if let Some(slot) = self.expr_parent.get_mut(id.idx()) {
                *slot = PackedParent::default();
            }
            self.children_of_expr::<true>(f, id, &last.kind);
        }
    }

    /// Call before removing the last type of `f`.
    #[inline(never)]
    pub fn forget_last_type(&mut self, f: &FileBuilder) {
        if let Some((last, before)) = f.types.split_last() {
            let id = TypeNodeId(before.len() as u32);
            if let Some(slot) = self.type_parent.get_mut(id.idx()) {
                *slot = NO_TYPE_PARENT;
            }
            self.children_of_type::<true>(f, id, &last.kind);
        }
    }

    #[inline(always)]
    fn exprs_of<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        list: IdList<ExprId>,
        parent: PackedParent,
    ) {
        for &child in f.ids.get(list.range()).unwrap_or_default() {
            self.expr_of::<UNDO>(f, ExprId(child), parent);
        }
    }

    #[inline(always)]
    fn stmts_of<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        list: IdList<StmtId>,
        parent: PackedParent,
    ) {
        for &child in f.ids.get(list.range()).unwrap_or_default() {
            self.stmt_of::<UNDO>(f, StmtId(child), parent);
        }
    }

    #[inline(always)]
    fn types_of<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        list: IdList<TypeNodeId>,
        parent: PackedTypeParent,
    ) {
        for &ty in f.ids.get(list.range()).unwrap_or_default() {
            self.type_of::<UNDO>(f, TypeNodeId(ty), parent);
        }
    }

    #[inline(always)]
    fn props_of<const UNDO: bool>(&mut self, f: &FileBuilder, props: Span<PropId>, owner: ExprId) {
        for p in props.iter() {
            let Some(prop) = f.props.get(p.idx()) else {
                continue;
            };
            self.prop_of::<UNDO>(f, p, owner);
            self.expr_of::<UNDO>(f, prop.value, Parent::Prop(p).into());
            if let PropKey::Computed(key) = prop.key {
                let names_a_function = !matches!(
                    prop.kind,
                    PropKind::Init | PropKind::Spread | PropKind::Shorthand
                );
                let parent = match names_a_function {
                    true => Parent::MethodKey(p),
                    false => Parent::PropKey(p),
                };
                self.expr_of::<UNDO>(f, key, parent.into());
            }
        }
    }

    #[inline(always)]
    fn members_of<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        members: Span<MemberId>,
        literal: TypeNodeId,
    ) {
        for m in members.iter() {
            self.member_of::<UNDO>(f, m, MemberOwner::TypeLiteral(literal));
        }
    }

    /// The first loop of [`fill`], for one expression. With `UNDO`, takes back what it wrote without.
    #[inline(always)]
    fn children_of_expr<const UNDO: bool>(&mut self, f: &FileBuilder, id: ExprId, kind: &ExprKind) {
        let me: PackedParent = Parent::Expr(id).into();
        let of_types: PackedTypeParent = TypeParent::Expr(id).into();
        macro_rules! operands {
            ($($operand:expr),*) => {{ $(self.expr_of::<UNDO>(f, $operand, me);)* }};
        }
        match *kind {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::JsxText(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => {}
            ExprKind::Dot { obj, .. } => operands!(obj),
            ExprKind::Index { obj, index, .. } => operands!(obj, index),
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                if let Some(call) = f.calls.get(c.idx()) {
                    operands!(call.callee);
                    if let ExprKind::TaggedTemplate(_) = *kind {
                        operands!(f.template_of(c));
                    }
                    self.exprs_of::<UNDO>(f, call.args, me);
                    self.types_of::<UNDO>(f, f.list_at(call.type_args), of_types);
                }
            }
            ExprKind::Template { exprs, .. } => self.exprs_of::<UNDO>(f, exprs, me),
            ExprKind::Array(items) => self.exprs_of::<UNDO>(f, items, me),
            ExprKind::ImportCall { args } => {
                self.exprs_of::<UNDO>(f, args, me);
                if !f.import_call_type_args.is_empty() {
                    let type_args = f.type_args_of_import_call(args);
                    self.types_of::<UNDO>(f, type_args, TypeParent::File.into());
                }
            }
            ExprKind::Object(props) => self.props_of::<UNDO>(f, props, id),
            ExprKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Expr(id)),
            ExprKind::Class(class) => {
                self.class_of::<UNDO>(f, class, ClassOwner::Expr(id));
                self.class_is::<UNDO>(f, class, REACHED);
            }
            ExprKind::Binary { left, right, .. } => operands!(left, right),
            ExprKind::Assign { target, value, .. } => operands!(target, value),
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = f.branches(branches);
                operands!(test, yes, no);
            }
            ExprKind::Unary { operand, .. }
            | ExprKind::Spread(operand)
            | ExprKind::Await(operand)
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Yield { value: operand, .. } => operands!(operand),
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                operands!(expr);
                self.type_of::<UNDO>(f, ty, of_types);
            }
            ExprKind::Instantiation { expr, type_args } => {
                operands!(expr);
                self.types_of::<UNDO>(f, f.list_at(type_args), of_types);
            }
            ExprKind::Jsx(jsx) => {
                if let Some(jsx) = f.jsx.get(jsx.idx()) {
                    operands!(jsx.tag, jsx.close_tag);
                    self.types_of::<UNDO>(f, jsx.type_args, of_types);
                    self.props_of::<UNDO>(f, jsx.attrs, id);
                    self.exprs_of::<UNDO>(f, jsx.children, me);
                }
            }
        }
    }

    /// The loop of [`fill`] over the statements, for one of them.
    #[inline(always)]
    fn children_of_stmt<const UNDO: bool>(&mut self, f: &FileBuilder, id: StmtId, kind: &StmtKind) {
        let me: PackedParent = Parent::Stmt(id).into();
        macro_rules! exprs {
            ($($e:expr),*) => {{ $(self.expr_of::<UNDO>(f, $e, me);)* }};
        }
        macro_rules! stmts {
            ($($s:expr),*) => {{ $(self.stmt_of::<UNDO>(f, $s, me);)* }};
        }
        match *kind {
            StmtKind::Return(e)
            | StmtKind::Expr(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e)
            | StmtKind::Directive { expr: e, .. } => exprs!(e),
            StmtKind::Var(declarations) => {
                for d in declarations.iter() {
                    self.var_decl_of::<UNDO>(f, d, id);
                }
            }
            StmtKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Stmt(id)),
            StmtKind::Class(class) => {
                self.class_of::<UNDO>(f, class, ClassOwner::Stmt(id));
                self.class_is::<UNDO>(f, class, REACHED);
            }
            StmtKind::If { test, yes, no } => {
                exprs!(test);
                stmts!(yes, no);
            }
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                exprs!(test);
                stmts!(body);
            }
            StmtKind::With { object, body } => {
                exprs!(object);
                stmts!(body);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                exprs!(test, update);
                stmts!(init, body);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                exprs!(expr);
                stmts!(left, body);
            }
            StmtKind::Block(list) => self.stmts_of::<UNDO>(f, list, me),
            StmtKind::Switch { expr, cases } => {
                exprs!(expr);
                for c in cases.iter() {
                    self.case_of::<UNDO>(f, c, id);
                    let Some(case) = f.cases.get(c.idx()) else {
                        continue;
                    };
                    self.expr_of::<UNDO>(f, case.test, Parent::Case(c).into());
                    self.stmts_of::<UNDO>(f, case.body, me);
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.var_decl_of::<UNDO>(f, param, id);
                stmts!(block, handler, finalizer);
            }
            StmtKind::Labeled { body, .. } => stmts!(body),
            StmtKind::ImportEquals(import) => {
                if let Some(import) = f.import_equals.get(import.idx()) {
                    exprs!(import.expression);
                }
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => {}
        }
    }

    /// The loop of [`fill`] over the types, for one of them.
    #[inline(always)]
    fn children_of_type<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        id: TypeNodeId,
        kind: &TypeNodeKind,
    ) {
        let me: PackedTypeParent = TypeParent::Type(id).into();
        macro_rules! ty {
            ($($ty:expr),*) => {{ $(self.type_of::<UNDO>(f, $ty, me);)* }};
        }
        match *kind {
            TypeNodeKind::Heritage { .. } => self.is_complete = false,
            TypeNodeKind::Typeof { expr, args, .. } => {
                self.types_of::<UNDO>(f, args, me);
                self.expr_of::<UNDO>(f, expr, Parent::File.into());
                self.has_type_queries = true;
            }
            TypeNodeKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Type(id)),
            TypeNodeKind::Object(members) => self.members_of::<UNDO>(f, members, id),
            TypeNodeKind::Mapped(mapped) => {
                if let Some(mapped) = f.mapped.get(mapped.idx()) {
                    self.type_param_of::<UNDO>(f, mapped.param, me);
                    if let Some(param) = f.type_params.get(mapped.param.idx()) {
                        let of_param = TypeParent::TypeParam(mapped.param).into();
                        self.type_of::<UNDO>(f, param.constraint, of_param);
                        self.type_of::<UNDO>(f, param.default, of_param);
                    }
                    ty!(mapped.name_ty, mapped.ty);
                    self.members_of::<UNDO>(f, mapped.members, id);
                }
            }
            TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. } => {
                self.types_of::<UNDO>(f, args, me)
            }
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => self.types_of::<UNDO>(f, types, me),
            TypeNodeKind::Array(operand)
            | TypeNodeKind::Keyof(operand)
            | TypeNodeKind::Readonly(operand)
            | TypeNodeKind::Unique(operand)
            | TypeNodeKind::JSDoc { ty: operand, .. }
            | TypeNodeKind::Predicate { ty: operand, .. } => ty!(operand),
            TypeNodeKind::Tuple(elements) => {
                for e in elements.iter() {
                    self.tuple_elem_of::<UNDO>(f, e, me);
                    // One of the two can contain the other, which it has claimed. The element is the parent of both.
                    if let Some(element) = f.tuple_elems.get(e.idx()) {
                        let of_element = TypeParent::TupleElem(e).into();
                        self.type_of::<UNDO>(f, element.ty, of_element);
                        self.type_of::<UNDO>(f, element.written, of_element);
                    }
                }
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => ty!(check, extends, yes, no),
            TypeNodeKind::IndexedAccess { obj, index } => ty!(obj, index),
            TypeNodeKind::Infer(param) => {
                self.type_param_of::<UNDO>(f, param, me);
                let constraint = f.type_params.get(param.idx()).map(|it| it.constraint);
                let of_param = TypeParent::TypeParam(param).into();
                self.type_of::<UNDO>(f, constraint.unwrap_or(TypeNodeId::NONE), of_param);
            }
            TypeNodeKind::Error
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
        }
    }

    /// Moves the lists to `b`, at the length of the lists of `f`. What was in `b` is kept for the next file.
    fn move_to(&mut self, f: &FileBuilder, b: &mut BoundBuilder) {
        macro_rules! hand_over {
            ($($list:ident: $nodes:ident, $empty:expr;)*) => {
                $(
                    self.$list.resize(f.$nodes.len(), $empty);
                    std::mem::swap(&mut self.$list, &mut b.$list);
                )*
            };
        }
        hand_over! {
            expr_parent: exprs, PackedParent::default();
            stmt_parent: stmts, PackedParent::default();
            prop_owner: props, ExprId::NONE;
            member_owner: members, MemberOwner::None;
            var_stmt: var_decls, StmtId::NONE;
            case_stmt: cases, StmtId::NONE;
            class_owner: classes, NO_CLASS_OWNER;
            class_scope: classes, ScopeId::NONE;
        }
        // These stay here. What has a parent is reached.
        let scope_of = |parent: &PackedTypeParent| match *parent == NO_TYPE_PARENT {
            true => ScopeId::NONE,
            false => REACHED,
        };
        self.type_parent.resize(f.types.len(), NO_TYPE_PARENT);
        self.type_param_parent
            .resize(f.type_params.len(), NO_TYPE_PARENT);
        self.tuple_elem_parent
            .resize(f.tuple_elems.len(), NO_TYPE_PARENT);
        b.type_scope.extend(self.type_parent.iter().map(scope_of));
        b.type_param_scope
            .extend(self.type_param_parent.iter().map(scope_of));
        refill(&mut b.fns, f.fns.len(), NO_FUNCTION);
        for (info, &owner) in b.fns.iter_mut().zip(&self.fn_owner) {
            info.owner = owner;
        }
    }
}

/// [`bind_for_format_in`] for a file that's still in the parser's growable lists. `claims` are those of its parser, and
/// are used up. It doesn't read anything that `File::finish_nodes` computes. Returns `None` if the file needs the
/// binder, which takes a [`File`]. It isn't generic and is never inlined, so `fill_in` is compiled for it in this crate,
/// with this crate's options.
#[inline(never)]
pub fn try_bind_for_format_with<'r>(
    f: &FileBuilder,
    claims: &mut Claims,
    recycled: &'r mut Recycled,
) -> Option<&'r BoundBuilder> {
    let b = &mut recycled.buffers().b;
    if !fill_in_rest(f, claims, b) {
        return fill_in::<Growable, false>(f, b).then_some(&*b);
    }
    #[cfg(debug_assertions)]
    assert_same_as_fill(f, b);
    Some(&*b)
}

fn fill_in_rest(f: &FileBuilder, claims: &mut Claims, b: &mut BoundBuilder) -> bool {
    let is_complete = std::mem::take(&mut claims.is_complete);
    if !is_complete || needs_full_binder(f) || !f.has_room_for_handles() {
        return false;
    }
    b.clear();
    claims.move_to(f, b);
    refill(&mut b.pat_parent, f.pats.len(), PatParent::None);
    refill(&mut b.param_fn, f.params.len(), FnId::NONE);
    refill(&mut b.enum_member_owner, f.enum_members.len(), EnumId::NONE);
    let lists = Lists {
        type_parent: &mut claims.type_parent,
        type_param_parent: &mut claims.type_param_parent,
        ..lists_of(b)
    };
    claims.has_type_parents =
        fill::<Growable, false, true>(f, lists, claims.has_type_queries) && is_done(b);
    claims.has_type_parents
}

#[cfg(debug_assertions)]
fn assert_same_as_fill(f: &FileBuilder, b: &BoundBuilder) {
    let mut expected = BoundBuilder::default();
    assert!(fill_in::<Growable, false>(f, &mut expected));
    macro_rules! same {
        ($($list:ident),*) => { $(assert!(b.$list == expected.$list, stringify!($list));)* };
    }
    same!(
        expr_parent,
        stmt_parent,
        pat_parent,
        prop_owner,
        member_owner,
        param_fn,
        var_stmt,
        case_stmt,
        class_owner,
        enum_member_owner,
        type_query_operands,
        class_scope,
        type_scope,
        type_param_scope
    );
    let owners = |b: &BoundBuilder| b.fns.iter().map(|it| it.owner).collect::<Vec<_>>();
    assert!(owners(b) == owners(&expected), "fns");
}
