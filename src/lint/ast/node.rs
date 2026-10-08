//! Any node, and the way up from it.

use super::{
    Case, Class, EnumMember, ExportSpec, Expr, File, Func, ImportSpec, Member, Param, Pat, PatElem,
    PatProp, Prop, Stmt, StmtKind, StmtTag, TupleElem, TypeNode, TypeParam, VarDecl,
};
use crate::span::{Span, Spanned};
use bun_sema::bind::{MemberOwner, Parent, PatParent};
use bun_sema::hir::{self, DecoratorOwner};

/// Any node of a file.
#[derive(Copy, Clone)]
pub enum Node<'a> {
    /// The root.
    File(&'a File<'a>),
    Expr(Expr<'a>),
    Stmt(Stmt<'a>),
    Type(TypeNode<'a>),
    Pat(Pat<'a>),
    PatProp(PatProp<'a>),
    PatElem(PatElem<'a>),
    Func(Func<'a>),
    Param(Param<'a>),
    TypeParam(TypeParam<'a>),
    Class(Class<'a>),
    Member(Member<'a>),
    Prop(Prop<'a>),
    VarDecl(VarDecl<'a>),
    Case(Case<'a>),
    EnumMember(EnumMember<'a>),
    ImportSpec(ImportSpec<'a>),
    ExportSpec(ExportSpec<'a>),
    TupleElem(TupleElem<'a>),
}

macro_rules! for_each_handle {
    ($each:ident) => {
        $each! {
            Expr Expr, Stmt Stmt, Type TypeNode, Pat Pat, PatProp PatProp, PatElem PatElem, Func Func, Param Param,
            TypeParam TypeParam, Class Class, Member Member, Prop Prop, VarDecl VarDecl, Case Case,
            EnumMember EnumMember, ImportSpec ImportSpec, ExportSpec ExportSpec, TupleElem TupleElem,
        }
    };
}

macro_rules! conversions {
    ($($variant:ident $handle:ident,)*) => {
        $(impl<'a> From<$handle<'a>> for Node<'a> {
            #[inline]
            fn from(it: $handle<'a>) -> Node<'a> {
                Node::$variant(it)
            }
        })*

        impl<'a> Node<'a> {
            #[inline]
            pub fn file(self) -> &'a File<'a> {
                match self {
                    Node::File(file) => file,
                    $(Node::$variant(it) => it.file(),)*
                }
            }

            /// From its first token to the end of its last. Parentheses around an expression or a
            /// type are not part of it.
            pub fn span(self) -> Span {
                match self {
                    Node::File(file) => file.span(),
                    $(Node::$variant(it) => it.span(),)*
                }
            }

            /// Which vector of the HIR it is in, and where.
            #[inline]
            fn packed(self) -> Packed {
                match self {
                    Node::File(_) => Packed::FILE,
                    $(Node::$variant(it) => Packed { tag: Tag::$variant, id: it.id().0 },)*
                }
            }
        }

        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        enum Tag { File, $($variant,)* }

        impl Packed {
            #[inline]
            fn unpack<'a>(self, file: &'a File<'a>) -> Node<'a> {
                match self.tag {
                    Tag::File => Node::File(file),
                    $(Tag::$variant => Node::$variant(<$handle as super::Handle>::from_raw(file, self.id)),)*
                }
            }
        }
    };
}
for_each_handle!(conversions);

impl<'a> From<&'a File<'a>> for Node<'a> {
    #[inline]
    fn from(file: &'a File<'a>) -> Node<'a> {
        Node::File(file)
    }
}

/// A [`Node`] without the reference to the file.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
struct Packed {
    tag: Tag,
    id: u32,
}

impl Packed {
    const FILE: Packed = Packed {
        tag: Tag::File,
        id: 0,
    };
}

impl PartialEq for Node<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.packed() == other.packed()
    }
}
impl Eq for Node<'_> {}
impl std::hash::Hash for Node<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.packed().hash(state);
    }
}
impl std::fmt::Debug for Node<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Packed { tag, id } = self.packed();
        write!(f, "{tag:?}({id})")
    }
}
impl Spanned for Node<'_> {
    #[inline]
    fn span(&self) -> Span {
        Node::span(*self)
    }
}

impl<'a> Node<'a> {
    /// The source text of the node.
    #[inline]
    pub fn text(self) -> &'a [u8] {
        self.file().slice(self.span())
    }

    #[inline]
    pub fn as_expr(self) -> Option<Expr<'a>> {
        match self {
            Node::Expr(it) => Some(it),
            _ => None,
        }
    }

    #[inline]
    pub fn as_stmt(self) -> Option<Stmt<'a>> {
        match self {
            Node::Stmt(it) => Some(it),
            _ => None,
        }
    }

    #[inline]
    pub fn as_type(self) -> Option<TypeNode<'a>> {
        match self {
            Node::Type(it) => Some(it),
            _ => None,
        }
    }

    #[inline]
    pub fn as_func(self) -> Option<Func<'a>> {
        match self {
            Node::Func(it) => Some(it),
            _ => None,
        }
    }

    /// What it is directly part of. The file is its own parent.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        match self {
            Node::Expr(e) => e.parent(),
            Node::Stmt(s) => s.parent(),
            _ => self.parent_of_neither_expr_nor_stmt(),
        }
    }

    /// The node that the binder has as `parent`.
    fn of_parent(file: &'a File<'a>, parent: Option<&Parent>) -> Node<'a> {
        let (hir, bound) = (&file.hir, &file.bound);
        match parent.copied().unwrap_or(Parent::None) {
            Parent::None | Parent::File => Node::File(file),
            Parent::Expr(e) => Node::Expr(Expr::new(file, e)),
            Parent::Prop(p) if file.is_import_attribute(p) => {
                file.parents().of_import_attribute(file, p)
            }
            Parent::Stmt(s) => {
                let statement = Stmt::new(file, s);
                Node::Stmt(match statement.tag() {
                    StmtTag::Expr => statement.wrapped_in().unwrap_or(statement),
                    _ => statement,
                })
            }
            Parent::VarInit(d) => Node::VarDecl(VarDecl::new(file, d)),
            Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                Node::Param(Param::new(file, p))
            }
            Parent::PatPropDefault(p) | Parent::PatKey(p) => Node::PatProp(PatProp::new(file, p)),
            Parent::PatElemDefault(e) => Node::PatElem(PatElem::new(file, e)),
            Parent::Prop(p) | Parent::PropKey(_, p) | Parent::MethodKey(p) => {
                Node::Prop(Prop::new(file, p))
            }
            Parent::MemberKey(m)
            | Parent::MemberInit(m)
            | Parent::Decorator(_, DecoratorOwner::Member(m)) => Node::Member(Member::new(file, m)),
            Parent::FnBody(f) => Node::Func(Func::new(file, f)),
            Parent::EnumInit(m) => Node::EnumMember(EnumMember::new(file, m)),
            Parent::Case(c) => Node::Case(Case::new(file, c)),
            Parent::ClassExtends(c) | Parent::Decorator(_, DecoratorOwner::Class(c)) => {
                Node::Class(Class::new(file, c))
            }
            Parent::Module(mut m) => loop {
                let Some(module) = hir.modules.get(m.idx()) else {
                    break Node::File(file);
                };
                // From the `C` of `namespace A.B.C` to the `A`.
                match bound.stmt_parent.get(module.stmt.idx()) {
                    Some(&Parent::Module(outer)) if file.is_nested_namespace(module.stmt) => {
                        m = outer
                    }
                    _ => break Node::Stmt(Stmt::new(file, module.stmt)),
                }
            },
        }
    }

    pub(super) fn parent_of_neither_expr_nor_stmt(self) -> Node<'a> {
        let file = self.file();
        let (hir, bound) = (&file.hir, &file.bound);
        let stmt = |s: Option<hir::StmtId>| match s {
            Some(s) if s.is_some() => Node::Stmt(Stmt::new(file, s)),
            _ => Node::File(file),
        };
        let owner_of_pattern = |inner: hir::PatId| match bound.pat_parent.get(inner.idx()) {
            Some(&(PatParent::Prop(owner, _) | PatParent::Elem(owner, _))) => {
                Node::Pat(Pat::new(file, owner))
            }
            _ => Node::File(file),
        };
        let unpack =
            |parent: Option<&Packed>| parent.map_or(Node::File(file), |it| it.unpack(file));
        match self {
            Node::File(_) => self,
            Node::Expr(e) => e.parent(),
            Node::Stmt(s) => s.parent(),
            Node::Pat(p) => match bound.pat_parent.get(p.id().idx()) {
                Some(&PatParent::Var(d)) => Node::VarDecl(VarDecl::new(file, d)),
                Some(&PatParent::Param(p)) => Node::Param(Param::new(file, p)),
                Some(&PatParent::Prop(_, prop)) => Node::PatProp(PatProp::new(file, prop)),
                Some(&PatParent::Elem(_, elem)) => Node::PatElem(PatElem::new(file, elem)),
                // The binder records none for the `this` of a `this` parameter.
                Some(PatParent::None) | None => match file.parents().of_this(p.id()) {
                    Some(param) => Node::Param(Param::new(file, param)),
                    None => Node::File(file),
                },
            },
            Node::PatProp(p) => owner_of_pattern(p.value().id()),
            Node::PatElem(e) => owner_of_pattern(
                hir.pat_elems
                    .get(e.id().idx())
                    .map_or(hir::PatId::NONE, |it| it.pat),
            ),
            Node::Func(f) => f.owner(),
            Node::Class(c) => c.owner(),
            Node::Param(p) => match p.func() {
                Some(func) => Node::Func(func),
                None => Node::File(file),
            },
            Node::Member(m) => match bound.member_owner.get(m.id().idx()) {
                Some(&MemberOwner::Class(c)) => Node::Class(Class::new(file, c)),
                Some(&MemberOwner::Interface(i)) => {
                    stmt(hir.interfaces.get(i.idx()).map(|i| i.stmt))
                }
                Some(&MemberOwner::TypeLiteral(t)) => Node::Type(TypeNode::new(file, t)),
                Some(MemberOwner::None) | None => Node::File(file),
            },
            Node::Prop(p) if file.is_import_attribute(p.id()) => {
                file.parents().of_import_attribute(file, p.id())
            }
            Node::Prop(p) => match bound.prop_owner.get(p.id().idx()) {
                Some(&owner) if owner.is_some() => Node::Expr(Expr::new(file, owner)),
                _ => Node::File(file),
            },
            Node::VarDecl(d) => stmt(bound.var_stmt.get(d.id().idx()).copied()),
            Node::Case(c) => stmt(bound.case_stmt.get(c.id().idx()).copied()),
            Node::EnumMember(m) => {
                let owner = bound.enum_member_owner.get(m.id().idx());
                stmt(owner.and_then(|e| hir.enums.get(e.idx())).map(|e| e.stmt))
            }
            Node::ImportSpec(s) => Node::Stmt(s.import().stmt()),
            Node::ExportSpec(s) => Node::Stmt(s.export().stmt()),
            Node::Type(t) => unpack(file.parents().types.get(t.id().idx())),
            Node::TypeParam(p) => unpack(file.parents().type_params.get(p.id().idx())),
            Node::TupleElem(e) => unpack(file.parents().tuple_elems.get(e.id().idx())),
        }
    }

    /// Its parent, the parent of that, and so on. The last is the file.
    #[inline]
    pub fn ancestors(self) -> Ancestors<'a> {
        Ancestors { at: Some(self) }
    }

    /// The innermost function that contains it. A function does not contain itself.
    pub fn enclosing_function(self) -> Option<Func<'a>> {
        self.ancestors().find_map(Node::as_func)
    }

    /// The innermost class that contains it.
    pub fn enclosing_class(self) -> Option<Class<'a>> {
        self.ancestors().find_map(|it| match it {
            Node::Class(class) => Some(class),
            _ => None,
        })
    }

    /// The innermost statement that contains it.
    pub fn enclosing_statement(self) -> Option<Stmt<'a>> {
        self.ancestors().find_map(Node::as_stmt)
    }
}

