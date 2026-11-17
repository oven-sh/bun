//! Which legacy octal numbers and escapes of a text parsed for `bun compile` are early errors: those in code that the parser of `bun run` reads as strict. It prints the value of every other.

use bun_sema::hir::*;
use bun_sema::util::SharedSort;

/// Of `flagged`, the `(code, start, end)` of every legacy octal form in the text, keeps those that `bun run` reports.
#[cold]
#[inline(never)]
pub(super) fn keep_early_errors(
    file: &FileBuilder,
    text: &[u8],
    flagged: &mut Vec<(u32, u32, u32)>,
) {
    if !file.is_js {
        let unchecked = Ranges::new(unchecked_ranges(file));
        flagged.retain(|&(_, _, end)| !unchecked.contain(end));
    }
    if flagged.is_empty() || file.is_parsed_as_strict_by_bun_run(text) {
        return;
    }
    let strict = Ranges::new(file.ranges_parsed_as_strict_by_bun_run());
    flagged.retain(|&(_, _, end)| strict.contain(end));
}

/// Sorted by start, and each end is the furthest end up to there.
struct Ranges(Vec<(u32, u32)>);

impl Ranges {
    fn new(mut ranges: Vec<(u32, u32)>) -> Ranges {
        ranges.shared_sort_unstable();
        let mut reach = 0;
        for range in &mut ranges {
            reach = reach.max(range.1);
            range.1 = reach;
        }
        Ranges(ranges)
    }

    /// True if a token that ends at `end` is in one of them. The end says where a form is: `-010` is flagged from its sign.
    fn contain(&self, end: u32) -> bool {
        let started = self.0.partition_point(|range| range.0 < end);
        let reach = started.checked_sub(1).and_then(|last| self.0.get(last));
        reach.is_some_and(|range| end <= range.1)
    }
}

/// In text read as TypeScript, what the parser of `bun run` does not check: a type, an interface, and what follows `declare` in a statement.
fn unchecked_ranges(file: &FileBuilder) -> Vec<(u32, u32)> {
    let passed_over = |statement: &Stmt| {
        let (flags, start) = match statement.kind {
            StmtKind::Interface(_) => return Some((statement.start, statement.loc.end)),
            StmtKind::Var(declarations) => {
                let first = declarations.iter().next()?;
                (file.var_decls.get(first.idx())?.flags, statement.start)
            }
            StmtKind::Fn(function) => (file.fns.get(function.idx())?.flags, statement.start),
            // Its decorators stand in front of `declare`.
            StmtKind::Class(class) => {
                let class = file.classes.get(class.idx())?;
                (class.flags, class.text_start)
            }
            StmtKind::Enum(enumeration) => {
                (file.enums.get(enumeration.idx())?.flags, statement.start)
            }
            StmtKind::Module(module) => (file.modules.get(module.idx())?.flags, statement.start),
            _ => return None,
        };
        (flags.contains(Flags::AMBIENT)).then_some((start, statement.loc.end))
    };
    let types = file.types.iter().map(|it| (it.pos, it.end));
    types
        .chain(file.stmts.iter().filter_map(passed_over))
        .collect()
}
