use bun_lint::prelude::*;
use bun_lint::types::IdSet;
use bun_lint::utils::oxlint::{member_key_name, property_key_name};
use bun_lint::utils::ts_scope::{
    ReturnTypeOptions, ancestor_has_return_type, check_function_expression_return_type,
    check_function_return_type, does_immediately_return_function_expression,
    is_typed_function_expression,
};
use bun_lint::utils::ts_utils::{has_overload_signatures, is_static_member_access_of_value};
use rustc_hash::FxHashSet;

/// Require explicit return and argument types on exported functions' and classes' public class
/// methods.
pub struct ExplicitModuleBoundaryTypes {
    allow_arguments_explicitly_typed_as_any: bool,
    allowed_names: Vec<Box<[u8]>>,
    allow_overload_functions: bool,
    options: ReturnTypeOptions,
}

const ANY_TYPED_ARG: Message = Message::new(
    "anyTypedArg",
    "Argument '{{name}}' should be typed with a non-any type.",
);
const ANY_TYPED_ARG_UNNAMED: Message = Message::new(
    "anyTypedArgUnnamed",
    "{{type}} argument should be typed with a non-any type.",
);
const MISSING_ARG_TYPE: Message =
    Message::new("missingArgType", "Argument '{{name}}' should be typed.");
const MISSING_ARG_TYPE_UNNAMED: Message = Message::new(
    "missingArgTypeUnnamed",
    "{{type}} argument should be typed.",
);
const MISSING_RETURN_TYPE: Message =
    Message::new("missingReturnType", "Missing return type on function.");

