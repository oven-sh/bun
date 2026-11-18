use bun_engine_text::{AllocError, Text};

use crate::construct::{GroupNames, build};
use crate::tree::Tree;
use crate::{Error, Flags, Form};

/// A parsed pattern.
pub struct Pattern {
    tree: Tree,
    names: Option<Box<GroupNames>>,
}

impl Pattern {
    pub fn new(source: Text<'_>, flags: Flags) -> Result<Pattern, Error> {
        let mut pattern = Pattern {
            tree: Tree::new(flags),
            names: None,
        };
        pattern.names = build(source, flags, &mut pattern.tree)?;
        Ok(pattern)
    }

    #[inline]
    pub fn tree(&self) -> &Tree {
        &self.tree
    }

    /// The whole match does not count.
    #[inline]
    pub fn group_count(&self) -> u16 {
        self.tree.group_count()
    }

    #[inline]
    pub fn group_names(&self) -> &GroupNames {
        self.names.as_deref().unwrap_or(GroupNames::NONE)
    }

    pub fn take_group_names(&mut self) -> GroupNames {
        (self.names.take()).map_or_else(GroupNames::default, |names| *names)
    }

    pub fn form(&self) -> Result<Option<Form>, AllocError> {
        Form::of(&self.tree)
    }
}
