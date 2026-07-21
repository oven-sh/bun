// Linux image bootstrap: the steps that turn a fresh linux VM into a Bun CI
// image, driven entirely by a LinuxImage entry from spec.ts.
//
// Steps are recipes over the ops vocabulary in ./ops-posix.ts — they say
// what to do, the ops decide how (root, quoting, tool choice). Every fact
// (versions, URLs, package lists, paths) is read from the image entry;
// none is declared here. The few genuine scripts (sysroot assembly,
// symlink rewriting, runtime path discovery) use ops.shellScript() with a
// required description, so they read as labeled exceptions.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LinuxArtifacts } from "../artifacts.ts";
import { bunTriplet, nodejsFolderName } from "../artifacts.ts";
import type { CrossToolchains, LinuxImage } from "../types.ts";
import type { Host } from "./host.ts";
import {
  addUserToGroup,
  applySysctlFile,
  copyIntoDirectory,
  disableServiceNow,
  enableService,
  ensureDirectory,
  ensureSymlink,
  ensureSystemUser,
  extractArchive,
  installFile,
  maskUnit,
  moveFile,
  reloadServiceManager,
  removePaths,
  setModeRecursive,
  setOwnerRecursive,
  shellScript,
  trimFilesystems,
  verify,
} from "./ops-posix.ts";
import type { Step } from "./runtime.ts";
import { download, ensureLines, log, mode, run, runOutput, scratchDir, sudo, warn, which, writeText } from "./runtime.ts";

/** Context every linux step needs. */
export type LinuxContext = {
  image: LinuxImage;
  host: Host;
  /** Building a CI image (creates the buildkite user, prefetch caches,
   * tuning, cleanup). False for a plain dev machine. */
  ci: boolean;
  /** Ref of the repo to clone for the prefetch caches. */
  repoRef: string;
  /** The resolved download bundle for this image — the same object the
   * image hash covers, so what is fetched and what is hashed can't diverge. */
  artifacts: LinuxArtifacts;
};

const BIN = "/usr/local/bin";

// ---------------------------------------------------------------------------
// Package manager
// ---------------------------------------------------------------------------

