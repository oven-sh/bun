//! Port of `src/runtime/cli/bunfig.zig`.
//!
//! `Bunfig::parse` and the inner `Parser` route through the real
//! `bun_parsers::{toml,json}` parsers (which produce the value-shaped
//! `bun_ast::Expr` tree) and write into `ctx.args`
//! (`api::TransformOptions`), `ctx.install` (`api::BunInstall`), and the rest
//! of `ContextData`.

#![allow(clippy::collapsible_if, clippy::needless_return)]

use bun_collections::VecExt;
use core::sync::atomic::Ordering;

use bun_alloc::Arena as Bump;
use bun_ast::{E, Expr, ExprTag, expr::Data as ExprData};
use bun_core::err;
use bun_parsers::json as json_parser;
use bun_parsers::toml::TOML;

use bun_install_types::NodeLinker::FromExprError;
use bun_options_types::LoaderExt as _;
use bun_options_types::code_coverage_options::Reporters as CoverageReporters;
use bun_options_types::context::{MacroImportReplacementMap, MacroMap, MacroOptions};
use bun_options_types::global_cache::GlobalCache;
use bun_options_types::offline_mode::PREFER as OFFLINE_PREFER;
use bun_options_types::schema::api;

use bun_options_types::command_tag::Tag as CommandTag;
use bun_options_types::context::ContextData;

// Re-exports (Zig: `pub const OfflineMode = @import("../options_types/OfflineMode.zig").OfflineMode;`)
pub use bun_options_types::offline_mode::OfflineMode;

// TODO: replace api.TransformOptions with Bunfig
pub struct Bunfig;

/// Owned clone of an `EString` payload (transcoding UTF-16 → UTF-8 if needed).
#[inline]
fn estring_to_owned(s: &E::EString, bump: &Bump) -> Box<[u8]> {
    Box::<[u8]>::from(s.string(bump).expect("OOM"))
}

/// Port of `resolver/package_json.zig` `PackageJSON.parseMacrosJSON`.
///
/// Re-ported here against the value-shaped `bun_ast::Expr` (the
/// tree produced by the TOML/JSON parsers) and returning the
/// `bun_options_types::context::MacroMap` shape so the result slots directly
/// into `ctx.debug.macros` without crossing the `bun_ast::Expr` /
/// `StringArrayHashMap` newtype boundary that `bun_resolver`'s copy uses.
fn parse_macros_json(
    macros: &Expr,
    log: &mut bun_ast::Log,
    json_source: &bun_ast::Source,
    bump: &Bump,
) -> MacroMap {
    let mut macro_map = MacroMap::default();
    let ExprData::EObject(obj) = &macros.data else {
        return macro_map;
    };

    for property in obj.properties.slice() {
        let Some(key_expr) = property.key.as_ref() else {
            continue;
        };
        let Some(key) = key_expr.as_string(bump) else {
            continue;
        };
        if !bun_resolver::is_package_path(key) {
            log.add_range_warning_fmt(
                Some(json_source),
                json_source.range_of_string(key_expr.loc),
                format_args!(
                    "\"{}\" is not a package path. \"macros\" remaps package paths to macros. Skipping.",
                    bstr::BStr::new(key)
                ),
            );
            continue;
        }

        let Some(value) = property.value.as_ref() else {
            continue;
        };
        let ExprData::EObject(value_obj) = &value.data else {
            log.add_warning_fmt(
                Some(json_source),
                value.loc,
                format_args!(
                    "Invalid macro remapping in \"{}\": expected object where the keys are import names and the value is a string path to replace",
                    bstr::BStr::new(key)
                ),
            );
            continue;
        };

        let remap_properties = value_obj.properties.slice();
        if remap_properties.is_empty() {
            continue;
        }

        let mut map = MacroImportReplacementMap::default();
        map.reserve(remap_properties.len());
        for remap in remap_properties {
            let Some(remap_key) = remap.key.as_ref() else {
                continue;
            };
            let Some(import_name) = remap_key.as_string(bump) else {
                continue;
            };
            let Some(remap_value) = remap.value.as_ref() else {
                continue;
            };
            let remap_value_str = match &remap_value.data {
                ExprData::EString(s) if s.len() > 0 => estring_to_owned(&*s, bump),
                _ => {
                    log.add_warning_fmt(
                        Some(json_source),
                        remap_value.loc,
                        format_args!(
                            "Invalid macro remapping for import \"{}\": expected string to remap to. e.g. \"graphql\": \"bun-macro-relay\" ",
                            bstr::BStr::new(import_name)
                        ),
                    );
                    continue;
                }
            };
            map.insert(Box::<[u8]>::from(import_name), remap_value_str);
        }

        if map.len() > 0 {
            macro_map.insert(Box::<[u8]>::from(key), map);
        }
    }

    macro_map
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
    source: &'a bun_ast::Source,
    log: &'a mut bun_ast::Log,
    // PORT NOTE: Zig held both `bunfig: *api.TransformOptions` (= `&ctx.args`)
    // and `ctx: *Command.Context` simultaneously. Rust forbids the overlapping
    // borrow, so `bunfig` writes route through `self.ctx.args` directly.
    ctx: &'a mut ContextData,
    /// Arena backing `EString::string()` UTF-16→UTF-8 transcodes; lifetime
    /// matches the `Expr` tree (same bump used for the TOML/JSON parse).
    bump: &'a Bump,
}

