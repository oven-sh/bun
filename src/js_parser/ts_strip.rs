//! In-place TypeScript type stripping for `module.stripTypeScriptTypes`.
//!
//! Node's `stripTypeScriptTypes` (backed by amaro / swc_ts_fast_strip)
//! replaces type-only syntax with whitespace so that line/column positions in
//! the output match the input exactly. Bun's transpiler re-prints from the
//! AST, which cannot preserve positions, so strip mode is implemented as a
//! separate pass: while the parser skips TypeScript syntax it records the
//! byte spans of every type-only construct (see `P::ts_strip` and the
//! `ts_strip_*` recording helpers), and this module turns those spans into
//! the blanked output.
//!
//! The algorithm is a port of amaro's `swc_ts_fast_strip` visitor
//! (https://github.com/nodejs/amaro/blob/main/deps/swc/crates/swc_ts_fast_strip/src/lib.rs):
//! the same whitespace substitution, the same ASI-protection semicolons, the
//! same "unsupported syntax" rejections with the same messages.

use crate::lexer::T;

/// One token as captured by the lexer when `track_tokens` is enabled.
/// Mirrors swc's `TokenAndSpan` usage in the strip pass: the strip
/// post-processing needs exact token boundaries (to end blanked spans at the
/// last real token, preserving trailing comments) and newline info (for ASI
/// fixes).
#[derive(Clone, Copy, Debug)]
pub struct CapturedToken {
    pub start: u32,
    pub end: u32,
    pub token: T,
    pub has_newline_before: bool,
}

/// Which unsupported construct was hit. Messages match amaro's
/// `swc_ts_fast_strip` byte-for-byte; Node surfaces them as
/// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnsupportedKind {
    Enum,
    Namespace,
    ParameterProperty,
    ImportEquals,
    ExportAssignment,
    TypeAssertion,
    ModuleKeyword,
}

