#!/usr/bin/env node
// Entry point for baking a Bun CI machine image (or provisioning a machine
// like one). Runs under a bare node (>= 25, type stripping) — no bun, no
// build step — because it is what installs everything else.
//
//   node scripts/build/ci/bootstrap.ts --image=<key> --ci --repo-ref=<ref>
//   node scripts/build/ci/bootstrap.ts --image=<key> --ci --dry-run
//
// The plan is the image's `components` list from ./spec.ts, resolved by
// ./components/registry.ts — the same list the image hash walks. There are
// no implicit defaults. --dry-run prints the complete plan (every step,
// command, download, and file write) without changing the machine — the
// way to review what a bake will do, from any host.
//
// See scripts/build/ci/CLAUDE.md for the whole image system.

import { parseArgs } from "node:util";
import { detectHost } from "./bootstrap/host.ts";
import { banner, log, mode, runSteps } from "./bootstrap/runtime.ts";
import { linuxArtifacts, linuxSteps, windowsArtifacts, windowsSteps } from "./components/registry.ts";
import { verifyHost } from "./components/verify-host.ts";
import { imageEntry } from "./naming.ts";
import { epoch } from "./spec.ts";

const USAGE = `Usage: node scripts/build/ci/bootstrap.ts --image=<key> [--ci] [--repo-ref=<ref>] [--dry-run]

  --image=<key>     Image entry in scripts/build/ci/spec.ts to bake (required).
  --ci              Bake a CI image: buildkite user, agent, prefetch caches,
                    system tuning, cleanup. Omit for a plain dev machine.
  --repo-ref=<ref>  Git ref cloned for the prefetch caches / xmac.mjs.
                    Required with --ci.
  --dry-run         Print every step, command, download and file write
                    without executing anything.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "image": { type: "string" },
      "ci": { type: "boolean" },
      "repo-ref": { type: "string" },
      "dry-run": { type: "boolean" },
      "help": { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const imageKey = values.image;
  if (!imageKey) {
    throw new Error(`--image=<key> is required.\n\n${USAGE}`);
  }
  const ci = values.ci === true;
  const dryRun = values["dry-run"] === true;
  const repoRefFlag = values["repo-ref"];
  if (ci && !repoRefFlag) {
    throw new Error(`--repo-ref=<ref> is required with --ci (the prefetch caches clone that ref).\n\n${USAGE}`);
  }
  const repoRef = repoRefFlag !== undefined ? repoRefFlag : "main";
  if (!/^[\w./-]+$/.test(repoRef)) {
    throw new Error(`--repo-ref="${repoRef}" is not a valid git ref (allowed: letters, digits, . _ / -)`);
  }

  mode.dryRun = dryRun;
  const image = imageEntry(imageKey);

  // Identify the run by its spec key. The content-addressed NAME is the
  // orchestrator's concern (it holds every recipe file); this VM sees only
  // the delivered subtree, so it must not recompute the hash here.
  banner(`Bun CI image bootstrap: ${image.key} (epoch ${epoch})${ci ? " [CI]" : ""}${dryRun ? " [DRY RUN]" : ""}`);
  log(`spec entry: ${image.key} (${image.os} ${image.arch})`);
  log(`components (${image.components.length}): ${image.components.join(", ")}`);
  log(`repo ref for caches: ${repoRef}`);

  const host = await detectHost();

  if (image.os === "linux") {
    if (host.os !== "linux" && !dryRun) {
      throw new Error(
        `Image "${image.key}" is linux but this host is ${host.os}. Use --dry-run to inspect the plan from another OS.`,
      );
    }
    const ctx = { image, host, ci, repoRef, artifacts: linuxArtifacts(image) };
    await runSteps(`Bootstrap ${image.key}`, [verifyHost(image, host), ...linuxSteps(image, ctx)]);
  } else {
    if (host.os !== "windows" && !dryRun) {
      throw new Error(
        `Image "${image.key}" is windows but this host is ${host.os}. Use --dry-run to inspect the plan from another OS.`,
      );
    }
    const ctx = { image, host, ci, repoRef, artifacts: windowsArtifacts(image) };
    await runSteps(`Bootstrap ${image.key}`, [verifyHost(image, host), ...windowsSteps(image, ctx)]);
  }
}

main().catch(error => {
  console.error(`\nbootstrap: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
