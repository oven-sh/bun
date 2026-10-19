use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint_eslint::rules::init_declarations::{
    Config, Finding, declared_namespace_around, has_declare,
};

/// Require or disallow initialization in variable declarations.
pub struct InitDeclarations {
    config: Config,
    /// Without options, upstream hands its context to ESLint's rule, which then reads no mode and reports nothing.
    has_mode: bool,
}

impl Rule for InitDeclarations {
    const META: Meta = Meta::typescript("init-declarations", Kind::Suggestion)
        .extends_base_rule("init-declarations")
        .reports_on_exit();
    const ON: On = On::new().var_decls();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        InitDeclarations {
            config: Config::new(options),
            has_mode: options.str(0).is_some(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint uses ESLint's rule here, which defaults to `always`. Do the same when there's no package to match.
        let language = file.language();
        if !self.has_mode && !language.is_oxlint && !language.stands_alone {
            return None;
        }
        Some(())
    }

    #[inline]
    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(found) = self.config.check(decl) {
            self.report(decl, &found, cx);
        }
    }
}

impl InitDeclarations {
    #[inline(never)]
    fn report<'a>(&self, decl: VarDecl<'a>, found: &Finding<'a>, cx: &Cx<'a, Self>) {
        let config = &self.config;
        if decl.flags().contains(Flags::AMBIENT)
            && (has_declare(found.declaration)
                || !config.is_never && declared_namespace_around(found.declaration).is_some())
        {
            return;
        }
        if decl.init().is_some() {
            let report = cx
                .report(decl, found.message)
                .called_with(found.declaration);
            report.data("idName", found.name);
            return;
        }
        // For oxlint the type annotation is part of it.
        if cx.language().is_oxlint {
            let report = cx.report(decl.binding_span(), found.message);
            report
                .called_with(found.declaration)
                .data("idName", found.name);
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
