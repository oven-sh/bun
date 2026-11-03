//! [`Node`], which can be any node, and parent lookups.

use super::{
    Case, Class, EnumMember, ExportSpec, Expr, File, Func, ImportAttributes, ImportSpec, Member,
    Param, Pat, PatElem, PatProp, Prop, Stmt, StmtTag, TupleElem, TypeNode, TypeParam, VarDecl,
};
use crate::span::{Span, Spanned};
use bun_sema::bind::{MemberOwner, Parent, PatParent};
use bun_sema::hir;

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
        }

        impl Spanned for $handle<'_> {
            #[inline]
            fn span(&self) -> Span {
                $handle::span(*self)
            }

            #[inline]
            fn packed_node(&self) -> Option<Packed> {
                Some(Packed { tag: Tag::$variant, id: self.id().0 })
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

            /// From its first token to the end of its last. Excludes parentheses around an expression or a type.
            pub fn span(self) -> Span {
                match self {
                    Node::File(file) => file.span(),
                    $(Node::$variant(it) => it.span(),)*
                }
            }

            /// Which HIR vector it's in, and its index there.
            #[inline]
            pub(crate) fn packed(self) -> Packed {
                match self {
                    Node::File(_) => Packed::FILE,
                    $(Node::$variant(it) => Packed { tag: Tag::$variant, id: it.id().0 },)*
                }
            }
        }

        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        enum Tag { File, $($variant,)* }

        /// The number of node kinds.
        pub(crate) const KINDS: usize = [Tag::File, $(Tag::$variant),*].len();

        impl<'a> File<'a> {
            /// The [`Node::index`] of the first node of each kind, followed by [`File::node_count`].
            fn kind_index_offsets(&self) -> &[u32; KINDS + 1] {
                self.lazy.kind_index_offsets.get_or_init(|| {
                    let mut offsets = [0; KINDS + 1];
                    let mut next = 1;
                    $(
                        offsets[Tag::$variant as usize] = next;
                        next += <$handle as super::Handle>::count_in(self);
                    )*
                    offsets[KINDS] = next;
                    offsets
                })
            }

            /// The total number of nodes of all kinds.
            pub fn node_count(&self) -> u32 {
                self.kind_index_offsets()[KINDS]
            }
        }

        impl Node<'_> {
            /// A number below [`File::node_count`] that's unique within the file. Use it to index a per-node table or
            /// bit set, like the file's own bit set of parenthesized expressions.
            #[inline]
            pub fn index(self) -> u32 {
                let Packed { tag, id } = self.packed();
                self.file().kind_index_offsets()[tag as usize] + id
            }
        }

        impl Packed {
            #[inline]
            pub(crate) fn unpack<'a>(self, file: &'a File<'a>) -> Node<'a> {
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
pub struct Packed {
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

    #[inline]
    fn packed_node(&self) -> Option<Packed> {
        Some(self.packed())
    }
}

impl Spanned for super::Modifier<'_> {
    #[inline]
    fn span(&self) -> Span {
        super::Modifier::span(*self)
    }
}

impl<'a> Node<'a> {
    /// The node's source text.
    #[inline]
    pub fn text(self) -> &'a [u8] {
        self.file().slice(self.span())
    }

    /// The `Expr`, `Stmt`, `Member` or `Prop` that owns a function or a class. Any other node is returned as is.
    #[inline]
    pub fn owner_or_self(self) -> Node<'a> {
        match self {
            Node::Func(func) => func.owner(),
            Node::Class(class) => class.owner(),
            _ => self,
        }
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

    /// Its direct parent. The file is its own parent.
    #[inline]
    pub fn parent(self) -> Node<'a> {
        match self {
            Node::Expr(e) => e.parent(),
            Node::Stmt(s) => s.parent(),
            _ => self.parent_of_other_node(),
        }
    }

    /// The node for the binder's `parent`.
    fn from_binder_parent(file: &'a File<'a>, parent: Parent) -> Node<'a> {
        let (hir, bound) = (&file.hir, &file.bound);
        match parent {
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
            Parent::ParamDefault(p) | Parent::ParamDecorator(p) => Node::Param(Param::new(file, p)),
            Parent::PatPropDefault(p) | Parent::PatKey(p) => Node::PatProp(PatProp::new(file, p)),
            Parent::PatElemDefault(e) => Node::PatElem(PatElem::new(file, e)),
            Parent::Prop(p) | Parent::PropKey(p) | Parent::MethodKey(p) => {
                Node::Prop(Prop::new(file, p))
            }
            Parent::MemberKey(m) | Parent::MemberInit(m) | Parent::MemberDecorator(m) => {
                Node::Member(Member::new(file, m))
            }
            Parent::FnBody(f) => Node::Func(Func::new(file, f)),
            Parent::EnumInit(m) => Node::EnumMember(EnumMember::new(file, m)),
            Parent::Case(c) => Node::Case(Case::new(file, c)),
            Parent::ClassExtends(c) | Parent::ClassDecorator(c) => Node::Class(Class::new(file, c)),
            Parent::Module(mut m) => loop {
                let Some(module) = hir.modules.get(m.idx()) else {
                    break Node::File(file);
                };
                // Walk from the `C` of `namespace A.B.C` up to the `A`.
                match bound.parent_of_stmt(module.stmt) {
                    Parent::Module(outer) if file.is_nested_namespace(module.stmt) => m = outer,
                    _ => break Node::Stmt(Stmt::new(file, module.stmt)),
                }
            },
        }
    }

    pub(super) fn parent_of_other_node(self) -> Node<'a> {
        match self.file().hides_casts {
            true => self.parent_with_hidden_casts(),
            false => self.parent_of_any(),
        }
    }

    #[inline(never)]
    fn parent_with_hidden_casts(self) -> Node<'a> {
        self.parent_of_any()
    }

    /// The rare cases live in separate functions, so that in a file without hidden casts this one makes no calls.
    #[inline(always)]
    fn parent_of_any(self) -> Node<'a> {
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
        match self {
            Node::File(_) => self,
            Node::Expr(e) => e.parent(),
            Node::Stmt(s) => s.parent(),
            Node::Pat(p) => match bound.pat_parent.get(p.id().idx()) {
                Some(&PatParent::Var(d)) => Node::VarDecl(VarDecl::new(file, d)),
                Some(&PatParent::Param(p)) => Node::Param(Param::new(file, p)),
                Some(&PatParent::Prop(_, prop)) => Node::PatProp(PatProp::new(file, prop)),
                Some(&PatParent::Elem(_, elem)) => Node::PatElem(PatElem::new(file, elem)),
                Some(PatParent::None) | None => self.parent_not_in_binder(),
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
            Node::Prop(_) if !hir.import_attributes.is_empty() => self.parent_not_in_binder(),
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
            Node::Type(_) | Node::TypeParam(_) | Node::TupleElem(_) => self.parent_not_in_binder(),
        }
    }

    /// The parents the binder doesn't record: of type syntax, of the `this` of a `this` parameter, and of a property in
    /// a file with import attributes.
    #[inline(never)]
    fn parent_not_in_binder(self) -> Node<'a> {
        let file = self.file();
        let unpack =
            |parent: Option<&Packed>| parent.map_or(Node::File(file), |it| it.unpack(file));
        match self {
            Node::Type(t) => unpack(file.parents().types.get(t.id().idx())),
            Node::TypeParam(p) => unpack(file.parents().type_params.get(p.id().idx())),
            Node::TupleElem(e) => unpack(file.parents().tuple_elems.get(e.id().idx())),
            Node::Pat(p) => match file.parents().of_this(p.id()) {
                Some(param) => Node::Param(Param::new(file, param)),
                None => Node::File(file),
            },
            Node::Prop(p) if file.is_import_attribute(p.id()) => {
                file.parents().of_import_attribute(file, p.id())
            }
            Node::Prop(p) => match file.bound.prop_owner.get(p.id().idx()) {
                Some(&owner) if owner.is_some() => Node::Expr(Expr::new(file, owner)),
                _ => Node::File(file),
            },
            _ => Node::File(file),
        }
    }

    /// Its parent, grandparent and so on, ending with the file.
    #[inline]
    pub fn ancestors(self) -> Ancestors<'a> {
        Ancestors { at: Some(self) }
    }

    /// The innermost function that contains it. A function doesn't contain itself.
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
}

