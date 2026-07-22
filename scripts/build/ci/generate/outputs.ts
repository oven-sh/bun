// Where an image's generated files live, and the digest over them.
//
// Pure: no bundler, no side effects. naming.ts (the hash) and machine.ts
// (the consumer) read paths and the digest from here; the files themselves
// are produced by generate.ts.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Image } from "../types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");

/** The generated-files root: build/ci/. */
export const ciOutRoot = join(repoRoot, "build", "ci");

/** Where an image's generated files live: build/ci/<key>/. */
export function imageOutDir(image: Image): string {
  return join(ciOutRoot, image.key);
}

/** sha256 over a directory's files (sorted relative paths + contents) —
 * the digest an image name is built from. */
export function hashImageDir(dir: string): string {
  const hash = createHash("sha256");
  for (const rel of listFiles(dir).sort()) {
    hash.update(`\x00${rel}\x00`);
    hash.update(readFileSync(join(dir, rel)));
  }
  return hash.digest("hex");
}

function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path, base));
    else out.push(path.slice(base.length + 1));
  }
  return out;
}
