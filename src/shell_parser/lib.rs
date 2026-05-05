#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ─── B-1 gate-and-stub ──────────────────────────────────────────────────────
// The Phase-A draft of `braces` depends on:
//   - unstable `adt_const_params` (StringEncoding as const generic param)
//   - `bun_str` / `bun_output` / `thiserror` crates (not in Cargo.toml)
//   - `bun_collections::SmallList`, `bun_core::CodePoint` (missing from lower-tier stub surface)
// TODO(b1): bun_collections::SmallList missing
// TODO(b1): bun_core::CodePoint missing
// TODO(b1): bun_str crate not a dependency (bun_string is — Phase-A used wrong name)
// Preserve the draft body verbatim; gate it off and expose a minimal stub surface.
#[cfg(any())]
#[path = "braces.rs"]
pub mod braces_draft;

pub mod braces {
    //! Stub surface for B-1. Real impls live in `braces.rs` (gated above).

    use bun_alloc::AllocError;

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum StringEncoding {
        Ascii,
        Wtf8,
        Utf16,
    }

    #[derive(Copy, Clone)]
    pub struct InputChar {
        pub char: u32,
        pub escaped: bool,
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum ShellCharIterState {
        Normal,
        Single,
        Double,
    }

    /// Opaque stub. Phase-A draft used `<const E: StringEncoding>` (nightly `adt_const_params`).
    pub struct ShellCharIter(());

    pub trait CharIter: Sized {}

    pub fn has_eq_sign(_str: &[u8]) -> Option<u32> {
        todo!("B-2: braces::has_eq_sign")
    }

    pub struct ExpansionVariants(());

    #[derive(Copy, Clone, Debug)]
    pub enum Token {
        // opaque
        _Stub,
    }

    #[derive(Copy, Clone, Debug, PartialEq, Eq)]
    pub enum TokenTag {
        _Stub,
    }

    pub mod ast {
        pub struct Expr(());
    }

    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub enum ParserError {
        OutOfMemory,
        UnexpectedToken,
    }

    pub type ExpandError = ParserError;

    pub fn expand() -> ! {
        todo!("B-2: braces::expand")
    }

    pub struct ParserErrorMsg(());
    pub struct Parser<'a>(core::marker::PhantomData<&'a ()>);

    pub fn calculate_expanded_amount(_tokens: &[Token]) -> u32 {
        todo!("B-2: braces::calculate_expanded_amount")
    }

    /// Opaque stub. Phase-A draft: `NewLexer<{ Encoding::Ascii }>`.
    pub type Lexer = NewLexer;

    pub struct LexerOutput(());

    pub type BraceLexerError = AllocError;

    /// Opaque stub. Phase-A draft used `<const ENCODING: StringEncoding>` (nightly).
    pub struct NewLexer(());
}

// Re-exports the Phase-A draft expected at crate root (it did `use crate::{...}`).
pub use braces::{has_eq_sign, CharIter, ShellCharIter, StringEncoding};