impl UnsupportedKind {
    pub fn message(self) -> &'static str {
        match self {
            UnsupportedKind::Enum => "TypeScript enum is not supported in strip-only mode",
            UnsupportedKind::Namespace => {
                "TypeScript namespace declaration is not supported in strip-only mode"
            }
            UnsupportedKind::ParameterProperty => {
                "TypeScript parameter property is not supported in strip-only mode"
            }
            UnsupportedKind::ImportEquals => {
                "TypeScript import equals declaration is not supported in strip-only mode"
            }
            UnsupportedKind::ExportAssignment => {
                "TypeScript export assignment is not supported in strip-only mode"
            }
            UnsupportedKind::TypeAssertion => {
                "The angle-bracket syntax for type assertions, `<T>expr`, is not supported in type strip mode. Instead, use the 'as' syntax: `expr as T`."
            }
            UnsupportedKind::ModuleKeyword => {
                "`module` keyword is not supported. Use `namespace` instead."
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum EntryKind {
    /// Replace the span with whitespace. Used for type annotations, type
    /// parameters/arguments, `implements` clauses, modifier keywords,
    /// `?`/`!` marks, erased import/export specifiers, etc.
    Blank,
    /// A whole erased statement (`interface`, `type`, `declare …`,
    /// `import type`, function overloads, …): blank + `fix_asi`.
    BlankStmt,
    /// `expr as T` / `expr satisfies T`: the span covers `as`/`satisfies`
    /// through the end of the type. Gets `fix_asi_in_expr`.
    BlankAs {
        /// `expr as const` (const assertion): mirrors swc, which skips
        /// `fix_asi_in_expr` for `TsConstAssertion`.
        is_const_assertion: bool,
    },
    /// Arrow-function type parameter list `<T, …>`. Needs the async/newline
    /// `(`-rewrite from swc's `visit_arrow_expr` / `fix_asi_in_arrow_expr`.
    ArrowTypeParams { is_async: bool },
    /// Arrow-function return type `: T` between `)` and `=>`. When the type
    /// spans a newline, `()\n: T =>` erased to spaces would put a line break
    /// between `)` and `=>` (illegal); swc shifts the `)` down to the type's
    /// last character.
    ArrowReturnType,
    /// Write `b';'` at `lo` (span is 1 byte). Emitted for the ASI hazards a
    /// blanked span cannot express (swc's class-member overwrites).
    SemiOverwrite,
    /// Unsupported syntax: error unless the span is contained in an erased
    /// (blanked) region — containment models swc's "ambient subtrees are
    /// never visited" behavior.
    Unsupported(UnsupportedKind),
}

#[derive(Clone, Copy, Debug)]
pub struct Entry {
    pub kind: EntryKind,
    pub lo: u32,
    /// Exclusive upper bound. May overshoot into trailing trivia
    /// (whitespace/comments before the next token); `apply` snaps it back to
    /// the end of the last token that starts inside the span.
    pub hi: u32,
}

/// Spans recorded by the parser while `Features::ts_strip_mode` is on.
#[derive(Default)]
pub struct Recorder {
    pub entries: Vec<Entry>,
}

impl Recorder {
    #[inline]
    pub fn record(&mut self, kind: EntryKind, lo: u32, hi: u32) {
        self.entries.push(Entry { kind, lo, hi });
    }
}

pub struct StripError {
    pub kind: UnsupportedKind,
    /// Byte offsets of the offending construct (for the `filename:line`
    /// snippet Node prepends to the error stack).
    pub lo: u32,
    pub hi: u32,
}


struct Strip<'s> {
    tokens: &'s [CapturedToken],
    /// (span_lo, span_hi) pairs to blank, in recording order.
    replacements: Vec<(u32, u32)>,
    /// (pos, byte) single-byte overwrites, applied after blanking.
    overwrites: Vec<(u32, u8)>,
}

impl Strip<'_> {
    /// Index of the first token whose start is >= `pos`.
    fn next_token_index(&self, pos: u32) -> usize {
        self.tokens.partition_point(|t| t.start < pos)
    }

    fn next_token(&self, pos: u32) -> Option<&CapturedToken> {
        self.tokens.get(self.next_token_index(pos))
    }

    /// Index of the token at `pos`, or the nearest token before it.
    fn prev_token_index(&self, pos: u32) -> usize {
        let idx = self.tokens.partition_point(|t| t.start < pos);
        match self.tokens.get(idx) {
            Some(t) if t.start == pos => idx,
            _ => idx.saturating_sub(1),
        }
    }

    /// Snap an entry's exclusive `hi` bound back to the end of the last
    /// token that begins inside `[lo, hi)`, so trailing trivia (comments)
    /// after the construct survives.
    fn snap_hi(&self, lo: u32, hi: u32) -> u32 {
        let idx = self.tokens.partition_point(|t| t.start < hi);
        if idx == 0 {
            return hi;
        }
        let t = &self.tokens[idx - 1];
        if t.start >= lo { t.end.min(hi).max(lo) } else { hi }
    }

    /// Port of swc `TsStrip::fix_asi`: after erasing a whole statement,
    /// decide whether the next line could fuse with the previous statement
    /// and protect with a `;`.
    fn fix_asi(&mut self, lo: u32, hi: u32) {
        let index = self.prev_token_index(lo);
        if index == 0 {
            // The erased statement is the first token of the file.
            return;
        }
        let prev = self.tokens[index - 1];

        let index = self.prev_token_index(hi.saturating_sub(1));
        if index + 1 >= self.tokens.len() {
            return;
        }
        let next = self.tokens[index + 1];
        if !next.has_newline_before {
            return;
        }

        // https://tc39.es/ecma262/#sec-asi-interesting-cases-in-statement-lists
        // `[`, `(`, `/`, `+`, `-`, backtick. (A regex after a statement
        // boundary is first lexed as `/`; both spellings land on TSlash.)
        match next.token {
            T::TOpenParen
            | T::TOpenBracket
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead
            | T::TPlus
            | T::TMinus
            | T::TSlash => {
                if prev.token == T::TSemicolon {
                    // The previous statement's own `;` may itself sit inside
                    // an erased span; re-materialize it instead of adding a
                    // second one.
                    self.overwrites.push((prev.start, b';'));
                    return;
                }
                self.overwrites.push((lo, b';'));
            }
            _ => {}
        }
    }

    /// Port of swc `TsStrip::fix_asi_in_expr` for `as` / `satisfies` spans.
    fn fix_asi_in_expr(&mut self, lo: u32, hi: u32) {
        let index = self.prev_token_index(hi.saturating_sub(1));
        if index + 1 >= self.tokens.len() {
            return;
        }
        let next = self.tokens[index + 1];
        if next.has_newline_before
            && matches!(
                next.token,
                T::TOpenParen
                    | T::TOpenBracket
                    | T::TNoSubstitutionTemplateLiteral
                    | T::TTemplateHead
            )
        {
            self.overwrites.push((lo, b';'));
        }
    }

}


fn span_has_newline(src: &[u8], lo: u32, hi: u32) -> bool {
    let bytes = &src[lo as usize..hi as usize];
    if bytes.iter().any(|&b| b == b'\n' || b == b'\r') {
        return true;
    }
    // U+2028/U+2029 line separators (E2 80 A8 / E2 80 A9).
    bytes
        .windows(3)
        .any(|w| w[0] == 0xe2 && w[1] == 0x80 && (w[2] == 0xa8 || w[2] == 0xa9))
}

/// Apply the recorded strip entries to `source`, producing the blanked
/// output, or the first unsupported-syntax error in source order.
pub fn apply(
    source: &[u8],
    tokens: &[CapturedToken],
    entries: &[Entry],
) -> Result<Vec<u8>, StripError> {
    let mut strip = Strip {
        tokens,
        replacements: Vec::new(),
        overwrites: Vec::new(),
    };

    // amaro runs its deprecated-`module`-keyword check before the strip
    // visitor, so a `module N {}` anywhere wins over other errors.
    for e in entries {
        if let EntryKind::Unsupported(UnsupportedKind::ModuleKeyword) = e.kind {
            return Err(StripError {
                kind: UnsupportedKind::ModuleKeyword,
                lo: e.lo,
                hi: e.hi,
            });
        }
    }

    // First pass: collect all blanked spans (needed for error suppression).
    let mut blanks: Vec<(u32, u32)> = Vec::new();
    for e in entries {
        match e.kind {
            EntryKind::Blank
            | EntryKind::BlankStmt
            | EntryKind::BlankAs { .. }
            | EntryKind::ArrowTypeParams { .. }
            | EntryKind::ArrowReturnType => {
                blanks.push((e.lo, strip.snap_hi(e.lo, e.hi)));
            }
            _ => {}
        }
    }

    // Errors: first (by source position) unsupported construct that is not
    // contained in an erased region.
    let mut first_error: Option<StripError> = None;
    let mut consider = |err: StripError| {
        if blanks
            .iter()
            .any(|&(lo, hi)| lo <= err.lo && err.hi <= hi && (lo, hi) != (err.lo, err.hi))
        {
            return;
        }
        match &first_error {
            Some(prev) if prev.lo <= err.lo => {}
            _ => first_error = Some(err),
        }
    };

    for e in entries {
        match e.kind {
            EntryKind::Unsupported(kind) => {
                consider(StripError {
                    kind,
                    lo: e.lo,
                    hi: strip.snap_hi(e.lo, e.hi),
                });
            }
            _ => {}
        }
    }

    if let Some(err) = first_error {
        return Err(err);
    }

    // Second pass: build replacements + overwrites.
    for e in entries {
        let hi = strip.snap_hi(e.lo, e.hi);
        match e.kind {
            EntryKind::Blank => strip.replacements.push((e.lo, hi)),
            EntryKind::BlankStmt => {
                strip.replacements.push((e.lo, hi));
                // `declare interface I {}` records both the inner interface
                // span and the outer declare span; only the outermost erased
                // statement gets the ASI-protection semicolon.
                let contained = blanks
                    .iter()
                    .any(|&(lo, bhi)| lo <= e.lo && hi <= bhi && (lo, bhi) != (e.lo, hi));
                if !contained {
                    strip.fix_asi(e.lo, hi);
                }
            }
            EntryKind::BlankAs { is_const_assertion } => {
                strip.replacements.push((e.lo, hi));
                if !is_const_assertion {
                    strip.fix_asi_in_expr(e.lo, hi);
                }
            }
            EntryKind::ArrowReturnType => {
                strip.replacements.push((e.lo, hi));
                let r_paren_idx = strip.prev_token_index(e.lo).saturating_sub(1);
                let Some(r_paren) = strip.tokens.get(r_paren_idx).copied() else {
                    continue;
                };
                let Some(arrow) = strip.next_token(hi).copied() else {
                    continue;
                };
                if r_paren.token != T::TCloseParen || arrow.token != T::TEqualsGreaterThan {
                    continue;
                }
                if !span_has_newline(source, r_paren.start, arrow.start) {
                    continue;
                }
                // Blank the original `)` and re-materialize it at the end of
                // the erased type so `)` and `=>` share a line (swc
                // visit_arrow_expr).
                strip.replacements.push((r_paren.start, r_paren.end));
                let mut pos = hi.saturating_sub(1);
                // Walk back to a UTF-8 char boundary; the intermediate bytes
                // become spaces.
                while pos > e.lo && (source[pos as usize] as i8) < -0x40 {
                    strip.overwrites.push((pos, b' '));
                    pos -= 1;
                }
                strip.overwrites.push((pos, b')'));
            }
            EntryKind::ArrowTypeParams { is_async } => {
                strip.replacements.push((e.lo, hi));
                // swc visit_arrow_expr: `async <\nT\n>(v) => v` erased to
                // spaces would parse as a call `async\n(v)`; and swc
                // fix_asi_in_arrow_expr: `return <T>\n(v) => v` erased would
                // trigger ASI after `return`. In both cases rewrite the `<`
                // to `(` and blank the original `(`.
                let Some(l_paren) = strip.next_token(hi) else {
                    continue;
                };
                if l_paren.token != T::TOpenParen {
                    continue;
                }
                let l_paren_start = l_paren.start;
                let rewrite = if is_async {
                    span_has_newline(source, e.lo, hi)
                } else {
                    let prev_idx = strip.prev_token_index(e.lo);
                    let in_ret_ctx = prev_idx > 0 && {
                        let t = strip.tokens[prev_idx - 1];
                        matches!(t.token, T::TReturn | T::TThrow)
                            || &source[t.start as usize..t.end as usize] == b"yield"
                    };
                    in_ret_ctx && span_has_newline(source, hi, l_paren_start)
                };
                if rewrite {
                    strip.overwrites.push((l_paren_start, b' '));
                    strip.overwrites.push((e.lo, b'('));
                }
            }
            EntryKind::SemiOverwrite => strip.overwrites.push((e.lo, b';')),
            EntryKind::Unsupported(_) => {}
        }
    }

    // Blank the spans. Character-level port of swc's replacement loop:
    // existing whitespace and line terminators are kept, everything else
    // becomes a space of the same UTF-8 width (U+0020 / U+00A0 / U+2002, and
    // U+0020+U+FEFF for 4-byte characters).
    let mut out = source.to_vec();
    let text = match core::str::from_utf8(source) {
        Ok(t) => t,
        // The parser only accepts valid UTF-8; nothing to blank safely.
        Err(_) => return Ok(out),
    };
    for &(lo, hi) in &strip.replacements {
        let (start, end) = (lo as usize, hi as usize);
        if start >= end || end > out.len() {
            continue;
        }
        for (i, c) in text[start..end].char_indices() {
            let i = start + i;
            match c {
                // https://262.ecma-international.org/#sec-white-space
                '\u{0009}' | '\u{000B}' | '\u{000C}' | '\u{FEFF}' => continue,
                // Space_Separator
                '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}'
                | '\u{205F}' | '\u{3000}' => continue,
                // https://262.ecma-international.org/#sec-line-terminators
                '\u{000A}' | '\u{000D}' | '\u{2028}' | '\u{2029}' => continue,
                _ => match c.len_utf8() {
                    1 => out[i] = 0x20,
                    2 => {
                        // No-Break Space U+00A0
                        out[i] = 0xc2;
                        out[i + 1] = 0xa0;
                    }
                    3 => {
                        // En Space U+2002
                        out[i] = 0xe2;
                        out[i + 1] = 0x80;
                        out[i + 2] = 0x82;
                    }
                    4 => {
                        // Space + ZWNBSP U+FEFF (no 4-byte space exists)
                        out[i] = 0x20;
                        out[i + 1] = 0xef;
                        out[i + 2] = 0xbb;
                        out[i + 3] = 0xbf;
                    }
                    _ => unreachable!(),
                },
            }
        }
    }

    for &(pos, byte) in &strip.overwrites {
        if (pos as usize) < out.len() {
            out[pos as usize] = byte;
        }
    }

    Ok(out)
}

// ─── Parser-side recording helpers ───

use crate::p::P;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Whether strip-mode span recording is enabled for this parse.
    #[inline]
    pub fn ts_strip_active(&self) -> bool {
        self.ts_strip.is_some()
    }

