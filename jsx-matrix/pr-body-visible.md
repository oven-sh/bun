Fixes #15844

### Problem
- A JSX option from `bunfig.toml`, a `--jsx-*` flag or `Bun.build({ jsx })` is lost when `tsconfig.json` sets the same option. tsconfig `"jsx": "react-jsx"` plus bunfig `jsx = "react"` gives `jsxDEV`, which neither file states.
- Cause: `TSConfigJSON::merge_jsx` (9 callers) merges each tsconfig.json over a dense `Pragma`, which cannot tell a stated option from a default.

### Fix
- Each source states only what it was given (`jsx::Stated`). `Pragma::from(Stated)` alone fills defaults. `merge_jsx` and `api::Jsx` are gone.
- Rule (second commit): a tsconfig.json does not decide an option that one of those sources states. `NODE_ENV` still picks dev or production.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (13 of 24 fail on main). Output matrix of 5,067 cells against main: 0 unexplained differences.

### Background
- `Pragma` is the JSX configuration the parser reads. Layers, lowest first: the user's sources, the working directory's tsconfig.json and `NODE_ENV`, the file's tsconfig.json.
- Considered a "was set" bitset on `Pragma` with a gate in `merge_jsx` (this PR's first version). It keeps the merge in every resolve. The sparse value removes it and ends four more defects (Notes).

### Downsides
- Behaviour change: an option set both in tsconfig.json and in bunfig.toml, a flag or `Bun.build` now takes the latter, also under a nested, node_modules or `--tsconfig-override` tsconfig.json. esbuild does the opposite.
- `api::TransformOptions` grows from 584 to 752 bytes per transpiler. `Pragma` shrinks from 152 to 64. A `Pragma` clone with a stated import source and factory: 6 allocations before, 0 now.
