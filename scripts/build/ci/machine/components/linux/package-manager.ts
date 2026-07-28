// The distro package manager, abstracted once. Everything on a Linux image
// that differs by manager (install syntax, index refresh, cache cleanup,
// which system-user tools exist, whether cmake/docker/python-fuse come from
// packages) is a member here; an image uses exactly one implementation,
// chosen from its entry's `packages.manager` fact.
//
// Selected by managerFor() in bootstrap.ts; components receive it on
// their LinuxContext.

import { existsSync } from "node:fs";
import { enableService, ensureDirectory, shellScript } from "../../ops-posix.ts";
import { download, log, sudo } from "../../runtime.ts";
import type { LinuxContext } from "../component.ts";
import { artifact } from "../component.ts";
import { appendToProfiles } from "../environment.ts";

/** How this distro creates system users: busybox adduser/addgroup, or the
 * shadow useradd suite. */
export type UserFlavor = "busybox" | "shadow";

export type PackageManager = {
  readonly name: "apt" | "apk";
  readonly userFlavor: UserFlavor;
  /** cmake is a distro package on this manager (else Kitware's installer). */
  readonly cmakeIsPackaged: boolean;
  /** python-fuse is packaged here (else built from source). */
  readonly pythonFuseIsPackaged: boolean;
  /** The distro's init system — a spec fact, never probed from the host,
   * so the recipe is a function of the spec rather than of whatever
   * machine runs it. (systemd distros also have a tmp.mount to mask;
   * OpenRC ones don't.) */
  readonly init: "systemd" | "openrc";
  /** Install packages, non-interactively. */
  install(ctx: LinuxContext, packages: readonly string[]): Promise<void>;
  /** Install docker: from packages already listed, or the upstream script. */
  installDocker(ctx: LinuxContext): Promise<void>;
  /** Install LLVM's `major`: apt.llvm.org's llvm.sh, or the distro's
   * versioned packages. */
  installLlvm(ctx: LinuxContext): Promise<void>;
};

async function installLogged(
  manager: "apt" | "apk",
  packages: readonly string[],
  run: () => Promise<void>,
): Promise<void> {
  if (!packages.length) return;
  log(`installing ${packages.length} ${manager} package(s): ${packages.join(" ")}`);
  await run();
}

// ---------------------------------------------------------------------------
// apt (Debian, Ubuntu)
// ---------------------------------------------------------------------------

export const apt: PackageManager = {
  name: "apt",
  userFlavor: "shadow",
  cmakeIsPackaged: false,
  pythonFuseIsPackaged: true,
  init: "systemd",
  async install(_ctx, packages) {
    await installLogged("apt", packages, () =>
      sudo(["apt-get", "install", "--yes", "--no-install-recommends", "--fix-missing", ...packages], {
        env: { DEBIAN_FRONTEND: "noninteractive" },
      }).then(() => undefined),
    );
  },
  async installDocker(ctx) {
    const script = await download(artifact(ctx.artifacts, "dockerInstaller"), { name: "get-docker.sh" });
    await sudo(["sh", script]);
    await enableService("docker", { start: false }, this.init);
  },
  async installLlvm(ctx) {
    const { llvm } = ctx.image;
    // apt.llvm.org's GPG key uses SHA1, which Debian 13+ (sqv) rejects
    // since 2026-02-01. Override the sequoia crypto policy to extend the
    // SHA1 deadline. https://github.com/llvm/llvm-project/issues/153385
    if (existsSync("/usr/bin/sqv") && existsSync("/usr/share/apt/default-sequoia.config")) {
      await ensureDirectory("/etc/crypto-policies/back-ends");
      await shellScript({
        describe: "extend apt-sequoia's SHA1 deadline so apt.llvm.org's key is accepted",
        root: true,
        script:
          `sed 's/sha1.second_preimage_resistance = 2026-02-01/sha1.second_preimage_resistance = 2028-02-01/' ` +
          `/usr/share/apt/default-sequoia.config > /etc/crypto-policies/back-ends/apt-sequoia.config`,
      });
    }
    const script = await download(artifact(ctx.artifacts, "llvmScript"), { name: "llvm.sh" });
    await sudo(["bash", script, `${llvm.major}`, "all"], { env: { DEBIAN_FRONTEND: "noninteractive" } });
    // llvm-symbolizer for ASAN.
    await this.install(ctx, [`llvm-${llvm.major}-tools`]);
    // The full LLVM bin dir on PATH so unversioned llvm-objcopy, llvm-strip,
    // llvm-ar etc. resolve (debian only symlinks a subset).
    await appendToProfiles(ctx, [`export PATH="/usr/lib/llvm-${llvm.major}/bin:$PATH"`]);
  },
};

// ---------------------------------------------------------------------------
// apk (Alpine)
// ---------------------------------------------------------------------------

export const apk: PackageManager = {
  name: "apk",
  userFlavor: "busybox",
  cmakeIsPackaged: true,
  pythonFuseIsPackaged: false,
  init: "openrc",
  async install(_ctx, packages) {
    await installLogged("apk", packages, () =>
      sudo(["apk", "add", "--no-cache", "--no-interactive", "--no-progress", ...packages]).then(() => undefined),
    );
  },
  async installDocker() {
    // docker + compose come from the apk package list.
    await enableService("docker", { start: true }, this.init);
  },
  async installLlvm(ctx) {
    // Alpine ships LLVM as versioned apk packages (llvm{N}, clang{N}, ...),
    // listed on the image's packages.llvm.
    await this.install(ctx, ctx.image.packages.llvm);
  },
};

/** The manager for an image, from its `packages.manager` spec fact. */
export function managerFor(manager: "apt" | "apk"): PackageManager {
  return manager === "apk" ? apk : apt;
}
