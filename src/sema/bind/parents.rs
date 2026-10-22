//! Computes the parent (or owner) of each node in a file, and nothing else.

use super::*;
use crate::util::SharedSort;

fn refill<T: Copy>(list: &mut Vec<T>, len: usize, value: T) {
    list.clear();
    list.resize(len, value);
}

pub(super) const NO_FUNCTION: FnInfo = FnInfo {
    owner: FnOwner::None,
    scope: ScopeId::NONE,
    enclosing: FnId::NONE,
    returns: IdList::EMPTY,
    yields: IdList::EMPTY,
    end: UNREACHABLE,
    exit: FlowId::NONE,
    contains_this: false,
};

/// The lists to fill in. Each is as long as the file's matching list and starts out with empty
/// entries.
struct Lists<'l> {
    expr_parent: &'l mut [PackedParent],
    stmt_parent: &'l mut [PackedParent],
    pat_parent: &'l mut [PatParent],
    prop_owner: &'l mut [ExprId],
    member_owner: &'l mut [MemberOwner],
    param_fn: &'l mut [FnId],
    var_stmt: &'l mut [StmtId],
    case_stmt: &'l mut [StmtId],
    class_owner: &'l mut [ClassOwner],
    enum_member_owner: &'l mut [EnumId],
    fns: &'l mut [FnInfo],
    type_query_operands: &'l mut Vec<ExprId>,
    class_scope: &'l mut [ScopeId],
    type_scope: &'l mut [ScopeId],
    type_param_scope: &'l mut [ScopeId],
    /// Lint only. `Bound::expr_kinds` starts as all `NOT_REACHED`, `Bound::expr_kind_counts` as all
    /// zeros.
    expr_kinds: &'l mut [u8],
    expr_kind_counts: &'l mut [u32],
    /// Lint only. `Bound::kind_counts` starts as all zeros.
    kind_counts: &'l mut [u32],
    /// Lint only. Receives the `return` statements, in the order of the file's statement list.
    returns: &'l mut Vec<u32>,
}

/// Stored instead of the real scope for every node that `bind` reaches.
const REACHED: ScopeId = ScopeId(0);

/// True if the file needs the full binder, because nodes that come from JSDoc comments are bound
/// where the comment is.
fn needs_full_binder<S: Storage>(f: &FileIn<S>) -> bool {
    f.is_js && !f.jsdoc_comments.is_empty()
}

/// [`bind`] for a formatter, which only needs each node's parent. Nothing is declared or resolved.
/// The result lives in `recycled`, as with [`bind_for_lint_in`].
///
/// Fills in `expr_parent`, `stmt_parent`, `pat_parent`, `prop_owner`, `member_owner`, `param_fn`,
/// `var_stmt`, `case_stmt`, `class_owner`, `enum_member_owner`, `type_query_operands` and the
/// `owner` of each entry in `fns`. The operand of a `typeof` type always gets `Parent::File`, where
/// `bind` gives it the enclosing function, namespace, class property or file. `class_scope`,
/// `type_scope` and `type_param_scope` only have `REACHED` for each node that `bind` reaches. The few
/// files that need the binder get the full result of `bind`.
pub fn bind_for_format_in<'r>(
    f: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    recycled: &'r mut Recycled,
) -> &'r BoundBuilder {
    match fill_in::<_, false>(f, &mut recycled.buffers().b) {
        true => &recycled.buffers().b,
        false => fall_back_to_binder(f, options, atoms, recycled),
    }
}

/// [`bind_for_format_in`] for a file that's still in the parser's growable lists. It doesn't read
/// anything that `File::finish_nodes` computes. Returns `None` if the file needs the binder, which
/// takes a [`File`]. It isn't generic and is never inlined, so `fill_in` is compiled for it in this
/// crate, with this crate's options.
#[inline(never)]
pub fn try_bind_for_format_in<'r>(
    f: &FileBuilder,
    recycled: &'r mut Recycled,
) -> Option<&'r BoundBuilder> {
    let b = &mut recycled.buffers().b;
    fill_in::<Growable, false>(f, b).then_some(&*b)
}

