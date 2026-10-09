use bun_lint_oxlint::text::find_next_token_within;
use crate::oxlint::vue::is_vue_setup;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow importing Vue compiler macros.
pub struct NoImportCompilerMacros;

const NO_IMPORT_COMPILER_MACROS: Message = Message::new("", "'{{name}}' is a compiler macro and doesn't need to be imported.");
const INVALID_IMPORT_COMPILER_MACROS: Message =
    Message::new("", "'{{name}}' is a compiler macro and can't be imported outside of `<script setup>`.");

const COMPILER_MACROS: [&str; 7] =
    ["defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel", "defineOptions", "defineSlots"];

impl Rule for NoImportCompilerMacros {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-import-compiler-macros", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImportCompilerMacros
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&COMPILER_MACROS) {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import_decl) = stmt.kind() else {
                return;
            };
            if !import_decl.spec().is_any(&["vue", "@vue/runtime-core", "@vue/runtime-dom"]) {
                return;
            }
            // What is before the names in braces: `import def, { a, b }`.
            let before = import_decl.default().map(|it| it.span()).or_else(|| import_decl.namespace_span());
            let mut rest = import_decl.named().iter();
            let mut last = None;
            while let Some(import_specifier) = rest.next() {
                let (previous, mut after) = (last.replace(import_specifier.span()), rest);
                let next = after.next();
                let imported_name = import_specifier.imported();
                let is_string = matches!(cx.file().slice(imported_name.span()).first(), Some(b'"' | b'\''));
                if is_string || !imported_name.name().is_any(&COMPILER_MACROS) {
                    continue;
                }
                let fix = move |fixer: Fixer| -> Option<Fix> {
                    let (file, span) = (stmt.file(), import_specifier.span());
                    match (previous.or(before), next) {
                        (None, None) => Some(fixer.remove(stmt)),
                        // With the comma after it.
                        (_, Some(next)) if previous.is_none() => {
                            let comma = find_next_token_within(file, span.between(next.span()), b",")?;
                            Some(fixer.remove(Span::new(span.start, comma + 1)))
                        }
                        // With the comma before it, and with the braces if nothing is left in them.
                        (Some(prev), _) => {
                            let comma = find_prev_token_within(file, prev.between(span), b",")?;
                            let end = match previous {
                                Some(_) => span.end,
                                None => find_next_token_within(file, Span::after(span, stmt.span().end), b"}")? + 1,
                            };
                            Some(fixer.remove(Span::new(comma, end)))
                        }
                        (None, Some(_)) => None,
                    }
                };
                // In a `<script setup>` the macro is there without the import.
                if is_vue_setup(cx.file()) {
                    cx.report(import_specifier, NO_IMPORT_COMPILER_MACROS).data("name", imported_name).fix(fix);
                } else {
                    cx.report(import_specifier, INVALID_IMPORT_COMPILER_MACROS).data("name", imported_name).fix_dangerously(fix);
                }
            }
        });
    }
}

/// `LintContext::find_prev_token_within`: where the text `token` is the last time in `within`, outside the comments.
fn find_prev_token_within<'a>(file: &'a File<'a>, within: Span, token: &[u8]) -> Option<u32> {
    let Span { start, mut end } = within;
    loop {
        let at = start + strings::last_index_of(file.slice(Span::new(start, end)), token)? as u32;
        match file.comment_around(at) {
            Some(comment) => end = comment.start().clamp(start, at),
            None => return Some(at),
        }
    }
}
