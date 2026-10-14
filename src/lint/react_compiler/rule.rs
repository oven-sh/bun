//! What the rules have in common. Each reports the diagnostics of one category.

use crate::Flavor;
use crate::eslint::{self, Suggested};
use crate::oxlint::{Rendered, render_all};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::{Cx, Report};
use bun_lint::rule::{Message, Rule};
use bun_lint::span::Span;
use bun_react_compiler::diagnostics::ErrorCategory;

const MESSAGE: Message = Message::new("", "{{message}}");
const DESCRIPTION: Message = Message::new("", "{{description}}");

/// oxlint's `run_react_compiler_rule`: reports what the compiler says of the file in `category`.
pub fn report<'a, R: Rule>(cx: &Cx<'a, R>, category: ErrorCategory) {
    report_with(cx.file(), category, &|at| cx.report(at, MESSAGE));
}

fn report_with<'a>(
    file: &'a File<'a>,
    category: ErrorCategory,
    report_at: &dyn Fn(Span) -> Report<'a>,
) {
    let findings = crate::findings(file, Flavor::Oxlint)
        .iter()
        .filter(|finding| finding.category == category);
    for (_, rendered) in render_all(file, findings) {
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
        let mut report = report_at(place)
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
    report_as_eslint_with(cx.file(), category, &|at| cx.report(at, MESSAGE));
}

fn report_as_eslint_with<'a>(
    file: &'a File<'a>,
    category: ErrorCategory,
    report_at: &dyn Fn(Span) -> Report<'a>,
) {
    let findings = crate::findings(file, Flavor::Eslint)
        .iter()
        .filter(|finding| finding.category == category);
    for finding in findings {
        let Some(rendered) = eslint::render(file, finding) else {
            continue;
        };
        let mut report = report_at(rendered.span).data("message", rendered.message);
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
    if starts {
        crate::want(file, flavor, category);
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
