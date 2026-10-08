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
    pub fn parent(self) -> Node<'a> {
        let file = self.file();
        let (hir, bound) = (&file.hir, &file.bound);
        let of_parent = |parent: Option<&Parent>| match parent.copied().unwrap_or(Parent::None) {
            Parent::None | Parent::File => Node::File(file),
            Parent::Expr(e) => Node::Expr(Expr::new(file, e)),
            Parent::Prop(p) if file.is_import_attribute(p) => file.parents().of_import_attribute(file, p),
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
                    Some(&Parent::Module(outer)) if file.is_nested_namespace(module.stmt) => m = outer,
                    _ => break Node::Stmt(Stmt::new(file, module.stmt)),
                }
            },
        };
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
        match self {
            Node::File(_) => self,
            Node::Expr(e) => {
                // Few files have a `typeof` in a type.
                let in_type_query = !bound.type_query_operands.is_empty()
                    && bound.type_query_operands.binary_search(&e.id()).is_ok();
                if let Some(Some(ty)) = in_type_query.then(|| file.parents().of_type_query_operand(e.id())) {
                    return Node::Type(TypeNode::new(file, ty));
                }
                let mut id = e.id();
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
                    parent => of_parent(parent),
                }
            }
            Node::Stmt(s) => match of_parent(bound.stmt_parent.get(s.id().idx())) {
                // The binder records the `switch` for what is in a clause.
                Node::Stmt(parent) => match parent.kind() {
                    StmtKind::Switch { cases, .. } => {
                        let start = s.span().start;
                        (cases.iter().find(|case| case.span().contains_offset(start)))
                            .map_or(Node::Stmt(parent), Node::Case)
                    }
                    _ => Node::Stmt(parent),
                },
                parent => parent,
            },
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
            Node::PatElem(e) => owner_of_pattern(hir.pat_elems[e.id().idx()].pat),
            Node::Func(f) => f.owner(),
            Node::Class(c) => c.owner(),
            Node::Param(p) => match p.func() {
                Some(func) => Node::Func(func),
                None => Node::File(file),
            },
            Node::Member(m) => match bound.member_owner.get(m.id().idx()) {
                Some(&MemberOwner::Class(c)) => Node::Class(Class::new(file, c)),
                Some(&MemberOwner::Interface(i)) => stmt(hir.interfaces.get(i.idx()).map(|i| i.stmt)),
                Some(&MemberOwner::TypeLiteral(t)) => Node::Type(TypeNode::new(file, t)),
                Some(MemberOwner::None) | None => Node::File(file),
            },
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
            Node::Type(t) => file.parents().types[t.id().idx()].unpack(file),
            Node::TypeParam(p) => file.parents().type_params[p.id().idx()].unpack(file),
            Node::TupleElem(e) => file.parents().tuple_elems[e.id().idx()].unpack(file),
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
}

impl Parents {
    #[inline]
    fn of_type_query_operand(&self, e: hir::ExprId) -> Option<hir::TypeNodeId> {
        let at = self.type_query_operands.binary_search_by_key(&e, |it| it.0);
        at.ok().map(|at| self.type_query_operands[at].1)
    }

    #[inline]
    pub(super) fn of_this(&self, name: hir::PatId) -> Option<hir::ParamId> {
        let at = self.this_names.binary_search_by_key(&name, |it| it.0);
        at.ok().map(|at| self.this_names[at].1)
    }

    /// The import, the export or the import type that the attribute `prop` belongs to.
    fn of_import_attribute<'a>(&self, file: &'a File<'a>, prop: hir::PropId) -> Node<'a> {
        let at = file.hir.props.get(prop.idx()).map_or(0, |it| it.pos);
        let is_around = |start: u32, end: u32| start <= at && at < end;
        let ty = (file.hir.types.iter()).position(|it| {
            matches!(it.kind, hir::TypeNodeKind::Import { .. }) && is_around(it.pos, it.end)
        });
        if let Some(ty) = ty {
            return Node::Type(TypeNode::new(file, hir::TypeNodeId(ty as u32)));
        }
        let statement = file.hir.stmts.iter().position(|it| {
            use hir::StmtKind::{ExportNamed, ExportStar, Import};
            matches!(it.kind, Import(_) | ExportNamed(_) | ExportStar { .. }) && is_around(it.start, it.loc.end)
        });
        match statement {
            Some(statement) => Node::Stmt(Stmt::new(file, hir::StmtId(statement as u32))),
            None => Node::File(file),
        }
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
        let packed = |tag: Tag, id: usize| Packed {
            tag,
            id: id as u32,
        };

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
                K::Array(t) | K::Keyof(t) | K::Readonly(t) | K::Unique(t) | K::JSDoc { ty: t, .. } => {
                    one(t, parent)
                }
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
                } => [check, extends, yes, no].into_iter().for_each(|t| one(t, parent)),
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
        for (i, e) in hir.exprs.iter().enumerate() {
            use hir::ExprKind as K;
            // What the parser has left behind can share its type arguments with a node.
            if matches!(file.bound.expr_parent.get(i), None | Some(Parent::None)) {
                continue;
            }
            let parent = packed(Tag::Expr, i);
            match e.kind {
                K::As { ty, .. } | K::Satisfies { ty, .. } => one(ty, parent),
                K::Instantiation { type_args, .. } => list!(type_args, parent),
                K::Call(c) | K::New(c) | K::TaggedTemplate(c) => {
                    if let Some(call) = hir.calls.get(c.idx()) {
                        list!(call.type_args, parent);
                    }
                }
                K::Jsx(j) => {
                    if let Some(jsx) = hir.jsx.get(j.idx()) {
                        list!(jsx.type_args, parent);
                    }
                }
                _ => {}
            }
        }
        type_query_operands.sort_unstable_by_key(|it| it.0);
        Parents {
            types,
            type_params,
            tuple_elems,
            type_query_operands: type_query_operands.into_boxed_slice(),
            this_names: this_names.into_boxed_slice(),
        }
    }
}

impl File<'_> {
    #[inline]
    pub(super) fn parents(&self) -> &Parents {
        self.lazy.parents.get_or_init(|| Parents::new(self))
    }
}
