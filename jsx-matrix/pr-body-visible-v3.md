Fixes #15844

### Problem
- A JSX option from `bunfig.toml`, a `--jsx-*` flag or `Bun.build({ jsx })` is lost when `tsconfig.json` sets the same option. tsconfig `"jsx": "react-jsx"` plus bunfig `jsx = "react"` gives `jsxDEV`.
- `TSConfigJSON::merge_jsx` merges each tsconfig.json over a dense `Pragma`, which cannot tell a stated option from a default.

### Fix
- First commit: each source states only what it was given (`jsx::Stated`) and `Pragma::from(Stated)` alone fills defaults. Four defects end (Notes).
- Second commit: an option that one of those sources states is read as if the project's tsconfig.json and the files it extends did not state it. Other tsconfig.json files keep theirs.
- Verified: `test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts` (16 of 28 fail on main). Output matrix, 5,127 cells against main: 0 unexplained differences.
- Self-reviewed: 6 concerns raised, 3 addressed, 3 need a maintainer (Notes).

### Background
- `Pragma` is what the parser reads. Layers, lowest first: the user's sources, the working directory's tsconfig.json and `NODE_ENV`, the file's tsconfig.json.
- The project's tsconfig.json is the nearest to the working directory. `TSConfigJSON` keeps what each file of an `extends` chain states.
- Considered a "was set" bitset on `Pragma` gating `merge_jsx`: the merge stays in every resolve.

### Downsides
- Breaking, no flag: a bunfig.toml key that tsconfig.json overrides today starts to apply. The docs sample (`jsxFactory = "h"`) beside `bun init`'s tsconfig.json throws `ReferenceError: h is not defined`.
- `api::TransformOptions` grows from 584 to 752 bytes. `Pragma` shrinks from 152 to 64, release `.text` by 26,880 bytes.