impl<'a> Parser<'a> {
    fn add_error(&mut self, loc: bun_ast::Loc, text: &'static [u8]) -> Result<(), bun_core::Error> {
        self.log.add_error_opts(
            text,
            bun_ast::ErrorOpts {
                source: Some(self.source),
                loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        );
        Err(err!("Invalid Bunfig"))
    }

    fn add_error_format(
        &mut self,
        loc: bun_ast::Loc,
        args: core::fmt::Arguments<'_>,
    ) -> Result<(), bun_core::Error> {
        self.log.add_error_fmt_opts(
            args,
            bun_ast::ErrorOpts {
                source: Some(self.source),
                loc,
                redact_sensitive_information: true,
                ..Default::default()
            },
        );
        Err(err!("Invalid Bunfig"))
    }

    pub fn expect_string(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::EString(_) => Ok(()),
            _ => self.add_error_format(
                expr.loc,
                format_args!("expected string but received {}", expr.data.tag_name()),
            ),
        }
    }

    fn apply_coverage_reporter_item(&mut self, item: &Expr) -> Result<(), bun_core::Error> {
        let item_str = item.as_string(self.bump).unwrap_or(b"");
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
        Ok(())
    }

    pub fn expect(&mut self, expr: &Expr, token: ExprTag) -> Result<(), bun_core::Error> {
        if expr.data.tag() != token {
            return self.add_error_format(
                expr.loc,
                format_args!(
                    "expected {} but received {}",
                    <&str>::from(token),
                    expr.data.tag_name()
                ),
            );
        }
        Ok(())
    }

