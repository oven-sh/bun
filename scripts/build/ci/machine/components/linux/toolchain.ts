// The build toolchain on a linux image: CMake, LLVM/clang, python-fuse (the
// alpine source build), Rust, Docker, and Tailscale. Each is its own
// component so an image's spec entry lists exactly which it carries and in
// what order; the install recipes read every fact (versions, URLs, homes,
// package lists) from that entry.

import { join } from "node:path";
import { cmakeDownload, pythonFuseDownload } from "../../artifacts.ts";
import { addUserToGroup, ensureDirectory, extractArchive, setModeRecursive, verify } from "../../ops-posix.ts";
import { download, ensureLines, log, run, runOutput, scratchDir, sudo } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { appendToProfiles } from "../environment.ts";

/** Kitware's self-extracting CMake installer on apt distros; alpine uses
 * its package. */
export const cmake: LinuxComponent = {
  name: "cmake",
  artifacts: image => ({ cmake: cmakeDownload(image.cmake, image.arch) }),
  steps: ctx => {
    const { image, manager } = ctx;
    return [
      {
        name: `Install CMake ${image.cmake.version}`,
        skip: manager.cmakeIsPackaged && "cmake is a distro package on this image",
        run: async () => {
          const installer = await download(artifact(ctx.artifacts, "cmake"));
          await sudo(["sh", installer, "--skip-license", "--prefix=/usr"]);
          await verify("cmake --version runs", () => run(["cmake", "--version"]).then(() => undefined));
        },
      },
    ];
  },
};

/** LLVM/clang: apt.llvm.org's llvm.sh on apt distros, the distro's llvm
 * packages on apk. */
export const llvm: LinuxComponent = {
  name: "llvm",
  artifacts: image => ({ llvmScript: { url: image.llvm.aptScriptUrl, sha256: null } }),
  steps: ctx => {
    const { image, manager } = ctx;
    const { llvm } = image;
    return [
      {
        name: `Install LLVM ${llvm.major} (${llvm.version})`,
        run: async () => {
          await manager.installLlvm(ctx);
          await verify(`clang-${llvm.major} runs`, async () => {
            const clangVersion = await runOutput([`clang-${llvm.major}`, "--version"]);
            log(`clang: ${clangVersion.split("\n")[0]}`);
          });
        },
      },
    ];
  },
};

/** python-fuse built from source on alpine (no wheel); apt distros use
 * the python3-fuse package. Sequenced after the build essentials, which
 * provide the python + build-base this needs (ordering is data in spec). */
export const pythonFuse: LinuxComponent = {
  name: "python-fuse",
  artifacts: image => ({ pythonFuse: pythonFuseDownload(image.pythonFuse) }),
  steps: ctx => {
    const { image, manager } = ctx;
    return [
      {
        name: `Install python-fuse ${image.pythonFuse.version} from source`,
        skip: manager.pythonFuseIsPackaged && "packaged as python3-fuse on this distro",
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
};

/** Rust via rustup into the image's rust home, plus the cross targets and
 * components the spec lists. */
export const rust: LinuxComponent = {
  name: "rust",
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
};

/** Docker: the get-docker.sh installer on apt distros; alpine's docker +
 * compose come from the apk package list, so there it's just enabled. */
export const docker: LinuxComponent = {
  name: "docker",
  artifacts: image => ({ dockerInstaller: { url: image.dockerInstallUrl, sha256: null } }),
  steps: ctx => {
    const { image, host, manager } = ctx;
    return [
      {
        name: "Install Docker",
        run: async () => {
          await manager.installDocker(ctx);
          // The account that RUNS jobs needs the socket: buildkite-agent
          // on a CI image (created earlier by ci-user), the invoking user
          // when provisioning a plain machine.
          await addUserToGroup(ctx.ci ? image.paths.buildkiteUser : host.user, "docker");
          await verify("docker --version runs", () => run(["docker", "--version"]).then(() => undefined));
        },
      },
    ];
  },
};

/** Tailscale, for SSH access to live CI agents (FLOATING installer). */
export const tailscale: LinuxComponent = {
  name: "tailscale",
  artifacts: image => ({ tailscaleInstaller: { url: image.tailscaleInstallUrl, sha256: null } }),
  steps: ctx => [
    {
      name: "Install Tailscale (SSH access to live agents)",
      skip: !ctx.ci && "not a CI image",
      run: async () => {
        // FLOATING: tailscale's install script picks the current package.
        const script = await download(artifact(ctx.artifacts, "tailscaleInstaller"), {
          name: "tailscale-install.sh",
        });
        await sudo(["sh", script]);
      },
    },
  ],
};