/// Fills in `b` as [`bind_for_format_in`] describes. With `LINT`, also fills in `expr_kinds`,
/// `expr_kind_counts` and `kind_counts`, and puts the `return` statements in `ids`, in the order of
/// the file's statement list. Returns false if the file needs the binder.
pub(super) fn fill_in<S: Storage, const LINT: bool>(f: &FileIn<S>, b: &mut BoundBuilder) -> bool {
    if needs_full_binder(f) || !f.has_room_for_handles() {
        return false;
    }
    b.clear();
    if LINT {
        refill(&mut b.expr_kinds, f.exprs.len(), NOT_REACHED);
        refill(&mut b.expr_kind_counts, 2 * ExprTag::COUNT, 0);
        refill(&mut b.kind_counts, kind_counts::LEN, 0);
    }
    refill(&mut b.expr_parent, f.exprs.len(), PackedParent::default());
    refill(&mut b.stmt_parent, f.stmts.len(), PackedParent::default());
    refill(&mut b.pat_parent, f.pats.len(), PatParent::None);
    refill(&mut b.prop_owner, f.props.len(), ExprId::NONE);
    refill(&mut b.member_owner, f.members.len(), MemberOwner::None);
    refill(&mut b.param_fn, f.params.len(), FnId::NONE);
    refill(&mut b.var_stmt, f.var_decls.len(), StmtId::NONE);
    refill(&mut b.case_stmt, f.cases.len(), StmtId::NONE);
    refill(
        &mut b.class_owner,
        f.classes.len(),
        ClassOwner::Stmt(StmtId::NONE),
    );
    refill(&mut b.enum_member_owner, f.enum_members.len(), EnumId::NONE);
    refill(&mut b.fns, f.fns.len(), NO_FUNCTION);
    refill(&mut b.class_scope, f.classes.len(), ScopeId::NONE);
    refill(&mut b.type_scope, f.types.len(), ScopeId::NONE);
    refill(&mut b.type_param_scope, f.type_params.len(), ScopeId::NONE);
    fill::<S, LINT>(f, lists_of(b)) && is_done(b)
}

fn lists_of(b: &mut BoundBuilder) -> Lists<'_> {
    Lists {
        expr_parent: &mut b.expr_parent,
        stmt_parent: &mut b.stmt_parent,
        pat_parent: &mut b.pat_parent,
        prop_owner: &mut b.prop_owner,
        member_owner: &mut b.member_owner,
        param_fn: &mut b.param_fn,
        var_stmt: &mut b.var_stmt,
        case_stmt: &mut b.case_stmt,
        class_owner: &mut b.class_owner,
        enum_member_owner: &mut b.enum_member_owner,
        fns: &mut b.fns,
        type_query_operands: &mut b.type_query_operands,
        class_scope: &mut b.class_scope,
        type_scope: &mut b.type_scope,
        type_param_scope: &mut b.type_param_scope,
        expr_kinds: &mut b.expr_kinds,
        expr_kind_counts: &mut b.expr_kind_counts,
        kind_counts: &mut b.kind_counts,
        returns: &mut b.ids,
    }
}

fn is_done(b: &mut BoundBuilder) -> bool {
    sort_and_dedup(&mut b.type_query_operands);
    every_node_has_parent(
        &b.expr_parent,
        &b.stmt_parent,
        &b.fns,
        &b.class_owner,
        &b.type_scope,
        &b.type_param_scope,
    )
}

fn sort_and_dedup(type_query_operands: &mut Vec<ExprId>) {
    type_query_operands.shared_sort_unstable();
    type_query_operands.dedup();
}