    fn load_log_level(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        self.expect_string(expr)?;
        // PERF(port): Zig used strings.ExactSizeMatcher(8) — profile in Phase B
        let level = match expr.as_string(self.bump).unwrap_or(b"") {
            b"debug" => api::MessageLevel::Debug,
            b"error" => api::MessageLevel::Err,
            b"warn" => api::MessageLevel::Warn,
            b"info" => api::MessageLevel::Info,
            _ => {
                return self.add_error(
                    expr.loc,
                    b"Invalid log level, must be one of debug, error, or warn",
                );
            }
        };
        self.ctx.args.log_level = Some(level);
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

    fn load_env_config(&mut self, expr: &Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::ENull(_) => {
                // env = null -> disable default .env files
                self.ctx.args.disable_default_env_files = true;
            }
            ExprData::EBoolean(boolean) => {
                if !boolean.value {
                    self.ctx.args.disable_default_env_files = true;
                }
            }
            ExprData::EObject(obj) => {
                if let Some(file_expr) = obj.get().get(b"file") {
                    match &file_expr.data {
                        ExprData::ENull(_) => {
                            self.ctx.args.disable_default_env_files = true;
                        }
                        ExprData::EBoolean(boolean) => {
                            if !boolean.value {
                                self.ctx.args.disable_default_env_files = true;
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

    fn parse_define_map(&mut self, expr: &Expr) -> Result<api::StringMap, bun_core::Error> {
        self.expect(expr, ExprTag::EObject)?;
        let obj = expr.data.e_object().expect("infallible: variant checked");
        let properties = obj.properties.slice();
        let valid_count = properties
            .iter()
            .filter(|p| matches!(p.value.as_ref().unwrap().data, ExprData::EString(_)))
            .count();
        let mut keys: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
        let mut values: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
        for prop in properties {
            let ExprData::EString(v) = &prop
                .value
                .as_ref()
                .expect("infallible: prop has value")
                .data
            else {
                continue;
            };
            let ExprData::EString(k) = &prop.key.as_ref().expect("infallible: prop has key").data
            else {
                continue;
            };
            keys.push(estring_to_owned(&*k, self.bump));
            values.push(estring_to_owned(&*v, self.bump));
        }
        Ok(api::StringMap { keys, values })
    }

    // PORT NOTE: `comptime cmd: Command.Tag` demoted to a runtime arg —
    // `bun_options_types::command_tag::Tag` does not derive `ConstParamTy` (it
    // already derives `enum_map::Enum`, which conflicts). The Zig original
    // monomorphised over `cmd` purely to dead-code-eliminate untaken arms; the
    // runtime branches below are equivalent and the few hot fields are tiny.
    pub fn parse(&mut self, cmd: CommandTag) -> Result<(), bun_core::Error> {
        bun_analytics::features::bunfig.fetch_add(1, Ordering::Relaxed);

        let json = self.json;

        if !matches!(json.data, ExprData::EObject(_)) {
            self.add_error(json.loc, b"bunfig expects an object { } at the root")?;
        }

        if let Some(expr) = json.get(b"logLevel") {
            self.load_log_level(&expr)?;
        }

        if let Some(expr) = json.get(b"define") {
            self.ctx.args.define = Some(self.parse_define_map(&expr)?);
        }

        if let Some(expr) = json.get(b"origin") {
            self.expect_string(&expr)?;
            self.ctx.args.origin = Some(estring_to_owned(
                expr.data
                    .e_string()
                    .expect("infallible: variant checked")
                    .get(),
                self.bump,
            ));
        }

        if let Some(env_expr) = json.get(b"env") {
            self.load_env_config(&env_expr)?;
        }

        if cmd == CommandTag::RunCommand || cmd == CommandTag::AutoCommand {
            if let Some(expr) = json.get(b"serve") {
                if let Some(port) = expr.get(b"port") {
                    self.expect(&port, ExprTag::ENumber)?;
                    let p = port.as_number().expect("infallible: type checked") as u16;
                    self.ctx.args.port = Some(if p == 0 { 3000 } else { p });
                }
            }

            if let Some(expr) = json.get(b"preload") {
                self.load_preload(&expr)?;
            }

            if let Some(expr) = json.get(b"telemetry") {
                self.expect(&expr, ExprTag::EBoolean)?;
                bun_analytics::set_enabled(if expr.as_bool().expect("infallible: type checked") {
                    bun_analytics::TriState::Yes
                } else {
                    bun_analytics::TriState::No
                });
            }
        }

        if cmd == CommandTag::RunCommand || cmd == CommandTag::AutoCommand {
            if let Some(expr) = json.get(b"smol") {
                self.expect(&expr, ExprTag::EBoolean)?;
                self.ctx.runtime_options.smol = expr.as_bool().expect("infallible: type checked");
            }
        }

        if cmd == CommandTag::TestCommand {
            if let Some(test_) = json.get(b"test") {
                if let Some(root) = test_.get(b"root") {
                    self.ctx.debug.test_directory = root.as_string(self.bump).unwrap_or(b"").into();
                }

                if let Some(expr) = test_.get(b"preload") {
                    self.load_preload(&expr)?;
                }

                if let Some(expr) = test_.get(b"smol") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.runtime_options.smol =
                        expr.as_bool().expect("infallible: type checked");
                }

                if let Some(expr) = test_.get(b"coverage") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.enabled =
                        expr.as_bool().expect("infallible: type checked");
                }

                if let Some(expr) = test_.get(b"onlyFailures") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.reporters.only_failures =
                        expr.as_bool().expect("infallible: type checked");
                }

                if let Some(expr) = test_.get(b"reporter") {
                    self.expect(&expr, ExprTag::EObject)?;
                    if let Some(junit_expr) = expr.get(b"junit") {
                        self.expect_string(&junit_expr)?;
                        if let ExprData::EString(s) = &junit_expr.data {
                            if s.len() > 0 {
                                self.ctx.test_options.reporters.junit = true;
                                self.ctx.test_options.reporter_outfile =
                                    Some(estring_to_owned(s, self.bump));
                            }
                        }
                    }
                    if let Some(dots_expr) = expr.get(b"dots").or_else(|| expr.get(b"dot")) {
                        self.expect(&dots_expr, ExprTag::EBoolean)?;
                        self.ctx.test_options.reporters.dots =
                            dots_expr.as_bool().expect("infallible: type checked");
                    }
                }

                if let Some(expr) = test_.get(b"coverageReporter") {
                    'brk: {
                        self.ctx.test_options.coverage.reporters = CoverageReporters {
                            text: false,
                            lcov: false,
                        };
                        if let ExprData::EString(_) = &expr.data {
                            self.apply_coverage_reporter_item(&expr)?;
                            break 'brk;
                        }

                        self.expect(&expr, ExprTag::EArray)?;
                        let arr = expr.data.e_array().expect("infallible: variant checked");
                        let items = arr.items.slice();
                        for item in items {
                            self.expect_string(item)?;
                            self.apply_coverage_reporter_item(item)?;
                        }
                    }
                }

                if let Some(expr) = test_.get(b"coverageDir") {
                    self.expect_string(&expr)?;
                    self.ctx.test_options.coverage.reports_directory = estring_to_owned(
                        expr.data
                            .e_string()
                            .expect("infallible: variant checked")
                            .get(),
                        self.bump,
                    );
                }

                if let Some(expr) = test_.get(b"coverageThreshold") {
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
                        if let Some(functions) = expr.get(b"functions") {
                            self.expect(&functions, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.functions =
                                functions.as_number().expect("infallible: type checked");
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                        if let Some(lines) = expr.get(b"lines") {
                            self.expect(&lines, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.lines =
                                lines.as_number().expect("infallible: type checked");
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                        if let Some(stmts) = expr.get(b"statements") {
                            self.expect(&stmts, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.stmts =
                                stmts.as_number().expect("infallible: type checked");
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                    }
                }

                // This mostly exists for debugging.
                if let Some(expr) = test_.get(b"coverageIgnoreSourcemaps") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.ignore_sourcemap =
                        expr.as_bool().expect("infallible: type checked");
                }

                if let Some(expr) = test_.get(b"coverageSkipTestFiles") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.skip_test_files =
                        expr.as_bool().expect("infallible: type checked");
                }

                let mut randomize_from_config: Option<bool> = None;

                if let Some(expr) = test_.get(b"randomize") {
                    self.expect(&expr, ExprTag::EBoolean)?;
                    randomize_from_config = expr.as_bool();
                    self.ctx.test_options.randomize =
                        expr.as_bool().expect("infallible: type checked");
                }

                if let Some(expr) = test_.get(b"seed") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    let seed_value =
                        num_to_u32(expr.as_number().expect("infallible: type checked"));

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

                if let Some(expr) = test_.get(b"rerunEach") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.retry != 0 {
                        self.add_error(expr.loc, b"\"rerunEach\" cannot be used with \"retry\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.repeat_count =
                        num_to_u32(expr.as_number().expect("infallible: type checked"));
                }

                if let Some(expr) = test_.get(b"retry") {
                    self.expect(&expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.repeat_count != 0 {
                        self.add_error(expr.loc, b"\"retry\" cannot be used with \"rerunEach\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.retry =
                        num_to_u32(expr.as_number().expect("infallible: type checked"));
                }

                if let Some(expr) = test_.get(b"concurrentTestGlob") {
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
                                patterns.push(estring_to_owned(&*s, self.bump));
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

                if let Some(expr) = test_.get(b"coveragePathIgnorePatterns") {
                    'brk: {
                        match &expr.data {
                            ExprData::EString(s) => {
                                self.ctx.test_options.coverage.ignore_patterns =
                                    vec![estring_to_owned(s, self.bump)];
                            }
                            ExprData::EArray(arr) => {
                                let items = arr.items.slice();
                                if items.is_empty() {
                                    break 'brk;
                                }
                                let mut patterns: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                                for item in items {
                                    let ExprData::EString(s) = &item.data else {
                                        self.add_error(
                                            item.loc,
                                            b"coveragePathIgnorePatterns array must contain only strings",
                                        )?;
                                        return Ok(());
                                    };
                                    patterns.push(estring_to_owned(&*s, self.bump));
                                }
                                self.ctx.test_options.coverage.ignore_patterns = patterns;
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
                }

                if let Some(expr) = test_.get(b"pathIgnorePatterns") {
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
                                let mut patterns: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                                for item in items {
                                    let ExprData::EString(s) = &item.data else {
                                        self.add_error(
                                            item.loc,
                                            b"pathIgnorePatterns array must contain only strings",
                                        )?;
                                        return Ok(());
                                    };
                                    patterns.push(estring_to_owned(&*s, self.bump));
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
            if let Some(install_obj) = json.get_object(b"install") {
                // Ensure ctx.install is allocated so later passes can write into it
                // once api::BunInstall fields land.
                if self.ctx.install.is_none() {
                    self.ctx.install = Some(Box::new(api::BunInstall::default()));
                }

                if let Some(auto_install_expr) = install_obj.get(b"auto") {
                    if let ExprData::EString(_) = &auto_install_expr.data {
                        let key = auto_install_expr.as_string(self.bump).unwrap_or(b"");
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

                if let Some(prefer_expr) = install_obj.get(b"prefer") {
                    self.expect_string(&prefer_expr)?;
                    let key = prefer_expr.as_string(self.bump).unwrap_or(b"");
                    if let Some(setting) = OFFLINE_PREFER.get(key) {
                        self.ctx.debug.offline_mode_setting = Some(*setting);
                    } else {
                        self.add_error(
                            prefer_expr.loc,
                            b"Invalid prefer setting, must be one of online or offline",
                        )?;
                    }
                }

                if let Some(expr) = install_obj.get(b"logLevel") {
                    self.load_log_level(&expr)?;
                }

                self.parse_install(&install_obj)?;
            }

            if let Some(run_expr) = json.get(b"run") {
                if let Some(silent) = run_expr.get(b"silent") {
                    if let Some(value) = silent.as_bool() {
                        self.ctx.debug.silent = value;
                    } else {
                        self.add_error(silent.loc, b"Expected boolean")?;
                    }
                }

                if let Some(elide_lines) = run_expr.get(b"elide-lines") {
                    if let Some(n) = elide_lines.as_number() {
                        // Note: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB
                        self.ctx.bundler_options.elide_lines = Some(n as usize);
                    } else {
                        self.add_error(elide_lines.loc, b"Expected number")?;
                    }
                }

                if let Some(shell) = run_expr.get(b"shell") {
                    if let Some(value) = shell.as_string(self.bump) {
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

                if let Some(bun_flag) = run_expr.get(b"bun") {
                    if let Some(value) = bun_flag.as_bool() {
                        self.ctx.debug.run_in_bun = value;
                    } else {
                        self.add_error(bun_flag.loc, b"Expected boolean")?;
                    }
                }

                if let Some(no_orphans) = run_expr.get(b"noOrphans") {
                    if let Some(value) = no_orphans.as_bool() {
                        if value {
                            bun_io::ParentDeathWatchdog::enable();
                        }
                    } else {
                        self.add_error(no_orphans.loc, b"Expected boolean")?;
                    }
                }
            }

            if let Some(console_expr) = json.get(b"console") {
                if let Some(depth) = console_expr.get(b"depth") {
                    if let Some(n) = depth.as_number() {
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

        if let Some(serve_obj2) = json.get_object(b"serve") {
            if let Some(serve_obj) = serve_obj2.get_object(b"static") {
                self.parse_serve_static(&serve_obj)?;
            }
        }

        if let Some(_bun) = json.get(b"bundle") {
            if cmd == CommandTag::BuildCommand
                || cmd == CommandTag::RunCommand
                || cmd == CommandTag::AutoCommand
            {
                if let Some(dir) = _bun.get(b"outdir") {
                    self.expect_string(&dir)?;
                    self.ctx.args.output_dir = Some(estring_to_owned(
                        dir.data
                            .e_string()
                            .expect("infallible: variant checked")
                            .get(),
                        self.bump,
                    ));
                }
            }

            if cmd == CommandTag::BuildCommand {
                if let Some(expr2) = _bun.get(b"logLevel") {
                    self.load_log_level(&expr2)?;
                }

                if let Some(entry_points) = _bun.get(b"entryPoints") {
                    self.expect(&entry_points, ExprTag::EArray)?;
                    let arr = entry_points
                        .data
                        .e_array()
                        .expect("infallible: variant checked");
                    let items = arr.items.slice();
                    let mut names: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                    for item in items {
                        self.expect_string(item)?;
                        names.push(estring_to_owned(
                            item.data
                                .e_string()
                                .expect("infallible: variant checked")
                                .get(),
                            self.bump,
                        ));
                    }
                    self.ctx.args.entry_points = names;
                }

                if let Some(expr) = _bun.get(b"packages") {
                    self.expect(&expr, ExprTag::EObject)?;
                    let object = expr.data.e_object().expect("infallible: variant checked");
                    let properties = object.properties.slice();
                    let mut valid_count: usize = 0;
                    for prop in properties {
                        if !matches!(
                            prop.value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .data,
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
                        let ExprData::EBoolean(b) = prop
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .data
                        else {
                            continue;
                        };
                        let key_expr = prop.key.as_ref().expect("infallible: prop has key");
                        let ExprData::EString(k) = &key_expr.data else {
                            continue;
                        };
                        let path = estring_to_owned(&*k, self.bump);

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

        if let Some(expr) = json.get(b"jsx") {
            if let Some(value) = expr.as_string(self.bump) {
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
        if let Some(expr) = json.get(b"jsxImportSource") {
            if let Some(value) = expr.as_string(self.bump) {
                jsx_import_source = Box::<[u8]>::from(value);
            }
        }
        if let Some(expr) = json.get(b"jsxFragment") {
            if let Some(value) = expr.as_string(self.bump) {
                jsx_fragment = Box::<[u8]>::from(value);
            }
        }
        if let Some(expr) = json.get(b"jsxFactory") {
            if let Some(value) = expr.as_string(self.bump) {
                jsx_factory = Box::<[u8]>::from(value);
            }
        }
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
                if !jsx_factory.is_empty() {
                    jsx.factory = jsx_factory;
                }
                if !jsx_fragment.is_empty() {
                    jsx.fragment = jsx_fragment;
                }
                if !jsx_import_source.is_empty() {
                    jsx.import_source = jsx_import_source;
                }
                jsx.runtime = jsx_runtime;
                jsx.development = jsx_dev;
            }
        }

        if let Some(expr) = json.get(b"debug") {
            if let Some(editor) = expr.get(b"editor") {
                if let Some(value) = editor.as_string(self.bump) {
                    self.ctx.debug.editor = value.into();
                }
            }
        }

        if let Some(expr) = json.get(b"macros") {
            if let ExprData::EBoolean(b) = expr.data {
                if b.value == false {
                    self.ctx.debug.macros = MacroOptions::Disable;
                }
            } else {
                self.ctx.debug.macros =
                    MacroOptions::Map(parse_macros_json(&expr, self.log, self.source, self.bump));
            }
            bun_analytics::features::macros.fetch_add(1, Ordering::Relaxed);
        }

        if let Some(expr) = json.get(b"external") {
            match &expr.data {
                ExprData::EString(s) => {
                    self.ctx.args.external = vec![estring_to_owned(s, self.bump)];
                }
                ExprData::EArray(array) => {
                    let items = array.items.slice();
                    let mut externals: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                    for item in items {
                        self.expect_string(item)?;
                        let ExprData::EString(s) = &item.data else {
                            unreachable!("expect_string returned Ok for non-EString")
                        };
                        externals.push(estring_to_owned(s, self.bump));
                    }
                    self.ctx.args.external = externals;
                }
                _ => self.add_error(expr.loc, b"Expected string or array")?,
            }
        }

        if let Some(expr) = json.get(b"loader") {
            self.expect(&expr, ExprTag::EObject)?;
            let obj = expr.data.e_object().expect("infallible: variant checked");
            let properties = obj.properties.slice();
            let mut loader_names: Vec<Box<[u8]>> = Vec::with_capacity(properties.len());
            let mut loader_values: Vec<api::Loader> = Vec::with_capacity(properties.len());
            for item in properties {
                let key_expr = item.key.as_ref().expect("infallible: prop has key");
                let key = key_expr
                    .as_string(self.bump)
                    .expect("infallible: type checked");
                if key.is_empty() {
                    continue;
                }
                if key[0] != b'.' {
                    self.add_error(
                        key_expr.loc,
                        b"file extension for loader must start with a '.'",
                    )?;
                }
                let value = item.value.as_ref().expect("infallible: prop has value");
                self.expect_string(value)?;
                let Some(loader) = bun_ast::Loader::from_string(
                    value
                        .as_string(self.bump)
                        .expect("infallible: type checked"),
                ) else {
                    self.add_error(value.loc, b"Invalid loader")?;
                    continue;
                };
                loader_names.push(key.into());
                loader_values.push(loader.to_api());
            }
            self.ctx.args.loaders = Some(api::LoaderMap {
                extensions: loader_names,
                loaders: loader_values,
            });
        }

        Ok(())
    }
}

impl Bunfig {
    pub fn parse(
        cmd: CommandTag,
        source: &bun_ast::Source,
        ctx: &mut ContextData,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: ctx.log is populated by `create_context_data()` before any
        // bunfig load; single-threaded CLI startup invariant. The raw pointer
        // is copied out so the resulting `&mut Log` does not borrow `ctx`
        // (Parser later needs `&mut ctx` alongside `&mut log`).
        let log_ptr: *mut bun_ast::Log = ctx.log;
        debug_assert!(!log_ptr.is_null());
        let log: &mut bun_ast::Log = unsafe { &mut *log_ptr };
        let log_count = log.errors + log.warnings;

        // Zig passes `bun.default_allocator` here — no side `mi_heap`. The Rust
        // port previously called `Arena::new()` (= `mi_heap_new` +
        // `mi_heap_destroy` on drop), which perf attributed ~1.6% of
        // `bun -e ''` startup to. Borrow the process default heap instead so
        // TOML/JSON parse allocations route through plain `mi_malloc`, matching
        // Zig. Parsed config lives for the process lifetime either way.
        let bump = Bump::borrowing_default();

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
                            bun_ast::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        );
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
                            bun_ast::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        );
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
// `[install]` / `[install.scopes]` registry parsing and `[serve.static]`.
// Split into a second `impl` block purely to keep `parse(cmd)` readable.
// ─────────────────────────────────────────────────────────────────────────────

impl<'a> Parser<'a> {
    fn parse_registry_url_string(
        &mut self,
        str: &E::EString,
    ) -> Result<api::NpmRegistry, bun_core::Error> {
        // Dedup D009: body is the canonical port in `bun_api::npm_registry`.
        // The api `Parser` is generic over log/source and never reads them for
        // this path, so we just hand it our reborrowed handles.
        let bytes = str.string(self.bump)?;
        Ok(bun_api::npm_registry::Parser {
            log: &mut *self.log,
            source: self.source,
        }
        .parse_registry_url_string_impl(bytes)?)
    }

    fn parse_registry_object(
        &mut self,
        obj: &E::Object,
    ) -> Result<api::NpmRegistry, bun_core::Error> {
        let mut registry = api::NpmRegistry::default();

        if let Some(url) = obj.get(b"url") {
            self.expect_string(&url)?;
            registry.url = url
                .as_string(self.bump)
                .expect("infallible: type checked")
                .into();
        }
        if let Some(username) = obj.get(b"username") {
            self.expect_string(&username)?;
            registry.username = username
                .as_string(self.bump)
                .expect("infallible: type checked")
                .into();
        }
        if let Some(password) = obj.get(b"password") {
            self.expect_string(&password)?;
            registry.password = password
                .as_string(self.bump)
                .expect("infallible: type checked")
                .into();
        }
        if let Some(token) = obj.get(b"token") {
            self.expect_string(&token)?;
            registry.token = token
                .as_string(self.bump)
                .expect("infallible: type checked")
                .into();
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

    fn parse_install(&mut self, install_obj: &Expr) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig held `*BunInstall` and `*Parser` simultaneously.
        // The helper methods (`expect*`, `add_error`, `parse_registry`) take
        // `&mut self`, which under Stacked Borrows would invalidate any
        // long-lived `&mut` derived from `self.ctx.install`. Move the box
        // out so the install borrow is provably disjoint from `self`, then
        // restore it on every exit path.
        let mut install = self.ctx.install.take().expect("install slot primed");
        let result = self.parse_install_inner(&mut install, install_obj);
        self.ctx.install = Some(install);
        result
    }

    fn parse_install_inner(
        &mut self,
        install: &mut api::BunInstall,
        install_obj: &Expr,
    ) -> Result<(), bun_core::Error> {
        if let Some(cafile) = install_obj.get(b"cafile") {
            install.cafile = match cafile.as_string(self.bump) {
                Some(s) => Some(s.into()),
                None => {
                    self.add_error(cafile.loc, b"Invalid cafile. Expected a string.")?;
                    return Ok(());
                }
            };
        }

        if let Some(ca) = install_obj.get(b"ca") {
            match &ca.data {
                ExprData::EArray(arr) => {
                    let items = arr.items.slice();
                    let mut list: Vec<Box<[u8]>> = Vec::with_capacity(items.len());
                    for item in items {
                        match item.as_string(self.bump) {
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

        if let Some(exact) = install_obj.get(b"exact") {
            if let Some(v) = exact.as_bool() {
                install.exact = Some(v);
            }
        }

        if let Some(registry) = install_obj.get(b"registry") {
            install.default_registry = Some(self.parse_registry(&registry)?);
        }

        if let Some(scopes) = install_obj.get(b"scopes") {
            let mut registry_map = install.scoped.take().unwrap_or_default();
            self.expect(&scopes, ExprTag::EObject)?;
            let obj = scopes.data.e_object().expect("infallible: variant checked");
            registry_map.scopes.reserve(obj.properties.slice().len());
            for prop in obj.properties.slice() {
                let Some(name_) = prop.key.as_ref().and_then(|k| k.as_string(self.bump)) else {
                    continue;
                };
                let Some(value) = prop.value.as_ref() else {
                    continue;
                };
                if name_.is_empty() {
                    continue;
                }
                let name = if name_[0] == b'@' { &name_[1..] } else { name_ };
                let registry = self.parse_registry(value)?;
                registry_map.scopes.insert(name.into(), registry);
            }
            install.scoped = Some(registry_map);
        }

        if let Some(v) = install_obj.get(b"dryRun").and_then(|e| e.as_bool()) {
            install.dry_run = Some(v);
        }
        if let Some(v) = install_obj.get(b"production").and_then(|e| e.as_bool()) {
            install.production = Some(v);
        }
        if let Some(v) = install_obj.get(b"frozenLockfile").and_then(|e| e.as_bool()) {
            install.frozen_lockfile = Some(v);
        }
        if let Some(v) = install_obj
            .get(b"saveTextLockfile")
            .and_then(|e| e.as_bool())
        {
            install.save_text_lockfile = Some(v);
        }
        if let Some(jobs) = install_obj.get(b"concurrentScripts") {
            if let Some(n) = jobs.as_number() {
                let n = num_to_u32(n);
                install.concurrent_scripts = if n == 0 { None } else { Some(n) };
            }
        }
        if let Some(v) = install_obj.get(b"ignoreScripts").and_then(|e| e.as_bool()) {
            install.ignore_scripts = Some(v);
        }
        if let Some(node_linker_expr) = install_obj.get(b"linker") {
            self.expect_string(&node_linker_expr)?;
            if let Some(s) = node_linker_expr.as_string(self.bump) {
                install.node_linker = api::NodeLinker::from_str(s);
                if install.node_linker.is_none() {
                    self.add_error(
                        node_linker_expr.loc,
                        b"Expected one of \"isolated\" or \"hoisted\"",
                    )?;
                }
            }
        }
        if let Some(v) = install_obj.get(b"globalStore").and_then(|e| e.as_bool()) {
            install.global_store = Some(v);
        }

        if let Some(lockfile_expr) = install_obj.get(b"lockfile") {
            if let Some(lockfile) = lockfile_expr.get(b"print") {
                self.expect_string(&lockfile)?;
                if let Some(value) = lockfile.as_string(self.bump) {
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
            if let Some(v) = lockfile_expr.get(b"save").and_then(|e| e.as_bool()) {
                install.save_lockfile = Some(v);
            }
            if let Some(v) = lockfile_expr
                .get(b"path")
                .and_then(|e| e.as_string(self.bump))
            {
                install.lockfile_path = Some(v.into());
            }
            if let Some(v) = lockfile_expr
                .get(b"savePath")
                .and_then(|e| e.as_string(self.bump))
            {
                install.save_lockfile_path = Some(v.into());
            }
        }

        if let Some(v) = install_obj.get(b"optional").and_then(|e| e.as_bool()) {
            install.save_optional = Some(v);
        }
        if let Some(v) = install_obj.get(b"peer").and_then(|e| e.as_bool()) {
            install.save_peer = Some(v);
        }
        if let Some(v) = install_obj.get(b"dev").and_then(|e| e.as_bool()) {
            install.save_dev = Some(v);
        }
        if let Some(v) = install_obj
            .get(b"globalDir")
            .and_then(|e| e.as_string(self.bump))
        {
            install.global_dir = Some(v.into());
        }
        if let Some(v) = install_obj
            .get(b"globalBinDir")
            .and_then(|e| e.as_string(self.bump))
        {
            install.global_bin_dir = Some(v.into());
        }

        if let Some(cache) = install_obj.get(b"cache") {
            'load: {
                if let Some(value) = cache.as_bool() {
                    if !value {
                        install.disable_cache = Some(true);
                        install.disable_manifest_cache = Some(true);
                    }
                    break 'load;
                }
                if let Some(value) = cache.as_string(self.bump) {
                    install.cache_directory = Some(value.into());
                    break 'load;
                }
                if let ExprData::EObject(_) = cache.data {
                    if let Some(v) = cache.get(b"disable").and_then(|e| e.as_bool()) {
                        install.disable_cache = Some(v);
                    }
                    if let Some(v) = cache.get(b"disableManifest").and_then(|e| e.as_bool()) {
                        install.disable_manifest_cache = Some(v);
                    }
                    if let Some(v) = cache.get(b"dir").and_then(|e| e.as_string(self.bump)) {
                        install.cache_directory = Some(v.into());
                    }
                }
            }
        }

        if let Some(v) = install_obj
            .get(b"linkWorkspacePackages")
            .and_then(|e| e.as_bool())
        {
            install.link_workspace_packages = Some(v);
        }

        if let Some(security_obj) = install_obj.get(b"security") {
            if let ExprData::EObject(_) = security_obj.data {
                if let Some(scanner) = security_obj.get(b"scanner") {
                    self.expect_string(&scanner)?;
                    install.security_scanner = scanner.as_string(self.bump).map(Into::into);
                }
            } else {
                self.add_error(
                    security_obj.loc,
                    b"Invalid security config, expected an object",
                )?;
            }
        }

        if let Some(min_age) = install_obj.get(b"minimumReleaseAge") {
            match &min_age.data {
                ExprData::ENumber(seconds) => {
                    if seconds.value < 0.0 {
                        self.add_error(
                            min_age.loc,
                            b"Expected positive number of seconds for minimumReleaseAge",
                        )?;
                        return Ok(());
                    }
                    const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;
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

        if let Some(exclusions) = install_obj.get(b"minimumReleaseAgeExcludes") {
            match &exclusions.data {
                ExprData::EArray(arr) => 'brk: {
                    let raw = arr.items.slice();
                    if raw.is_empty() {
                        break 'brk;
                    }
                    let mut list: Vec<Box<[u8]>> = Vec::with_capacity(raw.len());
                    for p in raw {
                        self.expect_string(p)?;
                        list.push(estring_to_owned(
                            p.data
                                .e_string()
                                .expect("infallible: variant checked")
                                .get(),
                            self.bump,
                        ));
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

        // bunfig.zig:824-839 — remap PnpmMatcher errors so callers (and the
        // crash handler's `"Invalid Bunfig"` match) see the canonical
        // bunfig error; only OOM passes through unchanged.
        let remap = |e: FromExprError| -> bun_core::Error {
            match e {
                FromExprError::OutOfMemory => err!(OutOfMemory),
                FromExprError::UnexpectedExpr | FromExprError::InvalidRegExp => {
                    err!("Invalid Bunfig")
                }
            }
        };
        if let Some(public_hoist_pattern_expr) = install_obj.get(b"publicHoistPattern") {
            install.public_hoist_pattern = Some(
                api::PnpmMatcher::from_expr(&public_hoist_pattern_expr, self.log, self.source)
                    .map_err(remap)?,
            );
        }
        if let Some(hoist_pattern_expr) = install_obj.get(b"hoistPattern") {
            install.hoist_pattern = Some(
                api::PnpmMatcher::from_expr(&hoist_pattern_expr, self.log, self.source)
                    .map_err(remap)?,
            );
        }

        Ok(())
    }

    fn parse_serve_static(&mut self, serve_obj: &Expr) -> Result<(), bun_core::Error> {
        if let Some(config_plugins) = serve_obj.get(b"plugins") {
            let plugins: Option<Vec<Box<[u8]>>> = 'plugins: {
                if let ExprData::EArray(arr) = &config_plugins.data {
                    let raw = arr.items.slice();
                    if raw.is_empty() {
                        break 'plugins None;
                    }
                    let mut plugins: Vec<Box<[u8]>> = Vec::with_capacity(raw.len());
                    for p in raw {
                        self.expect_string(p)?;
                        plugins.push(estring_to_owned(
                            p.data
                                .e_string()
                                .expect("infallible: variant checked")
                                .get(),
                            self.bump,
                        ));
                    }
                    break 'plugins Some(plugins);
                } else {
                    self.expect_string(&config_plugins)?;
                    let s = config_plugins
                        .data
                        .e_string()
                        .expect("infallible: variant checked");
                    break 'plugins Some(vec![estring_to_owned(s.get(), self.bump)]);
                }
            };
            // TODO: accept entire config object.
            self.ctx.args.serve_plugins = plugins;
        }

        if let Some(hmr) = serve_obj.get(b"hmr") {
            if let Some(v) = hmr.as_bool() {
                self.ctx.args.serve_hmr = Some(v);
            }
        }

        if let Some(minify) = serve_obj.get(b"minify") {
            if let Some(v) = minify.as_bool() {
                self.ctx.args.serve_minify_syntax = Some(v);
                self.ctx.args.serve_minify_whitespace = Some(v);
                self.ctx.args.serve_minify_identifiers = Some(v);
            } else if minify.is_object() {
                if let Some(syntax) = minify.get(b"syntax") {
                    self.ctx.args.serve_minify_syntax = Some(syntax.as_bool().unwrap_or(false));
                }
                if let Some(whitespace) = minify.get(b"whitespace") {
                    self.ctx.args.serve_minify_whitespace =
                        Some(whitespace.as_bool().unwrap_or(false));
                }
                if let Some(identifiers) = minify.get(b"identifiers") {
                    self.ctx.args.serve_minify_identifiers =
                        Some(identifiers.as_bool().unwrap_or(false));
                }
            } else {
                self.add_error(minify.loc, b"Expected minify to be boolean or object")?;
            }
        }

        if let Some(expr) = serve_obj.get(b"define") {
            self.ctx.args.serve_define = Some(self.parse_define_map(&expr)?);
        }
        self.ctx.args.bunfig_path = Box::<[u8]>::from(self.source.path.text);

        if let Some(public_path) = serve_obj.get(b"publicPath") {
            if let Some(v) = public_path.as_string(self.bump) {
                self.ctx.args.serve_public_path = Some(v.into());
            }
        }

        if let Some(env) = serve_obj.get(b"env") {
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
                    let slice = str.string(self.bump)?;
                    match api::DotEnvBehavior::parse_str(slice) {
                        Ok((behavior, prefix)) => {
                            if let Some(prefix) = prefix {
                                self.ctx.args.serve_env_prefix = Some(Box::<[u8]>::from(prefix));
                            }
                            self.ctx.args.serve_env_behavior = behavior;
                        }
                        Err(()) => {
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

// ported from: src/runtime/cli/bunfig.zig
