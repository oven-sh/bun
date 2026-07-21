// Linux base system: package index + CI tuning + common packages + the
// distro package installer helper other linux components use.

import { existsSync } from "node:fs";
import {
  applySysctlFile,
  disableServiceNow,
  ensureDirectory,
  maskUnit,
  reloadServiceManager,
  shellScript,
  trimFilesystems,
} from "../bootstrap/ops-posix.ts";
import { ensureLines, log, mode, runOutput, sudo } from "../bootstrap/runtime.ts";
import type { Component, LinuxContext } from "./component.ts";
import { appendToProfiles } from "./environment.ts";
import { coresDir } from "./paths.ts";

// ---------------------------------------------------------------------------
// Package manager (shared helper for linux components)
// ---------------------------------------------------------------------------

/** Install packages with the image's package manager, non-interactively. */
export async function installPackages(ctx: LinuxContext, packages: readonly string[]): Promise<void> {
  if (!packages.length) return;
  log(`installing ${packages.length} ${ctx.image.packages.manager} package(s): ${packages.join(" ")}`);
  switch (ctx.image.packages.manager) {
    case "apt":
      await sudo(["apt-get", "install", "--yes", "--no-install-recommends", "--fix-missing", ...packages], {
        env: { DEBIAN_FRONTEND: "noninteractive" },
      });
      break;
    case "apk":
      await sudo(["apk", "add", "--no-cache", "--no-interactive", "--no-progress", ...packages]);
      break;
  }
}

/** True when apt has an installable candidate for a package (renamed
 * packages, libasound2 → libasound2t64). A query of the TARGET's package
 * database; off-target (dry-run) plan with the first candidate. */
export async function aptHasCandidate(name: string): Promise<boolean> {
  if (mode.dryRun) {
    log(`[dry-run] would check whether apt knows "${name}" (assuming yes)`);
    return true;
  }
  const output = await runOutput(["apt-cache", "policy", name], { allowFailure: true });
  return output.includes(name) && !/Candidate: \(none\)/.test(output);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Refresh the package index and apply the CI-only OS tuning (ulimits,
 * package-manager options). First on every linux image. */
export const baseSystem: Component = {
  name: "base-system",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image, ci } = ctx;
      return [
        {
          name: "Update package index",
          run: async () => {
            if (image.packages.manager === "apt") {
              await sudo(["apt-get", "update", "-y"], { env: { DEBIAN_FRONTEND: "noninteractive" } });
            } else {
              await sudo(["apk", "update"]);
            }
          },
        },
        {
          name: "Configure ulimits and package-manager CI options",
          skip: !ci && "not a CI image",
          run: async () => {
            // limits.conf + systemd DefaultLimit* so builds and tests aren't
            // capped (systemd needs "infinity" where limits.conf says
            // "unlimited").
            const limitLines: string[] = [];
            const systemdLines: string[] = [];
            for (const limit of image.system.limits) {
              const counted = image.system.countedLimits[limit];
              const value = counted !== undefined ? `${counted}` : "unlimited";
              for (const who of ["root", "*"]) {
                limitLines.push(`${who} soft ${limit} ${value}`, `${who} hard ${limit} ${value}`);
              }
              systemdLines.push(`DefaultLimit${limit.toUpperCase()}=${value === "unlimited" ? "infinity" : value}`);
            }
            await ensureLines("/etc/security/limits.d/99-unlimited.conf", limitLines);
            if (existsSync("/etc/systemd/system.conf")) await ensureLines("/etc/systemd/system.conf", systemdLines);
            // OpenRC (alpine) has no systemd and no pam session config;
            // rc_ulimit in /etc/rc.conf is the ONLY thing raising limits for
            // rc-started services (buildkite-agent, dockerd). Without it
            // fd-heavy tests EMFILE at the OpenRC default of 1024.
            if (existsSync("/etc/rc.conf")) {
              const rcFlags: Record<string, string> = { c: "core", n: "nofile", u: "nproc" };
              const rcUlimit = ["c", "d", "e", "f", "i", "l", "m", "n", "q", "r", "s", "t", "u", "v", "x"]
                .map(flag => {
                  const named = rcFlags[flag];
                  const counted = named ? image.system.countedLimits[named] : undefined;
                  return `-${flag} ${counted !== undefined ? counted : "unlimited"}`;
                })
                .join(" ");
              await ensureLines("/etc/rc.conf", [`rc_ulimit="${rcUlimit}"`]);
            }
            for (const pam of ["/etc/pam.d/common-session", "/etc/pam.d/common-session-noninteractive"]) {
              if (existsSync(pam)) await ensureLines(pam, ["session optional pam_limits.so"]);
            }
            await reloadServiceManager();
            if (image.packages.manager === "apt") {
              await ensureLines("/etc/dpkg/dpkg.cfg.d/01-ci-options", [...image.system.dpkgOptions]);
              await ensureLines("/etc/apt/apt.conf.d/99-ci-options", [...image.system.aptOptions]);
            }
          },
        },
        {
          name: `Install common packages (${image.packages.common.length})`,
          run: () => installPackages(ctx, image.packages.common),
        },
        {
          name: "Install build essentials",
          run: async () => {
            await installPackages(ctx, [...image.packages.buildEssentials, ...image.packages.qemu]);
            // alsa: newer ubuntu renamed libasound2 → libasound2t64.
            if (image.packages.manager === "apt") {
              for (const candidate of ["libasound2t64", "libasound2"]) {
                if (await aptHasCandidate(candidate)) {
                  await installPackages(ctx, [candidate]);
                  break;
                }
              }
            }
          },
        },
      ];
    },
  },
};

