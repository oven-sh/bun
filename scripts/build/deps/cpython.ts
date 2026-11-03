/**
 * CPython — for its standard library alone, the part written in Python (`Lib/`).
 *
 * Nothing of it is compiled: Python is a language of JavaScriptCore
 * (vendor/WebKit/Source/JavaScriptCore/python). `Lib/` goes into the binary
 * unchanged: src/codegen/pack-python-stdlib.ts packs it (the step is in
 * bun.ts) and src/jsc/bindings/BunPythonStdlib.cpp serves it to programs as a
 * read-only directory.
 */

import type { Dependency } from "../source.ts";

/** The tag v3.15.2. The language version is JavaScriptCore's: python/runtime/PySys.cpp. */
const CPYTHON_COMMIT = "5e58eaad7c58df58dfa8ea549c87996e01dd1077";

/** When that commit was made, in seconds since the epoch: what `os.stat` gives as the time of every packed file. */
export const CPYTHON_COMMIT_TIME = 1792947471;

export const cpython: Dependency = {
  name: "cpython",

  source: () => ({
    kind: "github-archive",
    repo: "python/cpython",
    commit: CPYTHON_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({
    libs: [],
    includes: [],
  }),
};
