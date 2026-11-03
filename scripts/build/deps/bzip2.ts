/**
 * bzip2 — block-sorting compressor. Backs Python's `bz2` module
 * (src/jsc/bindings/python/BunPythonBz2.cpp), and through it the bzip2 modes
 * of `tarfile`, `zipfile` and `shutil`.
 *
 * DirectBuild: the seven files of libbz2, no config.h, no codegen. The command
 * line tools (bzip2.c, bzip2recover.c) are not built.
 *
 * Upstream is sourceware.org/git/bzip2.git, mirrored at gitlab.com/bzip2/bzip2;
 * neither serves GitHub's archive URLs. libarchive/bzip2 is a clone with the
 * same history: the commit below is what the tag bzip2-1.0.8 names in all three.
 */

import type { Dependency } from "../source.ts";

const BZIP2_COMMIT = "6a8690fc8d26c815e798c588f796eabe9d684cf0"; // bzip2-1.0.8

export const bzip2: Dependency = {
  name: "bzip2",

  source: () => ({
    kind: "github-archive",
    repo: "libarchive/bzip2",
    commit: BZIP2_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    sources: ["blocksort.c", "huffman.c", "crctable.c", "randtable.c", "compress.c", "decompress.c", "bzlib.c"],
    defines: {
      // Leaves out the FILE* half of the API, and with it the library's own
      // printing: a failed internal check calls bz_internal_error(), which
      // BunPythonBz2.cpp defines.
      BZ_NO_STDIO: true,
      // Without it, bzlib.h on Windows declares pointers to functions, to be
      // filled in from a DLL. Whoever includes bzlib.h defines it as well.
      ...(cfg.windows && { BZ_EXPORT: true, _CRT_SECURE_NO_WARNINGS: true }),
    },
    includes: ["."],
  }),

  provides: () => ({
    libs: [],
    includes: ["."],
  }),
};
