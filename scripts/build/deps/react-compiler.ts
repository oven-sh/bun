/**
 * React Compiler (Rust port) — the experimental Rust implementation of React
 * Compiler from facebook/react#36173, pinned to a commit on the PR branch.
 * Powers `bun build --react-compiler`.
 *
 * Like lolhtml, this is NOT built into its own archive. The compiler crates
 * under `compiler/crates/` are compiled as rlib path dependencies of
 * `bun_react_compiler` inside the ONE workspace cargo build, so their symbols
 * end up inside `libbun_rust.a` directly (a separate Rust staticlib would
 * bundle a second copy of `std`).
 *
 * This dep entry exists only to FETCH the source into
 * `vendor/react-compiler/` — `emitRust` in `rust.ts` waits on its `.ref`
 * stamp so cargo never sees a missing path dependency.
 */

import type { Dependency } from "../source.ts";

// Head of https://github.com/facebook/react/pull/36173 ("[compiler] Port
// React Compiler to Rust"), which lives on josephsavona/react#rust-research.
const REACT_COMPILER_COMMIT = "75f6a2b16b7826b9a35a9b86fd135f19a37af05c";

export const reactCompiler: Dependency = {
  name: "react-compiler",

  source: () => ({
    kind: "github-archive",
    repo: "josephsavona/react",
    commit: REACT_COMPILER_COMMIT,
  }),

  // 0001: turn off oxc_codegen's default "sourcemap" feature — the optional
  //       oxc_sourcemap dep declares `crate-type = ["lib", "cdylib"]`, and the
  //       useless cdylib artifact fails to link under bun's rustflags.
  // 0002: trim regex to std-only (drops aho-corasick's AVX2 Teddy kernels)
  //       and force sha2's software path (drops the SHA-NI block fn) so
  //       baseline builds pass verify-baseline-static.
  patches: [
    "patches/react-compiler/0001-codegen-no-sourcemap.patch",
    "patches/react-compiler/0002-baseline-safe-deps.patch",
  ],

  // No separate build — compiled as part of the workspace cargo build via
  // `bun_react_compiler`'s path deps on `vendor/react-compiler/compiler/crates/*`.
  build: () => ({ kind: "none" }),

  provides: () => ({
    // No standalone archive on the link line.
    libs: [],
    includes: [],
  }),
};
