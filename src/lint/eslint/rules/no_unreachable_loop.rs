use bun_lint::prelude::*;

/// Disallow loops with a body that allows only one iteration.
pub struct NoUnreachableLoop {
    /// The kinds of loops that are not ignored.
    checked: Vec<StmtTag>,
}

const INVALID: Message =
    Message::new("invalid", "Invalid loop. Its body allows only one iteration.");

impl Rule for NoUnreachableLoop {
    const META: Meta = Meta::eslint("no-unreachable-loop", Kind::Problem);
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts(self.checked.iter().copied(), |_, it, cx| {
            // The analysis does not tell enough about a loop that cannot be reached.
            if !it.is_repeating_loop() && it.is_reachable() {
                cx.report(it, INVALID);
            }
        });
    }
}