    /// Record a construct that started at `lo` and has been fully consumed:
    /// the lexer now sits on the first token *after* it, so the current token
    /// start is an exclusive upper bound (snapped to the last real token by
    /// `apply`).
    #[inline]
    pub fn ts_strip_record_to_here(&mut self, kind: EntryKind, lo: u32) {
        let hi = self.lexer.start as u32;
        if let Some(r) = &mut self.ts_strip {
            // Several call sites cover optional syntax (`skip_type_script_type_parameters`
            // consumes nothing when there is no `<`); skip empty spans.
            if hi > lo {
                r.record(kind, lo, hi);
            }
        }
    }

    /// Record a construct with an explicit span.
    #[inline]
    pub fn ts_strip_record_span(&mut self, kind: EntryKind, lo: u32, hi: u32) {
        if let Some(r) = &mut self.ts_strip {
            r.record(kind, lo, hi);
        }
    }

    /// `export interface I {}` and friends re-enter `parse_stmt`, so the
    /// erased-statement span recorded by the callee starts at the inner
    /// keyword. Extend it to cover the `export` keyword (swc blanks the whole
    /// `ExportDecl` span).
    #[inline]
    pub fn ts_strip_forward_export(&mut self, export_lo: u32, stmt: &bun_ast::Stmt) {
        let Some(r) = &mut self.ts_strip else { return };
        if !matches!(stmt.data, bun_ast::StmtData::STypeScript(_)) {
            return;
        }
        if let Some(last) = r.entries.last_mut() {
            if matches!(last.kind, EntryKind::BlankStmt) && last.lo == stmt.loc.start as u32 {
                last.lo = export_lo;
            }
        }
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Run the strip post-processing over the recorded spans (strip mode
    /// only; `None` otherwise). Called once from `to_ast`.
    pub fn take_ts_strip_output(&mut self) -> Option<Box<bun_ast::TsStripOutput>> {
        let recorder = self.ts_strip.take()?;
        let tokens = core::mem::take(&mut self.lexer.captured_tokens);
        let source = self.source.contents.as_ref();
        Some(Box::new(
            match apply(source, &tokens, &recorder.entries) {
                Ok(code) => bun_ast::TsStripOutput::Code(code),
                Err(err) => bun_ast::TsStripOutput::Unsupported {
                    message: err.kind.message(),
                    lo: err.lo,
                    hi: err.hi,
                },
            },
        ))
    }
}
