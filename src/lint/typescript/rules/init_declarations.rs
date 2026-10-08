use bun_lint::prelude::*;
use bun_lint_eslint::rules::init_declarations::{Config, declared_namespace_around, has_declare};

/// Require or disallow initialization in variable declarations.
pub struct InitDeclarations {
    /// `None` without options: upstream hands its context to ESLint's rule, which then reads no mode and reports nothing.
    config: Option<Config>,
}

impl Rule for InitDeclarations {
    const META: Meta =
        Meta::typescript("init-declarations", Kind::Suggestion).extends_base_rule("init-declarations");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        InitDeclarations {
            config: options.str(0).map(|_| Config::new(options)),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.config.is_none() {
            return;
        }
        on.var_decls(|rule, decl, cx| {
            let Some(config) = &rule.config else {
                return;
            };
            let Some(found) = config.check(decl) else {
                return;
            };
            if decl.flags().contains(Flags::AMBIENT)
                && (has_declare(found.declaration)
                    || !config.is_never && declared_namespace_around(found.declaration).is_some())
            {
                return;
            }
            if decl.init().is_some() {
                cx.report(decl, found.message).data("idName", found.name);
                return;
            }
            // Without the type annotation: as many columns as the name is long.
            let pat = decl.pat();
            let report = cx.report(pat, found.message).data("idName", found.name);
            if pat.text() != found.name.bytes() {
                let start = cx.position(pat.span().start);
                report.end_at(Position {
                    line: start.line,
                    column: start.column + text::utf16_len(found.name.bytes()),
                });
            }
        });
    }
}
