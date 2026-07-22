#!/usr/bin/env node
// The bootstrap program: bakes a Bun CI machine image from one image entry.
//
// runBootstrap() is bundled per image (see scripts/build/ci/generate.ts):
// each image's build/ci/<key>/bootstrap.ts is this module + that image's
// resolved entry inlined, standalone, run on the machine under a bare node.
//
//   node bootstrap.ts --ci --repo-ref=<ref>
//   node bootstrap.ts --ci --dry-run
//
// --dry-run prints the complete plan (every step, command, download, and
// file write) without changing the machine.

import { parseArgs } from "node:util";
import type { Image } from "../types.ts";
import type { LinuxComponent, WindowsComponent } from "./components/component.ts";
import type { PackageManager } from "./components/linux/package-manager.ts";
import { linuxArtifacts, linuxSteps, windowsArtifacts, windowsSteps } from "./components/registry.ts";
import { detectHost } from "./host.ts";
import { banner, log, mode, runSteps } from "./runtime.ts";

const USAGE = `Usage: node bootstrap.ts [--ci] [--repo-ref=<ref>] [--dry-run]

  --ci              Bake a CI image: buildkite user, agent, prefetch caches,
                    system tuning, cleanup. Omit for a plain dev machine.
  --repo-ref=<ref>  Git ref cloned for the prefetch caches / xmac.mjs.
                    Required with --ci.
  --dry-run         Print every step, command, download and file write
                    without executing anything.`;

/** Bake `image` (the resolved spec entry baked into this bundle). `manager`
 * is that image's package manager, selected in the generated entry so the
 * bundle carries only its own manager's code. */
export async function runBootstrap(
  image: Image,
  components: readonly LinuxComponent[] | readonly WindowsComponent[],
  epoch: number,
  manager: PackageManager | undefined,
  argv: string[],
): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
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
    if (manager === undefined) throw new Error(`linux image "${image.key}" needs a package manager`);
    const linux = components as readonly LinuxComponent[];
    const ctx = { image, host, ci, repoRef, artifacts: linuxArtifacts(linux, image), manager };
    await runSteps(`Bootstrap ${image.key}`, linuxSteps(linux, ctx));
  } else {
    if (host.os !== "windows" && !dryRun) {
      throw new Error(
        `Image "${image.key}" is windows but this host is ${host.os}. Use --dry-run to inspect the plan from another OS.`,
      );
    }
    const windows = components as readonly WindowsComponent[];
    const ctx = { image, host, ci, repoRef, artifacts: windowsArtifacts(windows, image) };
    await runSteps(`Bootstrap ${image.key}`, windowsSteps(windows, ctx));
  }
}
