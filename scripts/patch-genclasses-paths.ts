#!/usr/bin/env bun
// Restore the hand-tuned `pub use … as TypeName;` lines from the previous
// (checked-in) build/debug/codegen/generated_classes.rs into the freshly
// regenerated copy. The codegen's `rustModuleResolver` heuristic mis-guesses
// ~35 of these; the committed file carries the corrections.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const GEN = "build/debug/codegen/generated_classes.rs";
const orig = execSync(`git show HEAD:${GEN}`, { encoding: "utf8" });
const cur = readFileSync(GEN, "utf8");

const origPaths = new Map<string, string>(); // TypeName -> full `pub use … as TypeName;`
for (const m of orig.matchAll(/^pub use [\w:]+ as (\w+);$/gm)) {
  origPaths.set(m[1], m[0]);
}

const out = cur.replace(/^pub use [\w:]+ as (\w+);$/gm, (line, name) => {
  return origPaths.get(name) ?? line;
});

writeFileSync(GEN, out);
console.error(`restored ${origPaths.size} type paths`);
