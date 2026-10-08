//! What each node of a file is part of, and nothing else.

use super::*;

fn filled<T: Copy>(arena: &Arena, len: usize, value: T) -> ArenaVec<'_, T> {
    let mut list = ArenaVec::new_in(arena);
    list.reserve_exact(len);
    list.extend(std::iter::repeat_n(value, len));
    list
}

fn refilled<T: Copy>(list: &mut Vec<T>, len: usize, value: T) {
    list.clear();
    list.resize(len, value);
}

const NO_FUNCTION: FnInfo = FnInfo {
    owner: FnOwner::None,
    scope: ScopeId::NONE,
    enclosing: FnId::NONE,
    returns: IdList::EMPTY,
    yields: IdList::EMPTY,
    end: UNREACHABLE,
    exit: FlowId::NONE,
    contains_this: false,
};

/// What is filled in, each as long as the list of the file and with nothing in it.
struct Lists<'l> {
    expr_parent: &'l mut [Parent],
    stmt_parent: &'l mut [Parent],
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
}

/// In place of the scope of what `bind` gets to.
const REACHED: ScopeId = ScopeId(0);

/// What comes from JSDoc comments is bound where the comment is.
fn is_for_the_binder<S: Storage>(f: &FileIn<S>) -> bool {
    f.is_js && !f.jsdoc_comments.is_empty()
}

/// [`bind`] for a formatter, which goes down from the file and now and then asks what a node is part
/// of. It declares nothing and resolves nothing.
///
/// For every node that `bind` reaches, these are as in its result: `expr_parent`, `stmt_parent`,
/// `pat_parent`, `prop_owner`, `member_owner`, `param_fn`, `var_stmt`, `case_stmt`,
/// `enum_member_owner`, `class_owner`, `FnInfo::owner`, whether it is among
/// `type_query_operands`, and whether its entry in `class_scope`, `type_scope` or `type_param_scope`
/// is `NONE`, which is all that these three tell here. The exception is the parent of the `a.b` of the type `typeof a.b`, which
/// is the file here. All else is empty.
///
/// A node says what its children are part of, so this goes through the lists of the file once and
/// never calls itself. A file in which the parser has left something behind where it backtracked is
/// left to the binder, which does not get to it: so what has no entry in the result of `bind` has
/// none here.
pub fn bind_for_format<'s>(
    f: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    arena: &'s Arena,
) -> Bound<'s> {
    if is_for_the_binder(f) {
        return bind_for_lint(f, options, atoms, arena);
    }
    let mut expr_parent = filled(arena, f.exprs.len(), Parent::None);
    let mut stmt_parent = filled(arena, f.stmts.len(), Parent::None);
    let mut pat_parent = filled(arena, f.pats.len(), PatParent::None);
    let mut prop_owner = filled(arena, f.props.len(), ExprId::NONE);
    let mut member_owner = filled(arena, f.members.len(), MemberOwner::None);
    let mut param_fn = filled(arena, f.params.len(), FnId::NONE);
    let mut var_stmt = filled(arena, f.var_decls.len(), StmtId::NONE);
    let mut case_stmt = filled(arena, f.cases.len(), StmtId::NONE);
    let mut class_owner = filled(arena, f.classes.len(), ClassOwner::Stmt(StmtId::NONE));
    let mut fns = filled(arena, f.fns.len(), NO_FUNCTION);
    let mut class_scope = filled(arena, f.classes.len(), ScopeId::NONE);
    let mut type_scope = filled(arena, f.types.len(), ScopeId::NONE);
    let mut type_param_scope = filled(arena, f.type_params.len(), ScopeId::NONE);
    let mut enum_member_owner = vec![EnumId::NONE; f.enum_members.len()];
    let mut type_query_operands = Vec::new();
    let is_done = fill(
        f,
        Lists {
            expr_parent: &mut expr_parent,
            stmt_parent: &mut stmt_parent,
            pat_parent: &mut pat_parent,
            prop_owner: &mut prop_owner,
            member_owner: &mut member_owner,
            param_fn: &mut param_fn,
            var_stmt: &mut var_stmt,
            case_stmt: &mut case_stmt,
            class_owner: &mut class_owner,
            enum_member_owner: &mut enum_member_owner,
            fns: &mut fns,
            type_query_operands: &mut type_query_operands,
            class_scope: &mut class_scope,
            type_scope: &mut type_scope,
            type_param_scope: &mut type_param_scope,
        },
    );
    if !is_done {
        return bind_for_lint(f, options, atoms, arena);
    }
    Bound {
        expr_parent,
        stmt_parent,
        pat_parent,
        prop_owner,
        member_owner,
        param_fn,
        var_stmt,
        case_stmt,
        class_owner,
        fns,
        class_scope,
        type_scope,
        type_param_scope,
        enum_member_owner: few_to_arena(enum_member_owner, arena),
        type_query_operands: few_to_arena(type_query_operands, arena),
        ..Bound::empty_in(arena)
    }
}

