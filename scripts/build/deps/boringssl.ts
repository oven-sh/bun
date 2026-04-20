/**
 * BoringSSL — Google's OpenSSL fork. Provides TLS, all crypto primitives,
 * and the x509 machinery that node:crypto needs.
 */

import type { Dependency } from "../source.ts";

const BORINGSSL_COMMIT = "217cbd850d3446b6c173f88c8ee49521d567f166";

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
