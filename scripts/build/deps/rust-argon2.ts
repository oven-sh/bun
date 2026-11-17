/**
 * rust-argon2 — argon2 for `Bun.password`. A cargo path dep like `lolhtml`
 * (see that file), vendored so the patches below can lift the `m >= 8 * lanes`
 * floor (older Bun versions produced hashes with `m < 8` that must still verify)
 * and return an error instead of aborting when the allocation fails.
 */

import type { Dependency } from "../source.ts";

const RUST_ARGON2_COMMIT = "ed81866f163f0c7026aa6fd8388adf37242eb32a"; // 3.0.0

export const rustArgon2: Dependency = {
  name: "rust-argon2",

  source: () => ({
    kind: "github-archive",
    repo: "sru-systems/rust-argon2",
    commit: RUST_ARGON2_COMMIT,
  }),

  patches: ["patches/rust-argon2/legacy-low-memory.patch", "patches/rust-argon2/fallible-memory.patch"],

  build: () => ({ kind: "none" }),

  provides: () => ({
    libs: [],
    includes: [],
  }),
};
