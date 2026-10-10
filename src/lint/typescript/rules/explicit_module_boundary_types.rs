use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::{
    ReturnTypeOptions, ancestor_has_return_type, check_function_expression_return_type,
    check_function_return_type, does_immediately_return_function_expression,
    is_typed_function_expression,
};
use crate::rules::no_invalid_void_type::OverloadSignatures;
use bun_lint::utils::ts_utils::is_static_member_access_of_value;
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
const MISSING_ARG_TYPE_UNNAMED: Message =
    Message::new("missingArgTypeUnnamed", "{{type}} argument should be typed.");
const MISSING_RETURN_TYPE: Message =
    Message::new("missingReturnType", "Missing return type on function.");

impl ExplicitModuleBoundaryTypes {
    /// Upstream's `isAllowedName`, of the function declaration `func` or of the parent of the
    /// function expression `func`.
    fn is_allowed_name(&self, func: Func) -> bool {
        if self.allowed_names.is_empty() {
            return false;
        }
        let is_allowed = |name: Option<Name>| {
            name.is_some_and(|name| self.allowed_names.iter().any(|allowed| **allowed == *name.bytes()))
        };
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
}

/// The key, if oxlint has a name for it.
fn oxlint_named_key<'a>(key: Option<Key<'a>>, file: &File<'a>) -> Option<Span> {
    let key = key?;
    matches!(key.kind(), KeyKind::Ident(_) | KeyKind::String(_) | KeyKind::ComputedString(_))
        .then(|| key.inner_span(file))
}

/// What oxlint calls the target of a function: the nearest name around it. Whether it is the key of a property.
fn oxlint_target(func: Func) -> Option<(Span, bool)> {
    if let Some(name) = func.name() {
        return Some((name.span(), false));
    }
    let file = func.file();
    for node in Node::Func(func).ancestors() {
        let name = match node {
            Node::Member(member) => {
                if let Some(key) = oxlint_named_key(member.key(), file) {
                    return Some((key, true));
                }
                // The name of the class is forgotten after the first member that has a name.
                let Node::Class(class) = member.parent() else {
                    return None;
                };
                let mut before = class.members().iter().take_while(|&it| it != member);
                if before.any(|it| oxlint_named_key(it.key(), file).is_some()) {
                    return None;
                }
                class.name()
            }
            Node::Prop(prop) => match oxlint_named_key(prop.key(), file) {
                Some(key) => return Some((key, true)),
                None => continue,
            },
            Node::VarDecl(declarator) => {
                let pat = declarator.pat();
                return (pat.tag() == PatTag::Ident).then(|| (pat.span(), false));
            }
            Node::Func(around) => around.name(),
            Node::Class(class) => class.name(),
            _ => None,
        };
        if let Some(name) = name {
            return Some((name.span(), false));
        }
    }
    None
}

/// Where oxlint points for a function without a return type: at its target. But for an arrow function that is in no
/// other function and is not the value of a property, at the `=>`. Without a target, at the parameters of an arrow
/// function and at the start of another function.
fn oxlint_place(func: Func) -> Span {
    let start = func.estree_span().start;
    match (oxlint_target(func), func.arrow_span()) {
        (Some((key, true)), _) => key,
        (_, Some(arrow)) if func.enclosing().is_none() => arrow,
        (Some((name, _)), _) => name,
        (None, Some(arrow)) => func.params_span().unwrap_or(arrow),
        (None, None) => Span::new(start, start + "function".len() as u32),
    }
}

