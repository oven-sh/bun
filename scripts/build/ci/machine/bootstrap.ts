#!/usr/bin/env node
// Bake a Bun CI machine image (or provision a machine like one) from an
// image entry in the spec. Runs under a bare node (>= 25, type stripping) —
// no bun, no build step — because it is what installs everything else.
//
//   node scripts/build/ci/machine/bootstrap.ts --image=<key> --ci --repo-ref=<ref>
//
// The plan is the image's `components` list from the spec, resolved by
// ./components/registry.ts, run in the order the entry lists them.

import { parseArgs } from "node:util";
import { imageEntry } from "../naming.ts";
import { managerFor } from "./components/linux/package-manager.ts";
import { commandSteps, linuxArtifacts, linuxSteps, windowsArtifacts, windowsSteps } from "./components/registry.ts";
import { detectHost } from "./host.ts";
import { banner, log, runSteps } from "./runtime.ts";

const USAGE = `Usage: node bootstrap.ts --image=<key> [--ci] [--repo-ref=<ref>]

  --image=<key>     Image entry in the CI image spec to bake (required).
  --ci              Bake a CI image: buildkite user, agent, prefetch caches,
                    system tuning, cleanup. Omit for a plain dev machine.
  --repo-ref=<ref>  Git ref cloned for the prefetch caches / xmac.mjs.
                    Required with --ci.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "image": { type: "string" },
      "ci": { type: "boolean" },
      "repo-ref": { type: "string" },
      "help": { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const key = values.image;
  if (!key) throw new Error(`--image=<key> is required.\n\n${USAGE}`);
  const ci = values.ci === true;
  const repoRefFlag = values["repo-ref"];
  if (ci && !repoRefFlag) {
    throw new Error(`--repo-ref=<ref> is required with --ci (the prefetch caches clone that ref).\n\n${USAGE}`);
  }
  const repoRef = repoRefFlag !== undefined ? repoRefFlag : "main";
  if (!/^[\w./-]+$/.test(repoRef)) {
    throw new Error(`--repo-ref="${repoRef}" is not a valid git ref (allowed: letters, digits, . _ / -)`);
  }

  const image = imageEntry(key);

  banner(`Bun CI image bootstrap: ${image.key}${ci ? " [CI]" : ""}`);
  log(`spec entry: ${image.key} (${image.os} ${image.arch})`);
  log(`components (${image.components.length}): ${image.components.join(", ")}`);
  log(`repo ref for caches: ${repoRef}`);

  const host = await detectHost();

  if (image.os === "linux") {
    if (host.os !== "linux") {
      throw new Error(`Image "${image.key}" is linux but this host is ${host.os}.`);
    }
    const manager = managerFor(image.packages.manager);
    const ctx = { image, host, ci, repoRef, artifacts: linuxArtifacts(image), manager };
    await runSteps(`Bootstrap ${image.key}`, [
      ...commandSteps("linux", "setup", image.systemSetup),
      ...linuxSteps(image, ctx),
      ...commandSteps("linux", "cleanup", image.systemCleanup),
    ]);
  } else {
    if (host.os !== "windows") {
      throw new Error(`Image "${image.key}" is windows but this host is ${host.os}.`);
    }
    const ctx = { image, host, ci, repoRef, artifacts: windowsArtifacts(image) };
    await runSteps(`Bootstrap ${image.key}`, [
      ...commandSteps("windows", "setup", image.systemSetup),
      ...windowsSteps(image, ctx),
      ...commandSteps("windows", "cleanup", image.systemCleanup),
    ]);
  }
}

main().catch(error => {
  console.error(`\nbootstrap: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