impl ExplicitModuleBoundaryTypes {
    /// Upstream's `isAllowedName`, of the function declaration `func` or of the parent of the
    /// function expression `func`.
    fn is_allowed_name(&self, func: Func) -> bool {
        if self.allowed_names.is_empty() {
            return false;
        }
        let is_allowed = |name: Option<Name>| self.allows(name.map(Name::bytes));
        match func.owner() {
            Node::Stmt(_) => is_allowed(func.name().map(Ident::name)),
            Node::Member(member) => is_static_member_access_of_value(member, &self.allowed_names),
            Node::Expr(e) => match e.parent() {
                Node::VarDecl(declaration) => is_allowed(declaration.pat().as_ident()),
                Node::Member(member) if member.init() == Some(e) => {
                    is_static_member_access_of_value(member, &self.allowed_names)
                }
                Node::Prop(prop) if prop.kind() == PropKind::Method => {
                    is_static_member_access_of_value(prop, &self.allowed_names)
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn allows(&self, name: Option<&[u8]>) -> bool {
        name.is_some_and(|name| self.allowed_names.iter().any(|allowed| **allowed == *name))
    }

    /// The parameters without a type, or with `any`, each with the message if it has a name and the one if it has none.
    fn untyped_parameters<'a>(
        &self,
        func: Func<'a>,
        is_oxlint: bool,
    ) -> impl Iterator<Item = (Param<'a>, Message, Message)> {
        let allows_any = self.allow_arguments_explicitly_typed_as_any;
        func.params_with_this().filter_map(move |param| {
            // It has the type of its default value. oxlint looks at the annotation first, and not at `this`.
            if param.default().is_some() && !(is_oxlint && param.ty().is_some())
                || is_oxlint && func.this_param() == Some(param)
            {
                return None;
            }
            match param.ty() {
                None => Some((param, MISSING_ARG_TYPE, MISSING_ARG_TYPE_UNNAMED)),
                Some(ty) if !allows_any && ty.is_keyword(Keyword::Any) => {
                    Some((param, ANY_TYPED_ARG, ANY_TYPED_ARG_UNNAMED))
                }
                Some(_) => None,
            }
        })
    }

    /// `export`: for oxlint, the export that has led to `func`, which its rule is called with.
    fn check_parameters<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>, export: Option<Node<'a>>) {
        let is_oxlint = cx.language().is_oxlint;
        let report = |at: Span, message: Message| match export {
            Some(export) => cx.report(at, message).called_with(export),
            None => cx.report(at, message),
        };
        for (param, named, unnamed) in self.untyped_parameters(func, is_oxlint) {
            // oxlint points at the parameter with its modifiers, and for a rest parameter at all parameters.
            let at = match (is_oxlint, param.is_rest()) {
                (false, _) => param.span_without_modifiers(),
                (true, false) => param.span(),
                (true, true) => func.params_span().unwrap_or_else(|| param.span()),
            };
            let pattern = match (param.pat().kind(), param.is_rest()) {
                (PatKind::Ident(name), _) => {
                    report(at, named).data("name", name);
                    continue;
                }
                (PatKind::Missing, _) => continue,
                (_, true) => "Rest",
                (PatKind::Array(_), false) => "Array pattern",
                (PatKind::Object(_), false) => "Object pattern",
            };
            report(at, unnamed).data("type", pattern);
        }
    }
}

/// typescript-eslint's rule.
struct Checker<'a, 'c> {
    rule: &'c ExplicitModuleBoundaryTypes,
    cx: &'c Cx<'a, ExplicitModuleBoundaryTypes>,
    /// Upstream's `alreadyVisited`.
    visited: FxHashSet<Node<'a>>,
    /// The variables whose declarations and values have been checked, which are all in `visited`.
    followed: IdSet<Symbol<'a>>,
    /// The expressions that are still to be checked.
    pending: Vec<Expr<'a>>,
    /// Upstream's `checkedFunctions`.
    checked: Vec<Func<'a>>,
    /// Upstream collects the `return` statements while it walks the file, and checks what is
    /// exported when it leaves the export: a function that starts after this has none yet.
    returns_known_until: u32,
}

impl<'a> Checker<'a, '_> {
    fn check_export(&mut self, statement: Stmt<'a>) {
        match statement.kind() {
            StmtKind::Var(declarations) => {
                for declaration in declarations {
                    self.check_variable_declarator(declaration);
                }
            }
            StmtKind::Fn(func) => self.check_function(func),
            StmtKind::Class(class) => self.check_class(class),
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => self.check_expr(e),
            StmtKind::ExportNamed(export) => {
                for specifier in export.items() {
                    self.follow_reference(Node::ExportSpec(specifier), specifier.local().name());
                }
            }
            _ => {}
        }
        self.check_pending();
    }

    /// What upstream does at `Program:exit`. It goes up from every function to one that has been
    /// checked, this goes down from these.
    fn check_exported_higher_order_functions(&mut self) {
        let mut next = 0;
        while let Some(&func) = self.checked.get(next) {
            next += 1;
            if !does_immediately_return_function_expression(func) {
                continue;
            }
            if let FnBody::Expr(body) = func.body() {
                self.check_expr(body);
            }
            for statement in func.returns() {
                // Upstream takes the parent of a `return` for the body of the function.
                if statement.parent() == Node::Func(func)
                    && let StmtKind::Return(Some(value)) = statement.kind()
                {
                    self.check_expr(value);
                }
            }
            self.check_pending();
        }
    }

    /// `at`: the identifier `name`.
    fn follow_reference(&mut self, at: Node<'a>, name: Name<'a>) {
        let Some(variable) = at
            .scope()
            .get_name(name)
            .filter(|it| self.followed.insert(*it))
        else {
            return;
        };
        for declaration in variable.declarations() {
            match declaration {
                Declaration::Var(_) if !declaration.is_catch_parameter() => {
                    if let Some(Node::VarDecl(declarator)) = declaration.node() {
                        self.check_variable_declarator(declarator);
                    }
                }
                Declaration::Fn(func) if func.kind() == FnKind::Decl => self.check_function(func),
                Declaration::Fn(func) => self.check_function_expression(func),
                Declaration::Class(class) => self.check_class(class),
                _ => {}
            }
        }
        for reference in variable.references() {
            // The initializer is checked with the declaration.
            if !reference.is_init()
                && let Some(value) = reference.write_expr()
            {
                self.check_expr(value);
            }
        }
    }

    /// Upstream's `checkNode`, for an expression. It is checked by [`Self::check_pending`]: the order makes no difference, as
    /// nothing is checked twice.
    fn check_expr(&mut self, e: Expr<'a>) {
        self.pending.push(e);
    }

    fn check_pending(&mut self) {
        while let Some(e) = self.pending.pop() {
            self.check_expr_now(e);
        }
    }

    fn check_expr_now(&mut self, e: Expr<'a>) {
        match e.kind() {
            ExprKind::Fn(func) => self.check_function_expression(func),
            ExprKind::Class(class) => self.check_class(class),
            ExprKind::Array(elements) if self.visited.insert(Node::Expr(e)) => {
                for element in elements {
                    self.check_expr(element);
                }
            }
            ExprKind::Object(properties) if self.visited.insert(Node::Expr(e)) => {
                for property in properties {
                    if property.kind() != PropKind::Spread
                        && let Some(value) = property.value()
                    {
                        self.check_expr(value);
                    }
                }
            }
            ExprKind::Ident(name) if self.visited.insert(Node::Expr(e)) => {
                self.follow_reference(Node::Expr(e), name);
            }
            _ => {}
        }
    }

    fn check_variable_declarator(&mut self, declarator: VarDecl<'a>) {
        if self.visited.insert(Node::VarDecl(declarator))
            && let Some(init) = declarator.init()
        {
            self.check_expr(init);
        }
    }

    fn check_class(&mut self, class: Class<'a>) {
        if !self.visited.insert(Node::Class(class)) {
            return;
        }
        for member in class.members() {
            let flags = member.flags();
            if flags.contains(Flags::PRIVATE) || member.key().is_some_and(Key::is_private) {
                continue;
            }
            match (member.kind(), member.func()) {
                (MemberKind::Property, _) if !flags.contains(Flags::ABSTRACT) => {
                    if let Some(value) = member.init() {
                        self.check_expr(value);
                    }
                }
                (
                    MemberKind::Method
                    | MemberKind::Getter
                    | MemberKind::Setter
                    | MemberKind::Constructor,
                    Some(func),
                ) => match func.has_body() {
                    true => self.check_function_expression(func),
                    false => self.check_empty_body_function_expression(member, func),
                },
                _ => {}
            }
        }
    }

    fn check_empty_body_function_expression(&self, member: Member<'a>, func: Func<'a>) {
        if !member.is_constructor()
            && member.kind() != MemberKind::Setter
            && func.return_type().is_none()
        {
            self.cx.report(func.estree_span(), MISSING_RETURN_TYPE);
        }
        self.check_parameters(func);
    }

    /// The options with which the function is looked at as upstream sees it at this point.
    fn options_for(&self, func: Func<'a>) -> ReturnTypeOptions {
        let mut options = self.rule.options;
        if func.span().start >= self.returns_known_until
            && !matches!(func.body(), FnBody::Expr(body) if body.as_fn().is_some())
        {
            options.allow_higher_order_functions = false;
        }
        options
    }

    fn check_function_expression(&mut self, func: Func<'a>) {
        if !func.has_body() || !self.visited.insert(Node::Func(func)) {
            return;
        }
        self.checked.push(func);
        if self.is_fully_typed(func) {
            return;
        }
        if self.rule.is_allowed_name(func)
            || is_typed_function_expression(func, self.rule.options)
            || ancestor_has_return_type(func)
        {
            return;
        }
        if self.rule.allow_overload_functions
            && let Node::Member(member) = func.owner()
            && !member.flags().contains(Flags::ABSTRACT)
            && has_overload_signatures(Node::Member(member))
        {
            return;
        }
        check_function_expression_return_type(func, self.options_for(func), |loc| {
            self.cx.report(loc, MISSING_RETURN_TYPE);
        });
        self.check_parameters(func);
    }

    /// For a function declaration. One without a body is a `TSDeclareFunction`.
    fn check_function(&mut self, func: Func<'a>) {
        if !func.has_body() || !self.visited.insert(Node::Func(func)) {
            return;
        }
        self.checked.push(func);
        if self.is_fully_typed(func) {
            return;
        }
        if self.rule.is_allowed_name(func) || ancestor_has_return_type(func) {
            return;
        }
        if self.rule.allow_overload_functions && has_overload_signatures(Node::Func(func)) {
            return;
        }
        check_function_return_type(func, self.options_for(func), |loc| {
            self.cx.report(loc, MISSING_RETURN_TYPE);
        });
        self.check_parameters(func);
    }

    /// There is nothing to say about it, whatever it is part of.
    fn is_fully_typed(&self, func: Func<'a>) -> bool {
        func.return_type().is_some() && self.rule.untyped_parameters(func, false).next().is_none()
    }

    fn check_parameters(&self, func: Func<'a>) {
        self.rule.check_parameters(func, self.cx, None);
    }
}

/// What oxlint points at for a function that has no name, and asks `allowedNames` about: the variable, the class or the
/// key that it was last under.
#[derive(Copy, Clone)]
struct Target<'a> {
    span: Span,
    name: &'a [u8],
    is_property: bool,
}

