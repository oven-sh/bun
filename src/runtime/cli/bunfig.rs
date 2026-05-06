//! Port of `src/runtime/cli/bunfig.zig`.
//!
//! `Bunfig::parse` and the inner `Parser` are un-gated and route through the
//! real `bun_interchange::{toml,json}` parsers (which produce the value-shaped
//! `bun_logger::js_ast::Expr` tree). Field-writes that target the still-opaque
//! peechy-generated `api::TransformOptions` / `api::BunInstall` structs are
//! re-gated at statement granularity with `` and
//! `// TODO(b2-blocked): api::… (peechy codegen)` markers so the surrounding
//! control flow, error reporting, and `ctx.*` writes are live.

#![allow(clippy::collapsible_if, clippy::needless_return)]

use core::sync::atomic::Ordering;

use bun_alloc::Arena as Bump;
use bun_collections::ArrayHashMap;
use bun_core::err;
use bun_interchange::json as json_parser;
use bun_interchange::toml::TOML;
use bun_logger as logger;
use bun_logger::js_ast::{expr::Data as ExprData, E, Expr, ExprTag};

use bun_options_types::schema::api;
use bun_options_types::CodeCoverageOptions::Reporters as CoverageReporters;
use bun_options_types::Context::MacroOptions;
use bun_options_types::GlobalCache::GlobalCache;
use bun_options_types::OfflineMode::PREFER as OFFLINE_PREFER;

use crate::cli::command::{ContextData, Tag as CommandTag};

pub type MacroImportReplacementMap = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
pub type MacroMap = ArrayHashMap<Box<[u8]>, MacroImportReplacementMap>;

// Re-exports (Zig: `pub const OfflineMode = @import("../options_types/OfflineMode.zig").OfflineMode;`)
pub use bun_options_types::OfflineMode::OfflineMode;

// TODO: replace api.TransformOptions with Bunfig
pub struct Bunfig;

// ─────────────────────────────────────────────────────────────────────────────
// Local Expr helpers — `bun_logger::js_ast::Expr` (the T2 value-shaped tree)
// only exposes a subset of the accessors the Zig source used. These free fns
// fill the gaps without editing the lower-tier crate.
// ─────────────────────────────────────────────────────────────────────────────

#[inline]
fn data_tag(d: &ExprData) -> ExprTag {
    match d {
        ExprData::EArray(_) => ExprTag::EArray,
        ExprData::EObject(_) => ExprTag::EObject,
        ExprData::EString(_) => ExprTag::EString,
        ExprData::EBoolean(_) => ExprTag::EBoolean,
        ExprData::ENumber(_) => ExprTag::ENumber,
        ExprData::ENull(_) => ExprTag::ENull,
        ExprData::EUndefined(_) => ExprTag::EUndefined,
        ExprData::EMissing(_) => ExprTag::EMissing,
    }
}

#[inline]
fn tag_name(t: ExprTag) -> &'static str {
    <&'static str>::from(t)
}

#[inline]
fn expr_get(expr: &Expr, name: &[u8]) -> Option<Expr> {
    match &expr.data {
        // `obj` is `&StoreRef<E::Object>`; inherent `StoreRef::get()` shadows
        // `E::Object::get(key)`, so deref through the StoreRef first.
        ExprData::EObject(obj) => obj.get().get(name),
        _ => None,
    }
}

#[inline]
fn expr_get_object(expr: &Expr, name: &[u8]) -> Option<Expr> {
    expr_get(expr, name).filter(|e| matches!(e.data, ExprData::EObject(_)))
}

#[inline]
fn expr_as_bool(expr: &Expr) -> Option<bool> {
    if let ExprData::EBoolean(b) = expr.data { Some(b.value) } else { None }
}

#[inline]
fn expr_as_number(expr: &Expr) -> Option<f64> {
    if let ExprData::ENumber(n) = expr.data { Some(n.value) } else { None }
}

/// Zig `Expr.asString(allocator)` — UTF-8 view, allocating into `bump` only if
/// the literal is UTF-16.
#[inline]
fn expr_as_string<'b>(expr: &Expr, bump: &'b Bump) -> Option<&'b [u8]> {
    if let ExprData::EString(s) = &expr.data {
        Some(s.string(bump).expect("OOM"))
    } else {
        None
    }
}

/// Owned clone of an `EString` payload (transcoding UTF-16 → UTF-8 if needed).
#[inline]
fn estring_to_owned(s: &E::EString, bump: &Bump) -> Box<[u8]> {
    Box::<[u8]>::from(s.string(bump).expect("OOM"))
}

#[inline]
fn num_to_u32(n: f64) -> u32 {
    // Note: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB.
    n as u32
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

pub struct Parser<'a> {
    json: Expr,
    source: &'a logger::Source,
    log: &'a mut logger::Log,
    // PORT NOTE: Zig held both `bunfig: *api.TransformOptions` (= `&ctx.args`)
    // and `ctx: *Command.Context` simultaneously. Rust forbids the overlapping
    // borrow, so `bunfig` writes route through `self.ctx.args` directly.
    ctx: &'a mut ContextData,
    /// Arena backing `EString::string()` UTF-16→UTF-8 transcodes; lifetime
    /// matches the `Expr` tree (same bump used for the TOML/JSON parse).
    bump: &'a Bump,
}

impl<'a> Parser<'a> {
    fn add_error(&mut self, loc: logger::Loc, text: &'static [u8]) -> Result<(), bun_core::Error> {
        self.log
            .add_error_opts(
                text,
                logger::ErrorOpts {
                    source: Some(self.source),
                    loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            )
            .expect("unreachable");
        Err(err!("Invalid Bunfig"))
    }

    fn add_error_format(
        &mut self,
        loc: logger::Loc,
        args: core::fmt::Arguments<'_>,
    ) -> Result<(), bun_core::Error> {
        self.log
            .add_error_fmt_opts(
                args,
                logger::ErrorOpts {
                    source: Some(self.source),
                    loc,
                    redact_sensitive_information: true,
                    ..Default::default()
                },
            )
            .expect("unreachable");
        Err(err!("Invalid Bunfig"))
    }

    pub fn expect_string(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::EString(_) => Ok(()),
            _ => {
                self.log
                    .add_error_fmt_opts(
                        format_args!(
                            "expected string but received {}",
                            tag_name(data_tag(&expr.data))
                        ),
                        logger::ErrorOpts {
                            source: Some(self.source),
                            loc: expr.loc,
                            redact_sensitive_information: true,
                            ..Default::default()
                        },
                    )
                    .expect("unreachable");
                Err(err!("Invalid Bunfig"))
            }
        }
    }

    pub fn expect(&mut self, expr: &Expr, token: ExprTag) -> Result<(), bun_core::Error> {
        if data_tag(&expr.data) != token {
            self.log
                .add_error_fmt_opts(
                    format_args!(
                        "expected {} but received {}",
                        tag_name(token),
                        tag_name(data_tag(&expr.data))
                    ),
                    logger::ErrorOpts {
                        source: Some(self.source),
                        loc: expr.loc,
                        redact_sensitive_information: true,
                        ..Default::default()
                    },
                )
                .expect("unreachable");
            return Err(err!("Invalid Bunfig"));
        }
        Ok(())
    }

