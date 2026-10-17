// Copies files from a WebKit checkout into src/jsc/bindings/webcore/, under their upstream directory, with `#include <WebCore/X.h>` rewritten to `#include "X.h"`.
// It never overwrites a file. See README.md.
//
//   bun src/codegen/webcore/import.ts [--webcore=<directory>] Attr.h Attr.cpp
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { useQuotedIncludes } from "./util.ts";

const repository = path.resolve(import.meta.dirname, "../../..");
const { values: options, positionals: names } = parseArgs({
  allowPositionals: true,
  options: { webcore: { type: "string" } },
});
const webcore = path.resolve(
  options.webcore ?? process.env.WEBCORE_SOURCE_DIR ?? path.join(repository, "vendor/WebKit/Source/WebCore"),
);
const destination = path.join(repository, "src/jsc/bindings/webcore");

// Ports of other platforms, and tests.
const skipped = new Set(["mac", "cocoa", "ios", "win", "gtk", "wpe", "glib", "playstation", "testing", "scripts"]);

function find(directory: string, name: string): string | undefined {
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (entries.some(entry => entry.isFile() && entry.name === name)) return path.join(directory, name);
  for (const entry of entries) {
    const found = entry.isDirectory() && !skipped.has(entry.name) && find(path.join(directory, entry.name), name);
    if (found) return found;
  }
}

for (const name of names) {
  const source = find(webcore, name);
  if (!source) {
    console.log(`not found upstream: ${name}`);
    process.exitCode = 1;
    continue;
  }
  const relative = path.relative(webcore, source);
  const target = path.join(destination, relative);
  if (fs.existsSync(target)) {
    console.log(`exists: ${relative}`);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, useQuotedIncludes(fs.readFileSync(source, "utf8")));
  console.log(`imported ${relative}`);
}
