use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::cmp::Reverse;

/// Disallow unnecessary assignment of constructor property parameter.
pub struct NoUnnecessaryParameterPropertyAssignment;

const UNNECESSARY_ASSIGN: Message = Message::new(
    "unnecessaryAssign",
    "This assignment is unnecessary since it is already assigned by a parameter property.",
);


/// What is known about the body of a class.
#[derive(Default)]
struct ReportInfo<'a> {
    assigned_before_constructor: FxHashSet<Cow<'a, [u8]>>,
    assigned_before_unnecessary: FxHashSet<Cow<'a, [u8]>>,
    unnecessary_assignments: Vec<(Cow<'a, [u8]>, Expr<'a>)>,
}

/// What is looked up for every assignment.
#[derive(Default)]
struct Memo<'a> {
    /// For each name that a scope refers to: whether the first reference is to a parameter.
    from_parameter: FxHashMap<Scope<'a>, FxHashMap<Name<'a>, bool>>,
    /// The names of the parameter properties of a constructor.
    parameter_properties: FxHashMap<Func<'a>, FxHashSet<Name<'a>>>,
    /// What is around something: the property definition, the function, and the class whose body it is in.
    property_definitions: AncestorMemo<'a, Member<'a>>,
    functions: AncestorMemo<'a, Func<'a>>,
    class_bodies: AncestorMemo<'a, Class<'a>>,
}

fn is_this_member_expression(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj.tag() == ExprTag::This,
        _ => false,
    }
}

/// The `x` of `this.x` and `this["x"]`. Never empty.
fn get_property_name(e: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    if !is_this_member_expression(e) {
        return None;
    }
    let name = match e.kind() {
        ExprKind::Dot { name, .. } if !name.bytes().starts_with(b"#") => Cow::Borrowed(name.bytes()),
        ExprKind::Index { index, .. } => ast_utils::get_static_string_value(index)?,
        _ => return None,
    };
    (!name.is_empty()).then_some(name)
}

fn find_parent_property_definition<'a>(e: Expr<'a>, memo: &mut Memo<'a>) -> Option<Member<'a>> {
    memo.property_definitions.find(Node::Expr(e), |_, it| match it {
        Node::Member(member) if utils::estree_type_name(it) == "PropertyDefinition" => Some(member),
        _ => None,
    })
}

/// ESLint's `getUpperFunction`, of what is not a function.
fn get_upper_function<'a>(e: Expr<'a>, memo: &mut Memo<'a>) -> Option<Func<'a>> {
    memo.functions.find(Node::Expr(e), |_, it| ast_utils::as_function(it))
}

fn is_constructor_function_expression(func: Func<'_>) -> bool {
    func.kind() == FnKind::Constructor
        && matches!(func.owner(), Node::Member(member) if member.is_constructor())
}

impl<'a> Memo<'a> {
    fn is_reference_from_parameter(&mut self, identifier: Expr<'a>, name: Name<'a>) -> bool {
        let scope = Node::Expr(identifier).scope();
        let first_references = self.from_parameter.entry(scope).or_insert_with(|| {
            let mut first_references = FxHashMap::default();
            for reference in scope.references() {
                first_references.entry(reference.name()).or_insert_with(|| {
                    matches!(reference.symbol().and_then(|it| it.declarations().next()), Some(Declaration::Param(_)))
                });
            }
            first_references
        });
        first_references.get(&name).is_some_and(|it| *it)
    }

    fn has_parameter_property(&mut self, constructor: Func<'a>, name: Name<'a>) -> bool {
        let names = self.parameter_properties.entry(constructor).or_insert_with(|| {
            let properties = constructor.params().iter().filter(|it| it.is_parameter_property());
            properties.filter_map(|it| it.pat().as_ident()).collect()
        });
        names.contains(&name)
    }
}

fn get_identifier(mut e: Expr<'_>) -> Option<(Expr<'_>, Name<'_>)> {
    loop {
        e = match e.kind() {
            ExprKind::Ident(name) => return Some((e, name)),
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr) if !e.is_angle_bracket_assertion() => expr,
            ExprKind::NonNull(expr) => expr,
            _ => return None,
        };
    }
}

