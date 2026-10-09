//! What the rules have in common. Each reports the diagnostics of one category.

use crate::Flavor;
use crate::eslint::{self, Suggested};
use crate::oxlint::{Rendered, render_all};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::Cx;
use bun_lint::rule::{Message, Rule};
use bun_lint::span::Span;
use bun_react_compiler::diagnostics::ErrorCategory;

const MESSAGE: Message = Message::new("", "{{message}}");
const DESCRIPTION: Message = Message::new("", "{{description}}");

/// oxlint's `run_react_compiler_rule`: reports what the compiler says of the file in `category`.
pub fn report<'a, R: Rule>(cx: &Cx<'a, R>, category: ErrorCategory) {
    let file = cx.file();
    let findings = crate::findings(file, Flavor::Oxlint)
        .iter()
        .filter(|finding| finding.category == category);
    for (_, rendered) in render_all(file, findings) {
        if cx.has_reported_too_much() {
            break;
        }
        let Rendered {
            message,
            help,
            note,
            labels,
        } = rendered;
        let mut labels = labels.into_iter();
        let first = labels.next();
        // oxlint prints a diagnostic without a label without a place.
        let place = first
            .as_ref()
            .map_or_else(|| Span::empty(0), |label| label.span);
        let mut report = cx
            .report(place, MESSAGE)
            .data("message", message.into_owned())
            .help(help)
            .note(note);
        if let Some(first) = first.filter(|label| !label.text.is_empty()) {
            report = report.first_label(first.text);
        }
        for label in labels {
            report = report.label(label.span, label.text);
        }
        drop(report);
    }
}

/// `makeRule` of eslint-plugin-react-hooks: reports what the compiler says of the file in `category`.
pub fn report_as_eslint<'a, R: Rule>(cx: &Cx<'a, R>, category: ErrorCategory) {
    let file = cx.file();
    let findings = crate::findings(file, Flavor::Eslint)
        .iter()
        .filter(|finding| finding.category == category);
    for finding in findings {
        if cx.has_reported_too_much() {
            break;
        }
        let Some(rendered) = eslint::render(file, finding) else {
            continue;
        };
        let mut report = cx
            .report(rendered.span, MESSAGE)
            .data("message", rendered.message);
        for suggested in rendered.suggestions {
            let Suggested {
                description,
                range,
                text,
            } = suggested;
            let data: [(&'static str, &[u8]); 1] = [("description", &description)];
            report = report.suggest_with(DESCRIPTION, &data, |fixer| fixer.replace(range, text));
        }
        drop(report);
    }
}

/// Whether the rule for `category` has anything to do in the file. For [`Rule::register`].
pub fn starts<'a>(file: &'a File<'a>, flavor: Flavor, category: ErrorCategory) -> bool {
    let starts = crate::program::may_have_react_code(file, flavor)
        && (flavor == Flavor::Eslint || should_run(file));
    if starts && matches!(category, ErrorCategory::Todo | ErrorCategory::Invariant) {
        crate::want_everything(file, flavor);
    }
    starts
}

/// oxlint's `should_run_react_compiler`
fn should_run(file: &File) -> bool {
    let path = file.path();
    let name = bun_lint::paths::file_name(path);
    let extension = strings::last_index_of_char(name, b'.')
        .filter(|&at| at > 0)
        .and_then(|at| name.get(at + 1..));
    !strings::contains(path, b"node_modules")
        && !matches!(extension, Some(b"vue" | b"astro" | b"svelte"))
}

/// Declares the rule `react/$rule` of oxlint, which reports the diagnostics of `ErrorCategory::$category`.
#[macro_export]
macro_rules! declare_rule {
    ($(#[$doc:meta])* $name:ident, $rule:literal, $kind:ident, $category:ident) => {
        $(#[$doc])*
        pub struct $name;

        impl ::bun_lint::rule::Rule for $name {
            const META: ::bun_lint::rule::Meta = ::bun_lint::rule::Meta::oxlint(
                ::bun_lint::rule::Plugin::React,
                $rule,
                ::bun_lint::rule::Kind::$kind,
            );
            type State<'a> = ();

            fn new(_: &::bun_lint::options::Options) -> Self {
                $name
            }

            fn register<'a>(
                &self,
                on: &mut ::bun_lint::rule::Listeners<'a, Self>,
                file: &'a ::bun_lint::ast::File<'a>,
            ) {
                let category = $crate::ErrorCategory::$category;
                if $crate::rule::starts(file, $crate::Flavor::Oxlint, category) {
                    on.finish(|_, cx| $crate::rule::report(cx, $crate::ErrorCategory::$category));
                }
            }
        }
    };
}

/// Declares the rule `react-hooks/$rule` of eslint-plugin-react-hooks, which reports the diagnostics of
/// `ErrorCategory::$category`. After that: `recommended`, if it is in that configuration of the plugin.
///
/// The one option of the plugin's rule, an object that is merged into the options of the compiler, is not looked at.
#[macro_export]
macro_rules! declare_eslint_rule {
    ($(#[$doc:meta])* $name:ident, $rule:literal, $category:ident $(, $preset:ident)?) => {
        $(#[$doc])*
        pub struct $name;

        impl ::bun_lint::rule::Rule for $name {
            const META: ::bun_lint::rule::Meta = ::bun_lint::rule::Meta::plugin(
                ::bun_lint::rule::Plugin::ReactHooks,
                $rule,
                ::bun_lint::rule::Kind::Problem,
            )
            .fixable(::bun_lint::rule::Fixable::Code)
            .has_suggestions()
            $(.$preset())?;
            type State<'a> = ();

            fn new(_: &::bun_lint::options::Options) -> Self {
                $name
            }

            fn register<'a>(
                &self,
                on: &mut ::bun_lint::rule::Listeners<'a, Self>,
                file: &'a ::bun_lint::ast::File<'a>,
            ) {
                let category = $crate::ErrorCategory::$category;
                if $crate::rule::starts(file, $crate::Flavor::Eslint, category) {
                    on.finish(|_, cx| {
                        $crate::rule::report_as_eslint(cx, $crate::ErrorCategory::$category)
                    });
                }
            }
        }
    };
}
