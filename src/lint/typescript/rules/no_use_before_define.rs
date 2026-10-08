use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKind;
use bun_lint::utils::ts_scope::reference_contains_type_query;
use bun_lint_eslint::rules::no_use_before_define::{
    Config, definition_name_end, initializer_ranges, is_class_ref_in_class_decorator, is_in_range,
    is_named_export,
};

/// Disallow the use of variables before they are defined.
pub struct NoUseBeforeDefine {
    config: Config,
}

const NO_USE_BEFORE_DEFINE: Message =
    Message::new("noUseBeforeDefine", "'{{name}}' was used before it was defined.");

fn report<'a>(reference: Reference<'a>, cx: &mut Cx<'a, NoUseBeforeDefine>) {
    cx.report(reference, NO_USE_BEFORE_DEFINE).data("name", reference.name());
}

impl NoUseBeforeDefine {
    /// typescript-eslint's `isForbidden`.
    fn is_forbidden<'a>(&self, variable: Symbol<'a>, kind: DeclarationKind, reference: Reference<'a>) -> bool {
        let config = &self.config;
        if config.ignore_type_references && (reference.is_type() || reference_contains_type_query(reference)) {
            return false;
        }
        if kind == DeclarationKind::FunctionName {
            return config.functions;
        }
        let is_outer = variable.scope().variable_scope() != reference.scope().variable_scope();
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
        let initializers = initializer_ranges(definition);
        for reference in references {
            if reference.is_init() {
                continue;
            }
            let identifier = reference.span();
            let is_in_initializer = || {
                initializers.iter().any(|it| is_in_range(*it, identifier.end))
                    && variable.scope() == reference.scope()
            };
            let is_defined_before_use =
                definition_end <= identifier.end && !(reference.is_value() && is_in_initializer());
            if is_defined_before_use {
                continue;
            }
            if !self.config.allow_named_exports && is_named_export(reference)
                || self.is_forbidden(variable, kind, reference)
                    && !is_class_ref_in_class_decorator(definition, identifier)
                    && reference.scope().kind() != ScopeKind::FunctionType
            {
                report(reference, cx);
            }
        }
    }

    /// `export { a }` where nothing declares `a`.
    fn check_unresolved_exports<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state {
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
    /// Whether the file has an `export { a }`.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        NoUseBeforeDefine {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> bool {
        on.symbols(Self::check);
        if !self.config.allow_named_exports {
            on.export_specs(|_, _, cx| cx.state = true);
            on.finish(Self::check_unresolved_exports);
        }
        false
    }
}
