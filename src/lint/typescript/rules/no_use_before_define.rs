use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKind;
use bun_lint::utils::ts_scope::reference_contains_type_query;
use bun_lint_eslint::rules::no_use_before_define::{
    Config, Initializers, definition_name_end, end_of_definition, first_use,
    is_class_ref_in_class_decorator, is_named_export, starts_after,
};

/// Disallow the use of variables before they are defined.
pub struct NoUseBeforeDefine {
    config: Config,
}

const NO_USE_BEFORE_DEFINE: Message = Message::new(
    "noUseBeforeDefine",
    "'{{name}}' was used before it was defined.",
);

#[derive(Default)]
pub struct State<'a> {
    /// True if the file has an `export { a }`.
    has_export_specs: bool,
    initializers: Initializers<'a>,
}

fn report<'a>(reference: Reference<'a>, at: Span, cx: &mut Cx<'a, NoUseBeforeDefine>) {
    let report = match reference.expr() {
        Some(identifier) => cx.report(at, NO_USE_BEFORE_DEFINE).called_with(identifier),
        None => cx.report(at, NO_USE_BEFORE_DEFINE),
    };
    report.data("name", reference.name()).labels_with(|labels| {
        if let Some(defined) = reference
            .symbol()
            .and_then(|it| it.declarations().next()?.name_span())
        {
            labels.push(defined, "defined here");
        }
    });
}

/// For oxlint the computed key of a type-only member is a type reference: `{ [a]: 1 }` as a type or in an interface,
/// `declare [a]: 1` and `abstract [a]: 1` in a class.
fn oxlint_is_in_type_member_key(reference: Reference) -> bool {
    let Some(mut e) = reference.expr() else {
        return false;
    };
    loop {
        match e.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e) => {
                e = parent
            }
            Node::Member(member) => {
                return member.is_signature()
                    || member.flags().intersects(Flags::ABSTRACT | Flags::AMBIENT);
            }
            _ => return false,
        }
    }
}

/// For a reference that's the name in a JSX opening tag, or the first part of it, returns the same name in the closing
/// tag.
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
    // With typescript-eslint's parser it's already a separate reference.
    first.reference().is_none().then(|| first.span())
}

/// True for the `a` in `export default a` and `export = a`, which can be a type. oxc treats it as a value, along with
/// whatever the name resolves to.
fn oxlint_treats_as_value(variable: Symbol, reference: Reference) -> bool {
    variable.file().language().is_oxlint
        && matches!(reference.expr().map(Expr::parent), Some(Node::Stmt(it))
            if matches!(it.tag(), StmtTag::ExportDefault | StmtTag::ExportAssign))
        && variable.is_value_variable()
        && !utils::oxlint::is_namespace_of_types(variable)
}

impl NoUseBeforeDefine {
    /// typescript-eslint's `isForbidden`.
    fn is_forbidden<'a>(
        &self,
        variable: Symbol<'a>,
        kind: DeclarationKind,
        reference: Reference<'a>,
    ) -> bool {
        let config = &self.config;
        if config.ignore_type_references
            && (reference.is_type() && !oxlint_treats_as_value(variable, reference)
                || reference_contains_type_query(reference)
                || variable.file().language().is_oxlint && oxlint_is_in_type_member_key(reference))
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
        let (Some(first), Some(definition)) = (first_use(variable), variable.declarations().next())
        else {
            return;
        };
        // Only a value reference is checked for being inside an initializer.
        let (end, is_type) = match definition {
            Declaration::TypeParam(it) => (Some(it.name().start()), true),
            _ => (end_of_definition(definition), false),
        };
        let is_defined = |it: Reference<'a>| {
            starts_after(it, end) && !(is_type && it.is_value())
                || it.is_init()
                || it.is_jsx_pragma()
        };
        if end.is_none_or(|end| first <= end) || is_type && !variable.references().all(is_defined) {
            self.check_references(variable, definition, &is_defined, cx);
        }
    }

    /// `is_defined` returns true if a reference is obviously after the definition.
    #[inline(never)]
    fn check_references<'a>(
        &self,
        variable: Symbol<'a>,
        definition: Declaration<'a>,
        is_defined: &dyn Fn(Reference<'a>) -> bool,
        cx: &mut Cx<'a, Self>,
    ) {
        let references = variable.references();
        let (Some(kind), Some(definition_end)) =
            (definition.kind(), definition_name_end(definition))
        else {
            return;
        };
        let declared = cx.state.initializers.declared(definition);
        for reference in references {
            // The `React` reference that JSX implies has the declaration as its identifier.
            if is_defined(reference) {
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
            // oxlint makes no further checks on an allowed `export { a }`.
            if cx.language().is_oxlint
                && self.config.allow_named_exports
                && is_named_export(reference)
            {
                continue;
            }
            if !self.config.allow_named_exports && is_named_export(reference)
                || self.is_forbidden(variable, kind, reference)
                    && !is_class_ref_in_class_decorator(definition, identifier)
                    && reference.scope().kind() != ScopeKind::FunctionType
            {
                report(reference, reference.span(), cx);
                // For oxlint the closing tag's name is a reference too.
                if cx.language().is_oxlint
                    && let Some(closing) =
                        name_in_closing_tag(reference).filter(|it| it.end < definition_end)
                {
                    report(reference, closing, cx);
                }
            }
        }
    }

    /// Checks `export { a }` where nothing declares `a`.
    fn check_unresolved_exports<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state.has_export_specs {
            return;
        }
        for reference in cx.file().unresolved_references() {
            if is_named_export(reference) && cx.file().global(reference.name().bytes()).is_none() {
                report(reference, reference.span(), cx);
            }
        }
    }
}

impl Rule for NoUseBeforeDefine {
    const META: Meta = Meta::typescript("no-use-before-define", Kind::Problem)
        .extends_base_rule("no-use-before-define");
    const ON: On = On::new().symbols().export_specs().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUseBeforeDefine {
            config: Config::new(options),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new().symbols();
        if !self.config.allow_named_exports {
            on = on.export_specs().finish();
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn export_spec<'a>(&self, _: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.has_export_specs = true;
    }

    fn symbol<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        self.check(variable, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check_unresolved_exports(cx);
    }
}
