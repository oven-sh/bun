use bun_lint::prelude::*;
use std::borrow::Cow;
use std::cmp::Reverse;

/// Disallow unnecessary assignment of constructor property parameter.
pub struct NoUnnecessaryParameterPropertyAssignment;

const UNNECESSARY_ASSIGN: Message = Message::new(
    "unnecessaryAssign",
    "This assignment is unnecessary since it is already assigned by a parameter property.",
);

#[derive(Default)]
pub struct State<'a> {
    has_parameter_properties: bool,
    /// The assignments to a variable or to a property of `this`.
    assignments: Vec<Expr<'a>>,
}

/// What is known about the body of a class.
#[derive(Default)]
struct ReportInfo<'a> {
    assigned_before_constructor: Vec<Cow<'a, [u8]>>,
    assigned_before_unnecessary: Vec<Cow<'a, [u8]>>,
    unnecessary_assignments: Vec<(Cow<'a, [u8]>, Expr<'a>)>,
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

fn find_parent_property_definition(e: Expr<'_>) -> Option<Member<'_>> {
    Node::Expr(e).ancestors().find_map(|it| match it {
        Node::Member(member) if utils::estree_type_name(it) == "PropertyDefinition" => Some(member),
        _ => None,
    })
}

fn is_constructor_function_expression(func: Func<'_>) -> bool {
    func.kind() == FnKind::Constructor
        && matches!(func.owner(), Node::Member(member) if member.is_constructor())
}

fn is_reference_from_parameter<'a>(identifier: Expr<'a>, name: Name<'a>) -> bool {
    let mut references = Node::Expr(identifier).scope().references();
    let reference = references.find(|it| it.name() == name);
    let declaration = reference.and_then(Reference::symbol).and_then(|it| it.declarations().next());
    matches!(declaration, Some(Declaration::Param(_)))
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
    func.owner().as_expr()?.parent().as_expr().filter(|it| it.tag() == ExprTag::Call)
}

/// The innermost class whose body `e` is in.
fn enclosing_class_body(e: Expr<'_>) -> Option<Class<'_>> {
    let span = e.span();
    Node::Expr(e).ancestors().find_map(|it| match it {
        Node::Class(class) if class.body_span().contains(span) => Some(class),
        _ => None,
    })
}

/// The assignment `e` is in `constructor`, at most in an arrow function that is called at once.
fn check_in_constructor<'a>(e: Expr<'a>, constructor: Func<'a>, info: &mut ReportInfo<'a>) {
    let ExprKind::Assign { op, target, value } = e.kind() else {
        return;
    };
    // After a write to the parameter, `this.x = x` may copy another value than the parameter
    // property got.
    if let ExprKind::Ident(name) = target.kind() {
        if is_reference_from_parameter(target, name) {
            info.assigned_before_unnecessary.push(Cow::Borrowed(name.bytes()));
        }
        return;
    }
    let Some(left_name) = get_property_name(target) else {
        return;
    };
    if !matches!(op, None | Some(BinOp::Nullish | BinOp::And | BinOp::Or)) {
        info.assigned_before_unnecessary.push(left_name);
        return;
    }
    let Some((right, right_name)) = get_identifier(value) else {
        return;
    };
    if right_name.bytes() != &*left_name || !is_reference_from_parameter(right, right_name) {
        return;
    }
    let has_parameter_property = constructor
        .params()
        .iter()
        .any(|it| it.is_parameter_property() && it.pat().as_ident() == Some(right_name));
    if has_parameter_property && !info.assigned_before_unnecessary.contains(&left_name) {
        info.unnecessary_assignments.push((left_name, e));
    }
}

/// Whether the assignment `e`, whose innermost function is `function`, is made while a field is
/// initialized.
fn is_in_field_initializer<'a>(e: Expr<'a>, function: Option<Func<'a>>) -> bool {
    let Some(field) = find_parent_property_definition(e) else {
        return false;
    };
    match function {
        None => true,
        Some(function) => call_around_arrow(function)
            .is_some_and(|call| field.init() == Some(call) && !call.is_chain_root()),
    }
}

impl NoUnnecessaryParameterPropertyAssignment {
    fn collect<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.has_parameter_properties
            && let ExprKind::Assign { target, .. } = e.kind()
            && (target.tag() == ExprTag::Ident || is_this_member_expression(target))
            && !utils::is_assignment_target(e)
        {
            cx.state.assignments.push(e);
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut assignments = std::mem::take(&mut cx.state.assignments);
        assignments.sort_by_key(|it| (it.span().start, Reverse(it.span().end)));

        let mut infos: Vec<(Class<'a>, ReportInfo<'a>)> = Vec::new();
        for e in assignments {
            let Some(class) = enclosing_class_body(e) else {
                continue;
            };
            let at = infos.iter().position(|it| it.0 == class).unwrap_or_else(|| {
                infos.push((class, ReportInfo::default()));
                infos.len() - 1
            });
            let Some((_, info)) = infos.get_mut(at) else {
                continue;
            };

            let function = ast_utils::get_upper_function(e);
            let constructor = match function.and_then(call_around_arrow) {
                Some(call) => ast_utils::get_upper_function(call),
                None => function,
            };
            if let Some(constructor) = constructor.filter(|it| is_constructor_function_expression(*it)) {
                check_in_constructor(e, constructor, info);
            }

            if let ExprKind::Assign { target, .. } = e.kind()
                && let Some(name) = get_property_name(target)
                && is_in_field_initializer(e, function)
            {
                info.assigned_before_constructor.push(name);
            }
        }

        for (_, info) in &infos {
            for (name, e) in &info.unnecessary_assignments {
                if !info.assigned_before_constructor.contains(name) {
                    cx.report(*e, UNNECESSARY_ASSIGN);
                }
            }
        }
    }
}

impl Rule for NoUnnecessaryParameterPropertyAssignment {
    const META: Meta =
        Meta::typescript("no-unnecessary-parameter-property-assignment", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnnecessaryParameterPropertyAssignment
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.has_classes() {
            // Listeners run in the order they are registered in.
            on.params(|_, param, cx| {
                if param.is_parameter_property() {
                    cx.state.has_parameter_properties = true;
                }
            });
            on.exprs([ExprTag::Assign], Self::collect);
            on.finish(Self::finish);
        }
        State::default()
    }
}
