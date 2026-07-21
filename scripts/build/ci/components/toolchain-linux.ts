// The build toolchain on a linux image: CMake, LLVM/clang, python-fuse (the
// alpine source build), Rust, Docker, and Tailscale. Each is its own
// component so an image's spec entry lists exactly which it carries and in
// what order; the install recipes read every fact (versions, URLs, homes,
// package lists) from that entry.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cmakeDownload, pythonFuseDownload } from "../artifacts.ts";
import {
  addUserToGroup,
  enableService,
  ensureDirectory,
  extractArchive,
  setModeRecursive,
  shellScript,
  verify,
} from "../bootstrap/ops-posix.ts";
import { download, ensureLines, log, run, runOutput, scratchDir, sudo } from "../bootstrap/runtime.ts";
import * as win from "../bootstrap/ops-windows.ts";
import type { Component } from "./component.ts";
import { artifact } from "./component.ts";
import { appendToProfiles } from "./environment.ts";
import { installPackages } from "./system-linux.ts";

/** Kitware's self-extracting CMake installer on apt distros; alpine uses
 * its package. */
export const cmake: Component = {
  name: "cmake",
  linux: {
    artifacts: image => ({ cmake: cmakeDownload(image.cmake, image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install CMake ${image.cmake.version}`,
          skip: image.packages.manager === "apk" && "cmake is an apk package on alpine",
          run: async () => {
            const installer = await download(artifact(ctx.artifacts, "cmake"));
            await sudo(["sh", installer, "--skip-license", "--prefix=/usr"]);
            await verify("cmake --version runs", () => run(["cmake", "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
};

/** LLVM/clang: apt.llvm.org's llvm.sh on apt distros, the distro's llvm
 * packages on apk. */
export const llvm: Component = {
  name: "llvm",
  linux: {
    artifacts: image => ({ llvmScript: { url: image.llvm.aptScriptUrl, sha256: null } }),
    steps: ctx => {
      const { image } = ctx;
      const { llvm } = image;
      return [
        {
          name: `Install LLVM ${llvm.major} (${llvm.version})`,
          run: async () => {
            if (image.packages.manager === "apt") {
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
              await installPackages(ctx, [`llvm-${llvm.major}-tools`]);
              // The full LLVM bin dir on PATH so unversioned llvm-objcopy,
              // llvm-strip, llvm-ar etc. resolve (debian only symlinks a subset).
              await appendToProfiles(ctx, [`export PATH="/usr/lib/llvm-${llvm.major}/bin:$PATH"`]);
            } else {
              await installPackages(ctx, image.packages.llvm);
            }
            await verify(`clang-${llvm.major} runs`, async () => {
              const clangVersion = await runOutput([`clang-${llvm.major}`, "--version"]);
              log(`clang: ${clangVersion.split("\n")[0]}`);
            });
          },
        },
      ];
    },
  },
};

/** python-fuse built from source on alpine (no wheel); apt distros use
 * the python3-fuse package. Sequenced after the build essentials, which
 * provide the python + build-base this needs (ordering is data in spec). */
export const pythonFuse: Component = {
  name: "python-fuse",
  linux: {
    artifacts: image => ({ pythonFuse: pythonFuseDownload(image.pythonFuse) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install python-fuse ${image.pythonFuse.version} from source`,
          skip: image.packages.manager !== "apk" && "packaged as python3-fuse on this distro",
          run: async () => {
            // alpine has no wheel: build/install from source (needs the python
            // + build-base from "Install build essentials" above), and load
            // the fuse kernel module on boot.
            const tarball = await download(artifact(ctx.artifacts, "pythonFuse"));
            await extractArchive({ file: tarball, into: scratchDir });
            const src = join(scratchDir, `python-fuse-${image.pythonFuse.version}`);
            await run(["python", "setup.py", "build"], { cwd: src });
            await sudo(["python", "setup.py", "install"], { cwd: src });
            await ensureLines("/etc/modules-load.d/fuse.conf", ["fuse"]);
            await verify("python can import fuse", () => run(["python", "-c", "import fuse"]).then(() => undefined));
          },
        },
      ];
    },
  },
};

/** Rust via rustup into the image's rust home, plus the cross targets and
 * components the spec lists. */
