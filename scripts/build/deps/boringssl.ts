/**
 * BoringSSL — Google's OpenSSL fork. Provides TLS, all crypto primitives,
 * and the x509 machinery that node:crypto needs.
 */

import type { Dependency } from "../source.ts";

const BORINGSSL_COMMIT = "0c5fce43b7ed5eb6001487ee48ac65766f5ddcd1";

export const boringssl: Dependency = {
  name: "boringssl",
  versionMacro: "BORINGSSL",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/boringssl",
    commit: BORINGSSL_COMMIT,
  }),

  build: () => ({
    kind: "nested-cmake",
    // No explicit targets — defaults to lib names (crypto, ssl, decrepit).
    // BoringSSL's cmake targets match its output library names.
    args: {},
  }),

  provides: () => ({
    libs: ["crypto", "ssl", "decrepit"],
    includes: ["include"],
  }),
};
