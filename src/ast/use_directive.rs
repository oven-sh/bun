use crate::{Loc, Range};
use bun_core::strings;

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

const SKIPPED_PREFIX: &[u8] = b" \t\n\r;";
const QUOTED_LEN: usize = b"'use client'".len();

impl UseDirective {
    pub fn parse(contents: &[u8]) -> Option<UseDirective> {
        let truncated = strings::trim_left(contents, SKIPPED_PREFIX);

        if truncated.len() < QUOTED_LEN {
            return Some(UseDirective::None);
        }

        let directive_string = &truncated[0..QUOTED_LEN];

        let first_quote = directive_string[0];
        let last_quote = directive_string[QUOTED_LEN - 1];
        if first_quote != last_quote
            || (first_quote != b'"' && first_quote != b'\'' && first_quote != b'`')
        {
            return Some(UseDirective::None);
        }

        let unquoted = &directive_string[1..QUOTED_LEN - 1];

        if unquoted == b"use client" {
            return Some(UseDirective::Client);
        }

        if unquoted == b"use server" {
            return Some(UseDirective::Server);
        }

        None
    }

    /// Where the quoted directive that [`parse`](Self::parse) matched sits in `contents`.
    pub fn range(contents: &[u8]) -> Range {
        let start = contents.len() - strings::trim_left(contents, SKIPPED_PREFIX).len();
        Range {
            loc: Loc {
                start: i32::try_from(start).unwrap_or(i32::MAX),
            },
            len: QUOTED_LEN as i32,
        }
    }
}
