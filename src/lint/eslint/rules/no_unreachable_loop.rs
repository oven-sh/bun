use bun_lint::prelude::*;

/// Disallow loops with a body that allows only one iteration.
pub struct NoUnreachableLoop {
    /// The kinds of loops that are not ignored.
    checked: Vec<StmtTag>,
}

const INVALID: Message =
    Message::new("invalid", "Invalid loop. Its body allows only one iteration.");

impl Rule for NoUnreachableLoop {
    const META: Meta = Meta::eslint("no-unreachable-loop", Kind::Problem).reports_at_the_end();
    const ON: On = On::new().stmts(&[
        StmtTag::While,
        StmtTag::DoWhile,
        StmtTag::For,
        StmtTag::ForIn,
        StmtTag::ForOf,
    ]);
    no_state!();

    fn new(options: &Options) -> Self {
        let ignored = options.object(0).strings("ignore");
        let kinds = [
            ("WhileStatement", StmtTag::While),
            ("DoWhileStatement", StmtTag::DoWhile),
            ("ForStatement", StmtTag::For),
            ("ForInStatement", StmtTag::ForIn),
            ("ForOfStatement", StmtTag::ForOf),
        ];
        let checked = kinds.into_iter().filter(|kind| !ignored.contains(&kind.0));
        NoUnreachableLoop {
            checked: checked.map(|kind| kind.1).collect(),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        On::new().stmts(&self.checked)
    }

    fn stmt<'a>(&self, it: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // The analysis does not tell enough about a loop that cannot be reached.
        if !it.is_repeating_loop() && it.is_reachable() {
            cx.report(it, INVALID);
        }
    }
}
