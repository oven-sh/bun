jsx: state each source's options sparsely and resolve them in one place

bunfig.toml, the --jsx-* flags, Bun.build({ jsx }) and each tsconfig.json
now state only the JSX options they were given (jsx::Stated). jsx::Sources
keeps the user's sources apart, with the dev or production default of each
as a named constant. Pragma::from(Stated) is the one place that fills
defaults.

A resolve result no longer carries a Pragma. It lists the configurations
that govern the file, and BundleOptions::jsx_for lays them over the options
of the build. TSConfigJSON::merge_jsx, api::Jsx and the resolver's copy of
the Pragma are removed.

The order of the sources is the one main has. Four results change, because
the dense Pragma wrote them in the wrong order or copied them whole:

- `bun run` takes a --jsx-* flag over bunfig.toml, as `bun <file>` does.
- NODE_ENV=production beside a tsconfig.json that states no development or
  production runtime gives the production runtime in `bun build`.
- The createElement fallback for a key after a spread is imported from the
  package of a tsconfig's jsxImportSource on every path.
- `bun test --parallel` workers are sent only the --jsx-* flags that were
  typed. Each worker reads bunfig.toml itself.

A --jsx-factory, --jsx-fragment or --jsx-import-source flag with an empty
value states nothing, like an empty value in bunfig.toml and in Bun.build.
It used to reset the bunfig.toml value to the default and to select the
production runtime.
