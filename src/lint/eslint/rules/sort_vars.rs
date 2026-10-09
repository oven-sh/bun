use bun_core::strings;
use bun_lint::prelude::*;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Require variables within the same declaration block to be sorted.
pub struct SortVars {
    ignore_case: bool,
}

const SORT_VARS: Message = Message::new(
    "sortVars",
    "Variables within the same declaration block should be sorted alphabetically.",
);

fn name_of(declaration: VarDecl<'_>) -> &[u8] {
    declaration.pat().as_ident().map(Name::bytes).unwrap_or_default()
}

/// Whether moving the declaration could change what the code does: its initializer is not a
/// `Literal`.
fn has_dynamic_init(declaration: VarDecl) -> bool {
    declaration.init().is_some_and(|init| !ast_utils::is_literal(init))
}

/// The declarations in the order of `sorted`, with what is written between those of `written`.
fn text_of<'a>(sorted: &[VarDecl<'a>], written: &[VarDecl<'a>], file: &'a File<'a>) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, declaration) in sorted.iter().enumerate() {
        out.extend_from_slice(declaration.text());
        if let (Some(here), Some(next)) = (written.get(i), written.get(i + 1)) {
            out.extend_from_slice(file.slice(here.span().between(next.span())));
        }
    }
    out
}

impl SortVars {
    fn compare(&self, a: VarDecl, b: VarDecl) -> Ordering {
        let (a, b) = (name_of(a), name_of(b));
        match self.ignore_case {
            true => strings::order_utf16(&text::to_lower_case(a), &text::to_lower_case(b)),
            false => strings::order_utf16(a, b),
        }
    }

    fn sorted_text<'a>(&self, declarations: &[VarDecl<'a>], file: &'a File<'a>) -> Vec<u8> {
        let mut sorted = declarations.to_vec();
        if sorted.len() < 64 {
            utils::array_sort_by(&mut sorted, |a, b| self.compare(a, b) != Ordering::Greater);
        } else {
            // The same without moving each past all that come after it: of two with the same name,
            // the later one ends up first.
            let key = |name| match self.ignore_case {
                true => text::to_lower_case(name),
                false => Cow::Borrowed(name),
            };
            let mut named: Vec<_> = declarations.iter().rev().map(|it| (key(name_of(*it)), *it)).collect();
            utils::sort::sort_by(&mut named, |a, b| strings::order_utf16(&a.0, &b.0));
            sorted = named.into_iter().map(|it| it.1).collect();
        }
        text_of(&sorted, declarations, file)
    }

    /// oxlint's rule. It compares with the one before, and sorts the declarations side by side that can be moved.
    fn check_as_oxlint<'a>(&self, all: &[VarDecl<'a>], cx: &Cx<'a, Self>) {
        let is_movable = |it: &VarDecl| it.pat().tag() == PatTag::Ident && !has_dynamic_init(*it);
        let mut previous: Option<VarDecl<'a>> = None;
        // What is before this index has its fix, which is the same for all that are moved by it.
        let mut unfixed_from = 0;
        for (index, &declaration) in all.iter().enumerate().filter(|(_, it)| it.pat().tag() == PatTag::Ident) {
            let is_sorted = previous.is_none_or(|it| self.compare(declaration, it) != Ordering::Less);
            previous = Some(declaration);
            if is_sorted {
                continue;
            }
            let report = cx.report(declaration, SORT_VARS);
            let (Some(before), Some(after)) = (all.get(..index), all.get(index..)) else {
                continue;
            };
            if index < unfixed_from || !is_movable(&declaration) {
                continue;
            }
            let start = before.iter().rposition(|it| !is_movable(it)).map_or(0, |it| it + 1);
            unfixed_from = after.iter().position(|it| !is_movable(it)).map_or(all.len(), |it| index + it);
            let Some(moved) = all.get(start..unfixed_from).filter(|it| it.len() > 1) else {
                continue;
            };
            report.fix(|fixer| {
                let whole = moved.first()?.span().to(moved.last()?.span());
                if fixer.file().comments_in(whole).next().is_some() {
                    return None;
                }
                let mut sorted = moved.to_vec();
                utils::sort::sort_by(&mut sorted, |a, b| self.compare(*a, *b));
                Some(fixer.replace(whole, text_of(&sorted, moved, fixer.file())))
            });
        }
    }

    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(all) = statement.kind() else {
            return;
        };
        if cx.language().is_oxlint {
            return self.check_as_oxlint(&all.iter().collect::<Vec<_>>(), cx);
        }
        let identifiers = || all.iter().filter(|it| it.pat().tag() == PatTag::Ident);
        let mut rest = identifiers();
        let Some(mut memo) = rest.next() else {
            return;
        };
        let mut is_fixed = false;
        for declaration in rest {
            if self.compare(declaration, memo) != Ordering::Less {
                memo = declaration;
                continue;
            }
            let report = cx.report(declaration, SORT_VARS);
            if !is_fixed && !identifiers().any(has_dynamic_init) {
                report.fix(|fixer| {
                    let declarations: Vec<VarDecl<'a>> = identifiers().collect();
                    let (first, last) = (declarations.first()?, declarations.last()?);
                    let text = self.sorted_text(&declarations, fixer.file());
                    Some(fixer.replace(first.span().to(last.span()), text))
                });
            }
            is_fixed = true;
        }
    }
}

impl Rule for SortVars {
    const META: Meta = Meta::eslint("sort-vars", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        SortVars {
            ignore_case: options.object(0).bool_or("ignoreCase", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], Self::check);
    }
}
