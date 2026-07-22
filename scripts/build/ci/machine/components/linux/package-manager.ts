// The distro package manager, abstracted once. Everything on a Linux image
// that differs by manager (install syntax, index refresh, cache cleanup,
// which system-user tools exist, whether cmake/docker/python-fuse come from
// packages) is a member here, and each image's generated bootstrap imports
// exactly ONE implementation — its own — so a Debian bootstrap carries no
// apk code and an Alpine bootstrap carries no apt code.
//
// Selected per entry by managerFor(image) in the generated per-image entry
// (generate.ts); components receive it on their LinuxContext.

import { existsSync } from "node:fs";
import { enableService, ensureDirectory, shellScript } from "../../ops-posix.ts";
import { download, log, mode, runOutput, sudo } from "../../runtime.ts";
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
  /** The distro runs systemd (a tmp.mount to mask; else OpenRC). */
  readonly systemd: boolean;
  /** Refresh the package index. */
  updateIndex(): Promise<void>;
  /** Install packages, non-interactively. */
  install(ctx: LinuxContext, packages: readonly string[]): Promise<void>;
  /** Distro-specific extras run right after the build-essentials install. */
  afterBuildEssentials(ctx: LinuxContext): Promise<void>;
  /** Install docker: from packages already listed, or the upstream script. */
  installDocker(ctx: LinuxContext): Promise<void>;
  /** Install LLVM's `major`: apt.llvm.org's llvm.sh, or the distro's
   * versioned packages. */
  installLlvm(ctx: LinuxContext): Promise<void>;
  /** Drop the package cache before capture. */
  cleanCache(): Promise<void>;
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

/** True when apt has an installable candidate for a package (renamed
 * packages, libasound2 → libasound2t64). A query of the TARGET's package
 * database; off-target (dry-run) plan with the first candidate. */
async function aptHasCandidate(name: string): Promise<boolean> {
  if (mode.dryRun) {
    log(`[dry-run] would check whether apt knows "${name}" (assuming yes)`);
    return true;
  }
  const output = await runOutput(["apt-cache", "policy", name], { allowFailure: true });
  return output.includes(name) && !/Candidate: \(none\)/.test(output);
}

export const apt: PackageManager = {
  name: "apt",
  userFlavor: "shadow",
  cmakeIsPackaged: false,
  pythonFuseIsPackaged: true,
  systemd: true,
  async updateIndex() {
    await sudo(["apt-get", "update", "-y"], { env: { DEBIAN_FRONTEND: "noninteractive" } });
  },
  async install(_ctx, packages) {
    await installLogged("apt", packages, () =>
      sudo(["apt-get", "install", "--yes", "--no-install-recommends", "--fix-missing", ...packages], {
        env: { DEBIAN_FRONTEND: "noninteractive" },
      }).then(() => undefined),
    );
  },
  async afterBuildEssentials(ctx) {
    // alsa: newer ubuntu renamed libasound2 → libasound2t64.
    for (const candidate of ["libasound2t64", "libasound2"]) {
      if (await aptHasCandidate(candidate)) {
        await this.install(ctx, [candidate]);
        break;
      }
    }
  },
  async installDocker(ctx) {
    const script = await download(artifact(ctx.artifacts, "dockerInstaller"), { name: "get-docker.sh" });
    await sudo(["sh", script]);
    await enableService("docker", { start: false });
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
  async cleanCache() {
    await sudo(["apt-get", "clean"]);
    await shellScript({ describe: "drop apt package lists", root: true, script: "rm -rf /var/lib/apt/lists/*" });
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
  systemd: false,
  async updateIndex() {
    await sudo(["apk", "update"]);
  },
  async install(_ctx, packages) {
    await installLogged("apk", packages, () =>
      sudo(["apk", "add", "--no-cache", "--no-interactive", "--no-progress", ...packages]).then(() => undefined),
    );
  },
  async afterBuildEssentials() {},
  async installDocker() {
    // docker + compose come from the apk package list.
    await enableService("docker", { start: true });
  },
  async installLlvm(ctx) {
    // Alpine ships LLVM as versioned apk packages (llvm{N}, clang{N}, ...),
    // listed on the image's packages.llvm.
    await this.install(ctx, ctx.image.packages.llvm);
  },
  async cleanCache() {
    await shellScript({ describe: "drop apk cache", root: true, script: "rm -rf /var/cache/apk/*" });
  },
};

/** The manager for an image, from its spec fact. Resolved in the generated
 * per-image entry, so a bundle contains only one implementation. */
export function managerFor(manager: "apt" | "apk"): PackageManager {
  return manager === "apk" ? apk : apt;
}
