//! * 2207, and 2206: `checkGrammarTypeOnlyNamedImportsOrExports`
//! * 17019: `checkJSDocTypeIsInJsFile`

use super::*;

impl Checker<'_> {
    /// `checkJSDocTypeIsInJsFile`, where the syntax tree keeps a `?` after a type that makes nothing optional: `[...T?]`.
    pub(super) fn check_nullable_rest_element(&mut self, file: FileId, elem: TupleElemId) {
        let hir = self.hir(file);
        if has_parse_diagnostics(hir) {
            return;
        }
        let elem = &hir[elem];
        if !(elem.rest && elem.optional && elem.name.is_none() && elem.ty.is_some()) {
            return;
        }
        // In `A | B?`, `keyof T?` and the like the `?` goes with the last operand only.
        if !matches!(
            hir[elem.ty].kind,
            TypeNodeKind::Keyword(_)
                | TypeNodeKind::Ref { .. }
                | TypeNodeKind::StringLit(_)
                | TypeNodeKind::NumberLit(_)
                | TypeNodeKind::BigIntLit { .. }
                | TypeNodeKind::BoolLit(_)
                | TypeNodeKind::Template { .. }
                | TypeNodeKind::Array(_)
                | TypeNodeKind::Tuple(_)
                | TypeNodeKind::Object(_)
                | TypeNodeKind::Mapped(_)
                | TypeNodeKind::IndexedAccess { .. }
                | TypeNodeKind::Typeof { .. }
                | TypeNodeKind::Import { .. }
        ) {
            return;
        }
        let start = before_parentheses(&hir.text, hir[elem.ty].pos);
        if trim_trivia_end(&hir.text[..(start as usize).min(hir.text.len())]).ends_with(b"...") {
            let ty = elem.ty;
            let end_of_type = self.end_of_type_node_from(file, ty, start);
            let question = skip_trivia(&hir.text, end_of_type as usize);
            let end = if hir.text.get(question) == Some(&b'?') {
                question as u32 + 1
            } else {
                0
            };
            {
                // `getNullableType`
                let mut meant = self.type_from_node(file, ty);
                if !meant.is_never() && meant != TypeId::VOID {
                    meant = self.union(&[meant, TypeId::UNDEFINED]);
                }
                self.error_at(
                    (file, start, end),
                    17019,
                    &[Arg::Text("?"), Arg::Type(meant)],
                );
            }
        }
    }
}

/// `pos`, or where the parentheses that open right before it do. For what a `(` before it can be nothing but its own.
fn before_parentheses(text: &[u8], pos: u32) -> u32 {
    let mut start = pos;
    loop {
        let before = trim_trivia_end(&text[..(start as usize).min(text.len())]);
        if !before.ends_with(b"(") {
            return start;
        }
        start = before.len() as u32 - 1;
    }
}
