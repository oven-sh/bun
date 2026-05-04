use bun_str::strings;

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UseDirective {
    // TODO: Remove this, and provide `UseDirective.Optional` instead
    None = 0,
    /// "use client"
    Client = 1,
    /// "use server"
    Server = 2,
}

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Boundering {
    Client = UseDirective::Client as u8,
    Server = UseDirective::Server as u8,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct Flags {
    pub has_any_client: bool,
}

impl UseDirective {
    pub fn is_boundary(self, other: UseDirective) -> bool {
        if self == other || other == UseDirective::None {
            return false;
        }

        true
    }

    pub fn boundering(self, other: UseDirective) -> Option<Boundering> {
        if self == other || other == UseDirective::None {
            return None;
        }
        // SAFETY: `other` is Client or Server here (None excluded above), and
        // Boundering's discriminants are defined to equal UseDirective's.
        Some(unsafe { core::mem::transmute::<u8, Boundering>(other as u8) })
    }

    pub fn parse(contents: &[u8]) -> Option<UseDirective> {
        let truncated = strings::trim_left(contents, b" \t\n\r;");

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/UseDirective.zig (64 lines)
//   confidence: high
//   todos:      0
//   notes:      enum(u2) → #[repr(u8)]; nested Boundering/Flags hoisted to module scope
// ──────────────────────────────────────────────────────────────────────────
