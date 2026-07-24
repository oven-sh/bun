// Linux base system: package index + CI tuning + common packages, plus the
// cleanup and core-dump steps. Manager-specific behavior (apt vs apk) comes
// from ctx.manager — see package-manager.ts.

import { existsSync } from "node:fs";
import {
  applySysctlFile,
  disableServiceNow,
  ensureDirectory,
  maskUnit,
  reloadServiceManager,
  shellScript,
  trimFilesystems,
} from "../../ops-posix.ts";
import { ensureLines } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { appendToProfiles } from "../environment.ts";
import { coresDir } from "../paths.ts";

/** Refresh the package index and apply the CI-only OS tuning (ulimits).
 * First on every linux image. */
export const baseSystem: LinuxComponent = {
  name: "base-system",
  artifacts: () => ({}),
  steps: ctx => {
    const { image, ci, manager } = ctx;
    return [
      {
        name: "Update package index",
        run: () => manager.updateIndex(),
      },
      {
        name: "Configure ulimits",
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
        },
      },
      {
        name: `Install common packages (${image.packages.common.length})`,
        run: () => manager.install(ctx, image.packages.common),
      },
      {
        name: "Install build essentials",
        run: async () => {
          await manager.install(ctx, [...image.packages.buildEssentials, ...image.packages.qemu]);
          await manager.afterBuildEssentials(ctx);
        },
      },
    ];
  },
};

/** Empty caches and trim the disk before capture. Last on every linux CI
 * image. */
export const cleanup: LinuxComponent = {
  name: "cleanup",
  artifacts: () => ({}),
  steps: ctx => {
    const { image, ci, manager } = ctx;
    return [
      {
        name: "Mask tmpfs on /tmp (needs disk-backed /tmp)",
        skip: !manager.systemd && "no systemd tmp.mount on this distro",
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
          await manager.cleanCache();
          await trimFilesystems();
        },
      },
    ];
  },
};

/** Core dumps: a directory the test runner looks in after running tests
 * (scripts/runner.node.mjs reads the same directory via the sysctl). */
export const coreDumps: LinuxComponent = {
  name: "core-dumps",
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
};