/** Install packages with the image's package manager, non-interactively. */
async function installPackages(ctx: LinuxContext, packages: readonly string[]): Promise<void> {
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

/** True when apt has an installable candidate for a package (used for
 * renamed packages, libasound2 → libasound2t64). A query of the TARGET's
 * package database; off-target (dry-run) plan with the first candidate. */
async function aptHasCandidate(name: string): Promise<boolean> {
  if (mode.dryRun) {
    log(`[dry-run] would check whether apt knows "${name}" (assuming yes)`);
    return true;
  }
  const output = await runOutput(["apt-cache", "policy", name], { allowFailure: true });
  return output.includes(name) && !/Candidate: \(none\)/.test(output);
}

// ---------------------------------------------------------------------------
// Base system
// ---------------------------------------------------------------------------

export function baseSystemSteps(ctx: LinuxContext): Step[] {
  const { image, host, ci } = ctx;
  return [
    {
      name: "Verify host matches the spec image entry",
      run: () => {
        const problems: string[] = [];
        if (host.os !== image.os) problems.push(`os: host=${host.os} spec=${image.os}`);
        if (host.arch !== image.arch) problems.push(`arch: host=${host.arch} spec=${image.arch}`);
        if (host.distro !== image.distro) problems.push(`distro: host=${host.distro} spec=${image.distro}`);
        if (host.abi !== undefined && host.abi !== image.abi) problems.push(`abi: host=${host.abi} spec=${image.abi}`);
        if (host.packageManager !== image.packages.manager) {
          problems.push(`package manager: host=${host.packageManager} spec=${image.packages.manager}`);
        }
        if (problems.length) {
          const message =
            `This machine does not match image "${image.key}":\n  - ${problems.join("\n  - ")}\n` +
            `Refusing to bake: bootstrap was pointed at the wrong image entry or launched on the wrong base image.`;
          if (!mode.dryRun) throw new Error(message);
          // Dry-run reviews the plan from any machine, so a mismatch is
          // expected there — report it and keep planning.
          warn(`${message}\n(dry-run: continuing to print the plan anyway)`);
          return;
        }
        log(`Host matches spec image "${image.key}".`);
      },
    },
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
        // capped (systemd needs "infinity" where limits.conf says "unlimited").
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
  ];
}

// ---------------------------------------------------------------------------
// Language runtimes and tools
// ---------------------------------------------------------------------------

export function nodejsSteps(ctx: LinuxContext): Step[] {
  const { image, host } = ctx;
  const { nodejs } = image;
  return [
    {
      name: `Install Node.js ${nodejs.version}`,
      run: async () => {
        // Extract the pinned release and lay bin/, lib/, include/, share/
        // over /usr/local (npm/npx symlinks into ../lib/node_modules).
        const tarball = await download(ctx.artifacts.nodejs);
        await extractArchive({ file: tarball, into: scratchDir });
        const extracted = join(scratchDir, nodejsFolderName(nodejs, "linux", image.arch, image.abi));
        for (const dir of ["bin", "lib", "include", "share"]) {
          await copyIntoDirectory(join(extracted, dir), join("/usr/local", dir));
        }
        await verify(`${BIN}/node --version prints v${nodejs.version}`, async () => {
          const version = await runOutput([`${BIN}/node`, "--version"]);
          if (version !== `v${nodejs.version}`) throw new Error(`got "${version}"`);
        });
      },
    },
    {
      name: `Pre-seed Node.js ${nodejs.version} headers for node-gyp`,
      run: async () => {
        // So node-gyp never downloads headers at test time.
        const tarball = await download(ctx.artifacts.nodejsHeaders);
        await extractArchive({ file: tarball, into: scratchDir });
        const extracted = join(scratchDir, `node-v${nodejs.version}`);
        await copyIntoDirectory(join(extracted, "include"), "/usr/local/include");
        const cache = join(host.home, ".cache", "node-gyp", nodejs.version);
        const libArch = image.arch === "aarch64" ? "arm64" : "x64";
        await ensureDirectory(join(cache, "lib", libArch));
        await copyIntoDirectory(join(extracted, "include"), join(cache, "include"));
        await writeText(join(cache, "installVersion"), `${nodejs.gypInstallVersion}\n`);
        await setOwnerRecursive(join(host.home, ".cache"), host.user);
      },
    },
    {
      name: `Install Bun ${image.bun.version}`,
      run: async () => {
        const zip = await download(ctx.artifacts.bun);
        await extractArchive({ file: zip, into: scratchDir });
        const triplet = bunTriplet("linux", image.arch, image.abi);
        await installFile({ from: join(scratchDir, triplet, "bun"), to: `${BIN}/bun`, mode: "755" });
        await ensureSymlink(`${BIN}/bun`, `${BIN}/bunx`);
        await verify("bun --version runs", async () => {
          log(`bun ${await runOutput([`${BIN}/bun`, "--version"])} installed`);
        });
      },
    },
    {
      name: `Install curl-h3 ${image.curlH3.version} (HTTP/3 test client)`,
      run: async () => {
        // Static curl with nghttp3/ngtcp2, kept separate from the system
        // curl so nothing else changes behavior. Tests find it via
        // $CURL_HTTP3, then `curl-h3` in PATH.
        const tarball = await download(ctx.artifacts.curlH3);
        await extractArchive({ file: tarball, into: scratchDir, members: ["curl"] });
        await installFile({ from: join(scratchDir, "curl"), to: `${BIN}/curl-h3`, mode: "755" });
        await appendToProfiles(ctx, [`export CURL_HTTP3=${BIN}/curl-h3`]);
        await verify("curl-h3 --version runs", () => run([`${BIN}/curl-h3`, "--version"]).then(() => undefined));
      },
    },
    {
      name: `Install age ${image.age.version}`,
      run: async () => {
        const tarball = await download(ctx.artifacts.age);
        await extractArchive({ file: tarball, into: scratchDir, members: ["age/age"] });
        await installFile({ from: join(scratchDir, "age", "age"), to: `${BIN}/age`, mode: "755" });
      },
    },
    {
      name: `Install python-fuse ${image.pythonFuse.version} from source`,
      skip: image.packages.manager !== "apk" && "packaged as python3-fuse on this distro",
      run: async () => {
        // alpine has no wheel: build/install from source, and load the fuse
        // kernel module on boot.
        const tarball = await download(ctx.artifacts.pythonFuse);
        await extractArchive({ file: tarball, into: scratchDir });
        const src = join(scratchDir, `python-fuse-${image.pythonFuse.version}`);
        await run(["python", "setup.py", "build"], { cwd: src });
        await sudo(["python", "setup.py", "install"], { cwd: src });
        await ensureLines("/etc/modules-load.d/fuse.conf", ["fuse"]);
        await verify("python can import fuse", () => run(["python", "-c", "import fuse"]).then(() => undefined));
      },
    },
  ];
}

export function toolchainSteps(ctx: LinuxContext): Step[] {
  const { image, host } = ctx;
  const { llvm } = image;
  return [
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
    {
      name: `Install CMake ${image.cmake.version}`,
      skip: image.packages.manager === "apk" && "cmake is an apk package on alpine",
      run: async () => {
        const installer = await download(ctx.artifacts.cmake);
        await sudo(["sh", installer, "--skip-license", "--prefix=/usr"]);
        await verify("cmake --version runs", () => run(["cmake", "--version"]).then(() => undefined));
      },
    },
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
          const script = await download(ctx.artifacts.llvmScript, { name: "llvm.sh" });
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
    {
      name: "Install Rust (rustup + cross targets)",
      run: async () => {
        const { rust } = image;
        const env = { RUSTUP_HOME: rust.home, CARGO_HOME: rust.home };
        await ensureDirectory(rust.home);
        const installer = await download(ctx.artifacts.rustup, { name: "rustup-init.sh" });
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
        await verify("rustc --version runs", () => run([join(rust.home, "bin", "rustc"), "--version"], { env }).then(() => undefined));
      },
    },
    {
      name: "Install Docker",
      run: async () => {
        if (image.packages.manager === "apk") {
          // docker + compose come from the apk package list.
          await enableService("docker", { start: true });
        } else {
          const script = await download(ctx.artifacts.dockerInstaller, { name: "get-docker.sh" });
          await sudo(["sh", script]);
          await enableService("docker", { start: false });
        }
        await addUserToGroup(host.user, "docker");
        await verify("docker --version runs", () => run(["docker", "--version"]).then(() => undefined));
      },
    },
    {
      name: "Install Tailscale (SSH access to live agents)",
      skip: !ctx.ci && "not a CI image",
      run: async () => {
        // FLOATING: tailscale's install script picks the current package.
        const script = await download(ctx.artifacts.tailscaleInstaller, { name: "tailscale-install.sh" });
        await sudo(["sh", script]);
      },
    },
  ];
}

/** Chromium runtime for puppeteer-based tests (+ Chrome itself on x64). */
export function browserSteps(ctx: LinuxContext): Step[] {
  const { image } = ctx;
  const chromeDeb = ctx.artifacts.chromeDeb;
  return [
    {
      name: "Install Chromium test dependencies",
      run: () => installPackages(ctx, image.packages.chromium),
    },
    {
      name: "Install Google Chrome (system browser skips per-run Chrome-for-Testing download)",
      skip: !chromeDeb && "no Chrome .deb build for this image (x64 apt only)",
      run: async () => {
        // Best-effort: a Chrome install hiccup shouldn't fail the bake.
        const deb = await download(chromeDeb!, { name: "google-chrome.deb" });
        const result = await shellScript({
          describe: "install the Chrome .deb, letting apt resolve deps and falling back to dpkg",
          root: true,
          allowFailure: true,
          script: `apt-get install -y '${deb}' || dpkg -i '${deb}'`,
        });
        if (result.exitCode !== 0) warn("Chrome install failed; puppeteer tests will download their own browser");
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Cross-compilation toolchains (build host only)
// ---------------------------------------------------------------------------

export function crossToolchainSteps(ctx: LinuxContext): Step[] {
  const { image } = ctx;
  if (!image.buildHost) return [];
  const cross = image.crossToolchains;
  const dl = ctx.artifacts.cross!;
  return [
    {
      name: "Install cross binutils + amd64 compiler-rt",
      run: async () => {
        await installPackages(ctx, cross.crossBinutils);
        // x64 asan cross needs amd64 compiler-rt. Best-effort: apt.llvm.org
        // may not carry amd64 on every arm64 repo.
        await sudo(["dpkg", "--add-architecture", "amd64"], { allowFailure: true });
        await sudo(["apt-get", "update", "-qq"], { allowFailure: true, env: { DEBIAN_FRONTEND: "noninteractive" } });
        const result = await sudo(
          ["apt-get", "install", "--yes", "--no-install-recommends", `libclang-rt-${image.llvm.major}-dev:amd64`],
          { allowFailure: true, env: { DEBIAN_FRONTEND: "noninteractive" } },
        );
        if (result.exitCode !== 0) warn("amd64 compiler-rt unavailable from apt.llvm.org; x64 asan cross-links may fail");
      },
    },
    {
      name: `Install Android NDK ${cross.androidNdk.version}`,
      run: () => installAndroidNdk(ctx, cross),
    },
    {
      name: `Install FreeBSD ${cross.freebsdSysroot.version} sysroots (amd64, arm64)`,
      run: () => installFreebsdSysroot(cross, dl),
    },
    {
      name: `Install linux-gnu sysroots (ubuntu 20.04 / glibc ${cross.glibcSysroot.glibcVersion} + gcc-13)`,
      run: () => installGlibcSysroot(cross, dl),
    },
    {
      name: `Install linux-musl sysroots (alpine ${cross.muslSysroot.alpineRelease})`,
      run: () => installMuslSysroot(ctx, cross),
    },
    {
      name: `Install Windows sysroot (xwin ${cross.winSysroot.xwinVersion}: SDK ${cross.winSysroot.sdkVersion}, CRT ${cross.winSysroot.crtVersion})`,
      run: () => installWindowsSysroot(cross, dl),
    },
    {
      name: `Install macOS ${cross.macosSdk.version} SDK`,
      run: () => installMacosSdk(ctx, cross),
    },
  ];
}

async function installAndroidNdk(ctx: LinuxContext, cross: CrossToolchains): Promise<void> {
  const ndk = cross.androidNdk;
  if (existsSync(ndk.path)) {
    log(`${ndk.path} already exists; reusing`);
  } else {
    const zip = await download(ctx.artifacts.cross!.androidNdk);
    await extractArchive({ file: zip, into: "/opt", root: true });
    await moveFile(`/opt/android-ndk-${ndk.version}`, ndk.path);
    // Trim ~1.1GB we don't use (NDK's own clang/lld, lldb, non-android
    // runtimes) — we only need sysroot + android compiler-rt.
    const prebuilt = `${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64`;
    await removePaths(
      `${prebuilt}/bin`,
      `${prebuilt}/python3`,
      `${prebuilt}/lib/liblldb.so`,
      `${ndk.path}/simpleperf`,
      `${ndk.path}/shader-tools`,
      `${ndk.path}/sources`,
    );
    await appendToProfiles(ctx, [`export ANDROID_NDK_ROOT=${ndk.path}`]);
  }
  // clang's driver hardcodes <resource-dir>/lib/<triple>/libclang_rt.*
  // with no -L fallback, so the file must exist there for any android
  // link. Done as root so the build user needs no write access to /usr.
  // Both dirs are discovered at run time (they exist only after extraction
  // and the LLVM install), hence a script.
  await shellScript({
    describe: "symlink NDK compiler-rt builtins + libunwind into the host clang resource dir (flat + per-triple layouts)",
    root: true,
    script: `set -e
CLANG="$(command -v clang-${ctx.image.llvm.major} || command -v clang)"
RES="$($CLANG -print-resource-dir)"
NDK_CLANG_VER="$(ls "${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/" | head -1)"
NDK_RT="${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/$NDK_CLANG_VER/lib/linux"
echo "clang resource dir: $RES"
echo "NDK clang runtime: $NDK_RT"
mkdir -p "$RES/lib/linux"
for A in aarch64 x86_64; do
  ln -sfv "$NDK_RT/libclang_rt.builtins-$A-android.a" "$RES/lib/linux/"
  mkdir -p "$RES/lib/linux/$A"
  ln -sfv "$NDK_RT/$A/libunwind.a" "$RES/lib/linux/$A/"
  T="$RES/lib/$A-unknown-linux-android28"
  mkdir -p "$T"
  ln -sfv "$NDK_RT/libclang_rt.builtins-$A-android.a" "$T/libclang_rt.builtins.a"
  ln -sfv "$NDK_RT/$A/libunwind.a" "$T/libunwind.a"
done`,
  });
}

async function installFreebsdSysroot(cross: CrossToolchains, dl: NonNullable<LinuxArtifacts["cross"]>): Promise<void> {
  for (const fbsdArch of ["amd64", "arm64"] as const) {
    const sysroot = cross.freebsdSysroot.paths[fbsdArch];
    // Same sentinel detectFreebsdSysroot() uses, plus a /lib file so a
    // half-extracted (interrupted) sysroot isn't treated as complete.
    if (existsSync(`${sysroot}/usr/include/sys/param.h`) && existsSync(`${sysroot}/lib/libc.so.7`)) {
      log(`${sysroot} already complete; reusing`);
      continue;
    }
    await removePaths(sysroot);
    await ensureDirectory(sysroot);
    const baseTxz = await download(dl.freebsdBase[fbsdArch], { name: `freebsd-${fbsdArch}-base.txz` });
    await extractArchive({ file: baseTxz, into: sysroot, members: ["./usr/include", "./usr/lib", "./lib"], root: true });
  }
  // No FREEBSD_SYSROOT export — detectFreebsdSysroot() picks the
  // arch-appropriate path by well-known location.
}

async function installGlibcSysroot(cross: CrossToolchains, dl: NonNullable<LinuxArtifacts["cross"]>): Promise<void> {
  const g = cross.glibcSysroot;
  for (const srArch of ["x86_64", "aarch64"] as const) {
    const sysroot = g.paths[srArch];
    const debArch = srArch === "x86_64" ? "amd64" : "arm64";
    const triple = `${srArch}-linux-gnu`;
    if (existsSync(`${sysroot}/usr/include/features.h`) && existsSync(`${sysroot}/usr/include/c++/13`)) {
      log(`${sysroot} already complete; reusing`);
      continue;
    }
    await removePaths(sysroot);
    await ensureDirectory(sysroot);
    // Inputs fetched up front (logged, checksummed where pinned); the
    // assembly below is one script because each stage feeds the next.
    const packagesFiles: string[] = [];
    for (const [i, pkgIndex] of dl.ubuntuPackagesGz[srArch].entries()) {
      packagesFiles.push(await download(pkgIndex, { name: `Packages-${srArch}-${i}.gz` }));
    }
    const gcc13 = await download(dl.gcc13FocalDebs[debArch]);
    const lib64 =
      srArch === "x86_64"
        ? `if [ ! -e '${sysroot}/lib64' ]; then ln -sfn 'usr/lib/${triple}' '${sysroot}/lib64'; fi`
        : "true";
    await shellScript({
      describe:
        `assemble ${sysroot}: ubuntu:20.04 rootfs layers via skopeo, focal libc dev debs resolved ` +
        `from the Packages index, symlinks rewritten to stay inside the sysroot, gcc-13 libstdc++ overlaid`,
      root: true,
      script: `set -ex
tmp="$(mktemp -d)"
# 1. ubuntu:20.04 rootfs (glibc 2.31 runtime libs). Raw tar: mknod failures
#    on /dev nodes must not abort; the libc6 deb below provides what we need.
skopeo copy --override-arch ${debArch} docker://${g.ubuntuImage} dir:$tmp/img
for d in $(jq -r '.layers[].digest' $tmp/img/manifest.json | sed 's/^sha256://'); do
  tar -xzf "$tmp/img/$d" -C '${sysroot}' 2>/dev/null || true
done
# 2. focal runtime + dev headers: resolve each package's .deb path from the
#    Packages index (focal-updates listed first so first-match is patched).
gzip -dc ${packagesFiles.map(f => `'${f}'`).join(" ")} > $tmp/Packages
for pkg in ${g.packages.join(" ")}; do
  path=$(awk -v p="$pkg" '$1=="Package:"&&$2==p{f=1} f&&$1=="Filename:"{print $2; exit}' $tmp/Packages)
  if [ -z "$path" ]; then echo "package $pkg not found in focal Packages index" >&2; exit 1; fi
  curl -fsSL "${g.aptBase[srArch]}/$path" -o "$tmp/$pkg.deb"
  dpkg-deb -x "$tmp/$pkg.deb" '${sysroot}'
done
# 3. Absolute symlinks from the debs point at host paths; rewrite them to
#    stay inside the sysroot so -lpthread/-ldl resolve to target libs.
find '${sysroot}' -type l 2>/dev/null | while read -r l; do
  t="$(readlink "$l")"
  case "$t" in /*) ln -sfn "${sysroot}$t" "$l" ;; esac
done
# libc.so's linker script uses absolute /lib/<triple>/ paths; make them
# resolve inside the sysroot (usrmerge-style symlink if missing).
if [ ! -e '${sysroot}/lib/${triple}/libc.so.6' ]; then
  mkdir -p '${sysroot}/lib'
  ln -sfn '../usr/lib/${triple}' '${sysroot}/lib/${triple}'
fi
${lib64}
# 4. gcc-13 (libstdc++-13-dev, libgcc-13-dev) from the mirrored release
#    the WebKit Dockerfile uses.
mkdir -p $tmp/gcc13
tar -xzf '${gcc13}' -C $tmp/gcc13
for deb in $tmp/gcc13/*.deb; do dpkg-deb -x "$deb" '${sysroot}'; done
rm -rf "$tmp"`,
    });
    await verify(`${sysroot} has usr/include/c++/13 after the gcc-13 overlay`, () => {
      if (!existsSync(`${sysroot}/usr/include/c++/13`)) throw new Error(`${sysroot} missing usr/include/c++/13`);
    });
    log(`installed: ${sysroot} (ubuntu:20.04 glibc ${g.glibcVersion} + gcc-13 libstdc++)`);
  }
}

async function installMuslSysroot(ctx: LinuxContext, cross: CrossToolchains): Promise<void> {
  const m = cross.muslSysroot;
  const cdn = `${m.cdnBase}/v${m.alpineRelease}`;
  // apk.static (host arch) can install foreign-arch packages into any
  // root. The host machine follows from the spec arch (this only runs on
  // the build host). apk.static's version is discovered from the repo
  // index at run time (FLOATING), so this is a script.
  const hostMachine = ctx.image.arch === "aarch64" ? "aarch64" : "x86_64";
  const perArch = (["x86_64", "aarch64"] as const)
    .map(
      mlArch => `
sysroot='${m.paths[mlArch]}'
if [ -f "$sysroot/usr/lib/libc.so" ]; then
  echo "$sysroot already complete; reusing"
else
  rm -rf "$sysroot"; mkdir -p "$sysroot"
  "$APK" --arch ${mlArch} --root "$sysroot" --repository '${cdn}/main' \\
    --allow-untrusted --no-cache --initdb add ${m.packages.join(" ")}
  if [ ! -f "$sysroot/usr/lib/libc.so" ]; then echo "$sysroot not populated" >&2; exit 1; fi
  echo "installed: $sysroot"
fi`,
    )
    .join("\n");
  await shellScript({
    describe: `populate the musl sysroots for x86_64 + aarch64 from alpine ${m.alpineRelease} via apk.static`,
    root: true,
    script: `set -ex
tmp="$(mktemp -d)"; cd "$tmp"
curl -fsSL '${cdn}/main/${hostMachine}/APKINDEX.tar.gz' -o APKINDEX.tar.gz
APK_VER="$(tar -xzOf APKINDEX.tar.gz APKINDEX 2>/dev/null | awk '/^P:apk-tools-static$/{f=1} f&&/^V:/{print substr($0,3); exit}')"
if [ -z "$APK_VER" ]; then echo "could not resolve apk-tools-static version" >&2; exit 1; fi
echo "apk-tools-static version: $APK_VER"
curl -fsSL "${cdn}/main/${hostMachine}/apk-tools-static-$APK_VER.apk" -o apk-tools-static.apk
tar -xzf apk-tools-static.apk sbin/apk.static
APK="$tmp/sbin/apk.static"
${perArch}
rm -rf "$tmp"`,
  });
  // No LINUX_MUSL_SYSROOT export: detectLinuxMuslSysroot() picks the
  // arch-appropriate path by well-known location.
}

async function installWindowsSysroot(cross: CrossToolchains, dl: NonNullable<LinuxArtifacts["cross"]>): Promise<void> {
  const w = cross.winSysroot;
  const sysroot = w.path;
  // MSVC CRT/STL + Windows SDK splat for --os=windows cross-compiles, laid
  // out like a Visual Studio install so clang-cl/lld-link's /winsysroot
  // works. Same completeness sentinel scripts/build/winsysroot.ts uses.
  const complete =
    (existsSync(`${sysroot}/Windows Kits/10/lib`) || existsSync(`${sysroot}/Windows Kits/10/Lib`)) &&
    existsSync(`${sysroot}/VC/Tools/MSVC`);
  if (complete) {
    log(`${sysroot} already complete; reusing`);
    return;
  }
  const tarball = await download(dl.xwin);
  const xwinDir = join(scratchDir, "xwin");
  await extractArchive({ file: tarball, into: xwinDir, stripComponents: 1 });
  await removePaths(sysroot, `${sysroot}.cache`);
  await ensureDirectory(sysroot);
  // The cache must be on the same filesystem as the output: splat moves
  // files with rename(2), which fails EXDEV when scratch is tmpfs and
  // /opt is not.
  await ensureDirectory(`${sysroot}.cache`);
  // Both target arches in one splat; --include-debug-libs so /MTd (debug
  // CRT) links work; --include-atl for <atlstr.h>; winsysroot-style + MS
  // arch notation so clang-cl and lld-link resolve it with /winsysroot.
  await sudo([
    join(xwinDir, "xwin"),
    "--accept-license",
    "--arch",
    "x86_64,aarch64",
    "--sdk-version",
    w.sdkVersion,
    "--crt-version",
    w.crtVersion,
    "--include-atl",
    "--cache-dir",
    `${sysroot}.cache`,
    "splat",
    "--use-winsysroot-style",
    "--preserve-ms-arch-notation",
    "--include-debug-libs",
    "--output",
    sysroot,
  ]);
  // clang-cl/lld-link compose SDK paths as "Include"/"Lib" (title case);
  // the winsysroot-style splat writes lowercase — alias both spellings.
  await ensureSymlink("include", `${sysroot}/Windows Kits/10/Include`);
  await ensureSymlink("lib", `${sysroot}/Windows Kits/10/Lib`);
  await removePaths(xwinDir, `${sysroot}.cache`);
  await verify(`${sysroot} has an MSVC tree`, () => {
    if (!existsSync(`${sysroot}/VC/Tools/MSVC`)) throw new Error(`${sysroot}/VC/Tools/MSVC missing after splat`);
  });
}

async function installMacosSdk(ctx: LinuxContext, cross: CrossToolchains): Promise<void> {
  const sdk = cross.macosSdk;
  // macOS SDK for cross-compiling darwin from this linux host, fetched via
  // the repo's vendored xmac.mjs (from the bootstrapping ref) so the same
  // Apple-CDN download path is used here and at build time.
  // resolveMacosSdkPath() in scripts/build/macos-sdk.ts checks this path
  // before falling back to a per-job download. Same completeness sentinel.
  if (existsSync(`${sdk.path}/MacOSX${sdk.version}.sdk/usr/include/sys/syscall.h`)) {
    log(`${sdk.path} already complete; reusing`);
    return;
  }
  const xmac = await download(
    { url: ctx.artifacts.cross!.xmacRawTemplate.replace("{ref}", ctx.repoRef), sha256: null },
    { name: "xmac.mjs" },
  );
  const staging = join(scratchDir, "macos-sdk");
  await run(["mkdir", "-p", staging]);
  await run([
    `${BIN}/bun`,
    xmac,
    "splat",
    "--accept-license",
    "--sdk-only",
    "--release",
    sdk.cltRelease,
    "--sdk",
    sdk.version,
    "--output",
    staging,
    "--cache-dir",
    `${staging}/cache`,
  ]);
  await removePaths(sdk.path);
  await ensureDirectory(sdk.path);
  await moveFile(`${staging}/SDKs/MacOSX${sdk.version}.sdk`, `${sdk.path}/`);
  await setModeRecursive(sdk.path, "a+rX");
  await verify(`${sdk.path}/MacOSX${sdk.version}.sdk is present`, () => {
    if (!existsSync(`${sdk.path}/MacOSX${sdk.version}.sdk/usr/include/sys/syscall.h`)) {
      throw new Error("macOS SDK missing after splat");
    }
  });
}

// ---------------------------------------------------------------------------
// CI image state (buildkite user, agent, caches, tuning, cleanup)
// ---------------------------------------------------------------------------

export function ciSteps(ctx: LinuxContext): Step[] {
  const { image, ci } = ctx;
  const { paths } = image;
  return [
    {
      name: "Create buildkite-agent user, dirs, and hooks",
      skip: !ci && "not a CI image",
      run: async () => {
        const user = paths.buildkiteUser;
        const home = paths.buildkiteHome;
        await ensureSystemUser({
          name: user,
          home,
          shell: "/bin/sh",
          flavor: image.distro === "alpine" ? "busybox" : "shadow",
        });
        await addUserToGroup(user, "docker");
        for (const dir of [home, ...paths.buildkiteDirs]) {
          await ensureDirectory(dir, { owner: `${user}:${user}` });
        }
        // Stable checkout directory so ccache is effective across jobs.
        const hooksDir = `${home}/hooks`;
        await ensureDirectory(hooksDir, { mode: "755" });
        await writeText(`${hooksDir}/environment`, `#!/bin/sh\nset -efu\n\nexport BUILDKITE_BUILD_CHECKOUT_PATH=${home}/build\n`, {
          mode: 0o755,
        });
        await setOwnerRecursive(hooksDir, `${user}:${user}`);
      },
    },
    {
      name: `Install buildkite-agent ${image.buildkiteAgent.version}`,
      skip: !ci && "not a CI image",
      run: async () => {
        const tarball = await download(ctx.artifacts.buildkiteAgent);
        await extractArchive({ file: tarball, into: scratchDir, members: ["buildkite-agent"] });
        await installFile({ from: join(scratchDir, "buildkite-agent"), to: `${BIN}/buildkite-agent`, mode: "755" });
        await verify("buildkite-agent --version runs", () => run([`${BIN}/buildkite-agent`, "--version"]).then(() => undefined));
      },
    },
    {
      name: "Warm the build prefetch cache and bun install cache",
      skip: !ci && "not a CI image",
      run: () => prefetchBuildDeps(ctx),
    },
    {
      name: "Configure core dumps",
      skip: process.env.BUN_NO_CORE_DUMP === "1" && "BUN_NO_CORE_DUMP=1",
      run: async () => {
        // A directory the test runner looks in after running tests
        // (scripts/runner.node.mjs derives the same path from the spec).
        const coresDir = paths.coresDirPattern
          .replace("{distro}", image.distro)
          .replace("{release}", image.release)
          .replace("{arch}", image.arch);
        await ensureDirectory(coresDir, { mode: "777" });
        // %e = executable filename, %p = pid
        await ensureLines("/etc/sysctl.d/local.conf", [`kernel.core_pattern = ${coresDir}/%e-%p.core`]);
        // apport overrides core_pattern where it exists.
        await disableServiceNow("apport.service");
        await applySysctlFile("/etc/sysctl.d/local.conf");
        await appendToProfiles(ctx, [`export PATH="/sbin:$PATH"`]);
      },
    },
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
          await shellScript({ describe: "drop apt package lists", root: true, script: "rm -rf /var/lib/apt/lists/*" });
        } else {
          await shellScript({ describe: "drop apk cache", root: true, script: "rm -rf /var/cache/apk/*" });
        }
        await trimFilesystems();
      },
    },
  ];
}

/**
 * CI-only: bake a read-only download cache for scripts/build/download.ts
 * (BUN_BUILD_PREFETCH_DIR), pre-pull test docker images, and warm a shared
 * `bun install` cache — all from a shallow clone of the bootstrapping ref.
 * Everything is content-addressed by URL/identity, so a dep bump after the
 * bake just misses the cache for that one dep: no re-bake needed. Every
 * sub-step is best-effort (a fork branch that isn't on the upstream remote,
 * a network blip) so a cache miss never fails a bake.
 */
async function prefetchBuildDeps(ctx: LinuxContext): Promise<void> {
  const { image, repoRef } = ctx;
  const { paths } = image;
  const bun = `${BIN}/bun`;
  const clone = join(scratchDir, "bun-repo");
  const cloned = await run(["git", "clone", "--depth=1", "--branch", repoRef, "https://github.com/oven-sh/bun.git", clone], {
    allowFailure: true,
  });
  if (cloned.exitCode !== 0) {
    warn(`clone of ref "${repoRef}" failed; baking without warm caches`);
    return;
  }
  if (!existsSync(join(clone, "scripts/prefetch-deps.ts")) && !mode.dryRun) {
    warn(`scripts/prefetch-deps.ts not present at ${repoRef}; skipping warm cache`);
    return;
  }

  // Read-only download cache. resolveConfig() walks up from cwd to find
  // package.json, so run from inside the clone.
  await ensureDirectory(paths.prefetchDir, { mode: "777" });
  const prefetch = await run([bun, "scripts/prefetch-deps.ts", paths.prefetchDir], { cwd: clone, allowFailure: true });
  if (prefetch.exitCode !== 0) {
    warn("prefetch-deps.ts failed; baking without warm download cache");
    await removePaths(paths.prefetchDir);
  } else {
    // Read-only: download.ts only ever copies FROM here, and a writable baked
    // input is something a misbehaving job could corrupt for later jobs.
    await setModeRecursive(paths.prefetchDir, "a-w");
    await ensureLines("/etc/environment", [`BUN_BUILD_PREFETCH_DIR=${paths.prefetchDir}`]);
    await appendToProfiles(ctx, [`export BUN_BUILD_PREFETCH_DIR="${paths.prefetchDir}"`]);
  }

  // Pre-pull test docker images (postgres, mysql, redis, minio, ...).
  // Runs as root: our user is in the docker group but that doesn't apply
  // to the current shell.
  if ((existsSync(join(clone, "test/docker/prepare-ci.ts")) || mode.dryRun) && (which("docker") || mode.dryRun)) {
    await enableService("docker", { start: true });
    const pulled = await sudo([bun, "test/docker/prepare-ci.ts"], { cwd: clone, allowFailure: true });
    if (pulled.exitCode !== 0) warn("prepare-ci.ts failed; test docker images not pre-pulled");
  } else {
    log("skipping docker image pre-pull (no prepare-ci.ts or no docker)");
  }

  // Shared `bun install` download cache: every test shard's `bun install`
  // (root + test/) hits disk instead of npm. Left writable and owned by the
  // buildkite user: bun install extracts new tarballs into the cache dir
  // itself, so a read-only cache would fail on the first unseen package.
  const cacheDir = paths.installCacheDir;
  await ensureDirectory(cacheDir, { mode: "777" });
  const rootInstall = await run([bun, "install", "--ignore-scripts"], {
    cwd: clone,
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  const testInstall = await run([bun, "install", "--ignore-scripts"], {
    cwd: join(clone, "test"),
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  if (rootInstall.exitCode !== 0 || testInstall.exitCode !== 0) {
    warn("bun install prefetch failed; baking without warm install cache");
    await removePaths(cacheDir);
  } else {
    await setOwnerRecursive(cacheDir, `${paths.buildkiteUser}:${paths.buildkiteUser}`);
    await ensureLines("/etc/environment", [`BUN_INSTALL_CACHE_DIR=${cacheDir}`]);
    await appendToProfiles(ctx, [`export BUN_INSTALL_CACHE_DIR="${cacheDir}"`]);
  }
  await removePaths(clone);
}

// ---------------------------------------------------------------------------
// Shell profile helpers
// ---------------------------------------------------------------------------

/**
 * Append environment lines to the login profiles of both the bootstrap user
 * and (on CI images) the buildkite user, so interactive SSH sessions and the
 * agent both see the toolchain. Idempotent (ensureLines skips duplicates).
 * /etc/profile.d also covers non-login shells and other users.
 */
export async function appendToProfiles(ctx: LinuxContext, lines: string[]): Promise<void> {
  const homes = new Set<string>([ctx.host.home]);
  if (ctx.ci) homes.add(ctx.image.paths.buildkiteHome);
  for (const home of homes) {
    for (const profile of [".profile", ".bashrc", ".zshrc"]) {
      await ensureLines(join(home, profile), lines);
    }
  }
  await ensureLines("/etc/profile.d/bun-ci.sh", lines);
}