export const rust: Component = {
  name: "rust",
  linux: {
    artifacts: image => ({ rustup: { url: image.rust.rustupUrl, sha256: null } }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: "Install Rust (rustup + cross targets)",
          run: async () => {
            const { rust } = image;
            const env = { RUSTUP_HOME: rust.home, CARGO_HOME: rust.home };
            await ensureDirectory(rust.home);
            const installer = await download(artifact(ctx.artifacts, "rustup"), { name: "rustup-init.sh" });
            await sudo(["sh", installer, "-y", "--no-modify-path"], { env });
            await appendToProfiles(ctx, [
              `export RUSTUP_HOME=${rust.home}`,
              `export CARGO_HOME=${rust.home}`,
              `export PATH="${rust.home}/bin:$PATH"`,
            ]);
            const rustup = join(rust.home, "bin", "rustup");
            for (const target of rust.targets) await sudo([rustup, "target", "add", target], { env });
            for (const component of rust.components) await sudo([rustup, "component", "add", component], { env });
            // The build user (buildkite-agent) runs cargo; the tree must be
            // writable by everyone who builds.
            await setModeRecursive(rust.home, "a+rwX");
            await verify("rustc --version runs", () =>
              run([join(rust.home, "bin", "rustc"), "--version"], { env }).then(() => undefined),
            );
          },
        },
      ];
    },
  },
  windows: {
    artifacts: image => ({ rustupInit: { url: image.rust.rustupUrl, sha256: null } }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: "Install Rust (rustup)",
          run: async () => {
            if (await win.commandOnPath("rustc")) {
              log("rustc already installed");
              return;
            }
            const home = image.rust.home;
            await win.ensureDirectory(home);
            const init = await download(artifact(ctx.artifacts, "rustupInit"), { name: "rustup-init.exe" });
            // Install paths must be set in the SAME process that runs rustup so
            // it installs directly under Program Files (not SYSTEM's profile).
            await win.powershellScript({
              describe: `run rustup-init with CARGO_HOME/RUSTUP_HOME under ${home}`,
              script: `$env:CARGO_HOME = ${win.psq(`${home}\\cargo`)}
$env:RUSTUP_HOME = ${win.psq(`${home}\\rustup`)}
& ${win.psq(init)} -y
if ($LASTEXITCODE -ne 0) { throw "rustup-init failed: $LASTEXITCODE" }`,
            });
            await win.setMachineEnv("CARGO_HOME", `${home}\\cargo`);
            await win.setMachineEnv("RUSTUP_HOME", `${home}\\rustup`);
            await win.addToMachinePath(`${home}\\cargo\\bin`);
            await win.verify("rustc --version runs", () =>
              run([`${home}\\cargo\\bin\\rustc.exe`, "--version"]).then(() => undefined),
            );
          },
        },
      ];
    },
  },
};

/** Docker: the get-docker.sh installer on apt distros; alpine's docker +
 * compose come from the apk package list, so there it's just enabled. */
export const docker: Component = {
  name: "docker",
  linux: {
    artifacts: image => ({ dockerInstaller: { url: image.dockerInstallUrl, sha256: null } }),
    steps: ctx => {
      const { image, host } = ctx;
      return [
        {
          name: "Install Docker",
          run: async () => {
            if (image.packages.manager === "apk") {
              // docker + compose come from the apk package list.
              await enableService("docker", { start: true });
            } else {
              const script = await download(artifact(ctx.artifacts, "dockerInstaller"), { name: "get-docker.sh" });
              await sudo(["sh", script]);
              await enableService("docker", { start: false });
            }
            await addUserToGroup(host.user, "docker");
            await verify("docker --version runs", () => run(["docker", "--version"]).then(() => undefined));
          },
        },
      ];
    },
  },
};

/** Tailscale, for SSH access to live CI agents (FLOATING installer). */
export const tailscale: Component = {
  name: "tailscale",
  linux: {
    artifacts: image => ({ tailscaleInstaller: { url: image.tailscaleInstallUrl, sha256: null } }),
    steps: ctx => [
      {
        name: "Install Tailscale (SSH access to live agents)",
        skip: !ctx.ci && "not a CI image",
        run: async () => {
          // FLOATING: tailscale's install script picks the current package.
          const script = await download(artifact(ctx.artifacts, "tailscaleInstaller"), { name: "tailscale-install.sh" });
          await sudo(["sh", script]);
        },
      },
    ],
  },
};
