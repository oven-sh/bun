//! Turning the config into bundler setup: transpilers and `import.meta` defines.

use super::{BuildConfigSubset, Framework};
use crate::bake::{Graph, Mode, Side, dev_server};
use bun_alloc::Arena;
use bun_options_types::schema as bun_schema;

impl Framework {
    /// Returns `out`, initialized, and the arena slot of the `bake_types::Framework` view (never dropped by the arena).
    pub(crate) fn init_transpiler<'a, 'out>(
        &self,
        arena: &'a Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &'out mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> crate::Result<(
        &'out mut bun_bundler::Transpiler<'a>,
        *mut bun_bundler::bake_types::Framework,
    )> {
        // `ASTMemoryAllocator::enter` returns an RAII `Scope` whose `Drop`
        // runs `exit()` at end-of-fn.
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();

        // The caller (`DevServer::init`) hands us an uninitialized slot, so
        // use `MaybeUninit::write` (no drop of prior bytes) then reborrow as
        // `&mut Transpiler` for the field assignments below.
        let out: &'out mut bun_bundler::Transpiler<'a> = out.write(bun_bundler::Transpiler::init(
            arena,
            log,
            // `TransformOptions::default()`: every `Option` is `None`, every
            // slice empty, every scalar zero/false.
            bun_schema::api::TransformOptions::default(),
            None,
        )?);

        out.options.target = match renderer {
            Graph::Client => bun_ast::Target::Browser,
            Graph::Server | Graph::Ssr => bun_ast::Target::Bun,
        };
        out.options.public_path = match renderer {
            Graph::Client => dev_server::CLIENT_PREFIX.as_bytes().into(),
            Graph::Server | Graph::Ssr => Box::default(),
        };
        out.options.entry_points = Box::default();
        out.options.log = log;
        out.options.output_format = mode.output_format();
        out.options.out_extensions = bun_collections::StringHashMap::new();
        out.options.hot_module_reloading = mode == Mode::Development;
        out.options.code_splitting = mode != Mode::Development;

        // force disable filesystem output, even though bundle_v2
        // is special cased to return before that code is reached.
        out.options.output_dir = Box::default();

        // framework configuration
        out.options.react_fast_refresh = mode == Mode::Development
            && renderer == Graph::Client
            && self.react_fast_refresh.is_some();
        out.options.server_components = self.server_components.is_some();

        out.options.conditions = bun_bundler::options::ESMConditions::init(
            out.options.target.default_conditions(),
            out.options.target.is_server_side(),
            &[],
        )?;
        if renderer == Graph::Server && self.server_components.is_some() {
            out.options.conditions.append_slice(&[b"react-server"])?;
        }
        if mode == Mode::Development {
            // Support `esm-env` package using this condition.
            out.options.conditions.append_slice(&[b"development"])?;
        }
        // Ensure "node" condition is included for server-side rendering
        // This helps with package.json imports field resolution
        if renderer == Graph::Server || renderer == Graph::Ssr {
            out.options.conditions.append_slice(&[b"node"])?;
        }

        out.options.production = mode != Mode::Development;
        out.options.tree_shaking = mode != Mode::Development;
        // The dev server never minifies.
        let minify = |option: Option<bool>| mode != Mode::Development && option.unwrap_or(true);
        out.options.minify_syntax = minify(bundler_options.minify_syntax);
        out.options.minify_identifiers = minify(bundler_options.minify_identifiers);
        out.options.minify_whitespace = minify(bundler_options.minify_whitespace);
        out.options.css_chunking = true;
        // The bundler crate (lower tier) carries a TYPE_ONLY projection
        // (`bake_types::Framework`); construct it here and give it arena
        // lifetime so `BundleOptions<'a>` can borrow it for the bundle pass.
        let framework = arena.alloc(self.as_bundler_view());
        let framework_view: *mut bun_bundler::bake_types::Framework = &raw mut *framework;
        out.options.framework = Some(framework);
        out.options.inline_entrypoint_import_meta_main = true;

        out.options.source_map = match mode {
            // DevServer links source maps itself and relies on them always being enabled.
            Mode::Development => bun_bundler::options::SourceMapOption::External,
            Mode::ProductionStatic => {
                bun_bundler::options::SourceMapOption::from_api(Some(bundler_options.source_map))
            }
        };
        if bundler_options.env != bun_schema::api::DotEnvBehavior::_none {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix.clone().unwrap_or_default();
        }
        // The resolver crate carries a FORWARD_DECL subset of
        // `BundleOptions`, so re-project via the dedicated helper rather than
        // `Clone`.
        out.sync_resolver_opts();

        out.configure_linker();
        out.configure_defines()?;

        out.options.jsx.development = mode == Mode::Development;

        add_import_meta_defines(
            &mut out.options.define,
            mode,
            match renderer {
                Graph::Client => Side::Client,
                Graph::Server | Graph::Ssr => Side::Server,
            },
        )?;

        if !bundler_options.define.keys.is_empty() {
            debug_assert_eq!(
                bundler_options.define.keys.len(),
                bundler_options.define.values.len()
            );
            use bun_bundler::DefineDataExt;
            for (k, v) in bundler_options
                .define
                .keys
                .iter()
                .zip(bundler_options.define.values.iter())
            {
                let parsed =
                    bun_bundler::defines::DefineData::parse(k, v, false, false, log, arena)?;
                out.options.define.insert(k, parsed)?;
            }
        }

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.chunk_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.asset_naming = b"_bun/[hash].[ext]".as_slice().into();
        }

        // Re-sync after define/naming mutations so the resolver sees the
        // final option set.
        out.sync_resolver_opts();
        Ok((out, framework_view))
    }
}

pub(crate) fn add_import_meta_defines(
    define: &mut bun_bundler::options::Define,
    mode: Mode,
    side: Side,
) -> crate::Result<()> {
    use bun_ast::E::EString;

    use bun_bundler::defines::DefineData;

    static MODE_DEVELOPMENT: EString = EString::from_static(b"development");
    static MODE_PRODUCTION: EString = EString::from_static(b"production");

    // The following are from Vite: https://vitejs.dev/guide/env-and-mode
    // Note that it is not currently possible to have mixed
    // modes (production + hmr dev server)
    // TODO: BASE_URL
    // NOTE: `HTMLBundle::on_plugins_resolved` (the `Bun.serve` path without the
    // HMR dev server) mirrors this key list; add new keys in both places.
    define.insert(
        b"import.meta.env.DEV",
        DefineData::init_boolean(mode == Mode::Development),
    )?;
    define.insert(
        b"import.meta.env.PROD",
        DefineData::init_boolean(mode != Mode::Development),
    )?;
    define.insert(
        b"import.meta.env.MODE",
        DefineData::init_static_string(match mode {
            Mode::Development => &MODE_DEVELOPMENT,
            Mode::ProductionStatic => &MODE_PRODUCTION,
        }),
    )?;
    define.insert(
        b"import.meta.env.SSR",
        DefineData::init_boolean(side == Side::Server),
    )?;

    // To indicate a static build, `STATIC` is set to true then.
    define.insert(
        b"import.meta.env.STATIC",
        DefineData::init_boolean(mode == Mode::ProductionStatic),
    )?;

    Ok(())
}
