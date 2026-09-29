//! Answers what a call of an imported function returns, on the worker that parses the importer (`bun_js_parser::visit::const_call`).

use core::ptr::NonNull;
use std::sync::{Arc, OnceLock};

use crate::bundle_v2::BundleV2;
use crate::options;
use crate::transpiler::Transpiler;
use bun_ast::ImportKind;
use bun_collections::StringHashMap;
use bun_js_parser::{ConstCallExports, ConstCallLookup, ConstCallValue, Parser, ParserOptions};
use bun_resolver::fs as Fs;
use bun_resolver::fs::PathResolverExt as _;

bun_core::declare_scope!(const_call, hidden);

/// `export { x } from` chains longer than this are not followed.
const MAX_HOPS: u32 = 8;
/// A function of the imported file can return a call of an import of that file. This many files are parsed inside each other.
const MAX_DEPTH: u8 = 1;

/// What the exports of a file return. `None`: the file has no answer.
type Answer = Option<Arc<ConstCallExports>>;

/// One per build. The first worker that asks about a file parses it, and the other workers wait for that answer.
#[derive(Default)]
pub(crate) struct Cache {
    modules: bun_threading::Guarded<StringHashMap<Arc<OnceLock<Answer>>>>,
}

impl Cache {
    pub(crate) fn clear(&self) {
        *self.modules.lock() = Default::default();
    }
}

/// The lookup of one file.
#[derive(Clone, Copy)]
pub(crate) struct Lookup<'a> {
    ctx: &'a BundleV2<'static>,
    /// The one of the worker, for the target of the file.
    transpiler: *mut Transpiler<'static>,
    arena: &'a bun_alloc::Arena,
    importer: Fs::Path<'static>,
    /// Gets what the resolver reports while it resolves for the lookup.
    log: NonNull<bun_ast::Log>,
    /// How many more files can be parsed inside this one.
    depth: u8,
}

impl<'a> Lookup<'a> {
    /// `None`: no import of `importer` gets an answer. `transpiler` must be the one of the worker this runs on, and it and `log` must outlive the lookup.
    pub(crate) unsafe fn new(
        ctx: &'a BundleV2<'static>,
        transpiler: *mut Transpiler<'static>,
        arena: &'a bun_alloc::Arena,
        importer: Fs::Path<'static>,
        log: NonNull<bun_ast::Log>,
    ) -> Option<Self> {
        // SAFETY: the caller's contract.
        let options = unsafe { &(*transpiler).options };
        // A native plugin can replace the source of any file, and a client module is a reference, not its code.
        if !options.minify_syntax
            || options.server_components
            || options.has_dev_server()
            || ctx
                .plugins_ref()
                .is_some_and(|plugins| plugins.has_on_before_parse_plugins())
        {
            return None;
        }
        Some(Self {
            ctx,
            transpiler,
            arena,
            importer,
            log,
            depth: MAX_DEPTH,
        })
    }