impl<'a> Expr<'a> {
    /// What it is directly part of.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        let file = self.file;
        // The binder never has an expression as the parent of the `a.b` of the type `typeof a.b`.
        if !file.hides_casts
            && let Some(&Parent::Expr(parent)) = file.bound.expr_parent.get(self.id.idx())
            && let Some(raw) = file.hir.exprs.get(parent.idx())
            && !matches!(raw.kind, hir::ExprKind::TaggedTemplate(_))
        {
            return Node::Expr(Expr { file, id: parent });
        }
        self.parent_in_general()
    }

    /// What most expressions are part of that are not part of an expression.
    fn parent_in_general(self) -> Node<'a> {
        let file = self.file;
        if !file.hides_casts {
            let is_in_no_type = file.bound.type_query_operands.is_empty();
            match file.bound.expr_parent.get(self.id.idx()) {
                Some(&Parent::VarInit(d)) => return Node::VarDecl(VarDecl::new(file, d)),
                Some(&Parent::Prop(p)) if file.hir.import_attributes.is_empty() => {
                    return Node::Prop(Prop::new(file, p));
                }
                Some(&Parent::Stmt(s))
                    if !matches!(
                        file.hir.stmts.get(s.idx()),
                        None | Some(hir::Stmt {
                            kind: hir::StmtKind::Expr(_),
                            ..
                        })
                    ) =>
                {
                    return Node::Stmt(Stmt::new(file, s));
                }
                Some(&Parent::FnBody(f)) if is_in_no_type => return Node::Func(Func::new(file, f)),
                Some(&Parent::MemberInit(m)) if is_in_no_type => {
                    return Node::Member(Member::new(file, m));
                }
                _ => {}
            }
        }
        self.parent_in_rare_cases()
    }

    fn parent_in_rare_cases(self) -> Node<'a> {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        // Few files have a `typeof` in a type.
        let in_type_query = !bound.type_query_operands.is_empty()
            && bound.type_query_operands.binary_search(&self.id).is_ok();
        if let Some(Some(ty)) = in_type_query.then(|| file.parents().of_type_query_operand(self.id))
        {
            return Node::Type(TypeNode::new(file, ty));
        }
        let mut id = self.id;
        while let Some(cast) = file.jsdoc_cast_around(id) {
            id = cast;
        }
        match bound.expr_parent.get(id.idx()) {
            // The substitutions of a tagged template are in the template.
            Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                Some(hir::ExprKind::TaggedTemplate(call)) => match hir.calls.get(call.idx()) {
                    Some(call) if call.callee != id && call.template != id => {
                        Node::Expr(Expr::new(file, call.template))
                    }
                    _ => Node::Expr(Expr::new(file, parent)),
                },
                _ => Node::Expr(Expr::new(file, parent)),
            },
            parent => Node::of_parent(file, parent),
        }
    }
}

