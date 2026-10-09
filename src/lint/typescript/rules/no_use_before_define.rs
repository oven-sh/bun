use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKind;
use bun_lint::utils::ts_scope::reference_contains_type_query;
use bun_lint_eslint::rules::no_use_before_define::{
    Config, Initializers, definition_name_end, is_class_ref_in_class_decorator, is_named_export,
};

/// Disallow the use of variables before they are defined.
pub struct NoUseBeforeDefine {
    config: Config,
}

const NO_USE_BEFORE_DEFINE: Message =
    Message::new("noUseBeforeDefine", "'{{name}}' was used before it was defined.");

#[derive(Default)]
pub struct State<'a> {
    /// Whether the file has an `export { a }`.
    has_export_specs: bool,
    initializers: Initializers<'a>,
}

fn report<'a>(reference: Reference<'a>, cx: &mut Cx<'a, NoUseBeforeDefine>) {
    cx.report(reference, NO_USE_BEFORE_DEFINE).data("name", reference.name());
}

/// For oxlint the computed key of a member that is only a type is a reference in a type: `{ [a]: 1 }` as a type or in
/// an interface, `declare [a]: 1` and `abstract [a]: 1` in a class.
fn oxlint_is_in_key_of_type(reference: Reference) -> bool {
    let Some(mut e) = reference.expr() else {
        return false;
    };
    loop {
        match e.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e) => e = parent,
            Node::Member(member) => {
                return member.is_signature() || member.flags().intersects(Flags::ABSTRACT | Flags::AMBIENT);
            }
            _ => return false,
        }
    }
}

/// Of a reference that is the name in the opening tag of a JSX element, or the first part of it: the same in the closing tag.
fn name_in_closing_tag(reference: Reference) -> Option<Span> {
    let mut tag = reference.expr()?;
    while let Node::Expr(parent) = tag.parent()
        && matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == tag)
    {
        tag = parent;
    }
    let Node::Expr(element) = tag.parent() else {
        return None;
    };
    let ExprKind::Jsx(jsx) = element.kind() else {
        return None;
    };
    let mut first = jsx.close_tag().filter(|_| jsx.tag() == Some(tag))?;
    while let ExprKind::Dot { obj, .. } = first.kind() {
        first = obj;
    }
    // With the parser of typescript-eslint it is a reference of its own already.
    first.reference().is_none().then(|| first.span())
}

impl NoUseBeforeDefine {
    /// typescript-eslint's `isForbidden`.
    fn is_forbidden<'a>(&self, variable: Symbol<'a>, kind: DeclarationKind, reference: Reference<'a>) -> bool {
        let config = &self.config;
        if config.ignore_type_references
            && (reference.is_type()
                || reference_contains_type_query(reference)
                || variable.file().language().is_oxlint && oxlint_is_in_key_of_type(reference))
        {
            return false;
        }
        if kind == DeclarationKind::FunctionName {
            return config.functions;
        }
        // oxc has no scope for the initializer of a field.
        let is_oxlint = variable.file().language().is_oxlint;
        let variable_scope = |scope: Scope<'a>| {
            let mut found = scope.variable_scope();
            while is_oxlint
                && found.kind() == ScopeKind::ClassFieldInitializer
                && let Some(parent) = found.parent()
            {
                found = parent.variable_scope();
            }
            found
        };
        let is_outer = variable_scope(variable.scope()) != variable_scope(reference.scope());
        match kind {
            DeclarationKind::ClassName if is_outer => config.classes,
            DeclarationKind::Variable if is_outer => config.variables,
            DeclarationKind::TsEnumName if is_outer => config.enums,
            DeclarationKind::Type => config.typedefs,
            _ => true,
        }
    }

    fn check<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        let references = variable.references();
        if references.len() == 0 {
            return;
        }
        let Some(definition) = variable.declarations().next() else {
            return;
        };
        let (Some(kind), Some(definition_end)) = (definition.kind(), definition_name_end(definition)) else {
            return;
        };
        let declared = cx.state.initializers.declared(definition);
        for reference in references {
            // What JSX makes of `React` is a reference whose identifier is the declaration.
            if reference.is_init() || reference.is_jsx_pragma() {
                continue;
            }
            let identifier = reference.span();
            let mut is_in_initializer = || {
                variable.scope() == reference.scope()
                    && declared.is_some_and(|it| cx.state.initializers.has(it, reference))
            };
            let is_defined_before_use =
                definition_end <= identifier.end && !(reference.is_value() && is_in_initializer());
            if is_defined_before_use {
                continue;
            }
            // For oxlint nothing more is asked about an `export { a }` that is allowed.
            if cx.language().is_oxlint && self.config.allow_named_exports && is_named_export(reference) {
                continue;
            }
            if !self.config.allow_named_exports && is_named_export(reference)
                || self.is_forbidden(variable, kind, reference)
                    && !is_class_ref_in_class_decorator(definition, identifier)
                    && reference.scope().kind() != ScopeKind::FunctionType
            {
                report(reference, cx);
                // For oxlint that is a reference too.
                if cx.language().is_oxlint
                    && let Some(closing) = name_in_closing_tag(reference).filter(|it| it.end < definition_end)
                {
                    cx.report(closing, NO_USE_BEFORE_DEFINE).data("name", reference.name());
                }
            }
        }
    }

    /// `export { a }` where nothing declares `a`.
    fn check_unresolved_exports<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state.has_export_specs {
            return;
        }
        for reference in cx.file().unresolved_references() {
            if is_named_export(reference) && cx.file().global(reference.name().bytes()).is_none() {
                report(reference, cx);
            }
        }
    }
}

impl Rule for NoUseBeforeDefine {
    const META: Meta = Meta::typescript("no-use-before-define", Kind::Problem)
        .extends_base_rule("no-use-before-define");
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUseBeforeDefine {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.symbols(Self::check);
        if !self.config.allow_named_exports {
            on.export_specs(|_, _, cx| cx.state.has_export_specs = true);
            on.finish(Self::check_unresolved_exports);
        }
        State::default()
    }
}
