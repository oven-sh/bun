use std::io::Write as _;

use bun_bundler::options;
use bun_collections::ArrayHashMap;
use bun_core::{self, err};
use bun_install::{self, PackageManager};
use bun_interchange::toml::TOML;
use bun_js_parser as js_ast;
use bun_js_parser::{E, Expr, ExprData, ExprTag};
use bun_json as json_parser;
use bun_logger as logger;
use bun_resolver as resolver;
use bun_resolver::package_json::PackageJSON;
use bun_schema::api;
use bun_str::strings;
use bun_url::URL;

use crate::cli::{Command, ContextData};
// TODO(port): `Command::Tag` must `#[derive(core::marker::ConstParamTy, PartialEq, Eq)]`
use crate::cli::command::Tag as CommandTag;

pub type MacroImportReplacementMap = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
pub type MacroMap = ArrayHashMap<Box<[u8]>, MacroImportReplacementMap>;
pub type BundlePackageOverride = ArrayHashMap<Box<[u8]>, options::BundleOverride>;
type LoaderMap = ArrayHashMap<Box<[u8]>, options::Loader>;

// TODO: replace api.TransformOptions with Bunfig
pub struct Bunfig;

// Re-exports (Zig: `pub const OfflineMode = @import("../options_types/OfflineMode.zig").OfflineMode;`)
pub use bun_options_types::offline_mode::{OfflineMode, Prefer};

pub struct Parser<'a> {
    pub json: js_ast::Expr,
    pub source: &'a logger::Source,
    pub log: &'a mut logger::Log,
    // allocator field deleted (non-AST crate uses global mimalloc)
    pub bunfig: &'a mut api::TransformOptions,
    pub ctx: &'a mut ContextData,
}

impl<'a> Parser<'a> {
    fn add_error(&mut self, loc: logger::Loc, text: &'static str) -> Result<(), bun_core::Error> {
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

    fn parse_registry_url_string(
        &mut self,
        str: &E::String,
    ) -> Result<api::NpmRegistry, bun_core::Error> {
        let url = URL::parse(str.data());
        // SAFETY: all-zero is a valid api::NpmRegistry (POD, no NonNull/NonZero fields)
        let mut registry: api::NpmRegistry = unsafe { core::mem::zeroed() };

        // Token
        if url.username.is_empty() && !url.password.is_empty() {
            registry.token = url.password.into();
            let mut s = Vec::<u8>::new();
            write!(
                &mut s,
                "{}://{}/{}/",
                bstr::BStr::new(url.display_protocol()),
                url.display_host(),
                bstr::BStr::new(strings::trim(url.pathname, b"/")),
            )
            .expect("unreachable"); // io::Write on Vec<u8> is infallible
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
                bstr::BStr::new(strings::trim(url.pathname, b"/")),
            )
            .expect("unreachable"); // io::Write on Vec<u8> is infallible
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
        // SAFETY: all-zero is a valid api::NpmRegistry
        let mut registry: api::NpmRegistry = unsafe { core::mem::zeroed() };

        if let Some(url) = obj.get(b"url") {
            self.expect_string(url)?;
            let href = url.as_string().unwrap();
            // Do not include a trailing slash. There might be parameters at the end.
            registry.url = href.into();
        }

        if let Some(username) = obj.get(b"username") {
            self.expect_string(username)?;
            registry.username = username.as_string().unwrap().into();
        }

        if let Some(password) = obj.get(b"password") {
            self.expect_string(password)?;
            registry.password = password.as_string().unwrap().into();
        }

        if let Some(token) = obj.get(b"token") {
            self.expect_string(token)?;
            registry.token = token.as_string().unwrap().into();
        }

        Ok(registry)
    }

    fn parse_registry(&mut self, expr: js_ast::Expr) -> Result<api::NpmRegistry, bun_core::Error> {
        match &expr.data {
            ExprData::EString(str) => self.parse_registry_url_string(str),
            ExprData::EObject(obj) => self.parse_registry_object(obj),
            _ => {
                self.add_error(
                    expr.loc,
                    "Expected registry to be a URL string or an object",
                )?;
                // SAFETY: all-zero is a valid api::NpmRegistry
                Ok(unsafe { core::mem::zeroed() })
            }
        }
    }

    fn load_log_level(&mut self, expr: js_ast::Expr) -> Result<(), bun_core::Error> {
        self.expect_string(expr)?;
        // PERF(port): Zig used strings.ExactSizeMatcher(8) — profile in Phase B
        self.bunfig.log_level = Some(match expr.as_string().unwrap() {
            b"debug" => api::MessageLevel::Debug,
            b"error" => api::MessageLevel::Err,
            b"warn" => api::MessageLevel::Warn,
            b"info" => api::MessageLevel::Info,
            _ => {
                self.add_error(
                    expr.loc,
                    "Invalid log level, must be one of debug, error, or warn",
                )?;
                unreachable!()
            }
        });
        Ok(())
    }

    fn load_preload(&mut self, expr: js_ast::Expr) -> Result<(), bun_core::Error> {
        if let Some(mut array) = expr.as_array() {
            let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(array.array.items.len());
            // errdefer preloads.deinit() — deleted: Vec drops on `?`
            while let Some(item) = array.next() {
                self.expect_string(item)?;
                if item.data.as_e_string().len() > 0 {
                    // PERF(port): was appendAssumeCapacity
                    preloads.push(item.data.as_e_string().string()?);
                }
            }
            self.ctx.preloads = preloads.into();
        } else if expr.data.tag() == ExprTag::EString {
            if expr.data.as_e_string().len() > 0 {
                let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(1);
                preloads.push(expr.data.as_e_string().string()?);
                self.ctx.preloads = preloads.into();
            }
        } else if expr.data.tag() != ExprTag::ENull {
            self.add_error(expr.loc, "Expected preload to be an array")?;
        }
        Ok(())
    }

    fn load_env_config(&mut self, expr: js_ast::Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::ENull(_) => {
                // env = null -> disable default .env files
                self.bunfig.disable_default_env_files = true;
            }
            ExprData::EBoolean(boolean) => {
                // env = false -> disable default .env files
                // env = true -> keep default behavior (load .env files)
                if !boolean.value {
                    self.bunfig.disable_default_env_files = true;
                }
            }
            ExprData::EObject(obj) => {
                // env = { file: false } -> disable default .env files
                if let Some(file_expr) = obj.get(b"file") {
                    match &file_expr.data {
                        ExprData::ENull(_) => {
                            self.bunfig.disable_default_env_files = true;
                        }
                        ExprData::EBoolean(boolean) => {
                            if !boolean.value {
                                self.bunfig.disable_default_env_files = true;
                            }
                        }
                        _ => {
                            self.add_error(
                                file_expr.loc,
                                "Expected 'file' to be a boolean or null",
                            )?;
                        }
                    }
                }
            }
            _ => {
                self.add_error(
                    expr.loc,
                    "Expected 'env' to be a boolean, null, or an object",
                )?;
            }
        }
        Ok(())
    }

