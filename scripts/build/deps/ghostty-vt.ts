/**
 * libghostty-vt — Ghostty's terminal emulator library.
 *
 * Backs the pane renderer in `bun run --parallel` (`Panes` in
 * `src/runtime/cli/multi_run.rs`): each task's pty output is replayed into
 * a virtual terminal so progress bars, cursor movement, and colors resolve
 * to what a real terminal would show. The Rust bindings live in
 * `src/ghostty_vt_sys/`; no C/C++ in bun includes the headers.
 *
 * Ghostty only ships libghostty-vt from its main branch (no tagged release
 * includes the C API yet), so this pins a main commit.
 *
 * ## Build
 *
 * This is the only `nested-zig` dep: libghostty-vt is pure Zig. The
 * `dep_zig_build` ninja edge runs `scripts/build/zig-build-cli.ts`, which
 * finds a Zig 0.15 toolchain ($BUN_ZIG → $PATH → a sha256-pinned download
 * into the build cache) and runs `zig build`. That and the two `packages`
 * below are the entire toolchain footprint — see `NestedZigBuild` in
 * `../source.ts`.
 *
 * `-Dsimd=false` matters: without it Ghostty vendors its own highway and
 * simdutf into the archive, both of which bun already links, and the
 * duplicate C++ definitions would be an ODR violation. With it the library
 * is pure Zig — the only bundled object is Zig's compiler_rt, whose
 * symbols are all weak.
 *
 * `-Doptimize=ReleaseFast` is intentional even for debug bun builds: a
 * Debug Zig library bundles Zig's UBSan runtime, which would collide with
 * the `__ubsan_*` symbols clang's sanitizer runtime provides in bun's
 * ASAN profiles. The VT library is a leaf with its own test suite
 * upstream; bun gains nothing from a checked build of it.
 *
 * ## Bumping the commit
 *
 * 1. Update `GHOSTTY_COMMIT`.
 * 2. Re-derive the two `packages` hashes from the new commit's
 *    `build.zig.zon` (`uucode`) and `pkg/zlib/build.zig.zon` (`zlib`).
 *    Ghostty mirrors both on `deps.files.ghostty.org`; the URLs here are
 *    the upstreams they mirror, which hash to the same content
 *    (zig package hashes are content-addressed, not URL-addressed).
 *    A stale hash fails the build naming this file.
 * 3. Re-check `patches/ghostty-vt/lib-vt-only.patch` still applies.
 */

import type { Dependency } from "../source.ts";

const GHOSTTY_COMMIT = "f9194f93deeec82670771fc3909132b37356b155";

export const ghosttyVt: Dependency = {
  name: "ghostty-vt",

  source: () => ({
    kind: "github-archive",
    repo: "ghostty-org/ghostty",
    commit: GHOSTTY_COMMIT,
  }),

  // Upstream's `zig build -Demit-lib-vt` still constructs the whole Ghostty
  // app's build graph, which lazily fetches ~30 packages (GTK, fonts,
  // renderers) the VT library never uses. The patch returns right after
  // installing the VT static lib + headers, shrinking the dependency set to
  // the two packages below.
  patches: ["patches/ghostty-vt/lib-vt-only.patch"],

  build: () => ({
    kind: "nested-zig",
    args: [
      "-Demit-lib-vt",
      "-Dsimd=false",
      "-Dapp-runtime=none",
      "-Demit-xcframework=false",
      "-Doptimize=ReleaseFast",
    ],
    packages: [
      {
        // jacobsandlund/uucode — Unicode tables (grapheme/width data).
        // The one eager (non-lazy) package in ghostty's build.zig.zon.
        url: "https://github.com/jacobsandlund/uucode/archive/refs/tags/v0.2.0.tar.gz",
        hash: "uucode-0.2.0-ZZjBPqZVVABQepOqZHR7vV_NcaN-wats0IB6o-Exj6m9",
      },
      {
        // madler/zlib — pulled in by ghostty's build tooling
        // (`GhosttyFrameData`), not linked into libghostty-vt itself.
        url: "https://github.com/madler/zlib/archive/refs/tags/v1.3.1.tar.gz",
        hash: "N-V-__8AAB0eQwD-0MdOEBmz7intriBReIsIDNlukNVoNu6o",
      },
    ],
  }),

  provides: () => ({
    libs: ["ghostty-vt"],
    // bun's bindings are hand-written `extern "C"` declarations in
    // `src/ghostty_vt_sys/ghostty_vt.rs`; nothing in bun's C/C++ includes
    // the installed `include/ghostty/` headers.
    includes: [],
  }),

  // The pane renderer is pty-based and lives behind `#[cfg(unix)]` in
  // multi_run.rs; on Windows nothing references the library's symbols.
  enabled: cfg => !cfg.windows,
};
