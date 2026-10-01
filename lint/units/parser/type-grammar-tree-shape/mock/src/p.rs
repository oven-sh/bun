#![allow(dead_code)]
use crate::lexer::{Lexer, LexerSnapshot};
use crate::parser::{FindSymbolResult, FnOrArrowDataParse};
use bun_ast::{Log, Ref, Source};

pub struct AllocError;
#[derive(Default)]
pub struct StringBoolMap;
impl StringBoolMap { pub fn put(&mut self, _k: &[u8], _v: bool) -> Result<(), AllocError> { Ok(()) } }

pub struct ParserSnapshot<'a> { lexer: LexerSnapshot<'a>, msgs_len: usize, errors: u32, warnings: u32 }

pub struct P<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> {
    pub lexer: Lexer<'a>,
    pub(crate) log: *mut Log,
    pub(crate) source: &'a Source,
    pub(crate) stack_check: bun_core::StackCheck,
    pub(crate) local_type_names: StringBoolMap,
    pub(crate) ts_infer_constraint_backtracks: Vec<u32>,
    pub(crate) ts_conditional_arrow_attempts: Vec<u32>,
    pub(crate) symbols: Vec<&'a [u8]>,
    pub(crate) trace: Vec<String>,
    pub(crate) top_level_await_keyword: bun_ast::Range,
    pub(crate) parse_pass_symbol_uses: Option<u8>,
    pub(crate) needs_jsx_import: bool,
    pub(crate) has_with_scope: bool,
    pub(crate) has_import_meta: bool,
    pub(crate) has_es_module_syntax: bool,
    pub(crate) fn_or_arrow_data_parse: FnOrArrowDataParse,
    pub(crate) allow_private_identifiers: bool,
    pub(crate) allow_in: bool,
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn init(log: *mut Log, source: &'a Source) -> Self {
        P {
            lexer: Lexer::init(log, source), log, source, stack_check: bun_core::StackCheck::init(),
            local_type_names: StringBoolMap, ts_infer_constraint_backtracks: Vec::new(), ts_conditional_arrow_attempts: Vec::new(),
            symbols: Vec::new(), trace: Vec::new(), top_level_await_keyword: bun_ast::Range::NONE, parse_pass_symbol_uses: None, needs_jsx_import: false, has_with_scope: false, has_import_meta: false, has_es_module_syntax: false, fn_or_arrow_data_parse: FnOrArrowDataParse::default(), allow_private_identifiers: false, allow_in: true,
        }
    }
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn log(&self) -> &mut Log { unsafe { &mut *self.log } }
    #[inline]
    pub(crate) fn mark_type_script_only(&self) { if !TYPESCRIPT { unreachable!(); } }
    pub(crate) fn find_symbol(&mut self, _loc: bun_ast::Loc, name: &'a [u8]) -> Result<FindSymbolResult, crate::Error> {
        self.trace.push(String::from_utf8_lossy(name).into_owned());
        let idx = match self.symbols.iter().position(|s| *s == name) {
            Some(i) => i,
            None => { self.symbols.push(name); self.symbols.len() - 1 }
        };
        Ok(FindSymbolResult { r#ref: Ref(idx as u32), declare_loc: None, is_inside_with_scope: false })
    }
    pub(crate) fn load_name_from_ref(&self, r: Ref) -> &'a [u8] { self.symbols[r.0 as usize] }
    pub(crate) fn parse_export_clause(&mut self) -> Result<(), crate::Error> { Ok(()) }
    pub(crate) fn parse_path(&mut self) -> Result<(), crate::Error> { Ok(()) }
    pub(crate) fn parse_clause_alias(&mut self, _kind: &[u8]) -> Result<(), crate::Error> { Ok(()) }
    pub(crate) fn parser_snapshot(&mut self) -> ParserSnapshot<'a> {
        let log = self.log();
        ParserSnapshot { lexer: self.lexer.snapshot(), msgs_len: log.msgs.len(), errors: log.errors, warnings: log.warnings }
    }
    pub(crate) fn restore_parser_snapshot(&mut self, s: ParserSnapshot<'a>) {
        self.lexer.restore(&s.lexer);
        let log = self.log();
        log.msgs.truncate(s.msgs_len);
        log.errors = s.errors;
        log.warnings = s.warnings;
    }
    /// Mock: tokens up to a "," ")" "]" "}" ";" or "=>" that no bracket holds. An empty expression is an error.
    pub(crate) fn parse_expr(&mut self, _level: bun_ast::op::Level) -> Result<(), crate::Error> {
        use crate::lexer::T;
        let mut depth = 0usize; let mut n = 0usize;
        loop {
            match self.lexer.token {
                T::TEndOfFile => break,
                T::TOpenParen | T::TOpenBracket | T::TOpenBrace => depth += 1,
                T::TCloseParen | T::TCloseBracket | T::TCloseBrace => { if depth == 0 { break; } depth -= 1; }
                T::TComma | T::TSemicolon | T::TEqualsGreaterThan if depth == 0 => break,
                _ => {}
            }
            n += 1;
            self.lexer.next()?;
        }
        if n == 0 { self.lexer.unexpected()?; return Err(crate::Error::SyntaxError); }
        Ok(())
    }
    pub(crate) fn push_scope_for_parse_pass(&mut self, _kind: bun_ast::scope::Kind, _loc: bun_ast::Loc) -> Result<usize, crate::Error> { Ok(0) }
    pub(crate) fn parse_fn_body(&mut self, _data: &mut FnOrArrowDataParse) -> Result<(), crate::Error> {
        use crate::lexer::T;
        self.lexer.expect(T::TOpenBrace)?;
        let mut depth = 1usize;
        while depth > 0 && self.lexer.token != T::TEndOfFile {
            match self.lexer.token { T::TOpenBrace => depth += 1, T::TCloseBrace => depth -= 1, _ => {} }
            self.lexer.next()?;
        }
        Ok(())
    }
    pub(crate) fn parse_arrow_body(&mut self, _args: &mut [u8], _data: &mut FnOrArrowDataParse) -> Result<(), crate::Error> { Ok(()) }
}
