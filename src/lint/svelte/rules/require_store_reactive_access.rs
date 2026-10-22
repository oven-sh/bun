use crate::stores::store_calls;
use crate::variables::{find_variable, owner_as};
use bun_lint::ast::svelte::variables::SvelteVariable;
use bun_lint::ast::svelte::{Role, SvelteFlags, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::Type;

/// disallow to use of the store itself as an operand. Need to use $ prefix or get function.
pub struct RequireStoreReactiveAccess;

const USING_RAW_STORE_IN_TEXT: Message = Message::new(
    "usingRawStoreInText",
    "Use the $ prefix or the get function to access reactive values instead of accessing the raw store.",
);

/// `createStoreCheckerForES`: the variables a `svelte/store` call initializes, each with whether it's a `const`.
pub struct State<'a> {
    stores: Vec<(SvelteVariable<'a>, bool)>,
}

/// How an operand is checked. With `consistent`, a union is a store only if each of its types is. With `fixes`, a store
/// that's an identifier gets its `$`.
#[derive(Copy, Clone)]
struct How {
    consistent: bool,
    fixes: bool,
}

const PLAIN: How = How {
    consistent: false,
    fixes: true,
};
const CONSISTENT: How = How {
    consistent: true,
    fixes: true,
};

impl RequireStoreReactiveAccess {
    /// `verifyExpression`
    fn verify<'a>(&self, e: Option<Expr<'a>>, how: How, cx: &mut Cx<'a, Self>) {
        let Some(e) = e else {
            return;
        };
        if !is_store(e, how.consistent, &cx.state.stores) {
            return;
        }
        let is_identifier = e.as_ident().is_some();
        cx.report(e, USING_RAW_STORE_IN_TEXT)
            .fix(|fixer| (is_identifier && how.fixes).then(|| fixer.insert_before(e, "$")));
    }

    /// The code `node` has in `role`, if it's a program expression.
    fn verify_code<'a>(&self, node: SvelteNode<'a>, role: Role, how: How, cx: &mut Cx<'a, Self>) {
        let e = node.code(role).and_then(|it| it.node()).and_then(Node::as_expr);
        self.verify(e, how, cx);
    }
}

/// `createStoreChecker`: by types where available, as `createStoreCheckerForTS`, otherwise by the `svelte/store` calls.
fn is_store<'a>(e: Expr<'a>, consistent: bool, stores: &[(SvelteVariable<'a>, bool)]) -> bool {
    if e.file().types().is_some() {
        return is_store_type(e, e.ty().get_apparent_type(), consistent);
    }
    let Some(name) = e.as_ident() else {
        return false;
    };
    if name.bytes().starts_with(b"$") {
        return false;
    }
    let Some(variable) = find_variable(e) else {
        return false;
    };
    let found = stores.iter().find(|it| it.0 == variable);
    found.is_some_and(|it| !consistent || it.1)
}

/// `isStoreType`: a type with a `subscribe` property that can be called with two callbacks.
fn is_store_type<'a>(at: Expr<'a>, ty: Type<'a>, consistent: bool) -> bool {
    each_type(ty, consistent, &mut |ty| {
        let Some(subscribe) = ty.get_property(b"subscribe") else {
            return false;
        };
        let subscribe = subscribe.get_type_at_location(at);
        each_type(subscribe, consistent, &mut |ty| {
            ty.get_call_signatures().iter().any(|signature| {
                let mut parameters = signature.parameters().iter();
                matches!((parameters.next(), parameters.next()), (Some(run), Some(invalidate))
                    if [run, invalidate].into_iter().all(|it| {
                        let ty = it.get_type_at_location(at).get_apparent_type();
                        each_type(ty, false, &mut |ty| !ty.get_call_signatures().is_empty())
                    }))
            })
        })
    })
}

/// `eachTypeCheck`: `check` on each type of a union, requiring all of them if `consistent`, otherwise one.
fn each_type<'a>(ty: Type<'a>, consistent: bool, check: &mut dyn FnMut(Type<'a>) -> bool) -> bool {
    if !ty.is_union() {
        return check(ty);
    }
    let mut types = ty.types().iter();
    match consistent {
        true => types.all(|it| each_type(it, consistent, check)),
        false => types.any(|it| each_type(it, consistent, check)),
    }
}

/// `canAcceptStoreAttributeElement`: an element whose attributes are props, a component.
fn accepts_store(element: Option<SvelteNode<'_>>) -> bool {
    let Some(element) = element.filter(|it| it.tag() == SvelteTag::Element) else {
        return false;
    };
    match element.kind() {
        SvelteKind::Html => false,
        SvelteKind::Special => element.name() != b"svelte:element",
        _ => true,
    }
}