impl<'a> Stmt<'a> {
    #[inline]
    pub fn parent(self) -> Node<'a> {
        let file = self.file;
        match file.bound.stmt_parent.get(self.id.idx()) {
            Some(&Parent::FnBody(f)) => Node::Func(Func::new(file, f)),
            Some(&Parent::Stmt(parent))
                if matches!(
                    file.hir.stmts.get(parent.idx()),
                    Some(hir::Stmt {
                        kind: hir::StmtKind::Block(_),
                        ..
                    })
                ) =>
            {
                Node::Stmt(Stmt::new(file, parent))
            }
            parent => self.parent_in_general(parent),
        }
    }

    fn parent_in_general(self, parent: Option<&Parent>) -> Node<'a> {
        match Node::of_parent(self.file, parent) {
            // The binder records the `switch` for what is in a clause.
            Node::Stmt(parent) if parent.tag() == StmtTag::Switch => match parent.kind() {
                StmtKind::Switch { cases, .. } => cases
                    .around(self.span().start)
                    .map_or(Node::Stmt(parent), Node::Case),
                _ => Node::Stmt(parent),
            },
            parent => parent,
        }
    }
}

#[derive(Copy, Clone)]
pub struct Ancestors<'a> {
    at: Option<Node<'a>>,
}

impl<'a> Iterator for Ancestors<'a> {
    type Item = Node<'a>;

