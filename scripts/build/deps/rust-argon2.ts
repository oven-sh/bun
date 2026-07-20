/**
 * rust-argon2 — the Argon2 implementation behind `Bun.password`.
 *
 * Like lolhtml, this is NOT built into its own archive: the root Cargo.toml
 * redirects the published crate to `vendor/rust-argon2/` via
 * `[patch.crates-io]`, so it compiles inside the one workspace cargo build.
 * This dep entry exists only to FETCH the source and apply
 * `patches/rust-argon2/verify-encoded-legacy-memory.patch` (an additive
 * `verify_encoded_legacy_memory` entry point; see the patch for why) —
 * `emitRust` waits on the `.ref` stamp so cargo never sees a missing path.
 */

import type { Dependency } from "../source.ts";

// The `3.0.0` release tag. `src/` at this commit is byte-identical to the
// `rust-argon2 = "3.0"` sources published on crates.io.
const RUST_ARGON2_COMMIT = "ed81866f163f0c7026aa6fd8388adf37242eb32a";

export const rustArgon2: Dependency = {
  name: "rust-argon2",

  source: () => ({
    kind: "github-archive",
    repo: "sru-systems/rust-argon2",
    commit: RUST_ARGON2_COMMIT,
  }),

  patches: ["patches/rust-argon2/verify-encoded-legacy-memory.patch"],

  // No separate build — compiled as part of the workspace cargo build via
  // the `[patch.crates-io]` path override in the root Cargo.toml.
  build: () => ({ kind: "none" }),

  provides: () => ({
    // No standalone archive on the link line.
    libs: [],
    // No includes — it has no C/C++ surface; it's a pure Rust crate cargo
    // consumes straight out of `vendor/rust-argon2/`.
    includes: [],
  }),
};
