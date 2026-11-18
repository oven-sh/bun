//! Which exceptions a function catches at a call site.

use bun_engine_wasm_format::TagIndex;

use crate::output::Clause;

/// The part of a `try` or `try_table` in which it catches.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Scope(u32);

impl Scope {
    /// Outside of all.
    pub(crate) const NONE: Self = Self(u32::MAX);

    pub(crate) fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Default)]
pub(crate) struct Scopes {
    /// For each, the one that gets what it does not catch, which is older. After `finish`, the first clause.
    links: Vec<u32>,
    clauses: Vec<(Scope, Option<TagIndex>)>,
}

impl Scopes {
    pub(crate) fn clear(&mut self) {
        self.links.clear();
        self.clauses.clear();
    }

    pub(crate) fn open(&mut self, outer: Scope) -> Scope {
        self.links.push(outer.0);
        Scope(self.links.len() as u32 - 1)
    }

    pub(crate) fn delegate(&mut self, from: Scope, to: Scope) {
        self.links[from.index()] = to.0;
    }

    /// `None` catches all.
    pub(crate) fn add(&mut self, scope: Scope, tag: Option<TagIndex>) {
        self.clauses.push((scope, tag));
    }

    pub(crate) fn finish(&mut self) -> Vec<Clause> {
        self.clauses.sort_unstable_by_key(|clause| clause.0);
        let mut linked = Vec::with_capacity(self.clauses.len());
        let mut rest = self.clauses.iter().peekable();
        for index in 0..self.links.len() {
            let mut first = self.first_clause(Scope(self.links[index]));
            while let Some(&(_, tag)) = rest.next_if(|clause| clause.0.index() == index) {
                linked.push(Clause { tag, next: first });
                first = linked.len() as u32 - 1;
            }
            self.links[index] = first;
        }
        linked
    }

    /// After `finish`.
    pub(crate) fn first_clause(&self, scope: Scope) -> u32 {
        (self.links.get(scope.index()).copied()).unwrap_or(u32::MAX)
    }
}