/// An attribute's element: its start tag's parent.
fn element_of(attribute: SvelteNode<'_>) -> Option<SvelteNode<'_>> {
    attribute.parent()?.parent()
}

/// `canAcceptStoreMustache`
fn accepts_store_mustache(mustache: SvelteNode<'_>) -> bool {
    let Some(attribute) = mustache.parent().filter(|it| it.tag() == SvelteTag::Attribute) else {
        return false;
    };
    if attribute.nodes(Role::Value).count() > 1 || attribute.name().starts_with(b"--") {
        return false;
    }
    accepts_store(element_of(attribute))
}

impl Rule for RequireStoreReactiveAccess {
    const META: Meta = Meta::plugin(Plugin::Svelte, "require-store-reactive-access", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended()
        .uses_types();
    const ON: On = On::new()
        .stmts(&[
            StmtTag::If,
            StmtTag::While,
            StmtTag::DoWhile,
            StmtTag::For,
            StmtTag::ForIn,
            StmtTag::ForOf,
            StmtTag::Switch,
        ])
        .exprs(&[
            ExprTag::Cond,
            ExprTag::Call,
            ExprTag::New,
            ExprTag::Unary,
            ExprTag::Spread,
            ExprTag::Assign,
            ExprTag::Binary,
            ExprTag::Template,
            ExprTag::TaggedTemplate,
            ExprTag::ImportCall,
            ExprTag::Await,
        ])
        .members()
        .props()
        .pats(&[PatTag::Object])
        .svelte_nodes(&[
            SvelteTag::MustacheTag,
            SvelteTag::ShorthandAttribute,
            SvelteTag::SpreadAttribute,
            SvelteTag::Directive,
            SvelteTag::StyleDirective,
            SvelteTag::SpecialDirective,
            SvelteTag::IfBlock,
            SvelteTag::AwaitBlock,
            SvelteTag::EachBlock,
        ]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireStoreReactiveAccess
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.svelte()?;
        let mut stores = Vec::new();
        if file.types().is_none() {
            for call in store_calls(file) {
                let Node::VarDecl(declarator) = Node::Expr(call).parent() else {
                    continue;
                };
                if !matches!(declarator.pat().kind(), PatKind::Ident(_))
                    || !matches!(declarator.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Var(_)))
                {
                    continue;
                }
                let variable = declarator.pat().symbol().and_then(|it| file.svelte_variable_of(it));
                if let Some(variable) = variable {
                    stores.push((variable, declarator.var_kind() == VarKind::Const));
                }
            }
        }
        Some(State { stores })
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.kind() {
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. } => self.verify(Some(test), CONSISTENT, cx),
            StmtKind::For { test, .. } => self.verify(test, CONSISTENT, cx),
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => {
                self.verify(Some(expr), PLAIN, cx);
            }
            StmtKind::Switch { expr, .. } => self.verify(Some(expr), PLAIN, cx),
            _ => {}
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Cond { test, .. } => self.verify(Some(test), CONSISTENT, cx),
            ExprKind::Call(call) | ExprKind::New(call) => {
                let callee = call.callee();
                if !matches!(callee.kind(), ExprKind::Super) {
                    self.verify(Some(callee), PLAIN, cx);
                }
            }
            ExprKind::Unary { op, operand } => {
                let consistent = matches!(op, UnOp::Not | UnOp::Typeof);
                let how = How {
                    consistent,
                    fixes: true,
                };
                self.verify(Some(operand), how, cx);
            }
            ExprKind::Spread(argument) => self.verify(Some(argument), PLAIN, cx),
            ExprKind::Assign {
                op: Some(_),
                target,
                value,
            } => {
                if !matches!(target.kind(), ExprKind::Object(_) | ExprKind::Array(_)) {
                    self.verify(Some(target), PLAIN, cx);
                }
                self.verify(Some(value), PLAIN, cx);
            }
            // `LogicalExpression`
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                ..
            } => self.verify(Some(left), CONSISTENT, cx),
            // A `SequenceExpression`.
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => {}
            ExprKind::Binary { op, left, right } => {
                let consistent = matches!(
                    op,
                    BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
                );
                let how = How {
                    consistent,
                    fixes: true,
                };
                if !matches!(left.kind(), ExprKind::PrivateIdentifier(_)) {
                    self.verify(Some(left), how, cx);
                }
                self.verify(Some(right), how, cx);
            }
            ExprKind::Template(template) => {
                for substitution in template.exprs() {
                    self.verify(Some(substitution), PLAIN, cx);
                }
            }
            ExprKind::TaggedTemplate(call) => self.verify(Some(call.callee()), PLAIN, cx),
            ExprKind::ImportCall { args } => self.verify(args.first(), PLAIN, cx),
            ExprKind::Await(argument) => self.verify(Some(argument), CONSISTENT, cx),
            _ => {}
        }
    }

    /// `PropertyDefinition` and `MethodDefinition` with a computed key.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_definition = match member.kind() {
            MemberKind::Property => !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT),
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                !member.flags().contains(Flags::ABSTRACT)
            }
            _ => false,
        };
        if is_definition && !member.is_signature() {
            self.verify(member.computed_key(), PLAIN, cx);
        }
    }

    /// `Property` with a computed key, and an object literal's `SpreadElement`. A program can have a component's
    /// `{...a}` in one, which isn't a `SpreadElement` in ESLint's tree.
    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        match prop.kind() {
            PropKind::Spread => {
                let value = prop.value();
                let attribute_value = value.and_then(|it| {
                    owner_as(it, SvelteTag::SpreadAttribute, Role::Argument)
                });
                if attribute_value.is_none() {
                    self.verify(value, PLAIN, cx);
                }
            }
            _ if prop.is_jsx_attribute() || prop.is_import_attribute() => {}
            _ => self.verify(prop.computed_key(), PLAIN, cx),
        }
    }

    /// `Property` with a computed key in an object pattern.
    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let PatKind::Object(props) = pat.kind() {
            for prop in props.iter() {
                self.verify(prop.computed_key(), PLAIN, cx);
            }
        }
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let without_fix = How {
            consistent: false,
            fixes: false,
        };
        match node.tag() {
            SvelteTag::MustacheTag if !accepts_store_mustache(node) => {
                self.verify_code(node, Role::Expression, PLAIN, cx);
            }
            SvelteTag::ShorthandAttribute if !accepts_store(element_of(node)) => {
                self.verify_code(node, Role::Value, without_fix, cx);
            }
            SvelteTag::SpreadAttribute => self.verify_code(node, Role::Argument, PLAIN, cx),
            SvelteTag::Directive => self.directive(node, cx),
            SvelteTag::StyleDirective if node.has(SvelteFlags::SHORTHAND) => {
                if let Some(key) = node.child(Role::Key) {
                    let name = key.code(Role::Name).and_then(|it| it.node());
                    let e = name.and_then(Node::as_expr).filter(|it| it.as_ident().is_some());
                    self.verify(e, without_fix, cx);
                }
            }
            SvelteTag::SpecialDirective if node.kind() == SvelteKind::This => {
                self.verify_code(node, Role::Expression, PLAIN, cx);
            }
            SvelteTag::IfBlock | SvelteTag::AwaitBlock => {
                self.verify_code(node, Role::Expression, CONSISTENT, cx);
            }
            SvelteTag::EachBlock => self.verify_code(node, Role::Expression, PLAIN, cx),
            _ => {}
        }
    }
}

