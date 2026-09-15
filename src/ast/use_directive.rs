use bun_core::strings;

use crate::{Loc, Range};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UseDirective {
    // TODO: Remove this, and provide `UseDirective.Optional` instead
    None = 0,
    /// "use client"
    Client = 1,
    /// "use server"
    Server = 2,
}

/// What `parse` skips before the directive.
const LEADING: &[u8] = b" \t\n\r;";
/// A quoted directive and the byte after it. Both directives have this length.
const DIRECTIVE_LEN: usize = b"'use client';".len();

impl UseDirective {
    pub fn parse(contents: &[u8]) -> Option<UseDirective> {
        let truncated = strings::trim_left(contents, LEADING);

        if truncated.len() < DIRECTIVE_LEN {
            return Some(UseDirective::None);
        }

        let directive_string = &truncated[0..DIRECTIVE_LEN];

        let first_quote = directive_string[0];
        let last_quote = directive_string[DIRECTIVE_LEN - 2];
        if first_quote != last_quote
            || (first_quote != b'"' && first_quote != b'\'' && first_quote != b'`')
        {
            return Some(UseDirective::None);
        }

        let unquoted = &directive_string[1..DIRECTIVE_LEN - 2];

        if unquoted == b"use client" {
            return Some(UseDirective::Client);
        }

        if unquoted == b"use server" {
            return Some(UseDirective::Server);
        }

        None
    }

    /// Where the quoted directive that `parse` matched sits in `contents`.
    pub fn range(contents: &[u8]) -> Range {
        let start = contents.len() - strings::trim_left(contents, LEADING).len();
        // This runs before a parser rejects a source over `Source::MAX_PARSEABLE_LEN`.
        match i32::try_from(start) {
            Ok(start) => Range {
                loc: Loc { start },
                len: (DIRECTIVE_LEN - 1) as i32,
            },
            Err(_) => Range::NONE,
        }
    }
}
