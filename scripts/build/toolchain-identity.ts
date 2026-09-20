/**
 * `<buildDir>/toolchain-identity.txt`: which compiler, assembler and linker
 * this build directory's artifacts come from, as each tool reports itself
 * (`tools.ts` `toolIdentity`). Every edge that runs one of them names this
 * file as an input, so replacing a tool rebuilds what it produced. The Rust
 * units get the same from the rustc version and commit in their hash.
 *
 * ninja cannot see a replaced tool on its own. A command line names the tool
 * by path, and an upgrade behind a stable path (a package manager's `current`
 * link, a Homebrew `opt/` symlink, /usr/bin) leaves the path, and so the
 * command, unchanged. Naming the binary as an input does not help either: a
 * freshly installed binary keeps its packaged mtime, which is usually older
 * than the objects it should invalidate. The build directory then holds
 * objects from two compilers, and with LTO their bitcode meets in one link —
 * LLVM 21's next to LLVM 23's failed with `undefined symbol: hwy::Abort`.
 *
 * The archiver and the resource compiler are not here: llvm-lib and llvm-rc
 * do not report a version, and what they write does not depend on one.
 *
 * Written with `writeIfChanged`, so an unchanged toolchain keeps the file's
 * mtime and rebuilds nothing.
 */

import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { writeIfChanged } from "./fs.ts";
import { toolIdentity } from "./tools.ts";

export function toolchainIdentityPath(cfg: Config): string {
  return resolve(cfg.buildDir, "toolchain-identity.txt");
}

/** Write the file; returns its path. Called by configure, before ninja runs. */
export function writeToolchainIdentity(cfg: Config): string {
  const tools: [name: string, path: string | undefined][] = [
    ["cc", cfg.cc],
    ["cxx", cfg.cxx],
    ["nasm", cfg.nasm],
    ["ld", cfg.ld],
  ];
  const lines = tools.flatMap(([name, path]) =>
    // Absent on this platform: no nasm, and `ld` is "" on macOS, where clang finds the linker itself.
    path === undefined || path === "" ? [] : [`${name}: ${toolIdentity(path)}`],
  );
  const path = toolchainIdentityPath(cfg);
  writeIfChanged(path, lines.join("\n") + "\n");
  return path;
}
