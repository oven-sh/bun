use bun_lint::prelude::*;
use std::cmp::Ordering;

/// Enforce sorted `import` declarations within modules.
pub struct SortImports {
    ignore_case: bool,
    ignore_declaration_sort: bool,
    ignore_member_sort: bool,
    allow_separated_groups: bool,
    /// The place of each [`Syntax`] in `memberSyntaxSortOrder`.
    rank: [usize; 4],
}

const SORT_IMPORTS_ALPHABETICALLY: Message = Message::new(
    "sortImportsAlphabetically",
    "Imports should be sorted alphabetically.",
);
const SORT_MEMBERS_ALPHABETICALLY: Message = Message::new(
    "sortMembersAlphabetically",
    "Member '{{memberName}}' of the import declaration should be sorted alphabetically.",
);
const UNEXPECTED_SYNTAX_ORDER: Message = Message::new(
    "unexpectedSyntaxOrder",
    "Expected '{{syntaxA}}' syntax before '{{syntaxB}}' syntax.",
);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Syntax {
    /// `import "m"`
    None,
    /// `import * as a from "m"`
    All,
    /// `import { a, b } from "m"`
    Multiple,
    /// `import { a } from "m"`
    Single,
}

impl Syntax {
    const ALL: [Syntax; 4] = [Syntax::None, Syntax::All, Syntax::Multiple, Syntax::Single];

    fn name(self) -> &'static str {
        match self {
            Syntax::None => "none",
            Syntax::All => "all",
            Syntax::Multiple => "multiple",
            Syntax::Single => "single",
        }
    }
}

/// ESLint's `usedMemberSyntax`
fn used_member_syntax(import: Import<'_>) -> Syntax {
    let has_default = import.default().is_some();
    let has_namespace = import.namespace().is_some();
    match usize::from(has_default) + usize::from(has_namespace) + import.named().len() {
        0 => Syntax::None,
        _ if has_namespace && !has_default => Syntax::All,
        1 => Syntax::Single,
        _ => Syntax::Multiple,
    }
}

/// ESLint's `getFirstLocalMemberName`
fn get_first_local_member_name(import: Import<'_>) -> Option<&[u8]> {
    let first = (import.default())
        .or_else(|| import.namespace())
        .or_else(|| import.named().first().map(ImportSpec::local));
    first.map(Ident::bytes)
}

/// `items.sort(compare)` as V8 does it for fewer than 64 items, where `is_before(a, b)` is
/// `compare(a, b) < 0`. A `compare` that never answers 0 is inconsistent for equal items, and where
/// those end up depends on the algorithm.
// TODO(api): replace by utils::text::array_sort_by
fn array_sort_by<T: Copy>(items: &mut [T], is_before: impl Fn(T, T) -> bool) {
    if items.len() < 2 {
        return;
    }
    let is_descending = is_before(items[1], items[0]);
    let mut run = 2;
    while run < items.len() && is_before(items[run], items[run - 1]) == is_descending {
        run += 1;
    }
    if is_descending {
        items[..run].reverse();
    }
    for start in run..items.len() {
        let pivot = items[start];
        let (mut left, mut right) = (0, start);
        while left < right {
            let middle = left + (right - left) / 2;
            match is_before(pivot, items[middle]) {
                true => right = middle,
                false => left = middle + 1,
            }
        }
        items.copy_within(left..start, left + 1);
        items[left] = pivot;
    }
}

impl SortImports {
    fn compare(&self, a: &[u8], b: &[u8]) -> Ordering {
        match self.ignore_case {
            true => text::compare(&text::to_lower_case(a), &text::to_lower_case(b)),
            false => text::compare(a, b),
        }
    }

    fn check_declaration<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some(StmtKind::Import(import)) = node.as_stmt().map(Stmt::kind) else {
            return;
        };
        let Some(previous) = cx.state.replace(import) else {
            return;
        };
        if self.allow_separated_groups
            && cx.line_of(import.span().start) > cx.line_of(previous.span().end) + 1
        {
            return;
        }
        let (syntax, previous_syntax) = (used_member_syntax(import), used_member_syntax(previous));
        if syntax != previous_syntax {
            if self.rank[syntax as usize] < self.rank[previous_syntax as usize] {
                cx.report(node, UNEXPECTED_SYNTAX_ORDER)
                    .data("syntaxA", syntax.name())
                    .data("syntaxB", previous_syntax.name());
            }
        } else if let Some(name) = get_first_local_member_name(import)
            && let Some(previous_name) = get_first_local_member_name(previous)
            && self.compare(name, previous_name) == Ordering::Less
        {
            cx.report(node, SORT_IMPORTS_ALPHABETICALLY);
        }
    }

    fn check_members<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = statement.kind() else {
            return;
        };
        let specifiers = import.named();
        let is_unsorted = |(before, specifier): &(ImportSpec<'a>, ImportSpec<'a>)| {
            self.compare(before.local().bytes(), specifier.local().bytes()) == Ordering::Greater
        };
        let Some((_, first_unsorted)) = specifiers.iter().zip(specifiers.iter().skip(1)).find(is_unsorted) else {
            return;
        };
        cx.report(first_unsorted, SORT_MEMBERS_ALPHABETICALLY)
            .data("memberName", first_unsorted.local())
            .fix(|fixer| {
                let file = fixer.file();
                let has_comments = |specifier: ImportSpec<'a>| {
                    file.comments_before(specifier).len() > 0 || file.comments_after(specifier).len() > 0
                };
                if specifiers.iter().any(has_comments) {
                    return None;
                }
                let written: Vec<ImportSpec<'a>> = specifiers.iter().collect();
                let mut sorted = written.clone();
                array_sort_by(&mut sorted, |a, b| {
                    self.compare(a.local().bytes(), b.local().bytes()) != Ordering::Greater
                });
                // What is between the specifiers stays where it is.
                let mut text = Vec::new();
                for (i, specifier) in sorted.iter().enumerate() {
                    text.extend_from_slice(specifier.text());
                    if let (Some(this), Some(next)) = (written.get(i), written.get(i + 1)) {
                        text.extend_from_slice(file.slice(this.span().between(next.span())));
                    }
                }
                Some(fixer.replace(written.first()?.span().to(written.last()?.span()), text))
            });
    }
}

impl Rule for SortImports {
    const META: Meta = Meta::eslint("sort-imports", Kind::Suggestion).fixable(Fixable::Code);
    /// The import declaration before.
    type State<'a> = Option<Import<'a>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut rank = [0, 1, 2, 3];
        for (place, name) in options.strings("memberSyntaxSortOrder").into_iter().enumerate() {
            if let Some(syntax) = Syntax::ALL.into_iter().find(|it| it.name() == name) {
                rank[syntax as usize] = place;
            }
        }
        SortImports {
            ignore_case: options.bool_or("ignoreCase", false),
            ignore_declaration_sort: options.bool_or("ignoreDeclarationSort", false),
            ignore_member_sort: options.bool_or("ignoreMemberSort", false),
            allow_separated_groups: options.bool_or("allowSeparatedGroups", false),
            rank,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        if !self.ignore_declaration_sort {
            on.enter(StmtTag::Import, Self::check_declaration);
        }
        if !self.ignore_member_sort {
            on.stmts([StmtTag::Import], Self::check_members);
        }
        None
    }
}