/// Returns false if the file needs the binder. It also does if [`every_node_has_parent`] is
/// false.
fn fill<S: Storage, const LINT: bool>(f: &FileIn<S>, lists: Lists) -> bool {
    let Lists {
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
        fns,
        type_query_operands,
        class_scope,
        type_scope,
        type_param_scope,
        expr_kinds,
        expr_kind_counts,
        kind_counts,
        returns,
    } = lists;

    // A `NONE` id is out of range, so it's skipped.
    macro_rules! set {
        ($list:ident[$id:expr] = $value:expr) => {
            if let Some(slot) = $list.get_mut($id.idx()) {
                *slot = $value.into();
            }
        };
        ($list:ident[$id:expr].owner = $value:expr) => {
            if let Some(slot) = $list.get_mut($id.idx()) {
                slot.owner = $value;
            }
        };
    }
    // Marks the types and the type parameters that `bind` reaches from a node.
    macro_rules! ty {
        ($($ty:expr),*) => {{ $(set!(type_scope[$ty] = REACHED);)* }};
    }
    macro_rules! tys {
        ($list:expr) => {
            for ty in f.ids($list) {
                set!(type_scope[ty] = REACHED);
            }
        };
    }
    macro_rules! type_params {
        ($params:expr) => {
            for p in $params.iter() {
                set!(type_param_scope[p] = REACHED);
                if let Some(param) = f.type_params.get(p.idx()) {
                    ty!(param.constraint, param.default);
                }
            }
        };
    }
    macro_rules! decorators {
        ($modifiers:expr, $parent:expr) => {
            for modifier in $modifiers.iter() {
                if let Some(Modifier {
                    kind: ModifierKind::Decorator(e),
                    ..
                }) = f.modifiers.get(modifier.idx())
                {
                    set!(expr_parent[e] = $parent);
                }
            }
        };
    }

    // Expressions go first so that the later passes overwrite them. The nodes that the parser
    // abandons are expressions, like the `A<T>` of `extends A<T>` and the `a = 1` of
    // `({ a = 1 }) => 0`, and their operands end up belonging to something that isn't an
    // expression. If two expressions claim an operand, the parser kept the one it created later.
    let mut counts = [0u32; 2 * ExprTag::COUNT];
    for (i, e) in f.exprs.iter().enumerate() {
        let id = ExprId(i as u32);
        let me = Parent::Expr(id);
        // The rare `+ 1` kinds are fixed up in the match arms below (`link!`).
        let kind = 2 * e.kind.tag() as u8;
        if LINT {
            set!(expr_kinds[id] = kind);
            counts[kind as usize] += 1;
        }
        macro_rules! link {
            ($chain:expr) => {
                if LINT && $chain != Chain::No {
                    set!(expr_kinds[id] = kind + 1);
                    counts[kind as usize] -= 1;
                    counts[kind as usize + 1] += 1;
                }
            };
        }
        macro_rules! operands {
            ($($operand:expr),*) => {{ $(set!(expr_parent[$operand] = me);)* }};
        }
        macro_rules! list {
            ($list:expr) => {
                for operand in f.ids($list) {
                    set!(expr_parent[operand] = me);
                }
            };
        }
        macro_rules! props {
            ($props:expr) => {
                for p in $props.iter() {
                    let Some(prop) = f.props.get(p.idx()) else {
                        continue;
                    };
                    set!(prop_owner[p] = id);
                    set!(expr_parent[prop.value] = Parent::Prop(p));
                    if let PropKey::Computed(key) = prop.key {
                        let names_a_function = !matches!(
                            prop.kind,
                            PropKind::Init | PropKind::Spread | PropKind::Shorthand
                        );
                        set!(
                            expr_parent[key] = match names_a_function {
                                true => Parent::MethodKey(p),
                                false => Parent::PropKey(p),
                            }
                        );
                    }
                }
            };
        }
        match e.kind {
            ExprKind::Missing => {
                if LINT {
                    set!(expr_kinds[id] = NOT_REACHED);
                    counts[kind as usize] -= 1;
                }
            }
            ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => {}
            ExprKind::Dot { obj, chain, .. } => {
                link!(chain);
                operands!(obj);
            }
            ExprKind::Index { obj, index, chain } => {
                link!(chain);
                operands!(obj, index);
            }
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                if let Some(call) = f.calls.get(c.idx()) {
                    if let ExprKind::Call(_) = e.kind {
                        link!(call.chain);
                    }
                    operands!(call.callee);
                    if let ExprKind::TaggedTemplate(_) = e.kind {
                        operands!(f.template_of(c));
                    }
                    list!(call.args);
                    tys!(f.list_at(call.type_args));
                }
            }
            ExprKind::Template { exprs, .. } => list!(exprs),
            ExprKind::Array(items) => list!(items),
            ExprKind::ImportCall { args } => {
                list!(args);
                if !f.import_call_type_args.is_empty() {
                    tys!(f.type_args_of_import_call(args));
                }
            }
            ExprKind::Object(props) => props!(props),
            ExprKind::Fn(func) => set!(fns[func].owner = FnOwner::Expr(id)),
            ExprKind::Class(class) => {
                set!(class_owner[class] = ClassOwner::Expr(id));
                set!(class_scope[class] = REACHED);
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
                ty!(ty);
            }
            ExprKind::Instantiation { expr, type_args } => {
                operands!(expr);
                tys!(f.list_at(type_args));
            }
            ExprKind::Jsx(jsx) => {
                if let Some(jsx) = f.jsx.get(jsx.idx()) {
                    operands!(jsx.tag, jsx.close_tag);
                    tys!(jsx.type_args);
                    props!(jsx.attrs);
                    list!(jsx.children);
                }
            }
        }
    }
    if let Some(all) = expr_kind_counts.get_mut(..counts.len()) {
        all.copy_from_slice(&counts);
    }
    let mut others = [0u32; kind_counts::LEN];
    for (i, ty) in f.types.iter().enumerate() {
        let id = TypeNodeId(i as u32);
        if LINT {
            others[kind_counts::TYPES + ty.kind.tag() as usize] += 1;
        }
        match ty.kind {
            // This is an error. Its expression's parent is whatever contains the type.
            TypeNodeKind::Heritage { .. } => return false,
            TypeNodeKind::Typeof { expr, args, .. } => {
                tys!(args);
                set!(expr_parent[expr] = Parent::File);
                let mut at = expr;
                while let Some(operand) = f.exprs.get(at.idx()) {
                    type_query_operands.push(at);
                    let ExprKind::Dot { obj, .. } = operand.kind else {
                        break;
                    };
                    at = obj;
                }
            }
            TypeNodeKind::Fn(func) => set!(fns[func].owner = FnOwner::Type(id)),
            TypeNodeKind::Object(members) => {
                for m in members.iter() {
                    set!(member_owner[m] = MemberOwner::TypeLiteral(id));
                }
            }
            TypeNodeKind::Mapped(mapped) => {
                if let Some(mapped) = f.mapped.get(mapped.idx()) {
                    type_params!(Span::<TypeParamId>::new(mapped.param.0, 1));
                    ty!(mapped.name_ty, mapped.ty);
                    for m in mapped.members.iter() {
                        set!(member_owner[m] = MemberOwner::TypeLiteral(id));
                    }
                }
            }
            TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. } => tys!(args),
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => {
                tys!(types)
            }
            TypeNodeKind::Array(operand)
            | TypeNodeKind::Keyof(operand)
            | TypeNodeKind::Readonly(operand)
            | TypeNodeKind::Unique(operand)
            | TypeNodeKind::JSDoc { ty: operand, .. }
            | TypeNodeKind::Predicate { ty: operand, .. } => ty!(operand),
            TypeNodeKind::Tuple(elements) => {
                for e in elements.iter() {
                    // Whichever of `ty` and `written` contains the other.
                    if let Some(element) = f.tuple_elems.get(e.idx()) {
                        ty!(match element.member_type {
                            TupleMemberType::Optional => element.ty,
                            _ => element.written,
                        });
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
            TypeNodeKind::Infer(param) => {
                set!(type_param_scope[param] = REACHED);
                ty!(f
                    .type_params
                    .get(param.idx())
                    .map_or(TypeNodeId::NONE, |it| it.constraint));
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
    for alias in f.aliases.iter() {
        type_params!(alias.type_params);
        ty!(alias.ty);
    }
    for (i, interface) in f.interfaces.iter().enumerate() {
        type_params!(interface.type_params);
        tys!(interface.extends);
        tys!(interface.other_heritage);
        for m in interface.members.iter() {
            set!(member_owner[m] = MemberOwner::Interface(InterfaceId(i as u32)));
        }
    }
    for (i, class) in f.classes.iter().enumerate() {
        let id = ClassId(i as u32);
        decorators!(class.modifiers, Parent::ClassDecorator(id));
        set!(expr_parent[class.extends] = Parent::ClassExtends(id));
        for other in f.ids(class.other_extends) {
            set!(expr_parent[other] = Parent::ClassExtends(id));
        }
        type_params!(class.type_params);
        tys!(class.extends_args);
        tys!(class.implements);
        tys!(class.other_implements);
        for m in class.members.iter() {
            set!(member_owner[m] = MemberOwner::Class(id));
        }
    }
    for (i, member) in f.members.iter().enumerate() {
        let id = MemberId(i as u32);
        if let MemberOwner::Class(_) = member_owner[i] {
            decorators!(member.modifiers, Parent::MemberDecorator(id));
        }
        if let PropKey::Computed(key) = member.key {
            set!(expr_parent[key] = Parent::MemberKey(id));
        }
        set!(fns[member.func].owner = FnOwner::Member(id));
        set!(expr_parent[member.init] = Parent::MemberInit(id));
        ty!(member.ty);
    }
    for &(id, modifiers) in f.modifiers_of_stmts.iter() {
        if !matches!(f.stmts.get(id.idx()), Some(s) if matches!(s.kind, StmtKind::Class(_))) {
            decorators!(modifiers, Parent::Stmt(id));
        }
    }
    for (i, s) in f.stmts.iter().enumerate() {
        let id = StmtId(i as u32);
        let me = Parent::Stmt(id);
        macro_rules! exprs {
            ($($e:expr),*) => {{ $(set!(expr_parent[$e] = me);)* }};
        }
        macro_rules! stmts {
            ($($s:expr),*) => {{ $(set!(stmt_parent[$s] = me);)* }};
        }
        macro_rules! head {
            ($head:expr) => {
                if LINT
                    && let Some(Stmt {
                        kind: StmtKind::Expr(_),
                        ..
                    }) = f.stmts.get($head.idx())
                {
                    others[kind_counts::EXPRESSION_LOOP_HEADS] += 1;
                }
            };
        }
        if LINT {
            others[kind_counts::STMTS + s.kind.tag() as usize] += 1;
        }
        match s.kind {
            StmtKind::Return(e) => {
                exprs!(e);
                if LINT {
                    returns.push(id.0);
                }
            }
            StmtKind::Expr(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e) => exprs!(e),
            StmtKind::Var(declarations) => {
                for d in declarations.iter() {
                    set!(var_stmt[d] = id);
                }
            }
            StmtKind::Fn(func) => set!(fns[func].owner = FnOwner::Stmt(id)),
            StmtKind::Class(class) => {
                set!(class_owner[class] = ClassOwner::Stmt(id));
                set!(class_scope[class] = REACHED);
            }
            StmtKind::If { test, yes, no } => {
                exprs!(test);
                stmts!(yes, no);
            }
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                exprs!(test);
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
                head!(init);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                exprs!(expr);
                stmts!(left, body);
                head!(left);
            }
            StmtKind::Block(list) => {
                for inner in f.ids(list) {
                    stmts!(inner);
                }
            }
            StmtKind::Switch { expr, cases } => {
                exprs!(expr);
                for c in cases.iter() {
                    set!(case_stmt[c] = id);
                    let Some(case) = f.cases.get(c.idx()) else {
                        continue;
                    };
                    set!(expr_parent[case.test] = Parent::Case(c));
                    for inner in f.ids(case.body) {
                        stmts!(inner);
                    }
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                set!(var_stmt[param] = id);
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
    for (i, func) in f.fns.iter().enumerate() {
        let id = FnId(i as u32);
        set!(param_fn[func.this_param] = id);
        type_params!(func.type_params);
        ty!(func.ret, func.this_ty(f));
        // Decorators on a class member's parameters are evaluated with the class.
        let class = match fns[i].owner {
            FnOwner::Member(m) => match member_owner.get(m.idx()) {
                Some(&MemberOwner::Class(class)) => class,
                _ => ClassId::NONE,
            },
            _ => ClassId::NONE,
        };
        for p in func.params.iter() {
            let Some(param) = f.params.get(p.idx()) else {
                continue;
            };
            set!(param_fn[p] = id);
            set!(pat_parent[param.pat] = PatParent::Param(p));
            ty!(param.ty);
            set!(expr_parent[param.default] = Parent::ParamDefault(p));
            decorators!(
                f.param_modifiers(p),
                match class.is_some() {
                    true => Parent::ParamDecorator(p),
                    false => Parent::FnBody(id),
                }
            );
        }
        match func.body {
            FnBody::None => {}
            FnBody::Expr(e) => set!(expr_parent[e] = Parent::FnBody(id)),
            FnBody::Block(list) => {
                for s in f.ids(list) {
                    set!(stmt_parent[s] = Parent::FnBody(id));
                }
            }
        }
    }
    fill_var_decls(&f.var_decls, expr_parent, pat_parent, type_scope);
    for (i, pat) in f.pats.iter().enumerate() {
        let id = PatId(i as u32);
        if LINT {
            others[kind_counts::PATS + pat.kind.tag() as usize] += 1;
        }
        match pat.kind {
            PatKind::Missing | PatKind::Ident(_) => {}
            PatKind::Object(props) => {
                for p in props.iter() {
                    let Some(prop) = f.pat_props.get(p.idx()) else {
                        continue;
                    };
                    if let PropKey::Computed(key) = prop.key {
                        set!(expr_parent[key] = Parent::PatKey(p));
                    }
                    set!(expr_parent[prop.default] = Parent::PatPropDefault(p));
                    set!(pat_parent[prop.value] = PatParent::Prop(id, p));
                }
            }
            PatKind::Array(elements) => {
                for e in elements.iter() {
                    let Some(element) = f.pat_elems.get(e.idx()) else {
                        continue;
                    };
                    set!(expr_parent[element.default] = Parent::PatElemDefault(e));
                    set!(pat_parent[element.pat] = PatParent::Elem(id, e));
                }
            }
        }
    }
    for (i, declaration) in f.enums.iter().enumerate() {
        for m in declaration.members.iter() {
            set!(enum_member_owner[m] = EnumId(i as u32));
            if let Some(member) = f.enum_members.get(m.idx()) {
                set!(expr_parent[member.computed_name] = Parent::EnumInit(m));
                set!(expr_parent[member.init] = Parent::EnumInit(m));
            }
        }
    }
    for (i, module) in f.modules.iter().enumerate() {
        for s in f.ids(module.body) {
            set!(stmt_parent[s] = Parent::Module(ModuleId(i as u32)));
        }
    }
    for s in f.ids(f.body) {
        set!(stmt_parent[s] = Parent::File);
    }
    for &(_, attributes) in f.import_attributes.iter() {
        set!(expr_parent[attributes] = Parent::File);
    }
    for &specifier in f.specifier_expressions.iter() {
        set!(expr_parent[specifier] = Parent::File);
    }
    if LINT {
        let is_orphan = |it: &&PatParent| matches!(it, PatParent::None);
        others[kind_counts::PATS_WITHOUT_PARENT] =
            pat_parent.iter().filter(is_orphan).count() as u32;
    }
    if let Some(all) = kind_counts.get_mut(..others.len()) {
        all.copy_from_slice(&others);
    }
    true
}

/// The part of [`fill`] that handles variable declarations.
fn fill_var_decls(
    declarations: &[VarDecl],
    expr_parent: &mut [PackedParent],
    pat_parent: &mut [PatParent],
    type_scope: &mut [ScopeId],
) {
    for (i, declaration) in declarations.iter().enumerate() {
        let id = VarDeclId(i as u32);
        if let Some(slot) = pat_parent.get_mut(declaration.pat.idx()) {
            *slot = PatParent::Var(id);
        }
        if let Some(slot) = expr_parent.get_mut(declaration.init.idx()) {
            *slot = Parent::VarInit(id).into();
        }
        if let Some(slot) = type_scope.get_mut(declaration.ty.idx()) {
            *slot = REACHED;
        }
    }
}

/// Returns false if some node has no parent. The parser abandoned such a node, and the nodes inside
/// it now have entries that `bind` wouldn't give them. That's rare enough to fall back to the
/// binder.
#[inline(never)]
fn every_node_has_parent(
    expr_parent: &[PackedParent],
    stmt_parent: &[PackedParent],
    fns: &[FnInfo],
    class_owner: &[ClassOwner],
    type_scope: &[ScopeId],
    type_param_scope: &[ScopeId],
) -> bool {
    // There's almost never an orphan, so don't stop at the first one. Without an early exit the
    // compiler can compare several entries at once.
    let has_orphan = |list: &[PackedParent]| {
        let is_orphan = |found, it: &PackedParent| found | (*it == PackedParent::default());
        list.iter().fold(false, is_orphan)
    };
    let has_unreached =
        |list: &[ScopeId]| list.iter().fold(false, |found, it| found | it.is_none());
    !has_orphan(expr_parent)
        && !has_orphan(stmt_parent)
        && fns.iter().all(|it| it.owner != FnOwner::None)
        && !class_owner.contains(&ClassOwner::Stmt(StmtId::NONE))
        && !has_unreached(type_scope)
        && !has_unreached(type_param_scope)
}