/// [`bind_for_format`] without an arena: see [`bind_for_lint_in`].
pub fn bind_for_format_in<'r>(
    f: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    recycled: &'r mut Recycled,
) -> &'r BoundBuilder {
    match try_bind_for_format_in(f, recycled).is_some() {
        true => &recycled.room().b,
        false => bind_for_lint_in(f, options, atoms, recycled),
    }
}

/// [`bind_for_format_in`] for a file whose lists are stored anywhere, like those that the parser
/// still has. It reads nothing that `File::finish_nodes` computes. `None`: the file takes the binder,
/// which takes a [`File`].
pub fn try_bind_for_format_in<'r, S: Storage>(f: &FileIn<S>, recycled: &'r mut Recycled) -> Option<&'r BoundBuilder> {
    if is_for_the_binder(f) {
        return None;
    }
    let b = &mut recycled.room().b;
    b.clear();
    refilled(&mut b.expr_parent, f.exprs.len(), Parent::None);
    refilled(&mut b.stmt_parent, f.stmts.len(), Parent::None);
    refilled(&mut b.pat_parent, f.pats.len(), PatParent::None);
    refilled(&mut b.prop_owner, f.props.len(), ExprId::NONE);
    refilled(&mut b.member_owner, f.members.len(), MemberOwner::None);
    refilled(&mut b.param_fn, f.params.len(), FnId::NONE);
    refilled(&mut b.var_stmt, f.var_decls.len(), StmtId::NONE);
    refilled(&mut b.case_stmt, f.cases.len(), StmtId::NONE);
    refilled(&mut b.class_owner, f.classes.len(), ClassOwner::Stmt(StmtId::NONE));
    refilled(&mut b.enum_member_owner, f.enum_members.len(), EnumId::NONE);
    refilled(&mut b.fns, f.fns.len(), NO_FUNCTION);
    refilled(&mut b.class_scope, f.classes.len(), ScopeId::NONE);
    refilled(&mut b.type_scope, f.types.len(), ScopeId::NONE);
    refilled(&mut b.type_param_scope, f.type_params.len(), ScopeId::NONE);
    let is_done = fill(
        f,
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
        },
    );
    is_done.then_some(&*b)
}