    #[inline]
    fn next(&mut self) -> Option<Node<'a>> {
        match self.at? {
            Node::File(_) => {
                self.at = None;
                None
            }
            at => {
                let parent = at.parent();
                self.at = Some(parent);
                Some(parent)
            }
        }
    }
}

/// The parents that the binder does not record: those of type syntax. One pass over the vectors of
/// the HIR, the first time a rule asks for one.
pub(crate) struct Parents {
    types: Box<[Packed]>,
    type_params: Box<[Packed]>,
    tuple_elems: Box<[Packed]>,
    /// The `a.b` of `typeof a.b`, with the type. Sorted.
    type_query_operands: Box<[(hir::ExprId, hir::TypeNodeId)]>,
    /// The `this` of each `this` parameter, with the parameter. Sorted.
    this_names: Box<[(hir::PatId, hir::ParamId)]>,
    /// For each of `Hir::import_attributes`: the import, the export or the import type.
    import_attributes: Box<[Packed]>,
}

impl Parents {
    #[inline]
    fn of_type_query_operand(&self, e: hir::ExprId) -> Option<hir::TypeNodeId> {
        let at = self.type_query_operands.binary_search_by_key(&e, |it| it.0);
        at.ok().map(|at| self.type_query_operands[at].1)
    }

    /// Whether the type `id` is in a type that is an error, which has no children.
    fn is_in_error(&self, hir: &super::Hir, id: hir::TypeNodeId) -> bool {
        let mut at = id;
        while let Some(&Packed { tag: Tag::Type, id }) = self.types.get(at.idx()) {
            at = hir::TypeNodeId(id);
            if matches!(
                hir.types.get(at.idx()).map(|it| it.kind),
                Some(hir::TypeNodeKind::JSDoc { .. })
            ) {
                return true;
            }
        }
        false
    }

