//! Shared lexer→Log error-reporting cluster.
//!
//! js_parser, json, and toml lexers each carried a near-identical 50-line block
//! of `{syntax_error, add_error, add_range_error, add_default_error,
//! add_syntax_error}` that gate on `is_log_disabled`, dedup against
//! `prev_error_loc`, push into `Log`, then record the loc. Zig has two copies
//! (the comptime-generic `NewLexer` covers JS+JSON, toml is hand-duplicated);
//! Rust grew a third when json was split out. This trait collapses all three.
//!
//! The trait carries a `'s` lifetime so `source()` can hand back the lexer's
//! stored `&'s Source` *without* borrowing `self` — that is what lets the
//! provided bodies call `self.log_mut()` afterwards without a split-borrow
//! conflict.

use core::fmt;

use crate::{usize2loc, AddErrorOptions, Loc, Log, Range, Source};

pub trait LexerLog<'s> {
    /// Per-lexer error variant returned from the `*_error` family
    /// (`Error::SyntaxError` for js/toml, `bun_core::err!("SyntaxError")` for
    /// the JSON-subset lexer).
    type Err;

    // ── required state accessors ────────────────────────────────────────
    fn log_mut(&mut self) -> &mut Log;
    /// NB: returns the lexer-stored `&'s Source`, *not* a `&self`-tied borrow.
    fn source(&self) -> &'s Source;
    fn prev_error_loc_mut(&mut self) -> &mut Loc;
    fn start(&self) -> usize;
    fn syntax_err() -> Self::Err;

    /// js/json gate every push on this; toml has no flag (default `false`).
    #[inline]
    fn is_log_disabled(&self) -> bool {
        false
    }
    /// toml threads `should_redact_logs` into every message; js/json don't.
    #[inline]
    fn should_redact(&self) -> bool {
        false
    }

    // ── provided cluster ────────────────────────────────────────────────

    #[cold]
    fn add_error(&mut self, loc: usize, args: fmt::Arguments<'_>) {
        if self.is_log_disabled() {
            return;
        }
        let l = usize2loc(loc);
        if l.eql(*self.prev_error_loc_mut()) {
            return;
        }
        let source = self.source();
        let redact = self.should_redact();
        self.log_mut().add_error_fmt_opts(
            args,
            AddErrorOptions {
                source: Some(source),
                loc: l,
                redact_sensitive_information: redact,
                ..Default::default()
            },
        );
        *self.prev_error_loc_mut() = l;
    }

    #[cold]
    fn add_range_error(&mut self, r: Range, args: fmt::Arguments<'_>) -> Result<(), Self::Err> {
        if self.is_log_disabled() {
            return Ok(());
        }
        if r.loc.eql(*self.prev_error_loc_mut()) {
            return Ok(());
        }
        let source = self.source();
        let redact = self.should_redact();
        self.log_mut().add_error_fmt_opts(
            args,
            AddErrorOptions {
                source: Some(source),
                loc: r.loc,
                len: r.len,
                redact_sensitive_information: redact,
                ..Default::default()
            },
        );
        *self.prev_error_loc_mut() = r.loc;
        Ok(())
    }

    #[cold]
    fn syntax_error(&mut self) -> Result<(), Self::Err> {
        // Only add this if there is not already an error — a more descriptive
        // one may already have been emitted.
        if !self.log_mut().has_errors() {
            self.add_error(self.start(), format_args!("Syntax Error"));
        }
        Err(Self::syntax_err())
    }

    #[cold]
    fn add_default_error(&mut self, msg: &[u8]) -> Result<(), Self::Err> {
        self.add_error(self.start(), format_args!("{}", bstr::BStr::new(msg)));
        Err(Self::syntax_err())
    }

    #[cold]
    fn add_syntax_error(&mut self, loc: usize, args: fmt::Arguments<'_>) -> Result<(), Self::Err> {
        self.add_error(loc, args);
        Err(Self::syntax_err())
    }
}
