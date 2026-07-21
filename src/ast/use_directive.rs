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

#[derive(Copy, Clone, Default, Debug)]
pub struct Flags {
    pub has_any_client: bool,
}

impl UseDirective {
    pub fn parse(contents: &[u8]) -> Option<UseDirective> {
        let truncated = strings::trim_left(strings::without_utf8_bom(contents), b" \t\n\r;");

        const DIRECTIVE_LEN: usize = b"'use client';".len();

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
}