    pub fn parse<const CMD: CommandTag>(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_analytics::Features::bunfig_inc(1);

        let json = &self.json;

        if json.data.tag() != ExprTag::EObject {
            self.add_error(json.loc, "bunfig expects an object { } at the root")?;
        }

        if let Some(expr) = json.get(b"logLevel") {
            self.load_log_level(expr)?;
        }

        if let Some(expr) = json.get(b"define") {
            self.expect(expr, ExprTag::EObject)?;
            let mut valid_count: usize = 0;
            let properties = expr.data.as_e_object().properties.slice();
            for prop in properties {
                if prop.value.as_ref().unwrap().data.tag() != ExprTag::EString {
                    continue;
                }
                valid_count += 1;
            }
            let mut buffer: Vec<Box<[u8]>> = vec![Box::default(); valid_count * 2];
            let (keys, values) = buffer.split_at_mut(valid_count);
            let mut i: usize = 0;
            for prop in properties {
                if prop.value.as_ref().unwrap().data.tag() != ExprTag::EString {
                    continue;
                }
                keys[i] = prop
                    .key
                    .as_ref()
                    .unwrap()
                    .data
                    .as_e_string()
                    .string()
                    .expect("unreachable");
                values[i] = prop
                    .value
                    .as_ref()
                    .unwrap()
                    .data
                    .as_e_string()
                    .string()
                    .expect("unreachable");
                i += 1;
            }
            // TODO(port): api::StringMap layout — Zig used a single buffer split in two;
            // Rust port keeps two Vecs derived from one buffer.
            let mut buffer = buffer;
            let values_vec = buffer.split_off(valid_count);
            self.bunfig.define = Some(api::StringMap {
                keys: buffer.into(),
                values: values_vec.into(),
            });
        }

        if let Some(expr) = json.get(b"origin") {
            self.expect_string(expr)?;
            self.bunfig.origin = Some(expr.data.as_e_string().string()?);
        }

        if let Some(env_expr) = json.get(b"env") {
            self.load_env_config(env_expr)?;
        }

        if CMD == CommandTag::RunCommand || CMD == CommandTag::AutoCommand {
            if let Some(expr) = json.get(b"serve") {
                if let Some(port) = expr.get(b"port") {
                    self.expect(port, ExprTag::ENumber)?;
                    self.bunfig.port = Some(port.data.as_e_number().to_u16());
                    if self.bunfig.port.unwrap() == 0 {
                        self.bunfig.port = Some(3000);
                    }
                }
            }

            if let Some(expr) = json.get(b"preload") {
                self.load_preload(expr)?;
            }

            if let Some(expr) = json.get(b"telemetry") {
                self.expect(expr, ExprTag::EBoolean)?;
                bun_analytics::set_enabled(if expr.data.as_e_boolean().value {
                    bun_analytics::Enabled::Yes
                } else {
                    bun_analytics::Enabled::No
                });
            }
        }

        if CMD == CommandTag::RunCommand || CMD == CommandTag::AutoCommand {
            if let Some(expr) = json.get(b"smol") {
                self.expect(expr, ExprTag::EBoolean)?;
                self.ctx.runtime_options.smol = expr.data.as_e_boolean().value;
            }
        }

        if CMD == CommandTag::TestCommand {
            if let Some(test_) = json.get(b"test") {
                if let Some(root) = test_.get(b"root") {
                    self.ctx.debug.test_directory = root.as_string().unwrap_or(b"").into();
                }

                if let Some(expr) = test_.get(b"preload") {
                    self.load_preload(expr)?;
                }

                if let Some(expr) = test_.get(b"smol") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    self.ctx.runtime_options.smol = expr.data.as_e_boolean().value;
                }

                if let Some(expr) = test_.get(b"coverage") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.enabled = expr.data.as_e_boolean().value;
                }

                if let Some(expr) = test_.get(b"onlyFailures") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.reporters.only_failures = expr.data.as_e_boolean().value;
                }

                if let Some(expr) = test_.get(b"reporter") {
                    self.expect(expr, ExprTag::EObject)?;
                    if let Some(junit_expr) = expr.get(b"junit") {
                        self.expect_string(junit_expr)?;
                        if junit_expr.data.as_e_string().len() > 0 {
                            self.ctx.test_options.reporters.junit = true;
                            self.ctx.test_options.reporter_outfile =
                                Some(junit_expr.data.as_e_string().string()?);
                        }
                    }
                    if let Some(dots_expr) = expr.get(b"dots").or_else(|| expr.get(b"dot")) {
                        self.expect(dots_expr, ExprTag::EBoolean)?;
                        self.ctx.test_options.reporters.dots = dots_expr.data.as_e_boolean().value;
                    }
                }