struct Checker<'a, 'c> {
    rule: &'c ExplicitModuleBoundaryTypes,
    cx: &'c Cx<'a, ExplicitModuleBoundaryTypes>,
    /// Upstream's `alreadyVisited`.
    visited: FxHashSet<Node<'a>>,
    /// The variables whose declarations and values have been checked, which are all in `visited`.
    followed: FxHashSet<Symbol<'a>>,
    /// The expressions that are still to be checked.
    pending: Vec<Expr<'a>>,
    overloads: OverloadSignatures<'a>,
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
        let Some(variable) = at.scope().get_name(name).filter(|it| self.followed.insert(*it)) else {
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
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor,
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
        // oxlint says nothing about the return type of what has no body.
        if !member.is_constructor()
            && member.kind() != MemberKind::Setter
            && func.return_type().is_none()
            && !self.cx.language().is_oxlint
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
        if self.rule.is_allowed_name(func)
            || is_typed_function_expression(func, self.rule.options)
            || ancestor_has_return_type(func)
        {
            return;
        }
        if self.rule.allow_overload_functions
            && let Node::Member(member) = func.owner()
            && !member.flags().contains(Flags::ABSTRACT)
            && self.overloads.has(Node::Member(member))
        {
            return;
        }
        check_function_expression_return_type(func, self.options_for(func), |loc| {
            self.cx.report(if self.cx.language().is_oxlint { oxlint_place(func) } else { loc }, MISSING_RETURN_TYPE);
        });
        self.check_parameters(func);
    }

    /// For a function declaration. One without a body is a `TSDeclareFunction`.
    fn check_function(&mut self, func: Func<'a>) {
        if !func.has_body() || !self.visited.insert(Node::Func(func)) {
            return;
        }
        self.checked.push(func);
        if self.rule.is_allowed_name(func) || ancestor_has_return_type(func) {
            return;
        }
        if self.rule.allow_overload_functions && self.overloads.has(Node::Func(func)) {
            return;
        }
        check_function_return_type(func, self.options_for(func), |loc| {
            self.cx.report(if self.cx.language().is_oxlint { oxlint_place(func) } else { loc }, MISSING_RETURN_TYPE);
        });
        self.check_parameters(func);
    }

    fn check_parameters(&self, func: Func<'a>) {
        let is_oxlint = self.cx.language().is_oxlint;
        for param in func.params_with_this() {
            // It has the type of its default value. oxlint does not look at `this`.
            if param.default().is_some() || is_oxlint && func.this_param() == Some(param) {
                continue;
            }
            let (named, unnamed) = match param.ty() {
                None => (MISSING_ARG_TYPE, MISSING_ARG_TYPE_UNNAMED),
                Some(ty)
                    if !self.rule.allow_arguments_explicitly_typed_as_any
                        && matches!(ty.kind(), TypeKind::Keyword(Keyword::Any)) =>
                {
                    (ANY_TYPED_ARG, ANY_TYPED_ARG_UNNAMED)
                }
                Some(_) => continue,
            };
            // oxlint points at the parameter with its modifiers, and for a rest parameter at all parameters.
            let at = match (is_oxlint, param.is_rest()) {
                (false, _) => param.span_without_modifiers(),
                (true, false) => param.span(),
                (true, true) => func.params_span().unwrap_or_else(|| param.span()),
            };
            let pattern = match (param.pat().kind(), param.is_rest()) {
                (PatKind::Ident(name), _) => {
                    self.cx.report(at, named).data("name", name);
                    continue;
                }
                (PatKind::Missing, _) => continue,
                (_, true) => "Rest",
                (PatKind::Array(_), false) => "Array pattern",
                (PatKind::Object(_), false) => "Object pattern",
            };
            self.cx.report(at, unnamed).data("type", pattern);
        }
    }
}

impl Rule for ExplicitModuleBoundaryTypes {
    const META: Meta = Meta::typescript("explicit-module-boundary-types", Kind::Problem);
    const ON: On = On::new()
        .stmts(&[
            StmtTag::Var,
            StmtTag::Fn,
            StmtTag::Class,
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

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Vec<Stmt<'a>>> {
        Some(Vec::new())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.tag() {
            StmtTag::Var | StmtTag::Fn | StmtTag::Class => {
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
        // The order in which upstream leaves them.
        utils::sort::sort_unstable_by_key(&mut exports, |statement| statement.span().end);
        let mut checker = Checker {
            rule: self,
            cx,
            visited: FxHashSet::default(),
            followed: FxHashSet::default(),
            pending: Vec::new(),
            overloads: OverloadSignatures::default(),
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