impl RequireStoreReactiveAccess {
    /// Upstream's `SvelteDirective` listener.
    fn directive<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let is_shorthand = node.has(SvelteFlags::SHORTHAND);
        let fixes_unless_shorthand = How {
            consistent: false,
            fixes: !is_shorthand,
        };
        match node.kind() {
            SvelteKind::Action | SvelteKind::Animation | SvelteKind::Transition => {
                let key = node.child(Role::Key);
                let name = key.and_then(|it| it.code(Role::Name)).and_then(|it| it.node());
                let e = name.and_then(Node::as_expr).filter(|it| it.as_ident().is_some());
                self.verify(e, PLAIN, cx);
            }
            SvelteKind::Binding => {
                if node.name() != b"this" && accepts_store(element_of(node)) {
                    return;
                }
                match node.child(Role::Expression) {
                    // The program has the two functions as two expressions, or as one sequence.
                    Some(bindings) if bindings.tag() == SvelteTag::FunctionBindingsExpression => {
                        let roots = (bindings.codes(Role::Expressions)).flat_map(|it| it.roots());
                        for e in roots
                            .filter_map(|it| it.node().as_expr())
                            .flat_map(Expr::sequence)
                        {
                            self.verify(Some(e), fixes_unless_shorthand, cx);
                        }
                    }
                    _ => self.verify_code(node, Role::Expression, fixes_unless_shorthand, cx),
                }
            }
            SvelteKind::Class => {
                let how = How {
                    consistent: true,
                    fixes: !is_shorthand,
                };
                self.verify_code(node, Role::Expression, how, cx);
            }
            SvelteKind::EventHandler => self.verify_code(node, Role::Expression, PLAIN, cx),
            _ => {}
        }
    }
}
