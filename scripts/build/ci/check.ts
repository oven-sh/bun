#!/usr/bin/env node
// Smoke test for the CI image system: prints every image's content-addressed
// name and dry-runs its complete bootstrap plan. Any spec entry that can't
// resolve to a name, or any step that can't even plan, fails here — long
// before a real bake. Runs anywhere node runs (no cloud, no root).
//
//   node scripts/build/ci/check.ts
//
// Exits non-zero and names the failing image if any plan errors.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageName } from "./naming.ts";
import { images } from "./spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const bootstrap = join(here, "bootstrap.ts");

console.log("Content-addressed image names:");
for (const image of images) {
  console.log(`  ${imageName(image)}`);
}

console.log("\nDry-running every image's bootstrap plan:");
let failed = 0;
for (const image of images) {
  const result = spawnSync(
    process.execPath,
    [bootstrap, `--image=${image.key}`, "--ci", "--repo-ref=main", "--dry-run"],
    { encoding: "utf8" },
  );
  const complete = /all (\d+) step\(s\) complete/.exec(result.stdout);
  if (result.status === 0 && complete) {
    console.log(`  ok   ${image.key} (${complete[1]} steps)`);
  } else {
    failed++;
    console.log(`  FAIL ${image.key} (exit ${result.status})`);
    console.log(indent(`${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-30).join("\n")));
  }
}

if (failed) {
  console.error(`\n${failed} image plan(s) failed`);
  process.exit(1);
}
console.log(`\nall ${images.length} image plans ok`);

function indent(text: string): string {
  return text
    .split("\n")
    .map(line => `       | ${line}`)
    .join("\n");
}