    fn options(&self) -> &crate::options::BundleOptions<'static> {
        // SAFETY: the contract of `new`.
        unsafe { &(*self.transpiler).options }
    }

    /// The file that `specifier` in `importer` names, when nothing else can replace it or its source.
    fn resolve(
        &self,
        importer: &Fs::Path<'static>,
        specifier: &[u8],
        kind: ImportKind,
    ) -> Option<bun_resolver::Result> {
        let plugins = self.ctx.plugins_ref();
        // An `onResolve` plugin answers later, on another thread.
        if plugins.is_some_and(|plugins| plugins.has_any_matches(&Fs::Path::init(specifier), false))
        {
            return None;
        }
        let from_map = self
            .ctx
            .file_map
            .and_then(|map| map.resolve(self.arena, importer.text, specifier));
        let result = match from_map {
            Some(result) => result,
            None => {
                // SAFETY: the contract of `new`. The worker resolves nothing else while its parser runs.
                let resolver = unsafe { &raw mut (*self.transpiler).resolver };
                // SAFETY: `resolver` and `self.log` outlive the guard.
                let _log_scope =
                    unsafe { bun_resolver::Resolver::scoped_log(resolver.cast(), self.log) };
                // SAFETY: as for `resolver` above.
                unsafe { &mut *resolver }
                    .resolve_with_framework(importer.source_dir(), specifier, kind)
                    .ok()?
            }
        };
        let path = &result.path_pair.primary;
        // A package with a second build can get its imports rewritten to that one (`scan_for_secondary_paths`).
        let has_second_build = result
            .path_pair
            .secondary
            .as_ref()
            .is_some_and(|secondary| {
                !secondary.is_disabled
                    && !bun_core::strings::eql_long(secondary.text, path.text, true)
            });
        if result.flags.is_external()
            || path.is_disabled
            || !path.is_file()
            || has_second_build
            || !path
                .loader(&self.options().loaders)
                .is_some_and(|loader| loader.is_javascript_like())
            || plugins.is_some_and(|plugins| plugins.has_any_matches(path, true))
        {
            return None;
        }
        Some(result)
    }

    /// What the exports of `file` return. Parses the file when no importer asked about it before.
    fn exports_of(&self, file: &bun_resolver::Result) -> Answer {
        let path = &file.path_pair.primary;
        let mut key = Vec::with_capacity(path.text.len() + 2);
        key.extend_from_slice(path.text);
        // The depth is in the key: a parse at depth 1 waits only for parses at depth 0, which wait for nothing.
        key.extend_from_slice(&[self.options().target as u8, self.depth]);
        let slot = {
            let mut modules = self.ctx.const_call_modules.modules.lock();
            bun_core::handle_oom(modules.get_or_put_value(&key, Default::default())).clone()
        };
        slot.get_or_init(|| {
            let exports = self.parse(file).map(Arc::new);
            bun_core::scoped_log!(
                const_call,
                "{}: {} value(s), {} re-export(s), redirect: {}",
                bstr::BStr::new(path.text),
                exports.as_ref().map_or(0, |exports| exports.values.len()),
                exports
                    .as_ref()
                    .map_or(0, |exports| exports.reexports.len()),
                exports
                    .as_ref()
                    .is_some_and(|exports| exports.redirect.is_some())
            );
            exports
        })
        .clone()
    }

    /// The text of the file, from the reader of the parse task.
    fn read(
        &self,
        path: &Fs::Path<'static>,
        arena: &bun_alloc::Arena,
    ) -> Option<bun_resolver::cache::Contents> {
        if let Some(contents) = self.ctx.file_map.and_then(|map| map.get(path.text)) {
            return Some(bun_resolver::cache::Contents::SharedBuffer {
                ptr: contents.as_ptr(),
                len: contents.len(),
            });
        }
        // SAFETY: the contract of `new`. The two places are disjoint.
        let (fs, cache) = unsafe {
            (
                &mut *(*self.transpiler).fs,
                &mut (*self.transpiler).resolver.caches.fs,
            )
        };
        let mut entry = cache
            .read_file_with_allocator(fs, path.text, bun_sys::Fd::INVALID, false, None, Some(arena))
            .ok()?;
        let contents = core::mem::take(&mut entry.contents);
        let _ = entry.close_fd();
        Some(contents)
    }

    fn parse(&self, file: &bun_resolver::Result) -> Option<ConstCallExports> {
        let options = self.options();
        let loader = file.path_pair.primary.loader(&options.loaders)?;

        let arena = bun_alloc::Arena::new();
        let contents = self.read(&file.path_pair.primary, &arena)?;
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        // SAFETY: the contract of `new`.
        let top_level_dir = unsafe { (*self.transpiler).fs() }.top_level_dir;
        let path = crate::generic_path_with_pretty_initialized(
            &file.path_pair.primary,
            options.target,
            top_level_dir,
            &arena,
        )
        .ok()?;
        let mut source = bun_ast::Source::init_path_string(path.text, contents.as_slice());
        source.path = path;
        // Index 0 is the runtime, which the parser handles in another way.
        source.index = bun_ast::Index(1);
        let exports = core::cell::Cell::new(None);
        let inner = (self.depth > 0).then(|| Lookup {
            importer: file.path_pair.primary,
            depth: self.depth - 1,
            ..*self
        });

        let mut parser_options = self.parser_options(file, loader, &path);
        parser_options.const_call_exports = Some(&exports);
        parser_options.const_call_lookup =
            inner.as_ref().map(|inner| inner as &dyn ConstCallLookup);

        let mut log = bun_ast::Log::init();
        let parser =
            Parser::init(parser_options, &mut log, &source, &options.define, &arena).ok()?;
        parser.parse().ok()?;
        exports
            .take()
            .map(|exports: Box<ConstCallExports>| *exports)
    }

    /// The options of the parse task of `file`, without macros. A file that can be an entry point too has no known `import.meta.main`.
    fn parser_options(
        &self,
        file: &bun_resolver::Result,
        loader: options::Loader,
        path: &Fs::Path<'static>,
    ) -> ParserOptions<'static> {
        let options = self.options();
        let is_esm = options.output_format == options::Format::Esm;
        let mut parser_options = ParserOptions::init(
            crate::transpiler::to_parser_jsx_pragma(file.jsx.clone()),
            loader,
        );
        parser_options.bundle = true;
        parser_options.warn_about_unbundled_modules = false;
        parser_options.tree_shaking = options.tree_shaking;
        parser_options.code_splitting = options.code_splitting;
        parser_options.ignore_dce_annotations = options.ignore_dce_annotations;
        parser_options.use_define_for_class_fields = file.flags.use_define_for_class_fields();
        parser_options.module_type = match file.module_type {
            options::ModuleType::Unknown => {
                bun_resolver::module_type_from_ext(path.name().ext).unwrap_or_default()
            }
            known => known,
        };
        parser_options.output_format = match options.output_format {
            options::Format::Esm => bun_js_parser::options::Format::Esm,
            options::Format::Cjs => bun_js_parser::options::Format::Cjs,
            options::Format::Iife => bun_js_parser::options::Format::Iife,
            options::Format::InternalBakeDev => bun_js_parser::options::Format::InternalBakeDev,
        };
        let features = &mut parser_options.features;
        features.allow_runtime = true;
        features.unwrap_commonjs_to_esm = is_esm && bun_core::FeatureFlags::UNWRAP_COMMONJS_TO_ESM;
        features.unwrap_commonjs_packages = options.unwrap_commonjs_packages;
        features.top_level_await = is_esm;
        features.auto_polyfill_require = is_esm;
        features.inlining = options.minify_syntax;
        features.minify_syntax = options.minify_syntax;
        features.minify_identifiers = options.minify_identifiers;
        features.minify_keep_names = options.keep_names;
        features.minify_whitespace = options.minify_whitespace;
        features.emit_decorator_metadata = file.flags.emit_decorator_metadata();
        features.standard_decorators = !loader.is_typescript()
            || !(file.flags.experimental_decorators() || file.flags.emit_decorator_metadata());
        features.lower_using = !options.target.is_bun();
        features.no_macros = true;
        features.bundler_feature_flags = options
            .bundler_feature_flags
            .as_deref()
            .map(|flags| Box::new(bun_core::handle_oom(flags.clone())));
        let is_app_jsx = loader.is_jsx() && !path.is_node_module();
        features.react_fast_refresh = options.react_fast_refresh && is_app_jsx;
        if options.react_compiler.is_enabled() && is_app_jsx {
            features.react_compiler = options.react_compiler;
        }
        parser_options
    }

    /// `hops` files gave the name of another file before this one.
    fn lookup_from(
        &self,
        importer: &Fs::Path<'static>,
        specifier: &[u8],
        alias: &[u8],
        kind: ImportKind,
        hops: u32,
    ) -> Option<ConstCallValue> {
        let file = self.resolve(importer, specifier, kind)?;
        let path = &file.path_pair.primary;
        let exports = self.exports_of(&file)?;
        if let Some(redirect) = exports.redirect.as_deref().filter(|_| hops < MAX_HOPS) {
            return self.lookup_from(path, redirect, alias, ImportKind::Require, hops + 1);
        }
        if let Some((_, value)) = exports.values.iter().find(|(name, _)| **name == *alias) {
            return Some(*value);
        }
        let from = exports
            .reexports
            .iter()
            .find(|from| *from.alias == *alias && hops < MAX_HOPS)?;
        self.lookup_from(path, &from.specifier, &from.imported, ImportKind::Stmt, hops + 1)
    }
}

impl ConstCallLookup for Lookup<'_> {
    fn lookup(&self, specifier: &[u8], alias: &[u8]) -> Option<ConstCallValue> {
        self.lookup_from(&self.importer, specifier, alias, ImportKind::Stmt, 0)
    }
}
