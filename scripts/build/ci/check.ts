#!/usr/bin/env node
// Smoke test for the CI image system: generates every image's files, prints
// each content-addressed name (a hash of those files), and dry-runs each
// GENERATED bootstrap.ts. Any spec entry that can't generate, name, or plan
// fails here — long before a real bake. Runs anywhere node runs.
//
//   node scripts/build/ci/check.ts
//
// Exits non-zero and names the failing image if anything errors.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogEntry } from "./components/catalog.ts";
import { generateCiImages } from "./generate.ts";
import { imageName } from "./naming.ts";
import { imageOutDir } from "./outputs.ts";
import { bun as bunPin, images } from "./spec.ts";

const here = dirname(fileURLToPath(import.meta.url));

// The spec's bun pin must equal the repo's LATEST: the images ship the same
// bun the release process considers current.
const latest = readFileSync(join(here, "..", "..", "..", "LATEST"), "utf8").trim();
if (bunPin.version !== latest) {
  console.error(`spec bun.version ${bunPin.version} != LATEST ${latest}`);
  process.exit(1);
}

// Every component named in the spec must exist in the catalog (loud, here,
// rather than at bake time).
for (const image of images) {
  for (const name of image.components) catalogEntry(name, image.os);
}

console.log("Generating every image's files:");
generateCiImages();

console.log("\nContent-addressed image names:");
for (const image of images) {
  console.log(`  ${imageName(image)}`);
}

console.log("\nDry-running every generated bootstrap:");
let failed = 0;
for (const image of images) {
  const bootstrap = join(imageOutDir(image), "bootstrap.ts");
  // A dry-run is pure planning and finishes in well under a second; the
  // timeout turns a stall into a reported failure instead of a hung check.
  const result = spawnSync(process.execPath, [bootstrap, "--ci", "--repo-ref=main", "--dry-run"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const complete = /all (\d+) step\(s\) complete/.exec(result.stdout);
  const timedOut = result.signal === "SIGTERM";
  if (result.status === 0 && complete) {
    console.log(`  ok   ${image.key} (${complete[1]} steps)`);
  } else {
    failed++;
    console.log(`  FAIL ${image.key} (${timedOut ? "timed out after 60s" : `exit ${result.status}`})`);
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
