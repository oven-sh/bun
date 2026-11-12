Fixes #15844

### Problem
- A JSX option from `bunfig.toml`, a `--jsx-*` flag or `Bun.build({ jsx })` is lost when `tsconfig.json` sets the same option. tsconfig `"jsx": "react-jsx"` plus bunfig `jsx = "react"` gives `jsxDEV`, which neither file states.
- Cause: `TSConfigJSON::merge_jsx` merges each tsconfig.json over a dense `Pragma`, which cannot tell a stated option from a default.

### Fix
- First commit: each source states only what it was given (`jsx::Stated`) and `Pragma::from(Stated)` alone fills defaults. Main's order stays. Four older defects end (Notes).
- Second commit: the project's tsconfig.json does not decide an option that one of those sources states. A nested or dependency tsconfig.json and `--tsconfig-override` still do.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (FAILS of TOTAL fail on main). Output matrix of 5,067 cells against main: 0 unexplained differences.
- Self-reviewed: 6 concerns raised, 3 addressed. The other 3 need a maintainer (Notes).

### Background
- `Pragma` is the JSX configuration the parser reads. Layers, lowest first: the user's sources, the working directory's tsconfig.json and `NODE_ENV`, the file's tsconfig.json.
- Considered a "was set" bitset on `Pragma` with a gate in `merge_jsx`. It keeps the merge in every resolve. The sparse value removes it.

### Downsides
- Breaking, with no flag: a bunfig.toml key that tsconfig.json overrides today starts to apply. The docs sample (`jsxFactory = "h"`) beside `bun init`'s tsconfig.json then fails with `ReferenceError: h is not defined`.
- `api::TransformOptions` grows from 584 to 752 bytes. `Pragma` shrinks from 152 to 64 bytes, release `.text` by 26,880 bytes.
