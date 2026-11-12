Fixes #15844

### Problem
- A JSX option set in `bunfig.toml`, by a `--jsx-*` flag or in `Bun.build({ jsx })` is lost when a `tsconfig.json` sets the same option. With `"jsx": "react-jsx"` in tsconfig.json and `jsx = "react"` in bunfig.toml, `bun build` emits `jsxDEV` from `react/jsx-dev-runtime`. Neither file asks for that.
- Cause: each tsconfig.json is merged over a dense `Pragma` (`TSConfigJSON::merge_jsx`, 9 callers). A dense value cannot tell a stated option from a default.

### Fix
- First commit: each source states only what it was given (`jsx::Stated`, one `Option` for each option). `jsx::Sources` keeps bunfig.toml, the flags and `Bun.build` apart. `Pragma::from(Stated)` is the one place that fills defaults. `merge_jsx`, `api::Jsx` and the `Pragma` in each resolve result are gone.
- Second commit, the rule: a tsconfig.json does not decide an option that one of those sources states (`Stated::lay_tsconfig_over`). `NODE_ENV` picks dev or production as before.
- Four defects end with the old carrier. Notes lists them.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (NEWFAIL of its cases fail on main), and an output matrix of CELLS cells against main. MOVED cells move. Each prints what main prints when the stated options are taken out of the tsconfig.json.

### Background
- `Pragma` is the JSX configuration that the parser reads: runtime, factory, fragment, import source, development.
- Layers, lowest first: the user's sources with their defaults, then the working directory's tsconfig.json and `NODE_ENV` in the order they arrive, then the tsconfig.json of the file (`BundleOptions::jsx_for`).
- The first version of this PR put a "was set" bitset on `Pragma` and a gate in `merge_jsx`. That keeps the merge in every resolve and a second record of what was stated. A design review picked the sparse value: it removes both.
- esbuild lets tsconfig.json win over its CLI and API JSX options. Bun now differs for stated options. `docs/bundler/esbuild.mdx` says so.

### Downsides
- Behaviour change: a project that sets one JSX option both in tsconfig.json and in bunfig.toml, a flag or `Bun.build` now gets the second value. This also holds for files under a nested tsconfig.json, one in node_modules, and `--tsconfig-override`.
- `api::TransformOptions` grows from 584 to 752 bytes (one for each transpiler). `Pragma` shrinks from 152 to 64 bytes and `resolver::Result` from 288 to 192.
- Not changed: a bunfig.toml without JSX keys still switches `bun build` to the development runtime (#48152).

<details><summary>Notes</summary>

**Defects that end with the old carrier (first commit).** Each is a case where the dense `Pragma` was written in the wrong order or copied whole.
- `bun run --jsx-factory=x file.jsx` beside a bunfig.toml that sets `jsxFactory`: bunfig.toml won, because `bun run` loads it after the flags and the load overwrote them. `bun file.jsx` was right. Both now take the flag.
- `NODE_ENV=production bun build` beside a tsconfig.json that states no dev or production runtime used the development runtime: the whole-`Pragma` copy of the tsconfig wrote its default over what `NODE_ENV` chose. This is the subject of #38050.
- A `key` after a spread compiles to `createElement`, imported from the package of `jsxImportSource`. With the import source in tsconfig.json the import came from `react` on every path except the plain CLI without a bunfig.toml (also in #38050). The import source is now one value, so the runtime module and the package cannot differ.
- `bun test --parallel` beside a bunfig.toml: the coordinator sent its merged JSX state to the workers as `--jsx-*` flags, so the workers used the production runtime and the serial run the development one. The coordinator now sends only the flags that were typed. Each worker reads bunfig.toml itself.

**What is not changed.**
- The dev or production defaults of each source: any bunfig.toml means development, any `--jsx-*` flag with a value means production, `Bun.build` means development. They are three constants in `jsx::Sources` now. #48152, #48337 and #48338 change them.
- `bun run` and `bun test` apply the tsconfig.json of the working directory to every file. `bun build` applies the nearest one for each file.
- A file that `Bun.build` takes from `files` uses the built-in defaults.
- `--jsx-side-effects` alone has no effect.

**Output matrix.** One process for each cell, on the canary of the merge base (1.4.4-canary.1+89452d2ac) and on this branch.
- Main matrix, CELLS_MAIN cells: 7 tsconfig.json states x 6 bunfig.toml states x (5 flag sets x 6 CLI entry points + 7 `Bun.build` variants) x 3 `NODE_ENV` values.
- Second matrix, 405 cells: a nested tsconfig.json, `extends`, `--tsconfig-override`, a package in node_modules with its own tsconfig.json, `Bun.Transpiler`, a Worker, and `Bun.build` with a file in memory and a plugin module.
- Expected output of a cell: what main prints beside the tsconfig.json that is left when the options that the user's sources state are taken out of it.
- RESULTS

**esbuild.** esbuild 0.21.5 applies tsconfig.json over `--jsx` and `--jsx-factory`. `REVIEW.md` names the reference implementation as the spec for ported code, so this is a deliberate difference. It follows the request in this PR's thread that an explicitly set option in bunfig.toml wins.

**Open question for a maintainer.** Should `--jsx-*` flags and `Bun.build({ jsx })` win over tsconfig.json like bunfig.toml does? This PR says yes, because `docs/runtime/bunfig.mdx` says that flags override bunfig.toml. If the answer is "bunfig.toml only", the change is in `jsx::Sources::stated`.

**Earlier version of this PR.** It added `set_fields` to `api::Jsx` and `Pragma` and a gate in `merge_jsx`. A design review found that it allocated once for each resolve for projects with `jsxImportSource` in tsconfig.json, that the ahead-of-time compiler's copy of the merge was not changed, and that `set_fields` was a second record of what the values already say.

</details>