    #[inline]
    pub(super) fn of_this(&self, name: hir::PatId) -> Option<hir::ParamId> {
        let at = self.this_names.binary_search_by_key(&name, |it| it.0);
        at.ok().map(|at| self.this_names[at].1)
    }

    /// The import, the export or the import type that the attribute `prop` belongs to.
    fn of_import_attribute<'a>(&self, file: &'a File<'a>, prop: hir::PropId) -> Node<'a> {
        let at = file.hir.props.get(prop.idx()).map_or(0, |it| it.pos);
        let after = file.hir.import_attributes.partition_point(|it| it.0 <= at);
        let owner = after
            .checked_sub(1)
            .and_then(|it| self.import_attributes.get(it));
        owner.map_or(Node::File(file), |it| it.unpack(file))
    }

    /// What each of `Hir::import_attributes`, which are in the order of the source, belongs to: the first import type around
    /// it, or else the first import or export.
    fn owners_of_import_attributes(hir: &super::Hir) -> Box<[Packed]> {
        let all = hir.import_attributes;
        let mut owners = vec![Packed::FILE; all.len()].into_boxed_slice();
        if all.is_empty() {
            return owners;
        }
        let mut own = |start: u32, end: u32, owner: Packed| {
            let first = all.partition_point(|it| it.0 < start);
            let within = all[first..].partition_point(|it| it.0 < end);
            for it in owners[first..first + within]
                .iter_mut()
                .filter(|it| matches!(it.tag, Tag::File))
            {
                *it = owner;
            }
        };
        for (i, it) in hir.types.iter().enumerate() {
            if matches!(it.kind, hir::TypeNodeKind::Import { .. }) {
                own(
                    it.pos,
                    it.end,
                    Packed {
                        tag: Tag::Type,
                        id: i as u32,
                    },
                );
            }
        }
        for (i, it) in hir.stmts.iter().enumerate() {
            use hir::StmtKind::{ExportNamed, ExportStar, Import};
            if matches!(it.kind, Import(_) | ExportNamed(_) | ExportStar { .. }) {
                own(
                    it.start,
                    it.loc.end,
                    Packed {
                        tag: Tag::Stmt,
                        id: i as u32,
                    },
                );
            }
        }
        owners
    }

