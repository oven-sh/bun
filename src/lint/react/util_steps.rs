//! A limit on the ways up the scopes of a file. Upstream goes up from each node that it looks at:
//! m nodes under d scopes cost m x d. Here all the rules of the plugin together have
//! [`STEPS_OF_A_FILE`], and [`STEPS_OF_A_WAY`] more for each way: a way that has none left ends
//! as if there were no more scopes around.

use bun_lint::prelude::*;
use std::cell::Cell;

const STEPS_OF_A_FILE: i64 = 1 << 20;
const STEPS_OF_A_WAY: i64 = 64;

/// How many steps are left. It is kept with the file.
struct Steps(Cell<i64>);

/// One way up. Without a place to keep the steps with the file there is no limit.
#[derive(Copy, Clone)]
pub(crate) struct Way<'a>(Option<&'a Steps>);

impl<'a> Way<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Way<'a> {
        let steps = file.extension(|| Steps(Cell::new(STEPS_OF_A_FILE)));
        if let Some(Steps(left)) = steps {
            left.set(left.get().saturating_add(STEPS_OF_A_WAY));
        }
        Way(steps)
    }

    /// Takes `count` steps. Whether there were any left.
    pub(crate) fn take(self, count: i64) -> bool {
        self.0.is_none_or(|Steps(left)| {
            let before = left.get();
            left.set(before.saturating_sub(count).max(0));
            before > 0
        })
    }
}

/// The scope of `node` and the scopes around it.
pub(crate) fn scopes_around<'a>(node: Node<'a>) -> impl Iterator<Item = Scope<'a>> {
    scopes_around_at(node, 1)
}

/// The same, where what is done in each scope counts for `steps`.
pub(crate) fn scopes_around_at<'a>(node: Node<'a>, steps: i64) -> impl Iterator<Item = Scope<'a>> {
    let way = Way::new(node.file());
    node.scope().chain().take_while(move |_| way.take(steps))
}
