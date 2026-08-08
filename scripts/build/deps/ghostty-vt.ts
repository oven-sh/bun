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
 * includes the C API yet), so this pins a main commit. Bumping it means
 * re-deriving the two `packages` hashes below from the new commit's
 * `build.zig.zon` (uucode) and `pkg/zlib/build.zig.zon` (zlib) — both are
 * content-addressed, so the GitHub upstream URLs used here hash the same
 * as the `deps.files.ghostty.org` mirrors they point at, and a stale hash
 * fails the build naming this file — and re-checking that the patch still
 * applies. The build mechanism is `NestedZigBuild` in `../source.ts`.
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
  // installing the VT static lib + headers (shrinking the dependency set to
  // the two packages below), splits the lib into one section per symbol so
  // bun's --gc-sections link can drop the unused parts of the C API, and,
  // critically, stops bundling Zig's compiler_rt, which exports `memcpy`,
  // `memset`, and most of libm and would otherwise replace the libc
  // versions in the whole bun binary (see `exportPrefix` below).
  patches: ["patches/ghostty-vt/lib-vt-only.patch"],

  build: () => ({
    kind: "nested-zig",
    args: [
      "-Demit-lib-vt",
      // Without this Ghostty vendors its own highway and simdutf into the
      // archive; bun already links both, and the duplicate C++ definitions
      // would be an ODR violation. With it the library is pure Zig.
      "-Dsimd=false",
      "-Dapp-runtime=none",
      "-Demit-xcframework=false",
      // A release mode always, even for debug bun builds: a Debug Zig
      // library emits UBSan checks, and the patch deliberately does not
      // bundle Zig's ubsan runtime (nothing else defines those handlers).
      // ReleaseSmall over ReleaseFast: the pane renderer runs at human
      // output rates, and Small halves this library's contribution to
      // the linked bun binary (~0.6 MB vs ~1.2 MB after --gc-sections).
      "-Doptimize=ReleaseSmall",
    ],
    // libghostty-vt must export nothing but its C API. Zig's bundled
    // compiler_rt defines `memcpy`, `memset`, `memmove`, and most of libm
    // as weak globals; linked into bun ahead of libc, those replaced the
    // glibc implementations for the entire binary (a ~4x slower `memcpy`).
    // The patch disables the bundling; this check keeps it that way.
    exportPrefix: "ghostty_",
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
