//! What the rules have in common. Each reports the diagnostics of one category.

use crate::oxlint::{Rendered, render_all};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::Cx;
use bun_lint::rule::{Message, Rule};
use bun_lint::span::Span;
use bun_react_compiler::diagnostics::ErrorCategory;

const MESSAGE: Message = Message::new("", "{{message}}");

/// oxlint's `run_react_compiler_rule`: reports what the compiler says of the file in `category`.
pub fn report<'a, R: Rule>(cx: &Cx<'a, R>, category: ErrorCategory) {
    let file = cx.file();
    let findings = crate::findings(file)
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

/// Whether the rule for `category` has anything to do in the file. For [`Rule::register`].
pub fn starts<'a>(file: &'a File<'a>, category: ErrorCategory) -> bool {
    let starts = crate::program::may_have_react_code(file) && should_run(file);
    if starts && matches!(category, ErrorCategory::Todo | ErrorCategory::Invariant) {
        crate::want_everything(file);
    }
    starts
}

/// oxlint's `should_run_react_compiler`
fn should_run(file: &File) -> bool {
    let path = file.path();
    let name = strings::last_index_of_any(path, b"/\\")
        .and_then(|at| path.get(at + 1..))
        .unwrap_or(path);
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
                if $crate::rule::starts(file, $crate::ErrorCategory::$category) {
                    on.finish(|_, cx| $crate::rule::report(cx, $crate::ErrorCategory::$category));
                }
            }
        }
    };
}
