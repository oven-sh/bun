use crate::hir::{
    Branches, ClassId, ExprId, ExprKind, FileIn, FnBody, FnId, ModifierId, ModifierKind, PatId,
    PatKind, PropId, PropKey, Span, StmtId, StmtKind, Storage,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TreeNode {
    Expr(ExprId),
    Stmt(StmtId),
    Function(FnId),
    Class(ClassId),
    Pattern(PatId),
}

pub fn push_children<S: Storage>(hir: &FileIn<S>, node: TreeNode, stack: &mut Vec<TreeNode>) {
    match node {
        TreeNode::Expr(e) => push_expr_children(hir, e, stack),
        TreeNode::Stmt(stmt) => push_stmt_children(hir, stmt, stack),
        TreeNode::Function(function) => push_function_children(hir, function, stack),
        TreeNode::Class(class) => push_class_children(hir, class, stack),
        TreeNode::Pattern(pattern) => push_pattern_children(hir, pattern, stack),
    }
}

fn push_exprs(exprs: impl IntoIterator<Item = ExprId>, stack: &mut Vec<TreeNode>) {
    let present = exprs.into_iter().filter(|e| e.is_some());
    stack.extend(present.map(TreeNode::Expr));
}

fn push_stmts(stmts: impl IntoIterator<Item = StmtId>, stack: &mut Vec<TreeNode>) {
    let present = stmts.into_iter().filter(|stmt| stmt.is_some());
    stack.extend(present.map(TreeNode::Stmt));
}

fn push_pattern(pattern: PatId, stack: &mut Vec<TreeNode>) {
    stack.extend(pattern.some().map(TreeNode::Pattern));
}

fn push_computed_key(key: PropKey, stack: &mut Vec<TreeNode>) {
    match key {
        PropKey::Computed(e) => push_exprs([e], stack),
        PropKey::None | PropKey::Name(_) | PropKey::Private(_) => {}
    }
}

fn push_props<S: Storage>(hir: &FileIn<S>, props: Span<PropId>, stack: &mut Vec<TreeNode>) {
    for prop in props.iter() {
        push_computed_key(hir[prop].key, stack);
        push_exprs([hir[prop].value], stack);
    }
}

fn push_decorators<S: Storage>(
    hir: &FileIn<S>,
    modifiers: Span<ModifierId>,
    stack: &mut Vec<TreeNode>,
) {
    for modifier in modifiers.iter() {
        match hir[modifier].kind {
            ModifierKind::Decorator(e) => push_exprs([e], stack),
            ModifierKind::Keyword(_) => {}
        }
    }
}

fn push_expr_children<S: Storage>(hir: &FileIn<S>, e: ExprId, stack: &mut Vec<TreeNode>) {
    match hir[e].kind {
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
        ExprKind::Template { exprs: list }
        | ExprKind::ImportCall { args: list }
        | ExprKind::Array(list) => push_exprs(hir.ids(list), stack),
        ExprKind::TaggedTemplate(call) => {
            push_exprs([hir[call].callee, hir.template_of(call)], stack);
            push_exprs(hir.ids(hir[call].args), stack);
        }
        ExprKind::Call(call) | ExprKind::New(call) => {
            push_exprs([hir[call].callee], stack);
            push_exprs(hir.ids(hir[call].args), stack);
        }
        ExprKind::Object(props) => push_props(hir, props, stack),
        ExprKind::Fn(function) => stack.push(TreeNode::Function(function)),
        ExprKind::Class(class) => stack.push(TreeNode::Class(class)),
        ExprKind::Index { obj, index, .. } => push_exprs([obj, index], stack),
        ExprKind::Binary { left, right, .. } => push_exprs([left, right], stack),
        ExprKind::Assign { target, value, .. } => push_exprs([target, value], stack),
        ExprKind::Cond { test, branches } => {
            let Branches { yes, no } = hir.branches(branches);
            push_exprs([test, yes, no], stack);
        }
        ExprKind::Dot { obj: expr, .. }
        | ExprKind::Unary { operand: expr, .. }
        | ExprKind::Yield { value: expr, .. }
        | ExprKind::Spread(expr)
        | ExprKind::Await(expr)
        | ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::NonNull(expr)
        | ExprKind::Instantiation { expr, .. } => push_exprs([expr], stack),
        ExprKind::Jsx(jsx) => {
            let jsx = &hir[jsx];
            push_exprs([jsx.tag], stack);
            push_props(hir, jsx.attrs, stack);
            push_exprs(hir.ids(jsx.children), stack);
            push_exprs([jsx.close_tag], stack);
        }
    }
}

fn push_stmt_children<S: Storage>(hir: &FileIn<S>, stmt: StmtId, stack: &mut Vec<TreeNode>) {
    match hir[stmt].kind {
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Import(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportAsNamespace(_) => {}
        StmtKind::Expr(e)
        | StmtKind::Return(e)
        | StmtKind::Throw(e)
        | StmtKind::ExportDefault(e)
        | StmtKind::ExportAssign(e)
        | StmtKind::Directive { expr: e, .. } => push_exprs([e], stack),
        StmtKind::Var(declarations) => {
            for declaration in declarations.iter() {
                push_pattern(hir[declaration].pat, stack);
                push_exprs([hir[declaration].init], stack);
            }
        }
        StmtKind::Fn(function) => stack.push(TreeNode::Function(function)),
        StmtKind::Class(class) => stack.push(TreeNode::Class(class)),
        StmtKind::Enum(enumeration) => {
            for member in hir[enumeration].members.iter() {
                push_exprs([hir[member].computed_name, hir[member].init], stack);
            }
        }
        StmtKind::Module(module) => push_stmts(hir.ids(hir[module].body), stack),
        StmtKind::If { test, yes, no } => {
            push_exprs([test], stack);
            push_stmts([yes, no], stack);
        }
        StmtKind::For {
            init,
            test,
            update,
            body,
        } => {
            push_stmts([init], stack);
            push_exprs([test, update], stack);
            push_stmts([body], stack);
        }
        StmtKind::ForIn { left, expr, body }
        | StmtKind::ForOf {
            left, expr, body, ..
        } => {
            push_stmts([left], stack);
            push_exprs([expr], stack);
            push_stmts([body], stack);
        }
        StmtKind::While { test: expr, body } | StmtKind::With { object: expr, body } => {
            push_exprs([expr], stack);
            push_stmts([body], stack);
        }
        StmtKind::DoWhile { body, test } => {
            push_stmts([body], stack);
            push_exprs([test], stack);
        }
        StmtKind::Block(statements) => push_stmts(hir.ids(statements), stack),
        StmtKind::Switch { expr, cases } => {
            push_exprs([expr], stack);
            for case in cases.iter() {
                push_exprs([hir[case].test], stack);
                push_stmts(hir.ids(hir[case].body), stack);
            }
        }
        StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        } => {
            push_stmts([block], stack);
            if param.is_some() {
                push_pattern(hir[param].pat, stack);
            }
            push_stmts([handler, finalizer], stack);
        }
        StmtKind::Labeled { body, .. } => push_stmts([body], stack),
        StmtKind::ImportEquals(import) => push_exprs([hir[import].expression], stack),
    }
}

fn push_function_children<S: Storage>(hir: &FileIn<S>, function: FnId, stack: &mut Vec<TreeNode>) {
    let function = &hir[function];
    for param in function.params.iter() {
        push_decorators(hir, hir.param_modifiers(param), stack);
        push_pattern(hir[param].pat, stack);
        push_exprs([hir[param].default], stack);
    }
    match function.body {
        FnBody::None => {}
        FnBody::Block(statements) => push_stmts(hir.ids(statements), stack),
        FnBody::Expr(e) => push_exprs([e], stack),
    }
}

fn push_class_children<S: Storage>(hir: &FileIn<S>, class: ClassId, stack: &mut Vec<TreeNode>) {
    let class = &hir[class];
    push_decorators(hir, class.modifiers, stack);
    push_exprs([class.extends], stack);
    push_exprs(hir.ids(class.other_extends), stack);
    for member in class.members.iter() {
        let member = &hir[member];
        push_decorators(hir, member.modifiers, stack);
        push_computed_key(member.key, stack);
        push_exprs([member.init], stack);
        stack.extend(member.func.some().map(TreeNode::Function));
    }
}

fn push_pattern_children<S: Storage>(hir: &FileIn<S>, pattern: PatId, stack: &mut Vec<TreeNode>) {
    match hir[pattern].kind {
        PatKind::Missing | PatKind::Ident(_) => {}
        PatKind::Object(props) => {
            for prop in props.iter() {
                let prop = &hir[prop];
                push_computed_key(prop.key, stack);
                push_pattern(prop.value, stack);
                push_exprs([prop.default], stack);
            }
        }
        PatKind::Array(elements) => {
            for element in elements.iter() {
                push_pattern(hir[element].pat, stack);
                push_exprs([hir[element].default], stack);
            }
        }
    }
}