impl<'a> Expr<'a> {
    #[inline]
    pub fn parent(self) -> Node<'a> {
        let file = self.file;
        // The binder never records an expression as the parent of the `a.b` in the type `typeof a.b`.
        if !file.hides_casts
            && let Parent::Expr(parent) = file.bound.parent_of_expr(self.id)
            && let Some(raw) = file.hir.exprs.get(parent.idx())
            && !matches!(raw.kind, hir::ExprKind::TaggedTemplate(_))
        {
            return Node::Expr(Expr { file, id: parent });
        }
        self.parent_in_general()
    }

    /// Handles the most common parents that aren't expressions.
    fn parent_in_general(self) -> Node<'a> {
        let file = self.file;
        if !file.hides_casts {
            let has_no_type_queries = file.bound.type_query_operands.is_empty();
            match file.bound.parent_of_expr(self.id) {
                Parent::VarInit(d) => return Node::VarDecl(VarDecl::new(file, d)),
                Parent::Prop(p) if file.hir.import_attributes.is_empty() => {
                    return Node::Prop(Prop::new(file, p));
                }
                Parent::Stmt(s)
                    if match file.hir.stmts.get(s.idx()) {
                        None
                        | Some(hir::Stmt {
                            kind: hir::StmtKind::Expr(_),
                            ..
                        }) => has_no_type_queries && file.is_clearly_not_wrapper(s),
                        Some(_) => true,
                    } =>
                {
                    return Node::Stmt(Stmt::new(file, s));
                }
                Parent::FnBody(f) if has_no_type_queries => return Node::Func(Func::new(file, f)),
                Parent::MemberInit(m) if has_no_type_queries => {
                    return Node::Member(Member::new(file, m));
                }
                _ => {}
            }
        }
        self.parent_in_rare_cases()
    }

    #[inline(never)]
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
        let id = file.with_jsdoc_casts(self.id);
        match bound.parent_of_expr(id) {
            // A tagged template's substitutions are children of the template.
            Parent::Expr(parent) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                Some(hir::ExprKind::TaggedTemplate(c)) => {
                    let template = hir::template_in(hir.tagged_templates, c);
                    match hir.calls.get(c.idx()) {
                        Some(call) if call.callee != id && template != id => {
                            Node::Expr(Expr::new(file, template))
                        }
                        _ => Node::Expr(Expr::new(file, parent)),
                    }
                }
                _ => Node::Expr(Expr::new(file, parent)),
            },
            parent => Node::from_binder_parent(file, parent),
        }
    }
}

