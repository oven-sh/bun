//! The built-in presets: `auto` (what `bun index.html` uses) and the React framework.
#![allow(unexpected_cfgs)] // `bun_codegen_embed` is set via RUSTFLAGS (scripts/build/rust.ts) for release/CI builds.

use super::{FileSystemRouterType, Framework, ReactFastRefresh, ServerComponents};
use crate::bake::{BuiltInModule, router};
use bun_collections::StringArrayHashMap;
use bun_core::Utf8Bytes;
use std::borrow::Cow;

use super::framework::{literals, resolve_path};

impl Framework {
    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-refresh@experimental react-server-dom-bun
    pub(crate) fn react() -> Framework {
        // Cannot use .import because resolution must happen from the user's POV
        let built_in: [(&[u8], &'static [u8]); 3] = [
            (
                b"bun-framework-react/client.tsx",
                // Browser-side source: compressed in release builds.
                bun_zstd::embed_compressed!(src "runtime/bake/bun-framework-react/client.tsx"),
            ),
            (
                b"bun-framework-react/server.tsx",
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/server.tsx")
                    .as_bytes(),
            ),
            (
                b"bun-framework-react/ssr.tsx",
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/ssr.tsx")
                    .as_bytes(),
            ),
        ];
        let mut built_in_modules = StringArrayHashMap::new();
        for (path, code) in built_in {
            bun_core::handle_oom(
                built_in_modules.put(path, BuiltInModule::Code(Cow::Borrowed(code))),
            );
        }

        Framework {
            is_built_in_react: true,
            server_components: Some(ServerComponents::new(
                true,
                Utf8Bytes::Borrowed(b"react-server-dom-bun/server"),
            )),
            react_fast_refresh: Some(ReactFastRefresh::default()),
            file_system_router_types: vec![FileSystemRouterType {
                root: Utf8Bytes::Borrowed(b"pages"),
                prefix: Utf8Bytes::Borrowed(b"/"),
                entry_client: Some(Utf8Bytes::Borrowed(b"bun-framework-react/client.tsx")),
                entry_server: Utf8Bytes::Borrowed(b"bun-framework-react/server.tsx"),
                ignore_underscores: true,
                ignore_dirs: literals(&[b"node_modules", b".git"]),
                extensions: literals(&[b".tsx", b".jsx"]),
                style: router::Style::NextjsPages,
                allow_layouts: true,
                client_pages: false,
                server_exports: Vec::new(),
            }],
            built_in_modules,
        }
    }

    /// Default that requires no packages or configuration.
    /// - If `react-refresh` is installed, enable react fast refresh with it.
    ///     - Otherwise, if `react` is installed, use a bundled copy of
    ///     react-refresh so that it still works.
    /// - If any file system router types are provided, configure using
    ///   the above react configuration.
    pub(crate) fn auto(
        resolver: &mut bun_resolver::Resolver,
        file_system_router_types: Vec<FileSystemRouterType>,
    ) -> Framework {
        let mut fw = Framework::default();

        if !file_system_router_types.is_empty() {
            fw = Self::react();
            fw.file_system_router_types = file_system_router_types;
        }

        if let Some(rfr) = resolve_or_null(resolver, b"react-refresh/runtime") {
            fw.react_fast_refresh = Some(ReactFastRefresh { import_source: rfr });
        } else if resolve_or_null(resolver, b"react").is_some() {
            fw.react_fast_refresh = Some(ReactFastRefresh {
                import_source: Utf8Bytes::Borrowed(b"react-refresh/runtime/index.js"),
            });
            bun_core::handle_oom(fw.built_in_modules.put(
                b"react-refresh/runtime/index.js",
                BuiltInModule::Code(Cow::Borrowed(
                    bun_zstd::embed_compressed!(codegen "node-fallbacks/react-refresh.js"),
                )),
            ));
        }

        fw
    }

    /// The default framework of `bun bake`: the `.tsx` and `.jsx` pages in `app/pages/`, Next.js
    /// pages style, rendered on the server and hydrated in the browser with the project's React. No
    /// server components.
    pub(crate) fn bake_pages(resolver: &mut bun_resolver::Resolver) -> Framework {
        let mut fw = Self::auto(resolver, Vec::new());
        bun_core::handle_oom(fw.built_in_modules.put(
            b"bun-bake-react/client.tsx",
            // Browser-side source: compressed in release builds.
            BuiltInModule::Code(Cow::Borrowed(bun_zstd::embed_compressed!(
                src "runtime/bake/bun-bake-react/client.tsx"
            ))),
        ));
        bun_core::handle_oom(
            fw.built_in_modules.put(
                b"bun-bake-react/server.tsx",
                BuiltInModule::Code(Cow::Borrowed(
                    bun_core::runtime_embed_file!(Src, "runtime/bake/bun-bake-react/server.tsx")
                        .as_bytes(),
                )),
            ),
        );
        fw.file_system_router_types.push(FileSystemRouterType {
            root: Utf8Bytes::Borrowed(b"app/pages"),
            prefix: Utf8Bytes::Borrowed(b"/"),
            entry_client: Some(Utf8Bytes::Borrowed(b"bun-bake-react/client.tsx")),
            entry_server: Utf8Bytes::Borrowed(b"bun-bake-react/server.tsx"),
            ignore_underscores: true,
            ignore_dirs: literals(&[b"node_modules", b".git"]),
            extensions: literals(&[b".tsx", b".jsx"]),
            style: router::Style::NextjsPages,
            allow_layouts: true,
            client_pages: true,
            server_exports: literals(&[
                b"getServerSideProps",
                b"getStaticProps",
                b"getStaticPaths",
            ]),
        });
        fw
    }

    pub(crate) fn add_react_install_command_note(log: &mut bun_ast::Log) {
        log.add_msg(bun_ast::Msg {
            kind: bun_ast::Kind::Note,
            data: bun_ast::range_data(
                None,
                bun_ast::Range::NONE,
                concat!(
                    "Install the built in react integration with \"",
                    "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental",
                    "\"",
                ),
            ),
            ..Default::default()
        });
    }
}

#[inline]
fn resolve_or_null(r: &mut bun_resolver::Resolver, path: &[u8]) -> Option<Utf8Bytes<'static>> {
    match resolve_path(r, path) {
        Ok(resolved) => Some(resolved),
        Err(_) => {
            r.log_mut().reset();
            None
        }
    }
}