    fn load_log_level(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        self.expect_string(expr)?;
        // PERF(port): Zig used strings.ExactSizeMatcher(8) — profile in Phase B
        let _level = match expr_as_string(expr, self.bump).unwrap_or(b"") {
            b"debug" | b"error" | b"warn" | b"info" => (),
            _ => {
                self.add_error(
                    expr.loc,
                    b"Invalid log level, must be one of debug, error, or warn",
                )?;
                unreachable!()
            }
        };
        // TODO(b2-blocked): api::TransformOptions.log_level / api::MessageLevel (peechy codegen)
        
        {
            self.ctx.args.log_level = Some(match expr_as_string(expr, self.bump).unwrap() {
                b"debug" => api::MessageLevel::Debug,
                b"error" => api::MessageLevel::Err,
                b"warn" => api::MessageLevel::Warn,
                b"info" => api::MessageLevel::Info,
                _ => unreachable!(),
            });
        }
        Ok(())
    }

    fn load_preload(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::EArray(array) => {
                let items = array.items.slice();
                let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                for item in items {
                    self.expect_string(item)?;
                    if let ExprData::EString(s) = &item.data {
                        if s.len() > 0 {
                            // PERF(port): was appendAssumeCapacity
                            preloads.push(estring_to_owned(s, self.bump));
                        }
                    }
                }
                self.ctx.preloads = preloads;
            }
            ExprData::EString(s) => {
                if s.len() > 0 {
                    let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(1);
                    preloads.push(estring_to_owned(s, self.bump));
                    self.ctx.preloads = preloads;
                }
            }
            ExprData::ENull(_) => {}
            _ => {
                self.add_error(expr.loc, b"Expected preload to be an array")?;
            }
        }
        Ok(())
    }

    // parse_registry / parse_registry_url_string / parse_registry_object bodies
    // live in the `phase_a_draft` impl block below.

    fn load_env_config(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::ENull(_) => {
                // env = null -> disable default .env files
                // TODO(b2-blocked): api::TransformOptions.disable_default_env_files (peechy codegen)
                
                { self.ctx.args.disable_default_env_files = true; }
            }
            ExprData::EBoolean(boolean) => {
                if !boolean.value {
                    // TODO(b2-blocked): api::TransformOptions.disable_default_env_files (peechy codegen)
                    
                    { self.ctx.args.disable_default_env_files = true; }
                }
            }
            ExprData::EObject(obj) => {
                if let Some(file_expr) = obj.get().get(b"file") {
                    match &file_expr.data {
                        ExprData::ENull(_) => {
                            // TODO(b2-blocked): api::TransformOptions.disable_default_env_files (peechy codegen)
                            
                            { self.ctx.args.disable_default_env_files = true; }
                        }
                        ExprData::EBoolean(boolean) => {
                            if !boolean.value {
                                // TODO(b2-blocked): api::TransformOptions.disable_default_env_files (peechy codegen)
                                
                                { self.ctx.args.disable_default_env_files = true; }
                            }
                        }
                        _ => {
                            self.add_error(
                                file_expr.loc,
                                b"Expected 'file' to be a boolean or null",
                            )?;
                        }
                    }
                }
            }
            _ => {
                self.add_error(
                    expr.loc,
                    b"Expected 'env' to be a boolean, null, or an object",
                )?;
            }
        }
        Ok(())
    }

    // PORT NOTE: `comptime cmd: Command.Tag` demoted to a runtime arg —
    // `bun_options_types::CommandTag::Tag` does not derive `ConstParamTy` (it
    // already derives `enum_map::Enum`, which conflicts). The Zig original
    // monomorphised over `cmd` purely to dead-code-eliminate untaken arms; the
    // runtime branches below are equivalent and the few hot fields are tiny.
    pub fn parse(&mut self, cmd: CommandTag) -> Result<(), bun_core::Error> {
        bun_analytics::features::bunfig.fetch_add(1, Ordering::Relaxed);

        let json = self.json;

        if !matches!(json.data, ExprData::EObject(_)) {
            self.add_error(json.loc, b"bunfig expects an object { } at the root")?;
        }

        if let Some(expr) = expr_get(&json, b"logLevel") {
            self.load_log_level(&expr)?;
        }

        if let Some(expr) = expr_get(&json, b"define") {
            self.expect(&expr, ExprTag::EObject)?;
            // TODO(b2-blocked): api::TransformOptions.define / api::StringMap (peechy codegen)
            
            {
                let properties = expr.data.e_object().unwrap().properties.slice();
                let mut valid_count: usize = 0;
                for prop in properties {
                    if !matches!(prop.value.as_ref().unwrap().data, ExprData::EString(_)) {
                        continue;
                    }
                    valid_count += 1;
                }
                let mut keys: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
                let mut values: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
                for prop in properties {
                    let ExprData::EString(v) = &prop.value.as_ref().unwrap().data else { continue };
                    let ExprData::EString(k) = &prop.key.as_ref().unwrap().data else { continue };
                    keys.push(estring_to_owned(k, self.bump));
                    values.push(estring_to_owned(v, self.bump));
                }
                self.ctx.args.define = Some(api::StringMap { keys, values });
            }
        }

        if let Some(expr) = expr_get(&json, b"origin") {
            self.expect_string(&expr)?;
            // TODO(b2-blocked): api::TransformOptions.origin (peechy codegen)
            
            { self.ctx.args.origin = Some(estring_to_owned(expr.data.e_string().unwrap().get(), self.bump)); }
        }

        if let Some(env_expr) = expr_get(&json, b"env") {
            self.load_env_config(&env_expr)?;
        }

        if cmd == CommandTag::RunCommand || cmd == CommandTag::AutoCommand {
            if let Some(expr) = expr_get(&json, b"serve") {
                if let Some(port) = expr_get(&expr, b"port") {
                    self.expect(&port, ExprTag::ENumber)?;
                    // TODO(b2-blocked): api::TransformOptions.port (peechy codegen)
                    
                    {
                        let p = expr_as_number(&port).unwrap() as u16;
                        self.ctx.args.port = Some(if p == 0 { 3000 } else { p });
                    }
                }
            }

            if let Some(expr) = expr_get(&json, b"preload") {
                self.load_preload(&expr)?;
            }

            if let Some(expr) = expr_get(&json, b"telemetry") {
                self.expect(&expr, ExprTag::EBoolean)?;
                bun_analytics::set_enabled(if expr_as_bool(&expr).unwrap() {
                    bun_analytics::TriState::Yes
                } else {
                    bun_analytics::TriState::No
                });
            }
        }

        if cmd == CommandTag::RunCommand || cmd == CommandTag::AutoCommand {
            if let Some(expr) = expr_get(&json, b"smol") {
                self.expect(&expr, ExprTag::EBoolean)?;
                self.ctx.runtime_options.smol = expr_as_bool(&expr).unwrap();
            }
        }

        if cmd == CommandTag::TestCommand {
            if let Some(test_) = expr_get(&json, b"test") {
                if let Some(root) = expr_get(&test_, b"root") {
                    self.ctx.debug.test_directory =
                        expr_as_string(&root, self.bump).unwrap_or(b"").into();
                }

                if let Some(expr) = expr_get(&test_, b"preload") {
                    self.load_preload(&expr)?;
                }

                if let Some(expr) = expr_get(&test_, b"smol") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.runtime_options.smol = expr_as_bool(&expr).unwrap();
                }

                if let Some(expr) = expr_get(&test_, b"coverage") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.enabled = expr_as_bool(&expr).unwrap();
                }

                if let Some(expr) = expr_get(&test_, b"onlyFailures") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.reporters.only_failures = expr_as_bool(&expr).unwrap();
                }

                if let Some(expr) = expr_get(&test_, b"reporter") {
                    self.expect(&expr, ExprTag::EObject)?;
                    if let Some(junit_expr) = expr_get(&expr, b"junit") {
                        self.expect_string(&junit_expr)?;
                        if let ExprData::EString(s) = &junit_expr.data {
                            if s.len() > 0 {
                                self.ctx.test_options.reporters.junit = true;
                                self.ctx.test_options.reporter_outfile =
                                    Some(estring_to_owned(s, self.bump));
                            }
                        }
                    }
                    if let Some(dots_expr) =
                        expr_get(&expr, b"dots").or_else(|| expr_get(&expr, b"dot"))
                    {
                        self.expect(&dots_expr, ExprTag::EBoolean)?;
                        self.ctx.test_options.reporters.dots = expr_as_bool(&dots_expr).unwrap();
                    }
                }

                if let Some(expr) = expr_get(&test_, b"coverageReporter") {
                    'brk: {
                        self.ctx.test_options.coverage.reporters =
                            CoverageReporters { text: false, lcov: false };
                        if let ExprData::EString(_) = &expr.data {
                            let item_str = expr_as_string(&expr, self.bump).unwrap_or(b"");
                            if item_str == b"text" {
                                self.ctx.test_options.coverage.reporters.text = true;
                            } else if item_str == b"lcov" {
                                self.ctx.test_options.coverage.reporters.lcov = true;
                            } else {
                                self.add_error_format(
                                    expr.loc,
                                    format_args!(
                                        "Invalid coverage reporter \"{}\"",
                                        bstr::BStr::new(item_str)
                                    ),
                                )?;
                            }
                            break 'brk;
                        }

                        self.expect(&expr, ExprTag::EArray)?;
                        let arr = expr.data.e_array().unwrap();
                        let items = arr.items.slice();
                        for item in items {
                            self.expect_string(item)?;
                            let item_str = expr_as_string(item, self.bump).unwrap_or(b"");
                            if item_str == b"text" {
                                self.ctx.test_options.coverage.reporters.text = true;
                            } else if item_str == b"lcov" {
                                self.ctx.test_options.coverage.reporters.lcov = true;
                            } else {
                                self.add_error_format(
                                    item.loc,
                                    format_args!(
                                        "Invalid coverage reporter \"{}\"",
                                        bstr::BStr::new(item_str)
                                    ),
                                )?;
                            }
                        }
                    }
                }

                if let Some(expr) = expr_get(&test_, b"coverageDir") {
                    self.expect_string(&expr)?;
                    // TODO(b2-blocked): CodeCoverageOptions.reports_directory is `&'static [u8]`
                    // (proc-lifetime CLI string); needs retype to Box<[u8]> before this can
                    // accept a parsed value.
                    
                    {
                        // PORT NOTE: `reports_directory: &'static [u8]` upstream;
                        // leak the parsed value to satisfy the lifetime until the
                        // schema field is retyped to `Box<[u8]>`.
                        self.ctx.test_options.coverage.reports_directory =
                            Box::leak(estring_to_owned(expr.data.e_string().unwrap().get(), self.bump));
                    }
                }

                if let Some(expr) = expr_get(&test_, b"coverageThreshold") {
                    'outer: {
                        if let ExprData::ENumber(n) = expr.data {
                            let v = n.value;
                            self.ctx.test_options.coverage.fractions.functions = v;
                            self.ctx.test_options.coverage.fractions.lines = v;
                            self.ctx.test_options.coverage.fractions.stmts = v;
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                            break 'outer;
                        }

                        self.expect(&expr, ExprTag::EObject)?;
                        if let Some(functions) = expr_get(&expr, b"functions") {
                            self.expect(&functions, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.functions =
                                expr_as_number(&functions).unwrap();
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                        if let Some(lines) = expr_get(&expr, b"lines") {
                            self.expect(&lines, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.lines =
                                expr_as_number(&lines).unwrap();
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                        if let Some(stmts) = expr_get(&expr, b"statements") {
                            self.expect(&stmts, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.stmts =
                                expr_as_number(&stmts).unwrap();
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                    }
                }

                // This mostly exists for debugging.
                if let Some(expr) = expr_get(&test_, b"coverageIgnoreSourcemaps") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.ignore_sourcemap = expr_as_bool(&expr).unwrap();
                }

                if let Some(expr) = expr_get(&test_, b"coverageSkipTestFiles") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.skip_test_files = expr_as_bool(&expr).unwrap();
                }

                let mut randomize_from_config: Option<bool> = None;

                if let Some(expr) = expr_get(&test_, b"randomize") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    randomize_from_config = expr_as_bool(&expr);
                    self.ctx.test_options.randomize = expr_as_bool(&expr).unwrap();
                }

                if let Some(expr) = expr_get(&test_, b"seed") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    let seed_value = num_to_u32(expr_as_number(&expr).unwrap());

                    // Validate that randomize is true when seed is specified
                    let has_randomize_true =
                        randomize_from_config.unwrap_or(self.ctx.test_options.randomize);
                    if !has_randomize_true {
                        self.add_error(
                            expr.loc,
                            b"\"seed\" can only be used when \"randomize\" is true",
                        )?;
                    }

                    self.ctx.test_options.seed = Some(seed_value);
                }

                if let Some(expr) = expr_get(&test_, b"rerunEach") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.retry != 0 {
                        self.add_error(expr.loc, b"\"rerunEach\" cannot be used with \"retry\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.repeat_count = num_to_u32(expr_as_number(&expr).unwrap());
                }

                if let Some(expr) = expr_get(&test_, b"retry") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.repeat_count != 0 {
                        self.add_error(expr.loc, b"\"retry\" cannot be used with \"rerunEach\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.retry = num_to_u32(expr_as_number(&expr).unwrap());
                }

                if let Some(expr) = expr_get(&test_, b"concurrentTestGlob") {
                    match &expr.data {
                        ExprData::EString(s) => {
                            if s.len() == 0 {
                                self.add_error(
                                    expr.loc,
                                    b"concurrentTestGlob cannot be an empty string",
                                )?;
                                return Ok(());
                            }
                            let pattern = estring_to_owned(s, self.bump);
                            self.ctx.test_options.concurrent_test_glob = Some(vec![pattern]);
                        }
                        ExprData::EArray(arr) => {
                            let items = arr.items.slice();
                            if items.is_empty() {
                                self.add_error(
                                    expr.loc,
                                    b"concurrentTestGlob array cannot be empty",
                                )?;
                                return Ok(());
                            }
                            let mut patterns: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                            for item in items {
                                let ExprData::EString(s) = &item.data else {
                                    self.add_error(
                                        item.loc,
                                        b"concurrentTestGlob array must contain only strings",
                                    )?;
                                    return Ok(());
                                };
                                if s.len() == 0 {
                                    self.add_error(
                                        item.loc,
                                        b"concurrentTestGlob patterns cannot be empty strings",
                                    )?;
                                    return Ok(());
                                }
                                patterns.push(estring_to_owned(s, self.bump));
                            }
                            self.ctx.test_options.concurrent_test_glob = Some(patterns);
                        }
                        _ => {
                            self.add_error(
                                expr.loc,
                                b"concurrentTestGlob must be a string or array of strings",
                            )?;
                            return Ok(());
                        }
                    }
                }

                if let Some(expr) = expr_get(&test_, b"coveragePathIgnorePatterns") {
                    // TODO(b2-blocked): CodeCoverageOptions.ignore_patterns is
                    // `&'static [&'static [u8]]`; retype to Vec<Box<[u8]>> before un-gating.
                    match &expr.data {
                        ExprData::EString(_) => {
                            
                            { /* see phase_a_draft */ }
                        }
                        ExprData::EArray(arr) => {
                            for item in arr.items.slice() {
                                if !matches!(item.data, ExprData::EString(_)) {
                                    self.add_error(
                                        item.loc,
                                        b"coveragePathIgnorePatterns array must contain only strings",
                                    )?;
                                    return Ok(());
                                }
                            }
                            
                            { /* see phase_a_draft */ }
                        }
                        _ => {
                            self.add_error(
                                expr.loc,
                                b"coveragePathIgnorePatterns must be a string or array of strings",
                            )?;
                            return Ok(());
                        }
                    }
                }

                if let Some(expr) = expr_get(&test_, b"pathIgnorePatterns") {
                    'brk: {
                        // Only skip if --path-ignore-patterns was explicitly passed via CLI
                        if self.ctx.test_options.path_ignore_patterns_from_cli {
                            break 'brk;
                        }
                        match &expr.data {
                            ExprData::EString(s) => {
                                self.ctx.test_options.path_ignore_patterns =
                                    vec![estring_to_owned(s, self.bump)];
                            }
                            ExprData::EArray(arr) => {
                                let items = arr.items.slice();
                                if items.is_empty() {
                                    break 'brk;
                                }
                                let mut patterns: Vec<Box<[u8]>> =
                                    Vec::with_capacity(items.len());
                                for item in items {
                                    let ExprData::EString(s) = &item.data else {
                                        self.add_error(
                                            item.loc,
                                            b"pathIgnorePatterns array must contain only strings",
                                        )?;
                                        return Ok(());
                                    };
                                    patterns.push(estring_to_owned(s, self.bump));
                                }
                                self.ctx.test_options.path_ignore_patterns = patterns;
                            }
                            _ => {
                                self.add_error(
                                    expr.loc,
                                    b"pathIgnorePatterns must be a string or array of strings",
                                )?;
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        if cmd.is_npm_related()
            || cmd == CommandTag::RunCommand
            || cmd == CommandTag::AutoCommand
            || cmd == CommandTag::TestCommand
        {
            if let Some(install_obj) = expr_get_object(&json, b"install") {
                // Ensure ctx.install is allocated so later passes can write into it
                // once api::BunInstall fields land.
                if self.ctx.install.is_none() {
                    self.ctx.install = Some(Box::new(api::BunInstall::default()));
                }

                if let Some(auto_install_expr) = expr_get(&install_obj, b"auto") {
                    if let ExprData::EString(_) = &auto_install_expr.data {
                        let key = expr_as_string(&auto_install_expr, self.bump).unwrap_or(b"");
                        self.ctx.debug.global_cache = match GlobalCache::MAP.get(key) {
                            Some(v) => *v,
                            None => {
                                self.add_error(
                                    auto_install_expr.loc,
                                    b"Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"",
                                )?;
                                return Ok(());
                            }
                        };
                    } else if let ExprData::EBoolean(b) = auto_install_expr.data {
                        self.ctx.debug.global_cache = if b.value {
                            GlobalCache::allow_install
                        } else {
                            GlobalCache::disable
                        };
                    } else {
                        self.add_error(
                            auto_install_expr.loc,
                            b"Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"",
                        )?;
                        return Ok(());
                    }
                }

                if let Some(prefer_expr) = expr_get(&install_obj, b"prefer") {
                    self.expect_string(&prefer_expr)?;
                    let key = expr_as_string(&prefer_expr, self.bump).unwrap_or(b"");
                    if let Some(setting) = OFFLINE_PREFER.get(key) {
                        self.ctx.debug.offline_mode_setting = Some(*setting);
                    } else {
                        self.add_error(
                            prefer_expr.loc,
                            b"Invalid prefer setting, must be one of online or offline",
                        )?;
                    }
                }

                // TODO(b2-blocked): api::BunInstall fields (peechy codegen) —
                // cafile, ca, exact, registry, scopes, dryRun, production,
                // frozenLockfile, saveTextLockfile, concurrentScripts,
                // ignoreScripts, linker, globalStore, lockfile.*, optional,
                // peer, dev, globalDir, globalBinDir, cache.*,
                // linkWorkspacePackages, security.scanner, minimumReleaseAge,
                // minimumReleaseAgeExcludes, publicHoistPattern, hoistPattern.
                // Full body preserved in the gated `phase_a_install` block below.
                
                { self.phase_a_install(&install_obj)?; }

                if let Some(expr) = expr_get(&install_obj, b"logLevel") {
                    self.load_log_level(&expr)?;
                }
            }

            if let Some(run_expr) = expr_get(&json, b"run") {
                if let Some(silent) = expr_get(&run_expr, b"silent") {
                    if let Some(value) = expr_as_bool(&silent) {
                        self.ctx.debug.silent = value;
                    } else {
                        self.add_error(silent.loc, b"Expected boolean")?;
                    }
                }

                if let Some(elide_lines) = expr_get(&run_expr, b"elide-lines") {
                    if let Some(n) = expr_as_number(&elide_lines) {
                        // Note: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB
                        self.ctx.bundler_options.elide_lines = Some(n as usize);
                    } else {
                        self.add_error(elide_lines.loc, b"Expected number")?;
                    }
                }

                if let Some(shell) = expr_get(&run_expr, b"shell") {
                    if let Some(value) = expr_as_string(&shell, self.bump) {
                        if value == b"bun" {
                            self.ctx.debug.use_system_shell = false;
                        } else if value == b"system" {
                            self.ctx.debug.use_system_shell = true;
                        } else {
                            self.add_error(
                                shell.loc,
                                b"Invalid shell, only 'bun' and 'system' are supported",
                            )?;
                        }
                    } else {
                        self.add_error(shell.loc, b"Expected string")?;
                    }
                }

                if let Some(bun_flag) = expr_get(&run_expr, b"bun") {
                    if let Some(value) = expr_as_bool(&bun_flag) {
                        self.ctx.debug.run_in_bun = value;
                    } else {
                        self.add_error(bun_flag.loc, b"Expected boolean")?;
                    }
                }

                if let Some(no_orphans) = expr_get(&run_expr, b"noOrphans") {
                    if let Some(value) = expr_as_bool(&no_orphans) {
                        if value {
                            bun_aio::ParentDeathWatchdog::enable();
                        }
                    } else {
                        self.add_error(no_orphans.loc, b"Expected boolean")?;
                    }
                }
            }

            if let Some(console_expr) = expr_get(&json, b"console") {
                if let Some(depth) = expr_get(&console_expr, b"depth") {
                    if let Some(n) = expr_as_number(&depth) {
                        let depth_value = n as u16;
                        // Treat depth=0 as maxInt(u16) for infinite depth
                        self.ctx.runtime_options.console_depth = Some(if depth_value == 0 {
                            u16::MAX
                        } else {
                            depth_value
                        });
                    } else {
                        self.add_error(depth.loc, b"Expected number")?;
                    }
                }
            }
        }

        // TODO(b2-blocked): api::TransformOptions.serve_* fields (peechy codegen)
        // — `[serve.static]` plugins/hmr/minify/define/publicPath/env handled in
        // the gated `phase_a_serve_static` block.
        
        if let Some(serve_obj2) = expr_get_object(&json, b"serve") {
            if let Some(serve_obj) = expr_get_object(&serve_obj2, b"static") {
                self.phase_a_serve_static(&serve_obj)?;
            }
        }

        if let Some(_bun) = expr_get(&json, b"bundle") {
            if cmd == CommandTag::BuildCommand
                || cmd == CommandTag::RunCommand
                || cmd == CommandTag::AutoCommand
            {
                if let Some(dir) = expr_get(&_bun, b"outdir") {
                    self.expect_string(&dir)?;
                    // TODO(b2-blocked): api::TransformOptions.output_dir (peechy codegen)
                    
                    { self.ctx.args.output_dir = Some(estring_to_owned(dir.data.e_string().unwrap().get(), self.bump)); }
                }
            }

            if cmd == CommandTag::BuildCommand {
                if let Some(expr2) = expr_get(&_bun, b"logLevel") {
                    self.load_log_level(&expr2)?;
                }

                if let Some(entry_points) = expr_get(&_bun, b"entryPoints") {
                    self.expect(&entry_points, ExprTag::EArray)?;
                    let arr = entry_points.data.e_array().unwrap();
                    let items = arr.items.slice();
                    for item in items {
                        self.expect_string(item)?;
                    }
                    // TODO(b2-blocked): api::TransformOptions.entry_points (peechy codegen)
                    
                    {
                        let mut names: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                        for item in items {
                            names.push(estring_to_owned(item.data.e_string().unwrap().get(), self.bump));
                        }
                        self.ctx.args.entry_points = names.into();
                    }
                }

                if let Some(expr) = expr_get(&_bun, b"packages") {
                    self.expect(&expr, ExprTag::EObject)?;
                    let object = expr.data.e_object().unwrap();
                    let properties = object.properties.slice();
                    let mut valid_count: usize = 0;
                    for prop in properties {
                        if !matches!(
                            prop.value.as_ref().unwrap().data,
                            ExprData::EBoolean(_)
                        ) {
                            continue;
                        }
                        valid_count += 1;
                    }
                    self.ctx.debug.package_bundle_map.reserve(
                        valid_count.saturating_sub(self.ctx.debug.package_bundle_map.len()),
                    );

                    for prop in properties {
                        let ExprData::EBoolean(b) = prop.value.as_ref().unwrap().data else {
                            continue;
                        };
                        let key_expr = prop.key.as_ref().unwrap();
                        let ExprData::EString(k) = &key_expr.data else { continue };
                        let path = estring_to_owned(k, self.bump);

                        if !bun_resolver::is_package_path(&path) {
                            self.add_error(key_expr.loc, b"Expected package name")?;
                        }

                        // PERF(port): was putAssumeCapacity
                        self.ctx.debug.package_bundle_map.insert(
                            path,
                            if b.value {
                                bun_options_types::BundlePackage::Always
                            } else {
                                bun_options_types::BundlePackage::Never
                            },
                        );
                    }
                }
            }
        }

        // ── jsx ──────────────────────────────────────────────────────────────
        let mut jsx_factory: Box<[u8]> = Box::default();
        let mut jsx_fragment: Box<[u8]> = Box::default();
        let mut jsx_import_source: Box<[u8]> = Box::default();
        let mut jsx_runtime = api::JsxRuntime::Automatic;
        let mut jsx_dev = true;

        if let Some(expr) = expr_get(&json, b"jsx") {
            if let Some(value) = expr_as_string(&expr, self.bump) {
                if value == b"react" {
                    jsx_runtime = api::JsxRuntime::Classic;
                } else if value == b"solid" {
                    jsx_runtime = api::JsxRuntime::Solid;
                } else if value == b"react-jsx" {
                    jsx_runtime = api::JsxRuntime::Automatic;
                    jsx_dev = false;
                } else if value == b"react-jsxDEV" {
                    jsx_runtime = api::JsxRuntime::Automatic;
                    jsx_dev = true;
                } else {
                    self.add_error(
                        expr.loc,
                        b"Invalid jsx runtime, only 'react', 'solid', 'react-jsx', and 'react-jsxDEV' are supported",
                    )?;
                }
            }
        }
        if let Some(expr) = expr_get(&json, b"jsxImportSource") {
            if let Some(value) = expr_as_string(&expr, self.bump) {
                jsx_import_source = Box::<[u8]>::from(value);
            }
        }
        if let Some(expr) = expr_get(&json, b"jsxFragment") {
            if let Some(value) = expr_as_string(&expr, self.bump) {
                jsx_fragment = Box::<[u8]>::from(value);
            }
        }
        if let Some(expr) = expr_get(&json, b"jsxFactory") {
            if let Some(value) = expr_as_string(&expr, self.bump) {
                jsx_factory = Box::<[u8]>::from(value);
            }
        }
        // TODO(b2-blocked): api::TransformOptions.jsx (peechy codegen)
        
        {
            if self.ctx.args.jsx.is_none() {
                self.ctx.args.jsx = Some(api::Jsx {
                    factory: jsx_factory,
                    fragment: jsx_fragment,
                    import_source: jsx_import_source,
                    runtime: jsx_runtime,
                    development: jsx_dev,
                    ..Default::default()
                });
            } else {
                let jsx: &mut api::Jsx = self.ctx.args.jsx.as_mut().unwrap();
                if !jsx_factory.is_empty() { jsx.factory = jsx_factory; }
                if !jsx_fragment.is_empty() { jsx.fragment = jsx_fragment; }
                if !jsx_import_source.is_empty() { jsx.import_source = jsx_import_source; }
                jsx.runtime = jsx_runtime;
                jsx.development = jsx_dev;
            }
        }
        let _ = (jsx_factory, jsx_fragment, jsx_import_source, jsx_runtime, jsx_dev);

        if let Some(expr) = expr_get(&json, b"debug") {
            if let Some(editor) = expr_get(&expr, b"editor") {
                if let Some(value) = expr_as_string(&editor, self.bump) {
                    self.ctx.debug.editor = value.into();
                }
            }
        }

        if let Some(expr) = expr_get(&json, b"macros") {
            if let ExprData::EBoolean(b) = expr.data {
                if b.value == false {
                    self.ctx.debug.macros = MacroOptions::Disable;
                }
            } else {
                // TODO(b2-blocked): bun_resolver::package_json::PackageJSON::parse_macros_json
                // takes `bun_js_parser::ast::Expr`; the value-shaped T2 tree must be
                // lifted via `Expr::from` first. Gate until the From-bridge is verified.
                
                {
                    let _ = &expr;
                    self.ctx.debug.macros = MacroOptions::Map(
                        todo!("blocked_on: bun_resolver::package_json::MacroMap vs bun_options_types::Context::MacroMap"),
                    );
                }
            }
            bun_analytics::features::macros.fetch_add(1, Ordering::Relaxed);
        }

        if let Some(expr) = expr_get(&json, b"external") {
            match &expr.data {
                ExprData::EString(_) => {
                    // TODO(b2-blocked): api::TransformOptions.external (peechy codegen)
                    
                    { /* see phase_a_draft */ }
                }
                ExprData::EArray(array) => {
                    for item in array.items.slice() {
                        self.expect_string(item)?;
                    }
                    // TODO(b2-blocked): api::TransformOptions.external (peechy codegen)
                    
                    { /* see phase_a_draft */ }
                }
                _ => self.add_error(expr.loc, b"Expected string or array")?,
            }
        }

        if let Some(expr) = expr_get(&json, b"loader") {
            self.expect(&expr, ExprTag::EObject)?;
            let obj = expr.data.e_object().unwrap();
            let properties = obj.properties.slice();
            for item in properties {
                let key_expr = item.key.as_ref().unwrap();
                let key = expr_as_string(key_expr, self.bump).unwrap();
                if key.is_empty() {
                    continue;
                }
                if key[0] != b'.' {
                    self.add_error(
                        key_expr.loc,
                        b"file extension for loader must start with a '.'",
                    )?;
                }
                let value = item.value.as_ref().unwrap();
                self.expect_string(value)?;
                if bun_bundler::options::Loader::from_string(
                    expr_as_string(value, self.bump).unwrap(),
                )
                .is_none()
                {
                    self.add_error(value.loc, b"Invalid loader")?;
                }
            }
            // TODO(b2-blocked): api::TransformOptions.loaders (peechy codegen) — only the
            // `self.ctx.args.loaders = api::LoaderMap{…}` write is gated; validation above is live.
            
            { /* see phase_a_draft */ }
        }

        Ok(())
    }
}

impl Bunfig {
    pub fn parse(
        cmd: CommandTag,
        source: &logger::Source,
        ctx: &mut ContextData,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: ctx.log is populated by `create_context_data()` before any
        // bunfig load; single-threaded CLI startup invariant. The raw pointer
        // is copied out so the resulting `&mut Log` does not borrow `ctx`
        // (Parser later needs `&mut ctx` alongside `&mut log`).
        let log_ptr: *mut logger::Log = ctx.log;
        debug_assert!(!log_ptr.is_null());
        let log: &mut logger::Log = unsafe { &mut *log_ptr };
        let log_count = log.errors + log.warnings;

        let bump = Bump::new();

        let ext = source.path.name.ext;
        // Zig: `if (strings.eqlComptime(source.path.name.ext[1..], "toml"))`
        let is_toml = ext.len() > 1 && &ext[1..] == b"toml";

        let expr = if is_toml {
            match TOML::parse(source, log, &bump, true) {
                Ok(e) => e,
                Err(e) => {
                    if log.errors + log.warnings == log_count {
                        log.add_error_opts(
                            b"Failed to parse",
                            logger::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        )?;
                    }
                    return Err(e);
                }
            }
        } else {
            match json_parser::parse_ts_config::<true>(source, log, &bump) {
                Ok(e) => e,
                Err(e) => {
                    if log.errors + log.warnings == log_count {
                        log.add_error_opts(
                            b"Failed to parse",
                            logger::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        )?;
                    }
                    return Err(e);
                }
            }
        };

        // PORT NOTE: reshaped for borrowck — Zig stored both `&mut ctx` and
        // `&mut ctx.args` simultaneously inside Parser. In Rust we route bunfig
        // writes through `self.ctx.args` directly. `log` is derived from the
        // copied raw pointer above so it does not overlap the `&mut ctx` borrow.
        // SAFETY: Parser never reaches `ctx.log` (only `self.log`), so no two
        // live `&mut` to the same `Log` coexist.
        let mut parser = Parser {
            json: expr,
            log,
            source,
            ctx,
            bump: &bump,
        };
        parser.parse(cmd)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-A draft — install / serve.static / registry bodies preserved verbatim
// until `api::BunInstall` / `api::TransformOptions` peechy fields land. These
// reference fields that do not yet exist on the opaque schema structs.
// ─────────────────────────────────────────────────────────────────────────────

mod phase_a_draft {
    use super::*;
    #[allow(unused_imports)]
    use bun_install::{self, PackageManager, PnpmMatcher};
    use bun_url::URL;
    use std::io::Write as _;

    impl<'a> Parser<'a> {
        fn parse_registry_url_string(
            &mut self,
            str: &E::EString,
        ) -> Result<api::NpmRegistry, bun_core::Error> {
            let url = URL::parse(str.string(self.bump)?);
            let mut registry = api::NpmRegistry::default();

            // Token
            if url.username.is_empty() && !url.password.is_empty() {
                registry.token = url.password.into();
                let mut s = Vec::<u8>::new();
                write!(
                    &mut s,
                    "{}://{}/{}/",
                    bstr::BStr::new(url.display_protocol()),
                    url.display_host(),
                    bstr::BStr::new(bun_string::strings::trim(url.pathname, b"/")),
                )
                .expect("unreachable");
                registry.url = s.into();
            } else if !url.username.is_empty() && !url.password.is_empty() {
                registry.username = url.username.into();
                registry.password = url.password.into();
                let mut s = Vec::<u8>::new();
                write!(
                    &mut s,
                    "{}://{}/{}/",
                    bstr::BStr::new(url.display_protocol()),
                    url.display_host(),
                    bstr::BStr::new(bun_string::strings::trim(url.pathname, b"/")),
                )
                .expect("unreachable");
                registry.url = s.into();
            } else {
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = url.href.into();
            }

            Ok(registry)
        }

        fn parse_registry_object(
            &mut self,
            obj: &E::Object,
        ) -> Result<api::NpmRegistry, bun_core::Error> {
            let mut registry = api::NpmRegistry::default();

            if let Some(url) = obj.get(b"url") {
                self.expect_string(&url)?;
                registry.url = expr_as_string(&url, self.bump).unwrap().into();
            }
            if let Some(username) = obj.get(b"username") {
                self.expect_string(&username)?;
                registry.username = expr_as_string(&username, self.bump).unwrap().into();
            }
            if let Some(password) = obj.get(b"password") {
                self.expect_string(&password)?;
                registry.password = expr_as_string(&password, self.bump).unwrap().into();
            }
            if let Some(token) = obj.get(b"token") {
                self.expect_string(&token)?;
                registry.token = expr_as_string(&token, self.bump).unwrap().into();
            }

            Ok(registry)
        }

        fn parse_registry(&mut self, expr: &Expr) -> Result<api::NpmRegistry, bun_core::Error> {
            match &expr.data {
                ExprData::EString(s) => self.parse_registry_url_string(s),
                ExprData::EObject(o) => self.parse_registry_object(o),
                _ => {
                    self.add_error(
                        expr.loc,
                        b"Expected registry to be a URL string or an object",
                    )?;
                    Ok(api::NpmRegistry::default())
                }
            }
        }

        pub(super) fn phase_a_install(&mut self, install_obj: &Expr) -> Result<(), bun_core::Error> {
            let install: &mut api::BunInstall = self.ctx.install.as_deref_mut().unwrap();

            if let Some(cafile) = expr_get(install_obj, b"cafile") {
                install.cafile = match expr_as_string(&cafile, self.bump) {
                    Some(s) => Some(s.into()),
                    None => {
                        self.add_error(cafile.loc, b"Invalid cafile. Expected a string.")?;
                        return Ok(());
                    }
                };
            }

            if let Some(ca) = expr_get(install_obj, b"ca") {
                match &ca.data {
                    ExprData::EArray(arr) => {
                        let items = arr.items.slice();
                        let mut list: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                        for item in items {
                            match expr_as_string(item, self.bump) {
                                Some(s) => list.push(s.into()),
                                None => {
                                    self.add_error(item.loc, b"Invalid CA. Expected a string.")?;
                                    return Ok(());
                                }
                            }
                        }
                        install.ca = Some(api::Ca::List(list.into()));
                    }
                    ExprData::EString(s) => {
                        install.ca = Some(api::Ca::Str(estring_to_owned(s, self.bump)));
                    }
                    _ => {
                        self.add_error(
                            ca.loc,
                            b"Invalid CA. Expected a string or an array of strings.",
                        )?;
                        return Ok(());
                    }
                }
            }

            if let Some(exact) = expr_get(install_obj, b"exact") {
                if let Some(v) = expr_as_bool(&exact) { install.exact = Some(v); }
            }

            if let Some(registry) = expr_get(install_obj, b"registry") {
                install.default_registry = Some(self.parse_registry(&registry)?);
            }

            if let Some(scopes) = expr_get(install_obj, b"scopes") {
                let mut registry_map = install.scoped.take().unwrap_or_default();
                self.expect(&scopes, ExprTag::EObject)?;
                let obj = scopes.data.e_object().unwrap();
                registry_map.scopes.reserve(obj.properties.slice().len());
                for prop in obj.properties.slice() {
                    let Some(name_) = prop.key.as_ref().and_then(|k| expr_as_string(k, self.bump)) else { continue };
                    let Some(value) = prop.value.as_ref() else { continue };
                    if name_.is_empty() { continue }
                    let name = if name_[0] == b'@' { &name_[1..] } else { name_ };
                    let registry = self.parse_registry(value)?;
                    registry_map.scopes.insert(name.into(), registry);
                }
                install.scoped = Some(registry_map);
            }

            if let Some(v) = expr_get(install_obj, b"dryRun").and_then(|e| expr_as_bool(&e)) {
                install.dry_run = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"production").and_then(|e| expr_as_bool(&e)) {
                install.production = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"frozenLockfile").and_then(|e| expr_as_bool(&e)) {
                install.frozen_lockfile = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"saveTextLockfile").and_then(|e| expr_as_bool(&e)) {
                install.save_text_lockfile = Some(v);
            }
            if let Some(jobs) = expr_get(install_obj, b"concurrentScripts") {
                if let Some(n) = expr_as_number(&jobs) {
                    let n = num_to_u32(n);
                    install.concurrent_scripts = if n == 0 { None } else { Some(n) };
                }
            }
            if let Some(v) = expr_get(install_obj, b"ignoreScripts").and_then(|e| expr_as_bool(&e)) {
                install.ignore_scripts = Some(v);
            }
            if let Some(node_linker_expr) = expr_get(install_obj, b"linker") {
                self.expect_string(&node_linker_expr)?;
                if let Some(s) = expr_as_string(&node_linker_expr, self.bump) {
                    install.node_linker = PackageManager::Options::NodeLinker::from_str(s);
                    if install.node_linker.is_none() {
                        self.add_error(
                            node_linker_expr.loc,
                            b"Expected one of \"isolated\" or \"hoisted\"",
                        )?;
                    }
                }
            }
            if let Some(v) = expr_get(install_obj, b"globalStore").and_then(|e| expr_as_bool(&e)) {
                install.global_store = Some(v);
            }

            if let Some(lockfile_expr) = expr_get(install_obj, b"lockfile") {
                if let Some(lockfile) = expr_get(&lockfile_expr, b"print") {
                    self.expect_string(&lockfile)?;
                    if let Some(value) = expr_as_string(&lockfile, self.bump) {
                        if value != b"bun" {
                            if value != b"yarn" {
                                self.add_error(
                                    lockfile.loc,
                                    b"Invalid lockfile format, only 'yarn' output is implemented",
                                )?;
                            }
                            install.save_yarn_lockfile = Some(true);
                        }
                    }
                }
                if let Some(v) = expr_get(&lockfile_expr, b"save").and_then(|e| expr_as_bool(&e)) {
                    install.save_lockfile = Some(v);
                }
                if let Some(v) = expr_get(&lockfile_expr, b"path").and_then(|e| expr_as_string(&e, self.bump)) {
                    install.lockfile_path = Some(v.into());
                }
                if let Some(v) = expr_get(&lockfile_expr, b"savePath").and_then(|e| expr_as_string(&e, self.bump)) {
                    install.save_lockfile_path = Some(v.into());
                }
            }

            if let Some(v) = expr_get(install_obj, b"optional").and_then(|e| expr_as_bool(&e)) {
                install.save_optional = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"peer").and_then(|e| expr_as_bool(&e)) {
                install.save_peer = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"dev").and_then(|e| expr_as_bool(&e)) {
                install.save_dev = Some(v);
            }
            if let Some(v) = expr_get(install_obj, b"globalDir").and_then(|e| expr_as_string(&e, self.bump)) {
                install.global_dir = Some(v.into());
            }
            if let Some(v) = expr_get(install_obj, b"globalBinDir").and_then(|e| expr_as_string(&e, self.bump)) {
                install.global_bin_dir = Some(v.into());
            }

            if let Some(cache) = expr_get(install_obj, b"cache") {
                'load: {
                    if let Some(value) = expr_as_bool(&cache) {
                        if !value {
                            install.disable_cache = Some(true);
                            install.disable_manifest_cache = Some(true);
                        }
                        break 'load;
                    }
                    if let Some(value) = expr_as_string(&cache, self.bump) {
                        install.cache_directory = Some(value.into());
                        break 'load;
                    }
                    if let ExprData::EObject(_) = cache.data {
                        if let Some(v) = expr_get(&cache, b"disable").and_then(|e| expr_as_bool(&e)) {
                            install.disable_cache = Some(v);
                        }
                        if let Some(v) = expr_get(&cache, b"disableManifest").and_then(|e| expr_as_bool(&e)) {
                            install.disable_manifest_cache = Some(v);
                        }
                        if let Some(v) = expr_get(&cache, b"dir").and_then(|e| expr_as_string(&e, self.bump)) {
                            install.cache_directory = Some(v.into());
                        }
                    }
                }
            }

            if let Some(v) = expr_get(install_obj, b"linkWorkspacePackages").and_then(|e| expr_as_bool(&e)) {
                install.link_workspace_packages = Some(v);
            }

            if let Some(security_obj) = expr_get(install_obj, b"security") {
                if let ExprData::EObject(_) = security_obj.data {
                    if let Some(scanner) = expr_get(&security_obj, b"scanner") {
                        self.expect_string(&scanner)?;
                        install.security_scanner =
                            expr_as_string(&scanner, self.bump).map(Into::into);
                    }
                } else {
                    self.add_error(
                        security_obj.loc,
                        b"Invalid security config, expected an object",
                    )?;
                }
            }

            if let Some(min_age) = expr_get(install_obj, b"minimumReleaseAge") {
                match &min_age.data {
                    ExprData::ENumber(seconds) => {
                        if seconds.value < 0.0 {
                            self.add_error(
                                min_age.loc,
                                b"Expected positive number of seconds for minimumReleaseAge",
                            )?;
                            return Ok(());
                        }
                        const MS_PER_S: f64 = 1000.0;
                        install.minimum_release_age_ms = Some(seconds.value * MS_PER_S);
                    }
                    _ => {
                        self.add_error(
                            min_age.loc,
                            b"Expected number of seconds for minimumReleaseAge",
                        )?;
                    }
                }
            }

            if let Some(exclusions) = expr_get(install_obj, b"minimumReleaseAgeExcludes") {
                match &exclusions.data {
                    ExprData::EArray(arr) => 'brk: {
                        let raw = arr.items.slice();
                        if raw.is_empty() { break 'brk; }
                        let mut list: Vec<Box<[u8]>> = Vec::with_capacity(raw.len());
                        for p in raw {
                            self.expect_string(p)?;
                            list.push(estring_to_owned(p.data.e_string().unwrap().get(), self.bump));
                        }
                        install.minimum_release_age_excludes = Some(list.into());
                    }
                    _ => {
                        self.add_error(
                            exclusions.loc,
                            b"Expected array for minimumReleaseAgeExcludes",
                        )?;
                    }
                }
            }

            if let Some(public_hoist_pattern_expr) = expr_get(install_obj, b"publicHoistPattern") {
                install.public_hoist_pattern = match PnpmMatcher::from_expr(
                    &public_hoist_pattern_expr,
                    self.log,
                    self.source,
                ) {
                    Ok(v) => Some(v),
                    Err(e) if e == err!("OutOfMemory") => return Err(e),
                    Err(_) => return Err(err!("Invalid Bunfig")),
                };
            }
            if let Some(hoist_pattern_expr) = expr_get(install_obj, b"hoistPattern") {
                install.hoist_pattern = match PnpmMatcher::from_expr(
                    &hoist_pattern_expr,
                    self.log,
                    self.source,
                ) {
                    Ok(v) => Some(v),
                    Err(e) if e == err!("OutOfMemory") => return Err(e),
                    Err(_) => return Err(err!("Invalid Bunfig")),
                };
            }

            Ok(())
        }

        fn phase_a_serve_static(&mut self, serve_obj: &Expr) -> Result<(), bun_core::Error> {
            if let Some(config_plugins) = expr_get(serve_obj, b"plugins") {
                let plugins: Option<Box<[Box<[u8]>]>> = 'plugins: {
                    if let ExprData::EArray(arr) = &config_plugins.data {
                        let raw = arr.items.slice();
                        if raw.is_empty() { break 'plugins None; }
                        let mut plugins: Vec<Box<[u8]>> = Vec::with_capacity(raw.len());
                        for p in raw {
                            self.expect_string(p)?;
                            plugins.push(estring_to_owned(p.data.e_string().unwrap().get(), self.bump));
                        }
                        break 'plugins Some(plugins.into());
                    } else {
                        let s = config_plugins.data.e_string().unwrap();
                        break 'plugins Some(Box::new([estring_to_owned(s.get(), self.bump)]));
                    }
                };
                // TODO: accept entire config object.
                self.ctx.args.serve_plugins = plugins;
            }

            if let Some(hmr) = expr_get(serve_obj, b"hmr") {
                if let Some(v) = expr_as_bool(&hmr) { self.ctx.args.serve_hmr = Some(v); }
            }

            if let Some(minify) = expr_get(serve_obj, b"minify") {
                if let Some(v) = expr_as_bool(&minify) {
                    self.ctx.args.serve_minify_syntax = Some(v);
                    self.ctx.args.serve_minify_whitespace = Some(v);
                    self.ctx.args.serve_minify_identifiers = Some(v);
                } else if minify.is_object() {
                    if let Some(syntax) = expr_get(&minify, b"syntax") {
                        self.ctx.args.serve_minify_syntax = Some(expr_as_bool(&syntax).unwrap_or(false));
                    }
                    if let Some(whitespace) = expr_get(&minify, b"whitespace") {
                        self.ctx.args.serve_minify_whitespace = Some(expr_as_bool(&whitespace).unwrap_or(false));
                    }
                    if let Some(identifiers) = expr_get(&minify, b"identifiers") {
                        self.ctx.args.serve_minify_identifiers = Some(expr_as_bool(&identifiers).unwrap_or(false));
                    }
                } else {
                    self.add_error(minify.loc, b"Expected minify to be boolean or object")?;
                }
            }

            if let Some(expr) = expr_get(serve_obj, b"define") {
                self.expect(&expr, ExprTag::EObject)?;
                let properties = expr.data.e_object().unwrap().properties.slice();
                let mut keys: Vec<Box<[u8]>> = Vec::new();
                let mut values: Vec<Box<[u8]>> = Vec::new();
                for prop in properties {
                    let ExprData::EString(v) = &prop.value.as_ref().unwrap().data else { continue };
                    let ExprData::EString(k) = &prop.key.as_ref().unwrap().data else { continue };
                    keys.push(estring_to_owned(k, self.bump));
                    values.push(estring_to_owned(v, self.bump));
                }
                self.ctx.args.serve_define = Some(api::StringMap { keys, values });
            }
            self.ctx.args.bunfig_path = Box::<[u8]>::from(self.source.path.text);

            if let Some(public_path) = expr_get(serve_obj, b"publicPath") {
                if let Some(v) = expr_as_string(&public_path, self.bump) {
                    self.ctx.args.serve_public_path = Some(v.into());
                }
            }

            if let Some(env) = expr_get(serve_obj, b"env") {
                match &env.data {
                    ExprData::ENull(_) => {
                        self.ctx.args.serve_env_behavior = api::DotEnvBehavior::disable;
                    }
                    ExprData::EBoolean(b) => {
                        self.ctx.args.serve_env_behavior = if b.value {
                            api::DotEnvBehavior::load_all
                        } else {
                            api::DotEnvBehavior::disable
                        };
                    }
                    ExprData::EString(str) => {
                        if str.eql_comptime(b"inline") {
                            self.ctx.args.serve_env_behavior = api::DotEnvBehavior::load_all;
                        } else if str.eql_comptime(b"disable") {
                            self.ctx.args.serve_env_behavior = api::DotEnvBehavior::disable;
                        } else {
                            let slice = str.string(self.bump)?;
                            if let Some(asterisk) =
                                bun_core::strings::index_of_char(slice, b'*')
                            {
                                if asterisk > 0 {
                                    self.ctx.args.serve_env_prefix =
                                        Some(Box::<[u8]>::from(&slice[..asterisk]));
                                    self.ctx.args.serve_env_behavior = api::DotEnvBehavior::prefix;
                                } else {
                                    self.ctx.args.serve_env_behavior = api::DotEnvBehavior::load_all;
                                }
                            } else {
                                self.add_error(
                                    env.loc,
                                    b"Invalid env behavior, must be 'inline', 'disable', or a string with a '*' character",
                                )?;
                            }
                        }
                    }
                    _ => {
                        self.add_error(
                            env.loc,
                            b"Invalid env behavior, must be 'inline', 'disable', or a string with a '*' character",
                        )?;
                    }
                }
            }

            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/bunfig.zig (1305 lines)
//   confidence: medium
//   todos:      api::TransformOptions/api::BunInstall field-writes gated on
//               peechy .rs codegen; CodeCoverageOptions.{reports_directory,
//               ignore_patterns} need retype from &'static to owned;
//               parse_macros_json needs T2→T4 Expr lift.
//   notes:      const-generic `comptime cmd` demoted to runtime arg (Tag lacks
//               ConstParamTy); Parser.bunfig collapsed into Parser.ctx to
//               satisfy borrowck; local Expr accessor shims fill gaps in
//               bun_logger::js_ast.
// ──────────────────────────────────────────────────────────────────────────
