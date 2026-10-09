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

impl SortVars {
    fn compare(&self, a: VarDecl, b: VarDecl) -> Ordering {
        let (a, b) = (name_of(a), name_of(b));
        match self.ignore_case {
            true => text::compare(&text::to_lower_case(a), &text::to_lower_case(b)),
            false => text::compare(a, b),
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
            named.sort_by(|a, b| text::compare(&a.0, &b.0));
            sorted = named.into_iter().map(|it| it.1).collect();
        }
        let mut out = Vec::new();
        for (i, declaration) in sorted.iter().enumerate() {
            out.extend_from_slice(declaration.text());
            if let (Some(here), Some(next)) = (declarations.get(i), declarations.get(i + 1)) {
                out.extend_from_slice(file.slice(here.span().between(next.span())));
            }
        }
        out
    }

    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(all) = statement.kind() else {
            return;
        };
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
            // oxlint compares with the one before, ESLint with the last that was in order.
            if cx.language().is_oxlint {
                memo = declaration;
            }
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
