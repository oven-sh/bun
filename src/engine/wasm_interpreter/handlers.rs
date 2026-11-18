//! Where a function catches exceptions.

use bun_engine_wasm_format::{OutOfMemory, TagIndex};

const NONE: u32 = u32::MAX;

/// The part of a `try` or `try_table` in which it catches.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Scope(u32);

impl Scope {
    /// Outside of all.
    pub(crate) const NONE: Self = Self(NONE);
}

struct Links {
    /// Gets what this one does not catch. It is older.
    outer: Scope,
    first_clause: u32,
    last_clause: u32,
}

struct Clause {
    /// `None` catches all.
    tag: Option<TagIndex>,
    target: u32,
    next: u32,
}

#[derive(Default)]
pub(crate) struct Handlers {
    /// The index of a record, and the innermost scope from there on. In order.
    changes: Vec<(u32, Scope)>,
    scopes: Vec<Links>,
    clauses: Vec<Clause>,
}

impl Handlers {
    pub(crate) fn open(&mut self, outer: Scope) -> Result<Scope, OutOfMemory> {
        self.scopes.try_reserve(1)?;
        self.scopes.push(Links {
            outer,
            first_clause: NONE,
            last_clause: NONE,
        });
        Ok(Scope(self.scopes.len() as u32 - 1))
    }

    pub(crate) fn delegate(&mut self, from: Scope, to: Scope) {
        self.scopes[from.0 as usize].outer = to;
    }

    pub(crate) fn change(&mut self, from: u32, scope: Scope) -> Result<(), OutOfMemory> {
        self.changes.try_reserve(1)?;
        self.changes.push((from, scope));
        Ok(())
    }

    pub(crate) fn add(
        &mut self,
        scope: Scope,
        tag: Option<TagIndex>,
        target: u32,
    ) -> Result<(), OutOfMemory> {
        self.clauses.try_reserve(1)?;
        let (index, links) = (
            self.clauses.len() as u32,
            &mut self.scopes[scope.0 as usize],
        );
        match self.clauses.get_mut(links.last_clause as usize) {
            Some(last) => last.next = index,
            None => links.first_clause = index,
        }
        links.last_clause = index;
        let next = NONE;
        self.clauses.push(Clause { tag, target, next });
        Ok(())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.clauses.is_empty()
    }

    pub(crate) fn size_in_bytes(&self) -> usize {
        size_of_val(&*self.changes) + size_of_val(&*self.scopes) + size_of_val(&*self.clauses)
    }

    /// Where to jump with what the instruction throws that has the record.
    pub(crate) fn find(&self, index: usize, is_tag: impl Fn(TagIndex) -> bool) -> Option<u32> {
        let after = (self.changes).partition_point(|&(from, _)| from as usize <= index);
        let mut scope = self.changes.get(after.checked_sub(1)?)?.1;
        loop {
            let links = self.scopes.get(scope.0 as usize)?;
            let mut next = links.first_clause;
            while let Some(clause) = self.clauses.get(next as usize) {
                if clause.tag.is_none_or(&is_tag) {
                    return Some(clause.target);
                }
                next = clause.next;
            }
            scope = links.outer;
        }
    }
}
