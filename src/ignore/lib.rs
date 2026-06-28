//! Gitignore engine: git's `wildmatch` + per-directory `.gitignore` stacks.
//!
//! Authoritative upstream references (cited throughout):
//! - gitignore(5): https://git-scm.com/docs/gitignore
//! - git.git `wildmatch.c` (the `dowild` matcher)
//! - git.git `dir.c` (`parse_path_pattern`, `match_basename`, `match_pathname`,
//!   `last_matching_pattern_from_list`, `prep_exclude`)
//! - git.git `ctype.c` (the locale-independent ASCII classes wildmatch uses)
//!
//! Path convention (shared with the rest of the file index): paths are byte
//! slices relative to the index root, `/`-separated, no leading `./`, no
//! trailing `/`; the root itself is the empty slice.

mod chain;
mod ignore_file;
mod pattern;
mod wildmatch;

pub use chain::{IgnoreChain, Match};
pub use ignore_file::IgnoreFile;
pub use wildmatch::{WildmatchFlags, wildmatch};

#[cfg(test)]
mod chain_tests;
#[cfg(test)]
mod gitignore_tests;
#[cfg(test)]
mod t3070_tests;
