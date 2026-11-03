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

#[cold]
#[inline(never)]
fn grow<T: Copy>(list: &mut Vec<T>, nodes: usize, empty: T) {
    list.resize((2 * list.len()).max(nodes).max(64), empty);
}

/// One of the lists, with room for every node that the file has so far, and what is in an empty entry.
struct Slots<'c, T>(&'c mut [T], T);

impl<T: Copy + PartialEq> Slots<'_, T> {
    /// `list[at] = value`, unless `at` is `NONE`. With `UNDO`, takes that back.
    #[inline(always)]
    fn put<const UNDO: bool>(&mut self, at: usize, value: T) {
        if let Some(slot) = self.0.get_mut(at) {
            match UNDO {
                false => *slot = value,
                true if *slot == value => *slot = self.1,
                true => {}
            }
        }
    }

    #[inline(always)]
    fn put_all<const UNDO: bool, I>(&mut self, f: &FileBuilder, list: IdList<I>, value: T) {
        for &at in f.ids.get(list.range()).unwrap_or_default() {
            self.put::<UNDO>(at as usize, value);
        }
    }
}

/// Defines `fn $name(&mut self, f) -> Slots`, for `self.$list`.
macro_rules! lists {
    ($($name:ident: $list:ident = $value:ty, $nodes:ident, $empty:expr;)*) => {
        $(
            #[inline(always)]
            fn $name<'c, const UNDO: bool>(list: &'c mut Vec<$value>, f: &FileBuilder) -> Slots<'c, $value> {
                if !UNDO && list.len() < f.$nodes.len() {
                    grow(list, f.$nodes.len(), $empty);
                }
                Slots(list, $empty)
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
        exprs: expr_parent = PackedParent, exprs, PackedParent::NONE;
        stmts: stmt_parent = PackedParent, stmts, PackedParent::NONE;
        types: type_parent = PackedTypeParent, types, NO_TYPE_PARENT;
        type_params: type_param_parent = PackedTypeParent, type_params, NO_TYPE_PARENT;
        tuple_elems: tuple_elem_parent = PackedTypeParent, tuple_elems, NO_TYPE_PARENT;
        props: prop_owner = ExprId, props, ExprId::NONE;
        members: member_owner = MemberOwner, members, MemberOwner::None;
        var_decls: var_stmt = StmtId, var_decls, StmtId::NONE;
        cases: case_stmt = StmtId, cases, StmtId::NONE;
        classes: class_owner = ClassOwner, classes, NO_CLASS_OWNER;
        reached_classes: class_scope = ScopeId, classes, ScopeId::NONE;
        fns: fn_owner = FnOwner, fns, FnOwner::None;
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
                *slot = PackedParent::NONE;
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
    fn props_of<const UNDO: bool>(&mut self, f: &FileBuilder, props: Span<PropId>, owner: ExprId) {
        let mut owners = Self::props::<UNDO>(&mut self.prop_owner, f);
        let mut exprs = Self::exprs::<UNDO>(&mut self.expr_parent, f);
        for p in props.iter() {
            let Some(prop) = f.props.get(p.idx()) else {
                continue;
            };
            owners.put::<UNDO>(p.idx(), owner);
            exprs.put::<UNDO>(prop.value.idx(), Parent::Prop(p).into());
            if let PropKey::Computed(key) = prop.key {
                let names_a_function = !matches!(
                    prop.kind,
                    PropKind::Init | PropKind::Spread | PropKind::Shorthand
                );
                let parent = match names_a_function {
                    true => Parent::MethodKey(p),
                    false => Parent::PropKey(p),
                };
                exprs.put::<UNDO>(key.idx(), parent.into());
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
        let mut owners = Self::members::<UNDO>(&mut self.member_owner, f);
        for m in members.iter() {
            owners.put::<UNDO>(m.idx(), MemberOwner::TypeLiteral(literal));
        }
    }

    #[inline(always)]
    fn class_of<const UNDO: bool>(&mut self, f: &FileBuilder, class: ClassId, owner: ClassOwner) {
        Self::classes::<UNDO>(&mut self.class_owner, f).put::<UNDO>(class.idx(), owner);
        Self::reached_classes::<UNDO>(&mut self.class_scope, f).put::<UNDO>(class.idx(), REACHED);
    }

    #[inline(always)]
    fn fn_of<const UNDO: bool>(&mut self, f: &FileBuilder, func: FnId, owner: FnOwner) {
        Self::fns::<UNDO>(&mut self.fn_owner, f).put::<UNDO>(func.idx(), owner);
    }

    /// The types in `list`, which is usually empty.
    #[inline(always)]
    fn types_of<const UNDO: bool>(
        &mut self,
        f: &FileBuilder,
        list: IdList<TypeNodeId>,
        parent: PackedTypeParent,
    ) {
        if !list.is_empty() {
            Self::types::<UNDO>(&mut self.type_parent, f).put_all::<UNDO, _>(f, list, parent);
        }
    }

    /// The first loop of [`fill`], for one expression. With `UNDO`, takes back what it wrote without.
    #[inline(always)]
    fn children_of_expr<const UNDO: bool>(&mut self, f: &FileBuilder, id: ExprId, kind: &ExprKind) {
        let me: PackedParent = Parent::Expr(id).into();
        let of_types: PackedTypeParent = TypeParent::Expr(id).into();
        macro_rules! operands {
            ($($operand:expr),*) => {{
                let mut exprs = Self::exprs::<UNDO>(&mut self.expr_parent, f);
                $(exprs.put::<UNDO>($operand.idx(), me);)*
            }};
        }
        macro_rules! list {
            ($list:expr) => {
                Self::exprs::<UNDO>(&mut self.expr_parent, f).put_all::<UNDO, _>(f, $list, me)
            };
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
                    let mut exprs = Self::exprs::<UNDO>(&mut self.expr_parent, f);
                    exprs.put::<UNDO>(call.callee.idx(), me);
                    if let ExprKind::TaggedTemplate(_) = *kind {
                        exprs.put::<UNDO>(f.template_of(c).idx(), me);
                    }
                    exprs.put_all::<UNDO, _>(f, call.args, me);
                    self.types_of::<UNDO>(f, f.list_at(call.type_args), of_types);
                }
            }
            ExprKind::Template { exprs, .. } => list!(exprs),
            ExprKind::Array(items) => list!(items),
            ExprKind::ImportCall { args } => {
                list!(args);
                if !f.import_call_type_args.is_empty() {
                    let type_args = f.type_args_of_import_call(args);
                    self.types_of::<UNDO>(f, type_args, TypeParent::File.into());
                }
            }
            ExprKind::Object(props) => self.props_of::<UNDO>(f, props, id),
            ExprKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Expr(id)),
            ExprKind::Class(class) => self.class_of::<UNDO>(f, class, ClassOwner::Expr(id)),
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
                Self::types::<UNDO>(&mut self.type_parent, f).put::<UNDO>(ty.idx(), of_types);
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
                    list!(jsx.children);
                }
            }
        }
    }

    /// The loop of [`fill`] over the statements, for one of them.
    #[inline(always)]
    fn children_of_stmt<const UNDO: bool>(&mut self, f: &FileBuilder, id: StmtId, kind: &StmtKind) {
        let me: PackedParent = Parent::Stmt(id).into();
        macro_rules! exprs {
            ($($e:expr),*) => {{
                let mut exprs = Self::exprs::<UNDO>(&mut self.expr_parent, f);
                $(exprs.put::<UNDO>($e.idx(), me);)*
            }};
        }
        macro_rules! stmts {
            ($($s:expr),*) => {{
                let mut stmts = Self::stmts::<UNDO>(&mut self.stmt_parent, f);
                $(stmts.put::<UNDO>($s.idx(), me);)*
            }};
        }
        match *kind {
            StmtKind::Return(e)
            | StmtKind::Expr(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e)
            | StmtKind::Directive { expr: e, .. } => exprs!(e),
            StmtKind::Var(declarations) => {
                let mut var_decls = Self::var_decls::<UNDO>(&mut self.var_stmt, f);
                for d in declarations.iter() {
                    var_decls.put::<UNDO>(d.idx(), id);
                }
            }
            StmtKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Stmt(id)),
            StmtKind::Class(class) => self.class_of::<UNDO>(f, class, ClassOwner::Stmt(id)),
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
            StmtKind::Block(list) => {
                Self::stmts::<UNDO>(&mut self.stmt_parent, f).put_all::<UNDO, _>(f, list, me)
            }
            StmtKind::Switch { expr, cases } => {
                let mut exprs = Self::exprs::<UNDO>(&mut self.expr_parent, f);
                let mut stmts = Self::stmts::<UNDO>(&mut self.stmt_parent, f);
                let mut owners = Self::cases::<UNDO>(&mut self.case_stmt, f);
                exprs.put::<UNDO>(expr.idx(), me);
                for c in cases.iter() {
                    owners.put::<UNDO>(c.idx(), id);
                    let Some(case) = f.cases.get(c.idx()) else {
                        continue;
                    };
                    exprs.put::<UNDO>(case.test.idx(), Parent::Case(c).into());
                    stmts.put_all::<UNDO, _>(f, case.body, me);
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                Self::var_decls::<UNDO>(&mut self.var_stmt, f).put::<UNDO>(param.idx(), id);
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
            ($($ty:expr),*) => {{
                let mut types = Self::types::<UNDO>(&mut self.type_parent, f);
                $(types.put::<UNDO>($ty.idx(), me);)*
            }};
        }
        // The parameter of a mapped type or of an `infer`.
        macro_rules! type_param {
            ($param:expr, $($ty:ident),*) => {{
                let param: TypeParamId = $param;
                Self::type_params::<UNDO>(&mut self.type_param_parent, f).put::<UNDO>(param.idx(), me);
                if let Some(it) = f.type_params.get(param.idx()) {
                    let mut types = Self::types::<UNDO>(&mut self.type_parent, f);
                    $(types.put::<UNDO>(it.$ty.idx(), TypeParent::TypeParam(param).into());)*
                }
            }};
        }
        match *kind {
            TypeNodeKind::Heritage { .. } => self.is_complete = false,
            TypeNodeKind::Typeof { expr, args, .. } => {
                self.types_of::<UNDO>(f, args, me);
                Self::exprs::<UNDO>(&mut self.expr_parent, f)
                    .put::<UNDO>(expr.idx(), Parent::File.into());
                self.has_type_queries = true;
            }
            TypeNodeKind::Fn(func) => self.fn_of::<UNDO>(f, func, FnOwner::Type(id)),
            TypeNodeKind::Object(members) => self.members_of::<UNDO>(f, members, id),
            TypeNodeKind::Mapped(mapped) => {
                if let Some(mapped) = f.mapped.get(mapped.idx()) {
                    type_param!(mapped.param, constraint, default);
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
                let mut owners = Self::tuple_elems::<UNDO>(&mut self.tuple_elem_parent, f);
                let mut types = Self::types::<UNDO>(&mut self.type_parent, f);
                for e in elements.iter() {
                    owners.put::<UNDO>(e.idx(), me);
                    // One of the two can contain the other, which it has claimed. The element is the parent of both.
                    if let Some(element) = f.tuple_elems.get(e.idx()) {
                        let of_element = TypeParent::TupleElem(e).into();
                        types.put::<UNDO>(element.ty.idx(), of_element);
                        types.put::<UNDO>(element.written.idx(), of_element);
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
            // Only its constraint, not its default.
            TypeNodeKind::Infer(param) => type_param!(param, constraint),
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
            expr_parent: exprs, PackedParent::NONE;
            stmt_parent: stmts, PackedParent::NONE;
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
