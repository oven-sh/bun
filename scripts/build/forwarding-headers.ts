/**
 * Bun's C and C++ name the engine's declarations by one header per class. The engine declares them in a few headers
 * (src/engine/embed/include), so configure writes a header of each name that includes the one that has them.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "./config.ts";
import { writeIfChanged } from "./fs.ts";

/** Any quoted name, not `#include` lines alone: the code generators and the schemas keep some in string literals. */
const headerName = /[<"]((?:JavaScriptCore|wtf)\/[\w/-]+\.h)[>"]/g;

function targetOf(name: string): string {
  if (name === "wtf/SIMDUTF.h") return "<simdutf.h>";
  return name.startsWith("JavaScriptCore/") ? '"engine/Engine.h"' : '"engine/Support.h"';
}

/** Writes a header for every name in `files` and removes the others. Returns the directory, for the include path. */
export function generateForwardingHeaders(cfg: Pick<Config, "buildDir">, files: readonly string[]): string {
  const directory = resolve(cfg.buildDir, "forwarding-headers");
  const written = new Set<string>();
  for (const file of files) {
    for (const [, name] of readFileSync(file, "latin1").matchAll(headerName)) {
      const path = join(directory, name!);
      if (written.has(path)) continue;
      written.add(path);
      writeIfChanged(path, `#include ${targetOf(name!)}\n`);
    }
  }
  if (!existsSync(directory)) return directory;
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !written.has(path)) rmSync(path);
  }
  return directory;
}
