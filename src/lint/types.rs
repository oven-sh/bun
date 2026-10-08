//! Types: what the type checker knows about the file.

use std::cell::RefCell;

/// The queries that the type checker answers, for those who cannot name its lifetimes.
pub trait Queries {}

/// The type checker, right after it has checked the file.
pub struct Checker<'a> {
    #[expect(dead_code)]
    queries: RefCell<&'a mut dyn Queries>,
}

impl<'a> Checker<'a> {
    pub fn new(queries: &'a mut dyn Queries) -> Self {
        Checker {
            queries: RefCell::new(queries),
        }
    }
}