    fn new(file: &File) -> Parents {
        let hir = &file.hir;
        let mut types = vec![Packed::FILE; hir.types.len()].into_boxed_slice();
        let mut type_params = vec![Packed::FILE; hir.type_params.len()].into_boxed_slice();
        let mut tuple_elems = vec![Packed::FILE; hir.tuple_elems.len()].into_boxed_slice();
        let mut type_query_operands = Vec::new();

        let mut one = |child: hir::TypeNodeId, parent: Packed| {
            if let Some(slot) = types.get_mut(child.idx()) {
                *slot = parent;
            }
        };
        macro_rules! list {
            ($list:expr, $parent:expr) => {
                for &child in hir.ids.get($list.range()).unwrap_or_default() {
                    one(hir::TypeNodeId(child), $parent);
                }
            };
        }
        let mut params = |list: hir::Span<hir::TypeParamId>, parent: Packed| {
            if let Some(slots) = type_params.get_mut(list.range()) {
                slots.fill(parent);
            }
        };
        let packed = |tag: Tag, id: usize| Packed { tag, id: id as u32 };

        for (i, ty) in hir.types.iter().enumerate() {
            use hir::TypeNodeKind as K;
            let parent = packed(Tag::Type, i);
            match ty.kind {
                K::Heritage { args, .. } | K::Ref { args, .. } | K::Import { args, .. } => {
                    list!(args, parent)
                }
                K::Typeof { args, expr, .. } => {
                    list!(args, parent);
                    type_query_operands.push((expr, hir::TypeNodeId(i as u32)));
                }
                K::Template { types, .. } | K::Union(types) | K::Intersection(types) => {
                    list!(types, parent)
                }
                K::Array(t)
                | K::Keyof(t)
                | K::Readonly(t)
                | K::Unique(t)
                | K::JSDoc { ty: t, .. } => one(t, parent),
                K::Predicate { ty, .. } => one(ty, parent),
                K::Tuple(elements) => {
                    if let Some(slots) = tuple_elems.get_mut(elements.range()) {
                        slots.fill(parent);
                    }
                }
                K::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => [check, extends, yes, no]
                    .into_iter()
                    .for_each(|t| one(t, parent)),
                K::IndexedAccess { obj, index } => {
                    one(obj, parent);
                    one(index, parent);
                }
                K::Infer(param) => params(hir::Span::new(param.0, 1), parent),
                K::Mapped(m) => {
                    if let Some(mapped) = hir.mapped.get(m.idx()) {
                        params(hir::Span::new(mapped.param.0, 1), parent);
                        one(mapped.name_ty, parent);
                        one(mapped.ty, parent);
                    }
                }
                K::Error
                | K::Keyword(_)
                | K::StringLit(_)
                | K::NumberLit(_)
                | K::BigIntLit { .. }
                | K::BoolLit(_)
                | K::Fn(_)
                | K::Object(_)
                | K::UniqueSymbol => {}
            }
        }
        for (i, element) in hir.tuple_elems.iter().enumerate() {
            one(element.ty, packed(Tag::TupleElem, i));
            one(element.written, packed(Tag::TupleElem, i));
        }
        for (i, param) in hir.type_params.iter().enumerate() {
            one(param.constraint, packed(Tag::TypeParam, i));
            one(param.default, packed(Tag::TypeParam, i));
        }
        let mut this_names = Vec::new();
        for (i, func) in hir.fns.iter().enumerate() {
            one(func.ret, packed(Tag::Func, i));
            params(func.type_params, packed(Tag::Func, i));
            if let Some(this) = hir.params.get(func.this_param.idx()) {
                this_names.push((this.pat, func.this_param));
            }
        }
        this_names.sort_unstable_by_key(|it| it.0);
        for (i, param) in hir.params.iter().enumerate() {
            one(param.ty, packed(Tag::Param, i));
        }
        for (i, declaration) in hir.var_decls.iter().enumerate() {
            one(declaration.ty, packed(Tag::VarDecl, i));
        }
        for (i, member) in hir.members.iter().enumerate() {
            if member.func.is_none() {
                one(member.ty, packed(Tag::Member, i));
            }
        }
        for (i, class) in hir.classes.iter().enumerate() {
            let parent = packed(Tag::Class, i);
            params(class.type_params, parent);
            list!(class.extends_args, parent);
            list!(class.implements, parent);
            list!(class.other_implements, parent);
        }
        for interface in hir.interfaces {
            let parent = packed(Tag::Stmt, interface.stmt.idx());
            params(interface.type_params, parent);
            list!(interface.extends, parent);
            list!(interface.other_heritage, parent);
        }
        for alias in hir.aliases {
            let parent = packed(Tag::Stmt, alias.stmt.idx());
            params(alias.type_params, parent);
            one(alias.ty, parent);
        }
        // Few expressions have a type in them. This goes through all of them, so what tells that from
        // the expression alone comes first.
        const fn kind(tag: hir::ExprTag) -> u64 {
            1 << tag as u8
        }
        const CAN_HAVE_TYPES: u64 = kind(hir::ExprTag::As)
            | kind(hir::ExprTag::Satisfies)
            | kind(hir::ExprTag::Instantiation)
            | kind(hir::ExprTag::Call)
            | kind(hir::ExprTag::New)
            | kind(hir::ExprTag::TaggedTemplate)
            | kind(hir::ExprTag::Jsx);
        for (i, e) in hir.exprs.iter().enumerate() {
            use hir::ExprKind as K;
            if CAN_HAVE_TYPES & kind(e.kind.tag()) == 0 {
                continue;
            }
            let (ty, type_args) = match e.kind {
                K::As { ty, .. } | K::Satisfies { ty, .. } => (ty, hir::IdList::EMPTY),
                K::Instantiation { type_args, .. } => (hir::TypeNodeId::NONE, type_args),
                K::Call(c) | K::New(c) | K::TaggedTemplate(c) => (
                    hir::TypeNodeId::NONE,
                    hir.calls
                        .get(c.idx())
                        .map_or(hir::IdList::EMPTY, |call| call.type_args),
                ),
                K::Jsx(j) => (
                    hir::TypeNodeId::NONE,
                    hir.jsx
                        .get(j.idx())
                        .map_or(hir::IdList::EMPTY, |jsx| jsx.type_args),
                ),
                _ => continue,
            };
            if ty.is_none() && type_args.len == 0 {
                continue;
            }
            // What the parser has left behind can share its type arguments with a node.
            if matches!(file.bound.expr_parent.get(i), None | Some(Parent::None)) {
                continue;
            }
            let parent = packed(Tag::Expr, i);
            one(ty, parent);
            list!(type_args, parent);
        }
        type_query_operands.sort_unstable_by_key(|it| it.0);
        Parents {
            types,
            type_params,
            tuple_elems,
            type_query_operands: type_query_operands.into_boxed_slice(),
            this_names: this_names.into_boxed_slice(),
            import_attributes: Self::owners_of_import_attributes(hir),
        }
    }
}

impl File<'_> {
    #[inline]
    pub(super) fn parents(&self) -> &Parents {
        self.lazy.parents.get_or_init(|| Parents::new(self))
    }

    /// Whether the type `id` is in a type that is an error and whose operand is not a node: `T?`.
    #[inline]
    pub(super) fn is_in_type_that_is_an_error(&self, id: hir::TypeNodeId) -> bool {
        let is_error = |it: &hir::TypeNode| matches!(it.kind, hir::TypeNodeKind::JSDoc { .. });
        *self
            .lazy
            .has_types_that_are_errors
            .get_or_init(|| self.hir.types.iter().any(is_error))
            && self.parents().is_in_error(&self.hir, id)
    }
}