impl<'a> Stmt<'a> {
    #[inline]
    pub fn parent(self) -> Node<'a> {
        let file = self.file;
        match file.bound.parent_of_stmt(self.id) {
            Parent::FnBody(f) => Node::Func(Func::new(file, f)),
            Parent::Stmt(parent)
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

    fn parent_in_general(self, parent: Parent) -> Node<'a> {
        let file = self.file;
        match parent {
            Parent::File => return Node::File(file),
            Parent::Stmt(parent)
                if !matches!(
                    file.hir.stmts.get(parent.idx()).map(|it| it.kind),
                    None | Some(hir::StmtKind::Expr(_) | hir::StmtKind::Switch { .. })
                ) =>
            {
                return Node::Stmt(Stmt::new(file, parent));
            }
            _ => {}
        }
        self.parent_in_rare_cases(parent)
    }

    #[inline(never)]
    fn parent_in_rare_cases(self, parent: Parent) -> Node<'a> {
        match Node::from_binder_parent(self.file, parent) {
            // The binder records the `switch` as the parent of a statement in a clause.
            Node::Stmt(parent) if parent.tag() == StmtTag::Switch => match parent.as_switch() {
                Some((_, cases)) => cases
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

/// The parents the binder doesn't record, mainly those of type syntax. Built in one pass over the HIR's vectors the
/// first time a rule needs one.
pub(crate) struct Parents {
    types: Box<[Packed]>,
    type_params: Box<[Packed]>,
    tuple_elems: Box<[Packed]>,
    /// Each `a.b` of a `typeof a.b`, paired with the type. Sorted.
    type_query_operands: Box<[(hir::ExprId, hir::TypeNodeId)]>,
    /// The `this` of each `this` parameter, paired with the parameter. Sorted.
    this_names: Box<[(hir::PatId, hir::ParamId)]>,
    /// The import, export or import type for each entry of `Hir::import_attributes`.
    import_attributes: Box<[Packed]>,
}

impl Parents {
    #[inline]
    fn of_type_query_operand(&self, e: hir::ExprId) -> Option<hir::TypeNodeId> {
        let at = self.type_query_operands.binary_search_by_key(&e, |it| it.0);
        at.ok().map(|at| self.type_query_operands[at].1)
    }

    /// True if the type `id` is inside an error type, which has no children.
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

    /// The import, export or import type that the attribute `prop` belongs to.
    fn of_import_attribute<'a>(&self, file: &'a File<'a>, prop: hir::PropId) -> Node<'a> {
        // Looked up by its `{ .. }` rather than its position, because an entry can follow a clause nested in the
        // previous entry.
        let object = file.bound.prop_owner.get(prop.idx());
        object
            .and_then(|&it| self.of_import_attributes(file, it))
            .unwrap_or(Node::File(file))
    }

    /// The import, export or import type whose attributes are the `{ .. }` expression `object`.
    pub(super) fn of_import_attributes<'a>(
        &self,
        file: &'a File<'a>,
        object: hir::ExprId,
    ) -> Option<Node<'a>> {
        let owner = (self.import_attributes).get(file.index_of_import_attributes(object)?)?;
        Some(owner.unpack(file))
    }

    /// The owner of each entry of `Hir::import_attributes`. Clauses can nest, so an owner claims only its own clause,
    /// the one `import_attributes()` returns for it.
    fn owners_of_import_attributes(hir: &super::Hir) -> Box<[Packed]> {
        let mut owners = vec![Packed::FILE; hir.import_attributes.len()].into_boxed_slice();
        if owners.is_empty() {
            return owners;
        }
        // The first owner wins, because a type in a JSDoc comment is parsed once per node it annotates.
        let mut own = |within: Span, owner: Packed| {
            if let Some(it) =
                ImportAttributes::index_within(hir, within).and_then(|it| owners.get_mut(it))
                && matches!(it.tag, Tag::File)
            {
                *it = owner;
            }
        };
        for (i, it) in hir.types.iter().enumerate() {
            if let Some(within) = ImportAttributes::search_span_of_type(hir, it) {
                own(
                    within,
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
                    Span::new(it.start, it.loc.end),
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
        crate::utils::sort::sort_unstable_by_key(&mut this_names, |it| it.0);
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
        // Few expressions contain a type and this loops over all of them, so the check that only needs the expression's
        // tag comes first.
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
                K::Instantiation { type_args, .. } => {
                    (hir::TypeNodeId::NONE, hir.list_at(type_args))
                }
                K::Call(c) | K::New(c) | K::TaggedTemplate(c) => (
                    hir::TypeNodeId::NONE,
                    hir.calls
                        .get(c.idx())
                        .map_or(hir::IdList::EMPTY, |call| hir.list_at(call.type_args)),
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
            // An expression the parser abandoned can share its type arguments with a real node.
            if matches!(
                file.bound.parent_of_expr(hir::ExprId(i as u32)),
                Parent::None
            ) {
                continue;
            }
            let parent = packed(Tag::Expr, i);
            one(ty, parent);
            list!(type_args, parent);
        }
        crate::utils::sort::sort_unstable_by_key(&mut type_query_operands, |it| it.0);
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
    /// True if its parent's kind alone shows that the expression statement `id` isn't a [wrapper](Stmt::is_wrapper).
    #[inline(always)]
    fn is_clearly_not_wrapper(&self, id: hir::StmtId) -> bool {
        let Parent::Stmt(parent) = self.bound.parent_of_stmt(id) else {
            return true;
        };
        !matches!(
            self.hir.stmts.get(parent.idx()).map(|it| it.kind),
            Some(
                hir::StmtKind::For { .. }
                    | hir::StmtKind::ForIn { .. }
                    | hir::StmtKind::ForOf { .. },
            )
        )
    }

    #[inline]
    pub(super) fn parents(&self) -> &Parents {
        self.lazy.parents.get_or_init(|| Parents::new(self))
    }

    /// True if the type `id` is inside an error type whose operand isn't a node, like `T?`.
    #[inline]
    pub(super) fn is_in_error_type(&self, id: hir::TypeNodeId) -> bool {
        let is_error = |it: &hir::TypeNode| matches!(it.kind, hir::TypeNodeKind::JSDoc { .. });
        *self
            .lazy
            .has_error_types
            .get_or_init(|| self.hir.types.iter().any(is_error))
            && self.parents().is_in_error(&self.hir, id)
    }
}
