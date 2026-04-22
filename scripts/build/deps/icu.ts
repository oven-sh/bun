/**
 * ICU — Unicode/i18n. WTF and JSC are heavy users (Intl.*, String case
 * folding, text segmentation, regex Unicode property tables).
 *
 * Built from source so the binary doesn't depend on the host's ICU dev
 * package, and so the symbol-version suffix (_75) matches between headers
 * and lib on every target. The prebuilt WebKit tarball does the same
 * (see oven-sh/WebKit/Dockerfile).
 *
 * macOS: brew's icu4c is fine (and avoids a 30 MB data lib in the
 * binary), so this dep is disabled there — common.ts's icuPrefix()
 * supplies brew's -I/-L instead.
 *
 * Windows: handled separately via build-icu.ps1 (MSBuild).
 *
 * Autotools, not DirectBuild — ICU's build compiles a host `genrb`/
 * `pkgdata` tool mid-run to pack the locale data into libicudata.a.
 */

import { computeCpuTargetFlags } from "../flags.ts";
import type { Dependency } from "../source.ts";
import { depBuildDir } from "../source.ts";

const ICU_VERSION = "75-1";

export const icu: Dependency = {
  name: "icu",
  versionMacro: "ICU",

  // Linux only. Darwin uses brew (see common.ts icuPrefix); Windows
  // uses build-icu.ps1. Prebuilt ships its own ICU, so skip there too.
  enabled: cfg => cfg.linux && cfg.webkit !== "prebuilt",

  source: () => ({
    kind: "github-archive",
    repo: "unicode-org/icu",
    // ICU's release tags use this format; github-archive maps to
    // /archive/<ref>.tar.gz which works for tags.
    commit: `release-${ICU_VERSION}`,
  }),

  build: cfg => {
    const prefix = depBuildDir(cfg, "icu");
    // Only the -march/-mcpu target flags from bun's config — ICU uses
    // RTTI and runs its own `pkgdata` host tool mid-build, so no
    // -fno-rtti / sanitizers / debug instrumentation. The WebKit
    // Dockerfile builds it the same way (-Os only).
    const arch = computeCpuTargetFlags(cfg).join(" ");
    // configure → make → make install to deps/icu/. --with-data-packaging=
    // static compiles the locale data into libicudata.a (no separate .dat
    // file to ship). The disable list matches the WebKit Dockerfile.
    // make clean first so a re-run after changing flags doesn't pick up
    // stale objects from the previous configure.
    const sh = [
      `cd icu4c/source`,
      `[ -f Makefile ] && make distclean >/dev/null 2>&1 || true`,
      `./configure --prefix='${prefix}' --enable-static --disable-shared ` +
        `--with-data-packaging=static --disable-samples --disable-tests ` +
        `--disable-extras --disable-icuio --disable-layoutex`,
      `make -j$(nproc)`,
      `make install`,
    ].join(" && ");
    return {
      kind: "script",
      command: ["bash", "-euo", "pipefail", "-c", sh],
      env: {
        CC: cfg.cc,
        CXX: cfg.cxx,
        // -Os to keep the data lib small; -DUCONFIG_NO_LEGACY_CONVERSION
        // drops obsolete codepage tables. -w: ICU's headers trigger a
        // flood of -Wunnecessary-virtual-specifier on clang ≥21.
        CFLAGS: `${arch} -Os -std=c17 -fPIC -w`,
        CXXFLAGS:
          `${arch} -Os -std=c++20 -fPIC -w -fno-exceptions ` +
          `-fno-c++-static-destructors -DUCONFIG_NO_LEGACY_CONVERSION=1`,
        LDFLAGS: cfg.ld ? `--ld-path=${cfg.ld}` : "",
      },
      outputs: ["lib/libicuuc.a", "lib/libicui18n.a", "lib/libicudata.a"],
    };
  },

  provides: cfg => ({
    libs: [],
    includes: [`${depBuildDir(cfg, "icu")}/include`],
    // Static-lib order: i18n → uc → data.
    linkFlags: [`-L${depBuildDir(cfg, "icu")}/lib`, "-licui18n", "-licuuc", "-licudata"],
  }),
};