                if let Some(expr) = test_.get(b"coverageReporter") {
                    'brk: {
                        self.ctx.test_options.coverage.reporters =
                            crate::test_command::CoverageReporters {
                                text: false,
                                lcov: false,
                            };
                        if expr.data.tag() == ExprTag::EString {
                            let item_str = expr.as_string().unwrap_or(b"");
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

                        self.expect(expr, ExprTag::EArray)?;
                        let items = expr.data.as_e_array().items.slice();
                        for item in items {
                            self.expect_string(*item)?;
                            let item_str = item.as_string().unwrap_or(b"");
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

                if let Some(expr) = test_.get(b"coverageDir") {
                    self.expect_string(expr)?;
                    self.ctx.test_options.coverage.reports_directory =
                        expr.data.as_e_string().string()?;
                }

                if let Some(expr) = test_.get(b"coverageThreshold") {
                    'outer: {
                        if expr.data.tag() == ExprTag::ENumber {
                            let v = expr.data.as_e_number().value;
                            self.ctx.test_options.coverage.fractions.functions = v;
                            self.ctx.test_options.coverage.fractions.lines = v;
                            self.ctx.test_options.coverage.fractions.stmts = v;
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                            break 'outer;
                        }

                        self.expect(expr, ExprTag::EObject)?;
                        if let Some(functions) = expr.get(b"functions") {
                            self.expect(functions, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.functions =
                                functions.data.as_e_number().value;
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }

                        if let Some(lines) = expr.get(b"lines") {
                            self.expect(lines, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.lines =
                                lines.data.as_e_number().value;
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }

                        if let Some(stmts) = expr.get(b"statements") {
                            self.expect(stmts, ExprTag::ENumber)?;
                            self.ctx.test_options.coverage.fractions.stmts =
                                stmts.data.as_e_number().value;
                            self.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                    }
                }

                // This mostly exists for debugging.
                if let Some(expr) = test_.get(b"coverageIgnoreSourcemaps") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.ignore_sourcemap =
                        expr.data.as_e_boolean().value;
                }

                if let Some(expr) = test_.get(b"coverageSkipTestFiles") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    self.ctx.test_options.coverage.skip_test_files = expr.data.as_e_boolean().value;
                }

                let mut randomize_from_config: Option<bool> = None;

                if let Some(expr) = test_.get(b"randomize") {
                    self.expect(expr, ExprTag::EBoolean)?;
                    randomize_from_config = Some(expr.data.as_e_boolean().value);
                    self.ctx.test_options.randomize = expr.data.as_e_boolean().value;
                }

                if let Some(expr) = test_.get(b"seed") {
                    self.expect(expr, ExprTag::ENumber)?;
                    let seed_value = expr.data.as_e_number().to_u32();

                    // Validate that randomize is true when seed is specified
                    // Either randomize must be set to true in this config, or already enabled
                    let has_randomize_true =
                        randomize_from_config.unwrap_or(self.ctx.test_options.randomize);
                    if !has_randomize_true {
                        self.add_error(
                            expr.loc,
                            "\"seed\" can only be used when \"randomize\" is true",
                        )?;
                    }

                    self.ctx.test_options.seed = Some(seed_value);
                }

                if let Some(expr) = test_.get(b"rerunEach") {
                    self.expect(expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.retry != 0 {
                        self.add_error(expr.loc, "\"rerunEach\" cannot be used with \"retry\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.repeat_count = expr.data.as_e_number().to_u32();
                }

                if let Some(expr) = test_.get(b"retry") {
                    self.expect(expr, ExprTag::ENumber)?;
                    if self.ctx.test_options.repeat_count != 0 {
                        self.add_error(expr.loc, "\"retry\" cannot be used with \"rerunEach\"")?;
                        return Ok(());
                    }
                    self.ctx.test_options.retry = expr.data.as_e_number().to_u32();
                }

                if let Some(expr) = test_.get(b"concurrentTestGlob") {
                    match &expr.data {
                        ExprData::EString(str) => {
                            // Reject empty strings
                            if str.len() == 0 {
                                self.add_error(
                                    expr.loc,
                                    "concurrentTestGlob cannot be an empty string",
                                )?;
                                return Ok(());
                            }
                            let pattern = str.string()?;
                            let patterns: Box<[Box<[u8]>]> = Box::new([pattern]);
                            self.ctx.test_options.concurrent_test_glob = Some(patterns);
                        }
                        ExprData::EArray(arr) => {
                            if arr.items.len() == 0 {
                                self.add_error(
                                    expr.loc,
                                    "concurrentTestGlob array cannot be empty",
                                )?;
                                return Ok(());
                            }

                            let mut patterns: Vec<Box<[u8]>> =
                                vec![Box::default(); arr.items.len()];
                            for (i, item) in arr.items.slice().iter().enumerate() {
                                if item.data.tag() != ExprTag::EString {
                                    self.add_error(
                                        item.loc,
                                        "concurrentTestGlob array must contain only strings",
                                    )?;
                                    return Ok(());
                                }
                                // Reject empty strings in array
                                if item.data.as_e_string().len() == 0 {
                                    self.add_error(
                                        item.loc,
                                        "concurrentTestGlob patterns cannot be empty strings",
                                    )?;
                                    return Ok(());
                                }
                                patterns[i] = item.data.as_e_string().string()?;
                            }
                            self.ctx.test_options.concurrent_test_glob = Some(patterns.into());
                        }
                        _ => {
                            self.add_error(
                                expr.loc,
                                "concurrentTestGlob must be a string or array of strings",
                            )?;
                            return Ok(());
                        }
                    }
                }

                if let Some(expr) = test_.get(b"coveragePathIgnorePatterns") {
                    'brk: {
                        match &expr.data {
                            ExprData::EString(str) => {
                                let pattern = str.string()?;
                                let patterns: Box<[Box<[u8]>]> = Box::new([pattern]);
                                self.ctx.test_options.coverage.ignore_patterns = patterns;
                            }
                            ExprData::EArray(arr) => {
                                if arr.items.len() == 0 {
                                    break 'brk;
                                }

                                let mut patterns: Vec<Box<[u8]>> =
                                    vec![Box::default(); arr.items.len()];
                                for (i, item) in arr.items.slice().iter().enumerate() {
                                    if item.data.tag() != ExprTag::EString {
                                        self.add_error(
                                            item.loc,
                                            "coveragePathIgnorePatterns array must contain only strings",
                                        )?;
                                        return Ok(());
                                    }
                                    patterns[i] = item.data.as_e_string().string()?;
                                }
                                self.ctx.test_options.coverage.ignore_patterns = patterns.into();
                            }
                            _ => {
                                self.add_error(
                                    expr.loc,
                                    "coveragePathIgnorePatterns must be a string or array of strings",
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
                            ExprData::EString(str) => {
                                let pattern = str.string()?;
                                let patterns: Box<[Box<[u8]>]> = Box::new([pattern]);
                                self.ctx.test_options.path_ignore_patterns = patterns;
                            }
                            ExprData::EArray(arr) => {
                                if arr.items.len() == 0 {
                                    break 'brk;
                                }

                                let mut patterns: Vec<Box<[u8]>> =
                                    vec![Box::default(); arr.items.len()];
                                for (i, item) in arr.items.slice().iter().enumerate() {
                                    if item.data.tag() != ExprTag::EString {
                                        self.add_error(
                                            item.loc,
                                            "pathIgnorePatterns array must contain only strings",
                                        )?;
                                        return Ok(());
                                    }
                                    patterns[i] = item.data.as_e_string().string()?;
                                }
                                self.ctx.test_options.path_ignore_patterns = patterns.into();
                            }
                            _ => {
                                self.add_error(
                                    expr.loc,
                                    "pathIgnorePatterns must be a string or array of strings",
                                )?;
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        // TODO(port): CommandTag::is_npm_related() must be a `const fn` for this to work in const context
        if CMD.is_npm_related()
            || CMD == CommandTag::RunCommand
            || CMD == CommandTag::AutoCommand
            || CMD == CommandTag::TestCommand
        {
            if let Some(install_obj) = json.get_object(b"install") {
                let install: &mut api::BunInstall = 'brk: {
                    if let Some(install) = self.ctx.install.as_deref_mut() {
                        break 'brk install;
                    }
                    // SAFETY: all-zero is a valid api::BunInstall
                    let install = Box::new(unsafe { core::mem::zeroed::<api::BunInstall>() });
                    self.ctx.install = Some(install);
                    self.ctx.install.as_deref_mut().unwrap()
                };

                if let Some(auto_install_expr) = install_obj.get(b"auto") {
                    if auto_install_expr.data.tag() == ExprTag::EString {
                        self.ctx.debug.global_cache = match options::GlobalCache::MAP
                            .get(auto_install_expr.as_string().unwrap_or(b""))
                        {
                            Some(v) => *v,
                            None => {
                                self.add_error(
                                    auto_install_expr.loc,
                                    "Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"",
                                )?;
                                return Ok(());
                            }
                        };
                    } else if auto_install_expr.data.tag() == ExprTag::EBoolean {
                        self.ctx.debug.global_cache = if auto_install_expr.as_bool().unwrap() {
                            options::GlobalCache::AllowInstall
                        } else {
                            options::GlobalCache::Disable
                        };
                    } else {
                        self.add_error(
                            auto_install_expr.loc,
                            "Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"",
                        )?;
                        return Ok(());
                    }
                }

                if let Some(cafile) = install_obj.get(b"cafile") {
                    install.cafile = match cafile.as_string_cloned()? {
                        Some(s) => Some(s),
                        None => {
                            self.add_error(cafile.loc, "Invalid cafile. Expected a string.")?;
                            return Ok(());
                        }
                    };
                }

                if let Some(ca) = install_obj.get(b"ca") {
                    match &ca.data {
                        ExprData::EArray(arr) => {
                            let mut list: Vec<Box<[u8]>> = vec![Box::default(); arr.items.len()];
                            for (i, item) in arr.items.slice().iter().enumerate() {
                                list[i] = match item.as_string_cloned()? {
                                    Some(s) => s,
                                    None => {
                                        self.add_error(
                                            item.loc,
                                            "Invalid CA. Expected a string.",
                                        )?;
                                        return Ok(());
                                    }
                                };
                            }
                            install.ca = Some(api::Ca::List(list.into()));
                        }
                        ExprData::EString(str) => {
                            install.ca = Some(api::Ca::Str(str.string_cloned()?));
                        }
                        _ => {
                            self.add_error(
                                ca.loc,
                                "Invalid CA. Expected a string or an array of strings.",
                            )?;
                            return Ok(());
                        }
                    }
                }

                if let Some(exact) = install_obj.get(b"exact") {
                    if let Some(value) = exact.as_bool() {
                        install.exact = Some(value);
                    }
                }

                if let Some(prefer_expr) = install_obj.get(b"prefer") {
                    self.expect_string(prefer_expr)?;

                    if let Some(setting) = Prefer::get(prefer_expr.as_string().unwrap_or(b"")) {
                        self.ctx.debug.offline_mode_setting = *setting;
                    } else {
                        self.add_error(
                            prefer_expr.loc,
                            "Invalid prefer setting, must be one of online or offline",
                        )?;
                    }
                }

                if let Some(registry) = install_obj.get(b"registry") {
                    install.default_registry = Some(self.parse_registry(registry)?);
                }

                if let Some(scopes) = install_obj.get(b"scopes") {
                    let mut registry_map = install.scoped.take().unwrap_or_default();
                    self.expect(scopes, ExprTag::EObject)?;

                    registry_map
                        .scopes
                        .reserve(scopes.data.as_e_object().properties.len());

                    for prop in scopes.data.as_e_object().properties.slice() {
                        let Some(name_) = prop.key.as_ref().unwrap().as_string() else {
                            continue;
                        };
                        let Some(value) = prop.value.as_ref() else {
                            continue;
                        };
                        if name_.is_empty() {
                            continue;
                        }
                        let name = if name_[0] == b'@' { &name_[1..] } else { name_ };
                        let registry = self.parse_registry(*value)?;
                        registry_map.scopes.insert(name.into(), registry);
                    }

                    install.scoped = Some(registry_map);
                }

                if let Some(dry_run) = install_obj.get(b"dryRun") {
                    if let Some(value) = dry_run.as_bool() {
                        install.dry_run = Some(value);
                    }
                }

                if let Some(production) = install_obj.get(b"production") {
                    if let Some(value) = production.as_bool() {
                        install.production = Some(value);
                    }
                }

                if let Some(frozen_lockfile) = install_obj.get(b"frozenLockfile") {
                    if let Some(value) = frozen_lockfile.as_bool() {
                        install.frozen_lockfile = Some(value);
                    }
                }

                if let Some(save_text_lockfile) = install_obj.get(b"saveTextLockfile") {
                    if let Some(value) = save_text_lockfile.as_bool() {
                        install.save_text_lockfile = Some(value);
                    }
                }

                if let Some(jobs) = install_obj.get(b"concurrentScripts") {
                    if jobs.data.tag() == ExprTag::ENumber {
                        install.concurrent_scripts = Some(jobs.data.as_e_number().to_u32());
                        if install.concurrent_scripts.unwrap() == 0 {
                            install.concurrent_scripts = None;
                        }
                    }
                }

                if let Some(ignore_scripts_expr) = install_obj.get(b"ignoreScripts") {
                    if let Some(ignore_scripts) = ignore_scripts_expr.as_bool() {
                        install.ignore_scripts = Some(ignore_scripts);
                    }
                }

                if let Some(node_linker_expr) = install_obj.get(b"linker") {
                    self.expect_string(node_linker_expr)?;
                    if let Some(node_linker_str) = node_linker_expr.as_string() {
                        install.node_linker =
                            PackageManager::Options::NodeLinker::from_str(node_linker_str);
                        if install.node_linker.is_none() {
                            self.add_error(
                                node_linker_expr.loc,
                                "Expected one of \"isolated\" or \"hoisted\"",
                            )?;
                        }
                    }
                }

                if let Some(global_store_expr) = install_obj.get(b"globalStore") {
                    if let Some(global_store) = global_store_expr.as_bool() {
                        install.global_store = Some(global_store);
                    }
                }

                if let Some(lockfile_expr) = install_obj.get(b"lockfile") {
                    if let Some(lockfile) = lockfile_expr.get(b"print") {
                        self.expect_string(lockfile)?;
                        if let Some(value) = lockfile.as_string() {
                            if value != b"bun" {
                                if value != b"yarn" {
                                    self.add_error(
                                        lockfile.loc,
                                        "Invalid lockfile format, only 'yarn' output is implemented",
                                    )?;
                                }

                                install.save_yarn_lockfile = Some(true);
                            }
                        }
                    }

                    if let Some(lockfile) = lockfile_expr.get(b"save") {
                        if let Some(value) = lockfile.as_bool() {
                            install.save_lockfile = Some(value);
                        }
                    }

                    if let Some(lockfile) = lockfile_expr.get(b"path") {
                        if let Some(value) = lockfile.as_string() {
                            install.lockfile_path = Some(value.into());
                        }
                    }

                    if let Some(lockfile) = lockfile_expr.get(b"savePath") {
                        if let Some(value) = lockfile.as_string() {
                            install.save_lockfile_path = Some(value.into());
                        }
                    }
                }

                if let Some(optional) = install_obj.get(b"optional") {
                    if let Some(value) = optional.as_bool() {
                        install.save_optional = Some(value);
                    }
                }

                if let Some(optional) = install_obj.get(b"peer") {
                    if let Some(value) = optional.as_bool() {
                        install.save_peer = Some(value);
                    }
                }

                if let Some(optional) = install_obj.get(b"dev") {
                    if let Some(value) = optional.as_bool() {
                        install.save_dev = Some(value);
                    }
                }

                if let Some(dir) = install_obj.get(b"globalDir") {
                    if let Some(value) = dir.as_string() {
                        install.global_dir = Some(value.into());
                    }
                }

                if let Some(dir) = install_obj.get(b"globalBinDir") {
                    if let Some(value) = dir.as_string() {
                        install.global_bin_dir = Some(value.into());
                    }
                }

                if let Some(expr) = install_obj.get(b"logLevel") {
                    self.load_log_level(expr)?;
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

                        if let Some(value) = cache.as_string() {
                            install.cache_directory = Some(value.into());
                            break 'load;
                        }

                        if cache.data.tag() == ExprTag::EObject {
                            if let Some(disable) = cache.get(b"disable") {
                                if let Some(value) = disable.as_bool() {
                                    install.disable_cache = Some(value);
                                }
                            }

                            if let Some(disable) = cache.get(b"disableManifest") {
                                if let Some(value) = disable.as_bool() {
                                    install.disable_manifest_cache = Some(value);
                                }
                            }

                            if let Some(directory) = cache.get(b"dir") {
                                if let Some(value) = directory.as_string() {
                                    install.cache_directory = Some(value.into());
                                }
                            }
                        }
                    }
                }

                if let Some(link_workspace) = install_obj.get(b"linkWorkspacePackages") {
                    if let Some(value) = link_workspace.as_bool() {
                        install.link_workspace_packages = Some(value);
                    }
                }

                if let Some(security_obj) = install_obj.get(b"security") {
                    if security_obj.data.tag() == ExprTag::EObject {
                        if let Some(scanner) = security_obj.get(b"scanner") {
                            self.expect_string(scanner)?;
                            install.security_scanner = scanner.as_string_cloned()?;
                        }
                    } else {
                        self.add_error(
                            security_obj.loc,
                            "Invalid security config, expected an object",
                        )?;
                    }
                }

                if let Some(min_age) = install_obj.get(b"minimumReleaseAge") {
                    match &min_age.data {
                        ExprData::ENumber(seconds) => {
                            if seconds.value < 0.0 {
                                self.add_error(
                                    min_age.loc,
                                    "Expected positive number of seconds for minimumReleaseAge",
                                )?;
                                return Ok(());
                            }
                            const MS_PER_S: f64 = 1000.0;
                            install.minimum_release_age_ms = Some(seconds.value * MS_PER_S);
                        }
                        _ => {
                            self.add_error(
                                min_age.loc,
                                "Expected number of seconds for minimumReleaseAge",
                            )?;
                        }
                    }
                }

                if let Some(exclusions) = install_obj.get(b"minimumReleaseAgeExcludes") {
                    match &exclusions.data {
                        ExprData::EArray(arr) => 'brk: {
                            let raw_exclusions = arr.items.slice();
                            if raw_exclusions.is_empty() {
                                break 'brk;
                            }

                            let mut exclusions_list: Vec<Box<[u8]>> =
                                vec![Box::default(); raw_exclusions.len()];
                            for (i, p) in raw_exclusions.iter().enumerate() {
                                self.expect_string(*p)?;
                                exclusions_list[i] = p.data.as_e_string().string()?;
                            }
                            install.minimum_release_age_excludes = Some(exclusions_list.into());
                        }
                        _ => {
                            self.add_error(
                                exclusions.loc,
                                "Expected array for minimumReleaseAgeExcludes",
                            )?;
                        }
                    }
                }

                if let Some(public_hoist_pattern_expr) = install_obj.get(b"publicHoistPattern") {
                    install.public_hoist_pattern = match bun_install::PnpmMatcher::from_expr(
                        public_hoist_pattern_expr,
                        self.log,
                        self.source,
                    ) {
                        Ok(v) => Some(v),
                        Err(e) if e == err!("OutOfMemory") => return Err(e),
                        Err(_) => {
                            // error.UnexpectedExpr | error.InvalidRegExp
                            return Err(err!("Invalid Bunfig"));
                        }
                    };
                }

                if let Some(hoist_pattern_expr) = install_obj.get(b"hoistPattern") {
                    install.hoist_pattern = match bun_install::PnpmMatcher::from_expr(
                        hoist_pattern_expr,
                        self.log,
                        self.source,
                    ) {
                        Ok(v) => Some(v),
                        Err(e) if e == err!("OutOfMemory") => return Err(e),
                        Err(_) => {
                            // error.UnexpectedExpr | error.InvalidRegExp
                            return Err(err!("Invalid Bunfig"));
                        }
                    };
                }
            }

            if let Some(run_expr) = json.get(b"run") {
                if let Some(silent) = run_expr.get(b"silent") {
                    if let Some(value) = silent.as_bool() {
                        self.ctx.debug.silent = value;
                    } else {
                        self.add_error(silent.loc, "Expected boolean")?;
                    }
                }

                if let Some(elide_lines) = run_expr.get(b"elide-lines") {
                    if elide_lines.data.tag() == ExprTag::ENumber {
                        // Note: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB
                        self.ctx.bundler_options.elide_lines =
                            Some(elide_lines.data.as_e_number().value as usize);
                    } else {
                        self.add_error(elide_lines.loc, "Expected number")?;
                    }
                }

                if let Some(shell) = run_expr.get(b"shell") {
                    if let Some(value) = shell.as_string() {
                        if value == b"bun" {
                            self.ctx.debug.use_system_shell = false;
                        } else if value == b"system" {
                            self.ctx.debug.use_system_shell = true;
                        } else {
                            self.add_error(
                                shell.loc,
                                "Invalid shell, only 'bun' and 'system' are supported",
                            )?;
                        }
                    } else {
                        self.add_error(shell.loc, "Expected string")?;
                    }
                }

                if let Some(bun_flag) = run_expr.get(b"bun") {
                    if let Some(value) = bun_flag.as_bool() {
                        self.ctx.debug.run_in_bun = value;
                    } else {
                        self.add_error(bun_flag.loc, "Expected boolean")?;
                    }
                }

                if let Some(no_orphans) = run_expr.get(b"noOrphans") {
                    if let Some(value) = no_orphans.as_bool() {
                        if value {
                            bun_core::ParentDeathWatchdog::enable();
                        }
                    } else {
                        self.add_error(no_orphans.loc, "Expected boolean")?;
                    }
                }
            }

            if let Some(console_expr) = json.get(b"console") {
                if let Some(depth) = console_expr.get(b"depth") {
                    if depth.data.tag() == ExprTag::ENumber {
                        let depth_value = depth.data.as_e_number().value as u16;
                        // Treat depth=0 as maxInt(u16) for infinite depth
                        self.ctx.runtime_options.console_depth = Some(if depth_value == 0 {
                            u16::MAX
                        } else {
                            depth_value
                        });
                    } else {
                        self.add_error(depth.loc, "Expected number")?;
                    }
                }
            }
        }

        if let Some(serve_obj2) = json.get_object(b"serve") {
            if let Some(serve_obj) = serve_obj2.get_object(b"static") {
                if let Some(config_plugins) = serve_obj.get(b"plugins") {
                    let plugins: Option<Box<[Box<[u8]>]>> = 'plugins: {
                        if config_plugins.data.tag() == ExprTag::EArray {
                            let raw_plugins = config_plugins.data.as_e_array().items.slice();
                            if raw_plugins.is_empty() {
                                break 'plugins None;
                            }
                            let mut plugins: Vec<Box<[u8]>> =
                                vec![Box::default(); raw_plugins.len()];
                            for (i, p) in raw_plugins.iter().enumerate() {
                                self.expect_string(*p)?;
                                plugins[i] = p.data.as_e_string().string()?;
                            }
                            break 'plugins Some(plugins.into());
                        } else {
                            let p = config_plugins.data.as_e_string().string()?;
                            let plugins: Box<[Box<[u8]>]> = Box::new([p]);
                            break 'plugins Some(plugins);
                        }
                    };

                    // TODO: accept entire config object.
                    self.bunfig.serve_plugins = plugins;
                }

                if let Some(hmr) = serve_obj.get(b"hmr") {
                    if let Some(value) = hmr.as_bool() {
                        self.bunfig.serve_hmr = Some(value);
                    }
                }

                if let Some(minify) = serve_obj.get(b"minify") {
                    if let Some(value) = minify.as_bool() {
                        self.bunfig.serve_minify_syntax = Some(value);
                        self.bunfig.serve_minify_whitespace = Some(value);
                        self.bunfig.serve_minify_identifiers = Some(value);
                    } else if minify.is_object() {
                        if let Some(syntax) = minify.get(b"syntax") {
                            self.bunfig.serve_minify_syntax = Some(syntax.as_bool().unwrap_or(false));
                        }

                        if let Some(whitespace) = minify.get(b"whitespace") {
                            self.bunfig.serve_minify_whitespace =
                                Some(whitespace.as_bool().unwrap_or(false));
                        }

                        if let Some(identifiers) = minify.get(b"identifiers") {
                            self.bunfig.serve_minify_identifiers =
                                Some(identifiers.as_bool().unwrap_or(false));
                        }
                    } else {
                        self.add_error(minify.loc, "Expected minify to be boolean or object")?;
                    }
                }

                if let Some(expr) = serve_obj.get(b"define") {
                    self.expect(expr, ExprTag::EObject)?;
                    let mut valid_count: usize = 0;
                    let properties = expr.data.as_e_object().properties.slice();
                    for prop in properties {
                        if prop.value.as_ref().unwrap().data.tag() != ExprTag::EString {
                            continue;
                        }
                        valid_count += 1;
                    }
                    let mut buffer: Vec<Box<[u8]>> = vec![Box::default(); valid_count * 2];
                    let (keys, values) = buffer.split_at_mut(valid_count);
                    let mut i: usize = 0;
                    for prop in properties {
                        if prop.value.as_ref().unwrap().data.tag() != ExprTag::EString {
                            continue;
                        }
                        keys[i] = prop
                            .key
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .string()
                            .expect("unreachable");
                        values[i] = prop
                            .value
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .string()
                            .expect("unreachable");
                        i += 1;
                    }
                    let mut buffer = buffer;
                    let values_vec = buffer.split_off(valid_count);
                    self.bunfig.serve_define = Some(api::StringMap {
                        keys: buffer.into(),
                        values: values_vec.into(),
                    });
                }
                self.bunfig.bunfig_path = Box::<[u8]>::from(self.source.path.text.as_ref());

                if let Some(public_path) = serve_obj.get(b"publicPath") {
                    if let Some(value) = public_path.as_string() {
                        self.bunfig.serve_public_path = Some(value.into());
                    }
                }

                if let Some(env) = serve_obj.get(b"env") {
                    match &env.data {
                        ExprData::ENull(_) => {
                            self.bunfig.serve_env_behavior = api::DotEnvBehavior::Disable;
                        }
                        ExprData::EBoolean(boolean) => {
                            self.bunfig.serve_env_behavior = if boolean.value {
                                api::DotEnvBehavior::LoadAll
                            } else {
                                api::DotEnvBehavior::Disable
                            };
                        }
                        ExprData::EString(str) => {
                            if str.eql_comptime(b"inline") {
                                self.bunfig.serve_env_behavior = api::DotEnvBehavior::LoadAll;
                            } else if str.eql_comptime(b"disable") {
                                self.bunfig.serve_env_behavior = api::DotEnvBehavior::Disable;
                            } else {
                                let slice = str.string()?;
                                if let Some(asterisk) = strings::index_of_char(&slice, b'*') {
                                    if asterisk > 0 {
                                        self.bunfig.serve_env_prefix =
                                            Some(Box::<[u8]>::from(&slice[..asterisk as usize]));
                                        self.bunfig.serve_env_behavior =
                                            api::DotEnvBehavior::Prefix;
                                    } else {
                                        self.bunfig.serve_env_behavior =
                                            api::DotEnvBehavior::LoadAll;
                                    }
                                } else {
                                    self.add_error(
                                        env.loc,
                                        "Invalid env behavior, must be 'inline', 'disable', or a string with a '*' character",
                                    )?;
                                }
                            }
                        }
                        _ => {
                            self.add_error(
                                env.loc,
                                "Invalid env behavior, must be 'inline', 'disable', or a string with a '*' character",
                            )?;
                        }
                    }
                }
            }
        }

        if let Some(_bun) = json.get(b"bundle") {
            if CMD == CommandTag::BuildCommand
                || CMD == CommandTag::RunCommand
                || CMD == CommandTag::AutoCommand
                || CMD == CommandTag::BuildCommand
            {
                if let Some(dir) = _bun.get(b"outdir") {
                    self.expect_string(dir)?;
                    self.bunfig.output_dir = Some(dir.data.as_e_string().string()?);
                }
            }

            if CMD == CommandTag::BuildCommand {
                if let Some(expr2) = _bun.get(b"logLevel") {
                    self.load_log_level(expr2)?;
                }

                if let Some(entry_points) = _bun.get(b"entryPoints") {
                    self.expect(entry_points, ExprTag::EArray)?;
                    let items = entry_points.data.as_e_array().items.slice();
                    let mut names: Vec<Box<[u8]>> = vec![Box::default(); items.len()];
                    for (i, item) in items.iter().enumerate() {
                        self.expect_string(*item)?;
                        names[i] = item.data.as_e_string().string()?;
                    }
                    self.bunfig.entry_points = names.into();
                }

                if let Some(expr) = _bun.get(b"packages") {
                    self.expect(expr, ExprTag::EObject)?;
                    let mut valid_count: usize = 0;

                    let object = expr.data.as_e_object();
                    let properties = object.properties.slice();
                    for prop in properties {
                        if prop.value.as_ref().unwrap().data.tag() != ExprTag::EBoolean {
                            continue;
                        }
                        valid_count += 1;
                    }

                    self.ctx
                        .debug
                        .package_bundle_map
                        .reserve(valid_count.saturating_sub(self.ctx.debug.package_bundle_map.len()));
                    // PORT NOTE: Zig used ensureTotalCapacity; reshaped to reserve()

                    for prop in properties {
                        if prop.value.as_ref().unwrap().data.tag() != ExprTag::EBoolean {
                            continue;
                        }

                        let path = prop.key.as_ref().unwrap().data.as_e_string().string()?;

                        if !resolver::is_package_path(&path) {
                            self.add_error(prop.key.as_ref().unwrap().loc, "Expected package name")?;
                        }

                        // PERF(port): was putAssumeCapacity
                        self.ctx.debug.package_bundle_map.insert(
                            path,
                            match prop.value.as_ref().unwrap().as_bool().unwrap_or(false) {
                                true => options::BundlePackage::Always,
                                false => options::BundlePackage::Never,
                            },
                        );
                    }
                }
            }
        }

        let mut jsx_factory: Box<[u8]> = Box::default();
        let mut jsx_fragment: Box<[u8]> = Box::default();
        let mut jsx_import_source: Box<[u8]> = Box::default();
        let mut jsx_runtime = api::JsxRuntime::Automatic;
        let mut jsx_dev = true;

        if let Some(expr) = json.get(b"jsx") {
            if let Some(value) = expr.as_string() {
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
                        "Invalid jsx runtime, only 'react', 'solid', 'react-jsx', and 'react-jsxDEV' are supported",
                    )?;
                }
            }
        }

        if let Some(expr) = json.get(b"jsxImportSource") {
            if let Some(value) = expr.as_string() {
                jsx_import_source = Box::<[u8]>::from(value);
            }
        }

        if let Some(expr) = json.get(b"jsxFragment") {
            if let Some(value) = expr.as_string() {
                jsx_fragment = Box::<[u8]>::from(value);
            }
        }

        if let Some(expr) = json.get(b"jsxFactory") {
            if let Some(value) = expr.as_string() {
                jsx_factory = Box::<[u8]>::from(value);
            }
        }

        if self.bunfig.jsx.is_none() {
            self.bunfig.jsx = Some(api::Jsx {
                factory: jsx_factory,
                fragment: jsx_fragment,
                import_source: jsx_import_source,
                runtime: jsx_runtime,
                development: jsx_dev,
                ..Default::default()
            });
        } else {
            let jsx: &mut api::Jsx = self.bunfig.jsx.as_mut().unwrap();
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

        if let Some(expr) = json.get(b"debug") {
            if let Some(editor) = expr.get(b"editor") {
                if let Some(value) = editor.as_string() {
                    self.ctx.debug.editor = value.into();
                }
            }
        }

        if let Some(expr) = json.get(b"macros") {
            if expr.data.tag() == ExprTag::EBoolean {
                if expr.data.as_e_boolean().value == false {
                    self.ctx.debug.macros = crate::cli::MacroOptions::Disable;
                }
            } else {
                self.ctx.debug.macros = crate::cli::MacroOptions::Map(
                    PackageJSON::parse_macros_json(expr, self.log, self.source),
                );
            }
            bun_analytics::Features::macros_inc(1);
        }

        if let Some(expr) = json.get(b"external") {
            match &expr.data {
                ExprData::EString(str) => {
                    let externals: Box<[Box<[u8]>]> = Box::new([str.string()?]);
                    self.bunfig.external = externals;
                }
                ExprData::EArray(array) => {
                    let mut externals: Vec<Box<[u8]>> = vec![Box::default(); array.items.len()];

                    for (i, item) in array.items.slice().iter().enumerate() {
                        self.expect_string(*item)?;
                        externals[i] = item.data.as_e_string().string()?;
                    }

                    self.bunfig.external = externals.into();
                }
                _ => self.add_error(expr.loc, "Expected string or array")?,
            }
        }

        if let Some(expr) = json.get(b"loader") {
            self.expect(expr, ExprTag::EObject)?;
            let properties = expr.data.as_e_object().properties.slice();
            let mut loader_names: Vec<Box<[u8]>> = vec![Box::default(); properties.len()];
            let mut loader_values: Vec<api::Loader> = vec![api::Loader::default(); properties.len()];

            for (i, item) in properties.iter().enumerate() {
                let key = item.key.as_ref().unwrap().as_string().unwrap();
                if key.is_empty() {
                    continue;
                }
                if key[0] != b'.' {
                    self.add_error(
                        item.key.as_ref().unwrap().loc,
                        "file extension for loader must start with a '.'",
                    )?;
                }
                let value = item.value.as_ref().unwrap();
                self.expect_string(*value)?;

                let loader = match options::Loader::from_string(value.as_string().unwrap()) {
                    Some(l) => l,
                    None => {
                        self.add_error(value.loc, "Invalid loader")?;
                        unreachable!()
                    }
                };

                loader_names[i] = key.into();
                loader_values[i] = loader.to_api();
            }
            self.bunfig.loaders = Some(api::LoaderMap {
                extensions: loader_names.into(),
                loaders: loader_values.into(),
            });
        }

        Ok(())
    }

    pub fn expect_string(&mut self, expr: js_ast::Expr) -> Result<(), bun_core::Error> {
        match &expr.data {
            ExprData::EString(_) => Ok(()),
            _ => {
                self.log
                    .add_error_fmt_opts(
                        format_args!("expected string but received {}", expr.data.tag()),
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

    pub fn expect(&mut self, expr: js_ast::Expr, token: ExprTag) -> Result<(), bun_core::Error> {
        if expr.data.tag() != token {
            self.log
                .add_error_fmt_opts(
                    format_args!("expected {} but received {}", token, expr.data.tag()),
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
}

impl Bunfig {
    pub fn parse<const CMD: CommandTag>(
        source: &logger::Source,
        ctx: &mut ContextData,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let log_count = ctx.log.errors + ctx.log.warnings;

        let expr = if &source.path.name.ext[1..] == b"toml" {
            match TOML::parse(source, &mut ctx.log, true) {
                Ok(e) => e,
                Err(e) => {
                    if ctx.log.errors + ctx.log.warnings == log_count {
                        ctx.log.add_error_opts(
                            "Failed to parse",
                            logger::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        )?;
                    }
                    return Err(e.into());
                }
            }
        } else {
            match json_parser::parse_ts_config(source, &mut ctx.log, true) {
                Ok(e) => e,
                Err(e) => {
                    if ctx.log.errors + ctx.log.warnings == log_count {
                        ctx.log.add_error_opts(
                            "Failed to parse",
                            logger::ErrorOpts {
                                source: Some(source),
                                redact_sensitive_information: true,
                                ..Default::default()
                            },
                        )?;
                    }
                    return Err(e.into());
                }
            }
        };

        // PORT NOTE: reshaped for borrowck — Zig stored both `&mut ctx` and `&mut ctx.args`
        // simultaneously inside Parser. In Rust we route bunfig writes through `self.ctx.args`
        // by storing the borrows in Parser; here we split-borrow ctx fields.
        // TODO(port): bunfig field aliases ctx.args — Phase B should restructure Parser to
        // hold only `ctx: &mut ContextData` and access `ctx.args` directly, removing the
        // overlapping borrow.
        let mut parser = Parser {
            json: expr,
            log: ctx.log,
            source,
            bunfig: &mut ctx.args,
            ctx,
        };
        parser.parse::<CMD>()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/bunfig.zig (1305 lines)
//   confidence: medium
//   todos:      5
//   notes:      Parser holds overlapping &mut into ctx (bunfig=&ctx.args + ctx) — Phase B must collapse to single ctx borrow; const-generic CommandTag needs ConstParamTy; ExprData accessor names (.as_e_string/.tag) assumed.
// ──────────────────────────────────────────────────────────────────────────
