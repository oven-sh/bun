use bun_core::strings;
use bun_lint::prelude::*;
use std::borrow::Cow;
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

    /// As oxlint writes it.
    fn capitalized_name(self) -> &'static str {
        match self {
            Syntax::None => "None",
            Syntax::All => "All",
            Syntax::Multiple => "Multiple",
            Syntax::Single => "Single",
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

/// What is compared of the import declaration before.
pub struct Previous<'a> {
    syntax: Syntax,
    first_local_member_name: Option<&'a [u8]>,
    end: u32,
}

impl SortImports {
    fn compare(&self, a: &[u8], b: &[u8]) -> Ordering {
        match self.ignore_case {
            true => strings::order_utf16(&text::to_lower_case(a), &text::to_lower_case(b)),
            false => strings::order_utf16(a, b),
        }
    }

    /// `specifiers.sort((a, b) => name(a) > name(b) ? 1 : -1)`: of two with the same name, the later one ends up
    /// first.
    fn sort(&self, specifiers: &mut [ImportSpec<'_>]) {
        let key = |name| match self.ignore_case {
            true => text::to_lower_case(name),
            false => Cow::Borrowed(name),
        };
        let mut sorted: Vec<_> = specifiers.iter().rev().map(|it| (key(it.local().bytes()), *it)).collect();
        utils::sort::sort_by(&mut sorted, |a, b| strings::order_utf16(&a.0, &b.0));
        for (specifier, (_, next)) in specifiers.iter_mut().zip(sorted) {
            *specifier = next;
        }
    }

    /// How the import declaration `statement` is placed after the one before it in the source.
    fn check_declaration<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(import) = statement.as_import() else {
            return;
        };
        if import.span().start >= cx.state.1 {
            return;
        }
        let (syntax, first_local_member_name) = (used_member_syntax(import), get_first_local_member_name(import));
        let this = Previous {
            syntax,
            first_local_member_name,
            end: import.span().end,
        };
        let Some(previous) = cx.state.0.replace(this) else {
            return;
        };
        if self.allow_separated_groups && cx.line_of(import.span().start) > cx.line_of(previous.end) + 1 {
            return;
        }
        let previous_syntax = previous.syntax;
        if syntax != previous_syntax {
            if self.rank[syntax as usize] < self.rank[previous_syntax as usize] {
                let name: fn(Syntax) -> &'static str = match cx.language().is_oxlint {
                    true => Syntax::capitalized_name,
                    false => Syntax::name,
                };
                cx.report(statement, UNEXPECTED_SYNTAX_ORDER)
                    .data("syntaxA", name(syntax))
                    .data("syntaxB", name(previous_syntax));
            }
        } else if let Some(name) = first_local_member_name
            && let Some(previous_name) = previous.first_local_member_name
            && self.compare(name, previous_name) == Ordering::Less
        {
            cx.report(statement, SORT_IMPORTS_ALPHABETICALLY);
        }
    }
}

impl Rule for SortImports {
    const META: Meta = Meta::eslint("sort-imports", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Import]).finish();
    /// The import declaration before, and where those end that are looked at.
    type State<'a> = (Option<Previous<'a>>, u32);

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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.ignore_declaration_sort {
            on = on.finish();
        }
        if !self.ignore_member_sort {
            on = on.stmts(&[StmtTag::Import]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.has_stmts([StmtTag::Import]) {
            return None;
        }
        // oxlint stops at the first statement that is no import declaration.
        let first = file.body().iter().skip_while(|it| it.directive().is_some());
        let end = match file.language().is_oxlint {
            true => first.take_while(|it| it.tag() == StmtTag::Import).last().map_or(0, |it| it.span().end),
            false => u32::MAX,
        };
        (end > 0).then_some((None, end))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let start = |it: &Stmt| it.span().start;
        if file.stmts_of_kind(StmtTag::Import).is_sorted_by_key(|it| start(&it)) {
            file.stmts_of_kind(StmtTag::Import).for_each(|it| self.check_declaration(it, cx));
            return;
        }
        let mut sorted: Vec<Stmt> = file.stmts_of_kind(StmtTag::Import).collect();
        utils::sort::sort_by_key(&mut sorted, start);
        sorted.into_iter().for_each(|it| self.check_declaration(it, cx));
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(import) = statement.as_import() else {
            return;
        };
        if import.span().start >= cx.state.1 {
            return;
        }
        let specifiers = import.named();
        let mut rest = specifiers.iter();
        let Some(mut before) = rest.next().map(|it| it.local().bytes()) else {
            return;
        };
        let is_unsorted = |specifier: &ImportSpec<'a>| {
            let name = specifier.local().bytes();
            self.compare(std::mem::replace(&mut before, name), name) == Ordering::Greater
        };
        let Some(first_unsorted) = rest.find(is_unsorted) else {
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
                self.sort(&mut sorted);
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
