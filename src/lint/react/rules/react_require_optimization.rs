use crate::util_ast::{get_property_name, name_of_key};
use crate::util_component_util::is_pure_component;
use crate::util_components::Components;
use crate::util_components_list::{At, Queue};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::estree_type_name;
use bun_lint::utils::sort;
use rustc_hash::FxHashSet;

/// Enforce React components to have a shouldComponentUpdate method
pub struct RequireOptimization {
    allow_decorators: Vec<Box<[u8]>>,
}

const NO_SHOULD_COMPONENT_UPDATE: Message = Message::new(
    "noShouldComponentUpdate",
    "Component is not optimized. Please add a shouldComponentUpdate method.",
);

impl Rule for RequireOptimization {
    const META: Meta = Meta::plugin(Plugin::React, "require-optimization", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let allow_decorators = options.object(0).strings("allowDecorators");
        RequireOptimization { allow_decorators: allow_decorators.into_iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        Components::may_have_any(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        // Nothing that the rule tells the list changes what is a component. So first what there is in the end, and only
        // what is in one of these can have something to tell.
        let mut components = Components::new(file);
        components.finish();
        let list = components.list();
        if list.is_empty() {
            return;
        }
        let mut outermost: Vec<Span> = list.iter().map(|&id| components.component(id).node.span()).collect();
        sort::sort_unstable_by_key(&mut outermost, |it| it.sort_key(0, 0));
        outermost.dedup_by(|inner, outer| outer.contains(*inner));
        let is_in_component = |span: Span| {
            let after = outermost.partition_point(|it| it.start <= span.start);
            after.checked_sub(1).and_then(|at| outermost.get(at)).is_some_and(|it| it.contains(span))
        };

        // upstream's listeners.
        let pragmas = *components.pragmas();
        let mut queue = Queue::default();
        let mut mark_scu_as_declared = |node| queue.push(At::enter(node), 0, node);
        // Stateless Functional Components cannot be optimized (yet)
        let has_classes = file.has_classes();
        for func in file.funcs().filter(|it| ast_utils::is_function_with_body(*it) && is_in_component(it.span())) {
            if !(has_classes && is_function_in_class(func)) {
                mark_scu_as_declared(Node::Func(func));
            }
        }
        // upstream takes a private name for its text.
        let mentions_scu = file.mentions_any(&["shouldComponentUpdate", "#shouldComponentUpdate"]);
        for class in file.classes().filter(|it| is_in_component(it.span())) {
            if is_class_declaration(Node::Class(class))
                && (class.decorators().any(|it| is_pure_render_decorator(it) || self.is_custom_decorator(it))
                    || is_pure_component(class, &pragmas))
            {
                mark_scu_as_declared(Node::Class(class));
            }
            if !mentions_scu {
                continue;
            }
            for method in class.members().iter().map(Node::Member) {
                if get_property_name(method).is_some_and(is_scu_declared)
                    && estree_type_name(method) == "MethodDefinition"
                {
                    mark_scu_as_declared(method);
                }
            }
        }
        if mentions_scu || (file.mentions("mixins") && file.mentions("PureRenderMixin")) {
            for object in file.exprs_of_kind(ExprTag::Object).filter(|it| is_in_component(it.span())) {
                if let ExprKind::Object(properties) = object.kind()
                    && properties.iter().any(is_scu_or_pure_render_declared)
                    && !object.is_assignment_target()
                {
                    mark_scu_as_declared(Node::Expr(object));
                }
            }
        }

        // They are called in the order of ESLint's walk: what is a component depends on what comes before.
        let mut walk = Components::new(file);
        let mut has_scu: FxHashSet<Span> = FxHashSet::default();
        while let Some(event) = queue.pop_until(At::END) {
            walk.advance(event.at);
            has_scu.extend(walk.set(event.node).map(|id| walk.component(id).span()));
        }
        for at in list.into_iter().map(|id| components.component(id).span()) {
            if !has_scu.contains(&at) {
                cx.report(at, NO_SHOULD_COMPONENT_UPDATE);
            }
        }
    }
}

impl RequireOptimization {
    /// What upstream's `hasCustomDecorator` asks of the expression of a decorator.
    fn is_custom_decorator(&self, expression: Expr<'_>) -> bool {
        expression.as_ident().is_some_and(|name| self.allow_decorators.iter().any(|it| **it == *name.bytes()))
    }
}

/// What upstream's `hasPureRenderDecorator` asks of the expression of a decorator.
fn is_pure_render_decorator(expression: Expr<'_>) -> bool {
    let (ExprKind::Call(call) | ExprKind::New(call)) = expression.kind() else {
        return false;
    };
    let callee = call.callee();
    !expression.is_chain_root()
        && is_member_called(callee, "decorate")
        && callee.object().is_some_and(|it| it.is_ident("reactMixin"))
        && call.args().first().is_some_and(|it| it.is_ident("PureRenderMixin"))
}

/// upstream's `isSCUDeclared`, for the `name` of a key
fn is_scu_declared(name: &[u8]) -> bool {
    name == b"shouldComponentUpdate"
}

/// `isSCUDeclared(property.key) || isPureRenderDeclared(property)`
fn is_scu_or_pure_render_declared(property: Prop<'_>) -> bool {
    let Some(name) = property.key().and_then(name_of_key) else {
        return false;
    };
    is_scu_declared(name)
        || (name == b"mixins"
            && matches!(property.value().map(Expr::kind), Some(ExprKind::Array(elements))
                if elements.iter().any(|it| it.is_ident("PureRenderMixin"))))
}

fn is_class_declaration(node: Node<'_>) -> bool {
    estree_type_name(node) == "ClassDeclaration"
}

/// upstream's `isFunctionInClass`
fn is_function_in_class(func: Func<'_>) -> bool {
    Node::Func(func).scope().chain().any(|scope| scope.kind() == ScopeKind::Class && is_class_declaration(scope.node()))
}