/** Empty caches and trim the disk before capture. Last on every linux CI
 * image. */
export const cleanup: Component = {
  name: "cleanup",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image, ci } = ctx;
      return [
        {
          name: "Mask tmpfs on /tmp (needs disk-backed /tmp)",
          skip: !["ubuntu", "debian"].includes(image.distro) && "no systemd tmp.mount on this distro",
          run: () => maskUnit("tmp.mount"),
        },
        {
          name: "Clean caches and trim disk before capture",
          skip: !ci && "not a CI image",
          run: async () => {
            await shellScript({
              describe: "empty /tmp and /var/tmp",
              root: true,
              script: "rm -rf /tmp/* /var/tmp/* /tmp/.[!.]* /var/tmp/.[!.]* 2>/dev/null || true",
            });
            if (image.packages.manager === "apt") {
              await sudo(["apt-get", "clean"]);
              await shellScript({
                describe: "drop apt package lists",
                root: true,
                script: "rm -rf /var/lib/apt/lists/*",
              });
            } else {
              await shellScript({ describe: "drop apk cache", root: true, script: "rm -rf /var/cache/apk/*" });
            }
            await trimFilesystems();
          },
        },
      ];
    },
  },
};

/** Core dumps: a directory the test runner looks in after running tests
 * (scripts/runner.node.mjs reads the same directory via the sysctl). */
export const coreDumps: Component = {
  name: "core-dumps",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: "Configure core dumps",
          skip: process.env.BUN_NO_CORE_DUMP === "1" && "BUN_NO_CORE_DUMP=1",
          run: async () => {
            const dir = coresDir(image);
            await ensureDirectory(dir, { mode: "777" });
            // %e = executable filename, %p = pid
            await ensureLines("/etc/sysctl.d/local.conf", [`kernel.core_pattern = ${dir}/%e-%p.core`]);
            // apport overrides core_pattern where it exists.
            await disableServiceNow("apport.service");
            await applySysctlFile("/etc/sysctl.d/local.conf");
            await appendToProfiles(ctx, [`export PATH="/sbin:$PATH"`]);
          },
        },
      ];
    },
  },
};
