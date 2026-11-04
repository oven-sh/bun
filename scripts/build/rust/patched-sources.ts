/**
 * Patched copies of Rust sources the repository does not hold: the standard library (the toolchain's `rust-src`
 * component) and crates from the registry.
 *
 * `patches/rust-std/*.patch` name their files from a common root: `library/…` for the standard library,
 * `<name>-<version>/…` for a crate. The planner (plan.ts) copies each of those directories into its graph directory,
 * applies the patches to the copy, and plans the build on the copy. The toolchain and `$CARGO_HOME` are only read, so
 * nothing else that uses them sees a patch.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../error.ts";

export interface SourcePatch {
  path: string;
  body: string;
  /** The directories under the common root it changes: `library`, `hashbrown-0.16.1`, … */
  tops: string[];
}

export function readSourcePatches(paths: string[]): SourcePatch[] {
  return paths.map(path => {
    // CRLF→LF: `git apply` rejects a patch that a checkout with autocrlf rewrote.
    const body = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    const tops = new Set([...body.matchAll(/^\+\+\+ b\/([^/\n]+)\//gm)].map(m => m[1]!));
    return { path, body, tops: [...tops].sort() };
  });
}

/**
 * `<root>/<top>`: a copy of `pristine` with the patches that name `top` applied, in order. Left alone when it was
 * made from the same `origin` (what says which sources `pristine` holds) and the same patches: rewriting it would
 * give every file a new mtime and recompile everything that reads one.
 */
export function patchedCopy(
  root: string,
  top: string,
  pristine: string,
  origin: string,
  patches: SourcePatch[],
): string {
  const applied = patches.filter(p => p.tops.includes(top));
  const dest = join(root, top);
  const stamp = join(root, `${top}.identity`);
  const identity = createHash("sha256")
    .update(JSON.stringify([origin, applied.map(p => p.body)]))
    .digest("hex");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === identity) return dest;

  rmSync(stamp, { force: true });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(pristine, dest, { recursive: true });
  for (const patch of applied) {
    // --no-index: the copy is inside bun's checkout, in an ignored directory. --include: one patch can span crates.
    const result = spawnSync("git", ["apply", "--no-index", "--ignore-whitespace", `--include=${top}/*`, "-"], {
      cwd: root,
      input: patch.body,
      encoding: "utf8",
    });
    if (result.error) throw new BuildError("Failed to spawn git apply", { cause: result.error });
    if (result.status !== 0) {
      throw new BuildError(`${patch.path} does not apply to ${pristine}`, {
        hint:
          `${result.stderr.trim()}\n` +
          "The patches are written for the toolchain rust-toolchain.toml pins and the versions in Cargo.lock. " +
          "After a bump of either, redo the patch on the new sources.",
      });
    }
  }
  writeFileSync(stamp, identity);
  return dest;
}