/// `false`: it takes the binder.
fn fill<S: Storage>(f: &FileIn<S>, lists: Lists) -> bool {
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
    } = lists;

    // An id that is `NONE` is the index of nothing.
    macro_rules! set {
        ($list:ident[$id:expr] = $value:expr) => {
            if let Some(slot) = $list.get_mut($id.idx()) {
                *slot = $value;
            }
        };
        ($list:ident[$id:expr].owner = $value:expr) => {
            if let Some(slot) = $list.get_mut($id.idx()) {
                slot.owner = $value;
            }
        };
    }
    // The types and the type parameters that `bind` gets to from a node.
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
                if let Some(Modifier { kind: ModifierKind::Decorator(e), .. }) = f.modifiers.get(modifier.idx()) {
                    set!(expr_parent[e] = $parent);
                }
            }
        };
    }

    // The expressions come first. What the parser has left behind are expressions, like the `A<T>` of
    // `extends A<T>` and the `a = 1` of `({ a = 1 }) => 0`, whose operands are part of something that
    // is not an expression. Of two expressions, the one that is made later is the one that is kept.
    for (i, e) in f.exprs.iter().enumerate() {
        let id = ExprId(i as u32);
        let me = Parent::Expr(id);
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
                        let names_a_function = !matches!(prop.kind, PropKind::Init | PropKind::Spread | PropKind::Shorthand);
                        set!(expr_parent[key] = match names_a_function {
                            true => Parent::MethodKey(p),
                            false => Parent::PropKey(id, p),
                        });
                    }
                }
            };
        }
        match e.kind {
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
            | ExprKind::Regex
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => {}
            ExprKind::Dot { obj, .. } => operands!(obj),
            ExprKind::Index { obj, index, .. } => operands!(obj, index),
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                if let Some(call) = f.calls.get(call.idx()) {
                    operands!(call.callee, call.template);
                    list!(call.args);
                    tys!(call.type_args);
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
            ExprKind::Cond { test, yes, no } => operands!(test, yes, no),
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
                tys!(type_args);
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
    for (i, ty) in f.types.iter().enumerate() {
        let id = TypeNodeId(i as u32);
        match ty.kind {
            // An error. Its expression is part of what the type is in.
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
            TypeNodeKind::Template { types, .. } | TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
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
                    // Of `ty` and `written`, the one that contains the other.
                    if let Some(element) = f.tuple_elems.get(e.idx()) {
                        ty!(match element.member_type {
                            TupleMemberType::Optional => element.ty,
                            _ => element.written,
                        });
                    }
                }
            }
            TypeNodeKind::Cond { check, extends, yes, no } => ty!(check, extends, yes, no),
            TypeNodeKind::IndexedAccess { obj, index } => ty!(obj, index),
            // Not its default.
            TypeNodeKind::Infer(param) => {
                set!(type_param_scope[param] = REACHED);
                ty!(f.type_params.get(param.idx()).map_or(TypeNodeId::NONE, |it| it.constraint));
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
        decorators!(class.modifiers, Parent::Decorator(id, DecoratorOwner::Class(id)));
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
        if let MemberOwner::Class(class) = member_owner[i] {
            decorators!(member.modifiers, Parent::Decorator(class, DecoratorOwner::Member(id)));
        }
        if let PropKey::Computed(key) = member.key {
            set!(expr_parent[key] = Parent::MemberKey(id));
        }
        set!(fns[member.func].owner = FnOwner::Member(id));
        set!(expr_parent[member.init] = Parent::MemberInit(id));
        ty!(member.ty);
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
        if !s.modifiers.is_empty() && !matches!(s.kind, StmtKind::Class(_)) {
            decorators!(s.modifiers, me);
        }
        match s.kind {
            StmtKind::Expr(e)
            | StmtKind::Return(e)
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
            StmtKind::For { init, test, update, body } => {
                exprs!(test, update);
                stmts!(init, body);
            }
            StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                exprs!(expr);
                stmts!(left, body);
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
            StmtKind::Try { block, param, handler, finalizer } => {
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
        // The decorators of a parameter of a member of a class are evaluated with the class.
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
                    true => Parent::Decorator(class, DecoratorOwner::Param(p)),
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
    for (i, declaration) in f.var_decls.iter().enumerate() {
        let id = VarDeclId(i as u32);
        set!(pat_parent[declaration.pat] = PatParent::Var(id));
        set!(expr_parent[declaration.init] = Parent::VarInit(id));
        ty!(declaration.ty);
    }
    for (i, pat) in f.pats.iter().enumerate() {
        let id = PatId(i as u32);
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
    type_query_operands.sort_unstable();
    type_query_operands.dedup();
    // What nothing says to be a part of anything is what the parser has left behind, and what is in it
    // has entries that `bind` does not have. That is rare enough to leave it to the binder.
    !expr_parent.contains(&Parent::None)
        && !stmt_parent.contains(&Parent::None)
        && fns.iter().all(|it| it.owner != FnOwner::None)
        && !class_owner.contains(&ClassOwner::Stmt(StmtId::NONE))
        && !type_scope.contains(&ScopeId::NONE)
        && !type_param_scope.contains(&ScopeId::NONE)
}