/// `isArrowIIFE`: the call that the arrow function `func` is directly in.
fn call_around_arrow(func: Func<'_>) -> Option<Expr<'_>> {
    if !func.is_arrow() {
        return None;
    }
    call_around(func)
}

fn call_around(func: Func<'_>) -> Option<Expr<'_>> {
    func.owner().as_expr()?.parent().as_expr().filter(|it| it.tag() == ExprTag::Call)
}

/// The innermost class whose body `e` is in.
fn enclosing_class_body<'a>(e: Expr<'a>, memo: &mut Memo<'a>) -> Option<Class<'a>> {
    memo.class_bodies.find(Node::Expr(e), |child, it| match it {
        Node::Class(class) if class.body_span().contains(child.span()) => Some(class),
        _ => None,
    })
}

/// The assignment `e` is in `constructor`, at most in an arrow function that is called at once.
fn check_in_constructor<'a>(e: Expr<'a>, constructor: Func<'a>, info: &mut ReportInfo<'a>, memo: &mut Memo<'a>) {
    let ExprKind::Assign { op, target, value } = e.kind() else {
        return;
    };
    // After a write to the parameter, `this.x = x` may copy another value than the parameter
    // property got.
    if let ExprKind::Ident(name) = target.kind() {
        if memo.is_reference_from_parameter(target, name) {
            info.assigned_before_unnecessary.insert(Cow::Borrowed(name.bytes()));
        }
        return;
    }
    let Some(left_name) = get_property_name(target) else {
        return;
    };
    if !matches!(op, None | Some(BinOp::Nullish | BinOp::And | BinOp::Or)) {
        info.assigned_before_unnecessary.insert(left_name);
        return;
    }
    let Some((right, right_name)) = get_identifier(value) else {
        return;
    };
    if right_name.bytes() != &*left_name || !memo.is_reference_from_parameter(right, right_name) {
        return;
    }
    if memo.has_parameter_property(constructor, right_name) && !info.assigned_before_unnecessary.contains(&left_name) {
        info.unnecessary_assignments.push((left_name, e));
    }
}

/// Whether the assignment `e`, whose innermost function is `function`, is made while a field is
/// initialized.
fn is_in_field_initializer<'a>(e: Expr<'a>, function: Option<Func<'a>>, memo: &mut Memo<'a>) -> bool {
    let Some(field) = find_parent_property_definition(e, memo) else {
        return false;
    };
    match function {
        None => true,
        // For oxlint it can be a function expression too.
        Some(function) if function.is_arrow() || function.file().language().is_oxlint => {
            call_around(function).is_some_and(|call| field.init() == Some(call) && !call.is_chain_root())
        }
        Some(_) => false,
    }
}

impl NoUnnecessaryParameterPropertyAssignment {
    /// Notes whether `e` is a `this.x = x`. Without one there is nothing to report.
    fn look_for_copy<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state
            && let ExprKind::Assign { target, value, .. } = e.kind()
            && let Some((_, right_name)) = get_identifier(value)
            && get_property_name(target).is_some_and(|left_name| right_name.bytes() == &*left_name)
        {
            cx.state = true;
        }
    }
}

impl Rule for NoUnnecessaryParameterPropertyAssignment {
    const META: Meta =
        Meta::typescript("no-unnecessary-parameter-property-assignment", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Assign]).finish();
    /// Whether there is a `this.x = x`.
    type State<'a> = bool;

    fn new(_: &Options) -> Self {
        NoUnnecessaryParameterPropertyAssignment
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        (file.has_classes() && file.has_exprs([ExprTag::Assign])).then_some(false)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.look_for_copy(e, cx);
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state {
            return;
        }
        // The assignments to a variable or to a property of `this`.
        let is_relevant = |e: &Expr<'a>| {
            matches!(e.kind(), ExprKind::Assign { target, .. }
                if target.tag() == ExprTag::Ident || is_this_member_expression(target))
                && !utils::is_assignment_target(*e)
        };
        let mut assignments: Vec<Expr<'a>> = cx.file().exprs_of_kind(ExprTag::Assign).filter(is_relevant).collect();
        utils::sort::sort_by_key(&mut assignments, |it| (it.span().start, Reverse(it.span().end)));

        let mut infos: FxHashMap<Class<'a>, ReportInfo<'a>> = FxHashMap::default();
        let mut memo = Memo::default();
        for e in assignments {
            let Some(class) = enclosing_class_body(e, &mut memo) else {
                continue;
            };
            let info = infos.entry(class).or_default();

            let function = get_upper_function(e, &mut memo);
            let constructor = match function.and_then(call_around_arrow) {
                Some(call) => get_upper_function(call, &mut memo),
                None => function,
            };
            if let Some(constructor) = constructor.filter(|it| is_constructor_function_expression(*it)) {
                check_in_constructor(e, constructor, info, &mut memo);
            }

            if let ExprKind::Assign { target, .. } = e.kind()
                && let Some(name) = get_property_name(target)
                && is_in_field_initializer(e, function, &mut memo)
            {
                info.assigned_before_constructor.insert(name);
            }
        }

        for info in infos.values() {
            for (name, e) in &info.unnecessary_assignments {
                if !info.assigned_before_constructor.contains(name) {
                    let report = cx.report(*e, UNNECESSARY_ASSIGN);
                    // oxlint suggests to remove the statement that it is.
                    if cx.language().is_oxlint
                        && !e.is_parenthesized()
                        && let Node::Stmt(statement) = e.parent()
                        && utils::is_expression_statement(statement)
                    {
                        report.fix(|fixer| fixer.remove(statement));
                    }
                }
            }
        }
    }
}