enum Step<'a> {
    Visit(Node<'a>),
    WalkClass(Class<'a>),
    AssignmentTarget(Expr<'a>),
    Statements(List<'a, Stmt<'a>>),
    ForgetTarget,
    InSetter(bool),
    Overloaded(IdSet<Member<'a>>),
    /// `place`: where it lacks a return type, unless it returns a function.
    LeaveFunction {
        place: Option<Span>,
        forgets_target: bool,
    },
    LeaveClass,
}

/// oxlint's rule, its `ExplicitTypesChecker`. It goes down from what is exported, through every expression but calls and
/// JSX elements, and judges each function that it comes to. An identifier it follows only where that is the export.
struct OxlintChecker<'a, 'c> {
    rule: &'c ExplicitModuleBoundaryTypes,
    cx: &'c Cx<'a, ExplicitModuleBoundaryTypes>,
    /// The export that is being checked.
    export: Node<'a>,
    /// What is still to be done, the next at the end.
    steps: Vec<Step<'a>>,
    /// It is forgotten after what has set it, not set back.
    target: Option<Target<'a>>,
    /// The functions around, and the classes that [`Step::WalkClass`] went into. Whether a `return` of the function
    /// has a function.
    around: Vec<bool>,
    in_setter: bool,
    /// With `allowOverloadFunctions`, the methods of the class around that have overload signatures.
    overloaded: IdSet<Member<'a>>,
}

/// oxlint's `get_typed_inner_expression`
fn get_typed_inner_expression(mut e: Expr<'_>) -> Expr<'_> {
    while let ExprKind::NonNull(inner) = e.kind() {
        e = inner;
    }
    e
}

/// oxlint's `function_has_overload_signatures`: a declaration of the same variable has no body. For a function without
/// a name, an `export default function ();` of the file.
fn function_has_overload_signatures<'a>(func: Func<'a>) -> bool {
    let is_signature = |other: Func<'a>| other != func && !other.has_body();
    match func.name() {
        Some(_) => func.symbol().is_some_and(|symbol| {
            symbol
                .declarations()
                .any(|it| matches!(it, Declaration::Fn(other) if is_signature(other)))
        }),
        None => func.file().body().iter().any(|statement| {
            statement.is_default_export()
                && statement
                    .as_fn()
                    .is_some_and(|other| other.name().is_none() && is_signature(other))
        }),
    }
}

/// oxlint's `collect_overloaded_methods`
fn overloaded_methods(class: Class<'_>) -> IdSet<Member<'_>> {
    let methods = || {
        class.members().iter().filter_map(|member| {
            let is_method = matches!(
                member.kind(),
                MemberKind::Method
                    | MemberKind::Getter
                    | MemberKind::Setter
                    | MemberKind::Constructor
            );
            let func = member
                .func()
                .filter(|_| is_method && !member.key().is_some_and(Key::is_private))?;
            Some((
                member,
                func.has_body(),
                (member.is_static(), member_key_name(member)?),
            ))
        })
    };
    let signatures: FxHashSet<_> = methods().filter(|it| !it.1).map(|it| it.2).collect();
    methods()
        .filter(|it| it.1 && signatures.contains(&it.2))
        .map(|it| it.0)
        .collect()
}

impl<'a> OxlintChecker<'a, '_> {
    fn check_export(&mut self, statement: Stmt<'a>) {
        self.export = Node::Stmt(statement);
        self.visit(statement);
        while let Some(step) = self.steps.pop() {
            let first = self.steps.len();
            self.step(step);
            if let Some(added) = self.steps.get_mut(first..) {
                added.reverse();
            }
        }
    }

    fn visit(&mut self, node: impl Into<Node<'a>>) {
        self.steps.push(Step::Visit(node.into()));
    }

    fn visit_all<T: Into<Node<'a>>>(&mut self, nodes: impl IntoIterator<Item = T>) {
        self.steps
            .extend(nodes.into_iter().map(|it| Step::Visit(it.into())));
    }

    fn step(&mut self, step: Step<'a>) {
        match step {
            Step::Visit(Node::Stmt(statement)) => self.visit_export(statement),
            Step::Visit(Node::VarDecl(declarator)) => self.visit_variable_declarator(declarator),
            Step::Visit(Node::Expr(e)) => self.visit_expression(e),
            Step::Visit(Node::Prop(prop)) => self.visit_object_property(prop),
            Step::Visit(Node::Func(func)) => self.visit_function(func),
            Step::Visit(Node::Class(class)) => self.visit_class(class),
            Step::Visit(Node::Member(member)) => self.visit_class_element(member),
            Step::Visit(_) => {}
            Step::WalkClass(class) => {
                self.around.push(false);
                self.visit_all(class.decorators());
                self.visit_all(class.extends());
                self.visit_all(class.members());
                self.steps.push(Step::LeaveClass);
            }
            Step::AssignmentTarget(e) => self.visit_assignment_target(e),
            Step::Statements(statements) => self.visit_statements(statements),
            Step::ForgetTarget => self.target = None,
            Step::InSetter(was) => self.in_setter = was,
            Step::Overloaded(was) => self.overloaded = was,
            Step::LeaveFunction {
                place,
                forgets_target,
            } => {
                let returns_function = self.around.pop() == Some(true);
                if let Some(place) = place.filter(|_| !returns_function) {
                    self.cx
                        .report(place, MISSING_RETURN_TYPE)
                        .called_with(self.export);
                }
                if forgets_target {
                    self.target = None;
                }
            }
            Step::LeaveClass => {
                self.around.pop();
            }
        }
    }

    fn visit_export(&mut self, statement: Stmt<'a>) {
        match statement.kind() {
            StmtKind::Var(declarations) => self.visit_all(declarations),
            StmtKind::Fn(func) => self.visit(func),
            StmtKind::Class(class) if statement.is_default_export() => {
                self.steps.push(Step::WalkClass(class))
            }
            StmtKind::Class(class) => self.visit(class),
            StmtKind::Enum(it) => self.visit_all(it.members().iter().filter_map(EnumMember::init)),
            StmtKind::Module(module) => {
                self.steps.push(Step::Statements(module.innermost().body()))
            }
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                self.run_on_exported_expression(e, true)
            }
            StmtKind::ExportNamed(export) => {
                for specifier in export.items() {
                    let scope = Node::ExportSpec(specifier).scope();
                    self.run_on_identifier_reference(scope.resolve_name(specifier.local().name()));
                }
            }
            _ => {}
        }
    }

    /// `is_export`: not an element or a property of what is exported.
    fn run_on_exported_expression(&mut self, e: Expr<'a>, is_export: bool) {
        let e = get_typed_inner_expression(e);
        match e.kind() {
            ExprKind::Ident(_) => self.run_on_identifier_reference(e.symbol()),
            ExprKind::Fn(func) => self.visit(func),
            ExprKind::Array(elements) if is_export => {
                for element in elements {
                    self.run_on_exported_expression(element, false);
                }
            }
            ExprKind::Object(properties) if is_export => {
                for property in properties.iter().filter(|it| it.kind() != PropKind::Spread) {
                    if let Some(value) = property.value() {
                        self.run_on_exported_expression(value, false);
                    }
                }
            }
            _ => {}
        }
    }

    /// It goes by the first declaration.
    fn run_on_identifier_reference(&mut self, symbol: Option<Symbol<'a>>) {
        match symbol.and_then(|it| it.declarations().next()) {
            Some(declaration @ Declaration::Var(_)) if !declaration.is_catch_parameter() => {
                self.visit_all(declaration.node());
            }
            Some(Declaration::Fn(func)) => self.visit(func),
            Some(Declaration::Class(class)) => self.steps.push(Step::WalkClass(class)),
            _ => {}
        }
    }

    fn with_target_binding(&mut self, name: Option<Ident<'a>>) -> bool {
        if let Some(name) = name {
            self.target = Some(Target {
                span: name.span(),
                name: name.bytes(),
                is_property: false,
            });
        }
        name.is_some()
    }

    /// Not with a key whose name is nowhere in the file as it is, that of a number or a regular expression.
    fn with_target_property(&mut self, key: Option<Key<'a>>) -> bool {
        let Some(key) = key else {
            return false;
        };
        let span = key.inner_span(self.cx.file());
        let is_written = match key.kind() {
            KeyKind::Private(_) | KeyKind::ComputedNumber(_) => false,
            KeyKind::Number(_) => self.cx.file().slice(span).ends_with(b"n"),
            KeyKind::Computed(e) => e.tag() != ExprTag::Regex,
            _ => true,
        };
        let Some(name) = property_key_name(key).filter(|_| is_written) else {
            return false;
        };
        self.target = Some(Target {
            span,
            name,
            is_property: true,
        });
        true
    }

    fn visit_variable_declarator(&mut self, declarator: VarDecl<'a>) {
        if self.rule.options.allow_typed_function_expressions && declarator.ty().is_some() {
            return;
        }
        let (Some(init), pat) = (declarator.init(), declarator.pat()) else {
            return;
        };
        let Some(name) = pat
            .as_ident()
            .filter(|it| !self.rule.allows(Some(it.bytes())))
        else {
            return;
        };
        if !matches!(
            get_typed_inner_expression(init).tag(),
            ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies
        ) {
            self.target = Some(Target {
                span: pat.span(),
                name: name.bytes(),
                is_property: false,
            });
            self.visit(init);
            self.steps.push(Step::ForgetTarget);
        }
    }

    fn visit_expression(&mut self, e: Expr<'a>) {
        match e.kind() {
            ExprKind::Call(_) => {}
            ExprKind::Jsx(jsx) if !jsx.is_fragment() => {}
            ExprKind::New(call) => self.visit(call.callee()),
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Satisfies { expr, .. }
                if matches!(
                    get_typed_inner_expression(expr).tag(),
                    ExprTag::Fn | ExprTag::Object | ExprTag::Array
                ) => {}
            ExprKind::Assign { target, value, .. } => {
                self.steps.push(Step::AssignmentTarget(target));
                self.visit(value);
            }
            _ => Node::Expr(e).for_each_child(|child| self.visit(child)),
        }
    }

    /// The properties of a pattern are no properties for oxlint.
    fn visit_assignment_target(&mut self, e: Expr<'a>) {
        match e.kind() {
            _ if e.is_parenthesized() => self.visit_expression(e),
            ExprKind::Array(elements) => self
                .steps
                .extend(elements.iter().map(Step::AssignmentTarget)),
            ExprKind::Object(properties) => {
                for property in properties {
                    self.visit_all(property.computed_key());
                    self.steps
                        .extend(property.value().map(Step::AssignmentTarget));
                }
            }
            ExprKind::Spread(rest) => self.steps.push(Step::AssignmentTarget(rest)),
            _ => self.visit_expression(e),
        }
    }

    /// Of statements it looks at the `return`s, or at the only one.
    fn visit_statements(&mut self, statements: List<'a, Stmt<'a>>) {
        let mut rest = statements.iter().skip_while(|it| it.directive().is_some());
        if let (Some(only), None) = (rest.next(), rest.next())
            && let Some(e) = only.as_expr()
        {
            return self.visit(e);
        }
        for value in statements.iter().filter_map(Stmt::as_return).flatten() {
            if value.as_fn().is_some()
                && !value.is_parenthesized()
                && let Some(returns_function) = self.around.last_mut()
            {
                *returns_function = true;
            }
            self.visit(value);
        }
    }

    fn visit_object_property(&mut self, prop: Prop<'a>) {
        if prop.kind() == PropKind::Spread {
            return self.visit_all(prop.value());
        }
        let was_in_setter = self.in_setter;
        self.in_setter |= prop.kind() == PropKind::Setter;
        let has_name = self.with_target_property(prop.key());
        self.visit_all(prop.computed_key());
        self.visit_all(prop.value());
        self.steps.push(Step::InSetter(was_in_setter));
        if has_name {
            self.steps.push(Step::ForgetTarget);
        }
    }

    fn visit_class(&mut self, class: Class<'a>) {
        let has_name = self.with_target_binding(class.name());
        self.visit_all(class.members());
        if self.rule.allow_overload_functions {
            let was = std::mem::replace(&mut self.overloaded, overloaded_methods(class));
            self.steps.push(Step::Overloaded(was));
        }
        if has_name {
            self.steps.push(Step::ForgetTarget);
        }
    }

    fn visit_class_element(&mut self, member: Member<'a>) {
        let (kind, flags) = (member.kind(), member.flags());
        if flags.contains(Flags::PRIVATE)
            || member.key().is_some_and(Key::is_private)
            || kind == MemberKind::Property
                && !flags.contains(Flags::ACCESSOR)
                && member.ty().is_some()
            || self.rule.allows(member_key_name(member))
        {
            return;
        }
        let has_name = match member.constructor_keyword() {
            Some(keyword) => {
                self.target = Some(Target {
                    span: keyword.span(),
                    name: keyword.bytes(),
                    is_property: true,
                });
                true
            }
            None => self.with_target_property(member.key()),
        };
        match (kind, member.func()) {
            (MemberKind::StaticBlock, Some(block)) => {
                self.steps
                    .extend(block.body_statements().map(Step::Statements));
            }
            (MemberKind::Method | MemberKind::Getter | MemberKind::Constructor, Some(func))
                if !member.is_constructor() && !self.overloaded.contains(member) =>
            {
                self.visit_all(member.decorators());
                self.visit_all(member.computed_key());
                self.visit(func);
            }
            (
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor,
                Some(func),
            ) => self.rule.check_parameters(func, self.cx, Some(self.export)),
            (MemberKind::Property, _) => {
                self.visit_all(member.decorators());
                self.visit_all(member.computed_key());
                self.visit_all(member.init());
            }
            _ => {}
        }
        if has_name {
            self.steps.push(Step::ForgetTarget);
        }
    }

    fn visit_function(&mut self, func: Func<'a>) {
        let forgets_target = self.with_target_binding(func.name());
        self.around.push(false);
        self.rule.check_parameters(func, self.cx, Some(self.export));
        let place = match func.return_type() {
            Some(_) => None,
            None if func.is_arrow() => self.check_arrow_without_return(func),
            None if self.in_setter => None,
            None => self.check_function_without_return(func),
        };
        self.steps.push(Step::LeaveFunction {
            place,
            forgets_target,
        });
    }

    fn check_function_without_return(&mut self, func: Func<'a>) -> Option<Span> {
        let body = func.body_statements()?;
        if self.rule.allow_overload_functions && function_has_overload_signatures(func) {
            return None;
        }
        if self.rule.options.allow_higher_order_functions {
            self.steps.push(Step::Statements(body));
        }
        let name = func
            .name()
            .map(Ident::bytes)
            .or_else(|| self.target.map(|it| it.name));
        let start = func.estree_span().start;
        let keyword = || Span::new(start, start + "function".len() as u32);
        (!self.rule.allows(name)).then(|| self.target.map_or_else(keyword, |it| it.span))
    }

    fn check_arrow_without_return(&mut self, arrow: Func<'a>) -> Option<Span> {
        let place = match self.target {
            Some(Target {
                span,
                is_property: true,
                ..
            }) => Some(span),
            _ if self.around.len() == 1 => arrow.arrow_span(),
            Some(target) => Some(target.span),
            None => arrow.params_span().or_else(|| arrow.arrow_span()),
        };
        let unless_allowed = place.filter(|_| !self.rule.allows(self.target.map(|it| it.name)));
        let body = match arrow.body() {
            FnBody::Expr(body) if self.rule.options.allow_higher_order_functions => body,
            FnBody::Block(statements) if self.rule.options.allow_higher_order_functions => {
                self.steps.push(Step::Statements(statements));
                return unless_allowed;
            }
            _ => return unless_allowed,
        };
        let mut inner = get_typed_inner_expression(body);
        while let Some((expr, _)) = inner.as_satisfies() {
            inner = get_typed_inner_expression(expr);
        }
        match inner.tag() {
            ExprTag::AsConst
                if self
                    .rule
                    .options
                    .allow_direct_const_assertion_in_arrow_functions
                    && !inner.is_angle_bracket_assertion() =>
            {
                None
            }
            ExprTag::Fn => {
                self.visit(body);
                None
            }
            // `allowedNames` is not asked.
            _ => place,
        }
    }
}
impl Rule for ExplicitModuleBoundaryTypes {
    const META: Meta =
        Meta::typescript("explicit-module-boundary-types", Kind::Problem).reports_on_exit();
    const ON: On = On::new()
        .stmts(&[
            StmtTag::Var,
            StmtTag::Fn,
            StmtTag::Class,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ExportDefault,
            StmtTag::ExportAssign,
            StmtTag::ExportNamed,
        ])
        .finish();
    /// The statements that export something of this file.
    type State<'a> = Vec<Stmt<'a>>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        ExplicitModuleBoundaryTypes {
            allow_arguments_explicitly_typed_as_any: object
                .bool_or("allowArgumentsExplicitlyTypedAsAny", false),
            allowed_names: (object.strings("allowedNames").into_iter())
                .map(|name| name.as_bytes().into())
                .collect(),
            allow_overload_functions: object.bool_or("allowOverloadFunctions", false),
            options: ReturnTypeOptions {
                allow_direct_const_assertion_in_arrow_functions: object
                    .bool_or("allowDirectConstAssertionInArrowFunctions", true),
                allow_expressions: false,
                allow_higher_order_functions: object.bool_or("allowHigherOrderFunctions", true),
                allow_typed_function_expressions: object
                    .bool_or("allowTypedFunctionExpressions", true),
            },
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match file.language().is_oxlint {
            true => Self::ON,
            false => On::new()
                .stmts(&[
                    StmtTag::Var,
                    StmtTag::Fn,
                    StmtTag::Class,
                    StmtTag::ExportDefault,
                    StmtTag::ExportAssign,
                    StmtTag::ExportNamed,
                ])
                .finish(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Vec<Stmt<'a>>> {
        Some(Vec::new())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.tag() {
            StmtTag::Var | StmtTag::Fn | StmtTag::Class | StmtTag::Enum | StmtTag::Module => {
                if statement.is_exported() {
                    cx.state.push(statement);
                }
            }
            StmtTag::ExportDefault | StmtTag::ExportAssign => {
                cx.state.push(statement);
            }
            StmtTag::ExportNamed => {
                if matches!(statement.kind(), StmtKind::ExportNamed(export) if !export.has_from()) {
                    cx.state.push(statement);
                }
            }
            _ => {}
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut exports = std::mem::take(&mut cx.state);
        if exports.is_empty() {
            return;
        }
        if cx.language().is_oxlint {
            let mut checker = OxlintChecker {
                rule: self,
                cx,
                export: Node::File(cx.file()),
                steps: Vec::new(),
                target: None,
                around: Vec::new(),
                in_setter: false,
                overloaded: IdSet::default(),
            };
            return exports
                .into_iter()
                .for_each(|statement| checker.check_export(statement));
        }
        // The order in which upstream leaves them.
        utils::sort::sort_unstable_by_key(&mut exports, |statement| statement.span().end);
        let mut checker = Checker {
            rule: self,
            cx,
            visited: FxHashSet::default(),
            followed: IdSet::default(),
            pending: Vec::new(),
            checked: Vec::new(),
            returns_known_until: 0,
        };
        for statement in exports {
            checker.returns_known_until = statement.span().end;
            checker.check_export(statement);
        }
        checker.returns_known_until = u32::MAX;
        checker.check_exported_higher_order_functions();
    }
}
