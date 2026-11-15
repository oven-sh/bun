use bun_alloc::Arena as Bump;
use bun_core::strings;
use bun_js_parser as js_parser;

// B-3 UNIFIED: `Define` is now the single canonical `bun_js_parser::defines::Define`
// (re-exported via `crate::defines`); `JavaScript::parse`/`scan` and the bundler's
// `BundleOptions.define` share the same nominal type.
use js_parser::defines::Define;

pub use bun_resolver::cache::ExternalFreeFunction;

/// What a parse task parses. A worker's arena, the bundle or a plugin owns the bytes.
pub(crate) type Entry<'a> = bun_resolver::cache::Entry<&'a [u8]>;

pub struct JavaScript {}

impl JavaScript {
    pub fn init() -> JavaScript {
        JavaScript {}
    }
}

impl JavaScript {
    // For now, we're not going to cache JavaScript ASTs.
    // It's probably only relevant when bundling for production.
    pub(crate) fn parse<'a>(
        &self,
        bump: &'a Bump,
        opts: js_parser::ParserOptions<'a>,
        defines: &'a Define,
        log: &bun_ast::Log,
        source: &'a bun_ast::Source<'a>,
        cache: Option<&mut dyn js_parser::TranspilerCache>,
    ) -> Result<Option<js_parser::Result<'a>>, crate::Error> {
        let temp_log = bun_ast::Log::init();
        temp_log.level.set(log.level.get());
        let parser = match js_parser::Parser::init(opts, &temp_log, source, defines, bump) {
            Ok(p) => p,
            Err(_) => {
                temp_log.append_to(log);
                return Ok(None);
            }
        };

        let result = match parser.parse_with_cache(cache) {
            Ok(r) => {
                // The parser halts on every logged error.
                debug_assert_eq!(temp_log.errors.get(), 0);
                r
            }
            Err(err) => {
                // `Parser::parse` consumes `self`, so `parser` is gone in this
                // arm. The lexer range is lost; fall back to `Range::None`.
                // TODO: thread the failing token range through the `Err`
                // payload (make `_parse` return a `(Error, Range)` pair) so the
                // diagnostic points at the failing token.
                if temp_log.errors.get() == 0 {
                    log.add_range_error(Some(source), bun_ast::Range::None, err.name().as_bytes());
                }
                temp_log.append_to(log);
                return Ok(None);
            }
        };

        temp_log.append_to(log);
        Ok(Some(result))
    }

    pub fn scan<'a>(
        &mut self,
        bump: &'a Bump,
        scan_pass_result: &mut js_parser::ScanPassResult<'a>,
        opts: js_parser::ParserOptions<'a>,
        defines: &'a Define,
        log: &bun_ast::Log,
        source: &'a bun_ast::Source<'a>,
    ) -> Result<(), crate::Error> {
        if strings::trim(source.contents(), b"\n\t\r ").is_empty() {
            return Ok(());
        }

        let temp_log = bun_ast::Log::init();

        let parser = match js_parser::Parser::init(opts, &temp_log, source, defines, bump) {
            Ok(p) => p,
            Err(_) => {
                temp_log.append_to(log);
                return Ok(());
            }
        };

        let res = parser.scan_imports(scan_pass_result);
        temp_log.append_to(log);
        res.map_err(Into::into)
    }
}
