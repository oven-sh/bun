// The RECIPE hash: a digest of the code that produces an image.
//
// The image entry (facts) is not the whole recipe — bootstrap.ts, the
// component that installs a tool, the ops it calls, the packer template,
// and the machine.ts that drives the bake all determine what lands on disk.
// If any of that code changes, the image it would produce may differ, so
// its name MUST change too: otherwise a build could believe an image baked
// when it was silently reused, which is the one outcome this system exists
// to make impossible. Whether an image bakes must be a mechanical
// consequence of what changed — never something to remember to force.
//
// So the recipe is hashed alongside the facts. It is scoped per platform:
// a change to a windows-only component does not rename linux images. A
// comment or formatting edit is a real byte change and does rename; that
// honest cost buys a system that cannot be fooled.
//
// Read from disk at hash time, so the digest is the code THIS checkout would
// run. It walks the tree, so a new component is included with nothing to
// remember — which means it must run where the FULL scripts tree exists
// (the CI host / orchestrator). A bake VM receives only scripts/build/ci and
// never computes the name; readRecipeFile fails loudly if that is violated.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Image } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const ciDir = here; // scripts/build/ci — everything here ships to the bake VM

/** Files under scripts/build/ci that are TOOLING, not recipe: they inspect
 * or check images but produce nothing on one. Editing them must not rename
 * any image. Everything else in the tree is recipe. */
const NON_RECIPE = new Set([
  "scripts/build/ci/check.ts",
  "scripts/build/ci/existence.ts",
  "scripts/build/ci/CLAUDE.md",
]);

/** Recipe files that produce only ONE platform's images. Any recipe file
 * not listed here is shared and affects both. toolchain-linux.ts holds
 * the rust component's WINDOWS half too, so it is shared (unlisted). */
const LINUX_ONLY = new Set([
  "scripts/build/ci/bootstrap/ops-posix.ts",
  "scripts/build/ci/components/ci-user.ts",
  "scripts/build/ci/components/system-linux.ts",
  "scripts/build/ci/components/cross-linux.ts",
  "scripts/build/ci/components/browsers-linux.ts",
  "scripts/build/ci/components/environment.ts",
  "scripts/build/ci/components/gcc.ts",
]);
const WINDOWS_ONLY = new Set([
  "scripts/build/ci/bootstrap/ops-windows.ts",
  "scripts/build/ci/components/system-windows.ts",
  "scripts/build/ci/components/scoop.ts",
  "scripts/build/ci/components/toolchain-windows.ts",
  "scripts/build/ci/packer.ts",
]);

/** Every file under scripts/build/ci, walked from disk — so a NEW
 * component is part of the recipe automatically, with nothing to remember. */
function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(relative(repoRoot, path).split("\\").join("/"));
  }
  return out;
}

/** The repo-relative recipe files for one OS, sorted. */
export function recipeFiles(os: Image["os"]): readonly string[] {
  const excluded = os === "linux" ? WINDOWS_ONLY : LINUX_ONLY;
  const files = walk(ciDir, []).filter(file => !NON_RECIPE.has(file) && !excluded.has(file));
  // The orchestrator lives outside the ci dir but drives every bake.
  files.push("scripts/machine.ts");
  return files.sort();
}

/**
 * Hex digest of the recipe for one OS: each file's repo-relative path plus
 * its exact bytes, in a fixed order. The path is included so a rename is a
 * recipe change too.
 */
export function recipeHash(os: Image["os"]): string {
  const hash = createHash("sha256");
  for (const file of recipeFiles(os)) {
    hash.update(`\x00${file}\x00`);
    hash.update(readRecipeFile(file));
  }
  return hash.digest("hex");
}

/** Read one recipe file, insisting the full tree is present. The hash is
 * computed by the orchestrator on the CI host, where every recipe file
 * exists; a bake VM sees only the delivered subtree and must never compute
 * the name (it would digest a different, incomplete set). A missing file
 * therefore means "wrong place to hash", never "skip it and hash the rest". */
function readRecipeFile(file: string): Buffer {
  try {
    return readFileSync(join(repoRoot, file));
  } catch (cause) {
    throw new Error(
      `recipe hash: cannot read ${file}. The image name must be computed where the full ` +
        `scripts tree exists (the CI host), not on a bake VM that only received scripts/build/ci.`,
      { cause },
    );
  }
}
