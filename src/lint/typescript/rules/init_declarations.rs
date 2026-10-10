use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint_eslint::rules::init_declarations::{Config, declared_namespace_around, has_declare};

/// Require or disallow initialization in variable declarations.
pub struct InitDeclarations {
    config: Config,
    /// Without options, upstream hands its context to ESLint's rule, which then reads no mode and reports nothing.
    has_mode: bool,
}

impl Rule for InitDeclarations {
    const META: Meta =
        Meta::typescript("init-declarations", Kind::Suggestion).extends_base_rule("init-declarations");
    const ON: On = On::new().var_decls();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        InitDeclarations {
            config: Config::new(options),
            has_mode: options.str(0).is_some(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // In oxlint it is ESLint's rule, whose mode is `always` then.
        if !self.has_mode && !file.language().is_oxlint {
            return None;
        }
        Some(())
    }

    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let config = &self.config;
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
        // For oxlint the type annotation is part of it.
        if cx.language().is_oxlint {
            cx.report(decl.binding_span(), found.message).data("idName", found.name);
            return;
        }
        // Without the type annotation: as many columns as the name is long.
        let pat = decl.pat();
        let report = cx.report(pat, found.message).data("idName", found.name);
        if pat.text() != found.name.bytes() {
            let start = cx.position(pat.span().start);
            report.end_at(Position {
                line: start.line,
                column: start.column + strings::wtf8_len_utf16(found.name.bytes()),
            });
        }
    }
}
