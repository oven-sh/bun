//! Answers what a call of an imported function returns, on the worker that parses the importer (`bun_js_parser::visit::const_call`).

use std::sync::Arc;

use crate::bundle_v2::BundleV2;
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

/// One per build: what the exports of each file that an importer asked about return. `None`: the file has no answer.
#[derive(Default)]
pub(crate) struct Cache {
    modules: bun_threading::Guarded<StringHashMap<Option<Arc<ConstCallExports>>>>,
}

impl Cache {
    pub(crate) fn clear(&self) {
        *self.modules.lock() = Default::default();
    }
}

/// The lookup of one file.
pub(crate) struct Lookup<'a> {
    ctx: &'a BundleV2<'static>,
    /// The one of the worker, for the target of the file.
    transpiler: *mut Transpiler<'static>,
    arena: &'a bun_alloc::Arena,
    importer: Fs::Path<'static>,
    /// How many more files can be parsed inside this one.
    depth: u8,
}

impl<'a> Lookup<'a> {
    /// `None` when no import of `importer` gets an answer.
    ///
    /// # Safety
    /// `transpiler` is the one of the worker this runs on, and it outlives the lookup. Only its `options` and `resolver` are read.
    pub(crate) unsafe fn new(
        ctx: &'a BundleV2<'static>,
        transpiler: *mut Transpiler<'static>,
        arena: &'a bun_alloc::Arena,
        importer: Fs::Path<'static>,
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
            depth: MAX_DEPTH,
        })
    }

    fn options(&self) -> &crate::options::BundleOptions<'static> {
        // SAFETY: the contract of `new`.
        unsafe { &(*self.transpiler).options }
    }

    /// The file that `specifier` in `importer` names, when nothing else can replace it or its source.
    fn resolve(&self, importer: &Fs::Path<'static>, specifier: &[u8]) -> Option<Fs::Path<'static>> {
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
            // SAFETY: the contract of `new`. The worker resolves nothing else while its parser runs.
            None => unsafe { &mut (*self.transpiler).resolver }
                .resolve_with_framework(importer.source_dir(), specifier, ImportKind::Stmt)
                .ok()?,
        };
        let path = result.path_pair.primary;
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
            || has_second_build
            || !path
                .loader(&self.options().loaders)
                .is_some_and(|loader| loader.is_javascript_like())
            || plugins.is_some_and(|plugins| plugins.has_any_matches(&path, true))
        {
            return None;
        }
        Some(path)
    }

    /// What the exports of the file at `path` return. Parses the file when no importer asked about it before.
    fn exports_of(&self, path: &Fs::Path<'static>) -> Option<Arc<ConstCallExports>> {
        let mut key = Vec::with_capacity(path.text.len() + 2);
        key.extend_from_slice(path.text);
        key.extend_from_slice(&[self.options().target as u8, self.depth]);
        if let Some(known) = self.ctx.const_call_modules.modules.lock().get(&key[..]) {
            return known.clone();
        }
        // Two workers can parse one file at the same time. Both get the same answer.
        let exports = self.parse(path).map(Arc::new);
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
        let mut modules = self.ctx.const_call_modules.modules.lock();
        bun_core::handle_oom(modules.put(&key, exports.clone()));
        exports
    }

    fn parse(&self, path: &Fs::Path<'static>) -> Option<ConstCallExports> {
        let options = self.options();
        let loader = path.loader(&options.loaders)?;
        let from_disk;
        let contents: &[u8] = match self.ctx.file_map.and_then(|map| map.get(path.text)) {
            Some(contents) => contents,
            None => {
                from_disk = bun_sys::File::read_from(bun_sys::Fd::cwd(), path.text).ok()?;
                &from_disk
            }
        };

        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(path.text, contents);
        let exports = core::cell::Cell::new(None);
        let inner = (self.depth > 0).then(|| Lookup {
            importer: *path,
            depth: self.depth - 1,
            ..*self
        });

        let mut parser_options = ParserOptions::init(
            crate::transpiler::to_parser_jsx_pragma(options.jsx.clone()),
            loader,
        );
        // What a function returns depends on the defines, the feature flags and the source. The other options decide only which files have an answer.
        parser_options.bundle = true;
        parser_options.tree_shaking = options.tree_shaking;
        parser_options.warn_about_unbundled_modules = false;
        parser_options.features.inlining = options.minify_syntax;
        parser_options.features.minify_syntax = options.minify_syntax;
        parser_options.features.no_macros = true;
        parser_options.features.top_level_await = true;
        parser_options.features.bundler_feature_flags = options
            .bundler_feature_flags
            .as_deref()
            .map(|flags| Box::new(bun_core::handle_oom(flags.clone())));
        // A file that is only `module.exports = require()` is a redirect in the bundle too.
        parser_options.features.allow_runtime = true;
        parser_options.features.unwrap_commonjs_to_esm = options.output_format
            == crate::options::Format::Esm
            && bun_core::FeatureFlags::UNWRAP_COMMONJS_TO_ESM;
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

    /// `hops` files gave the name of another file before this one.
    fn lookup_from(
        &self,
        importer: &Fs::Path<'static>,
        specifier: &[u8],
        alias: &[u8],
        hops: u32,
    ) -> Option<ConstCallValue> {
        let path = self.resolve(importer, specifier)?;
        let exports = self.exports_of(&path)?;
        if let Some(redirect) = exports.redirect.as_deref().filter(|_| hops < MAX_HOPS) {
            return self.lookup_from(&path, redirect, alias, hops + 1);
        }
        if let Some((_, value)) = exports.values.iter().find(|(name, _)| **name == *alias) {
            return Some(*value);
        }
        let from = exports
            .reexports
            .iter()
            .find(|from| *from.alias == *alias && hops < MAX_HOPS)?;
        self.lookup_from(&path, &from.specifier, &from.imported, hops + 1)
    }
}

impl Clone for Lookup<'_> {
    fn clone(&self) -> Self {
        *self
    }
}
impl Copy for Lookup<'_> {}

impl ConstCallLookup for Lookup<'_> {
    fn lookup(&self, specifier: &[u8], alias: &[u8]) -> Option<ConstCallValue> {
        self.lookup_from(&self.importer, specifier, alias, 0)
    }
}
