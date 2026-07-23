// Linux image facts: the per-platform half of the spec. Shared pins (node,
// bun, llvm, cross toolchains, ...) come from ./spec.ts; the linux image
// entries are exported for it to assemble the fleet list.

import {
  age,
  alpineRelease,
  buildkiteAgent,
  bun,
  cmake,
  crossToolchains,
  curlH3,
  llvm,
  nodejs,
  pythonFuse,
} from "./spec.ts";
import type {
  Arch,
  LinuxBuildHostImage,
  LinuxImageBase,
  LinuxPackages,
  LinuxRustSpec,
  LinuxSharedFields,
  LinuxTestImage,
} from "./types.ts";

const linuxRust: LinuxRustSpec = {
  home: "/opt/rust",
  rustupUrl: "https://sh.rustup.rs",
  targets: [
    "aarch64-linux-android",
    "x86_64-linux-android",
    // x86_64-unknown-freebsd is Tier 2 (prebuilt std). aarch64 is Tier 3
    // (no prebuilt) — lolhtml.ts uses -Zbuild-std for that.
    "x86_64-unknown-freebsd",
    // macOS cross lanes build libbun_rust.a for darwin on the shared rust box.
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    // Windows cross targets (--os=windows from a linux host).
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
    // Linux cross-arch/cross-abi targets: an arm64 glibc host cargo-builds
    // all four linux triples (x64/aarch64 × gnu/musl).
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-musl",
    "aarch64-unknown-linux-musl",
  ],
  // rust-src for -Zbuild-std (Tier 3 targets without prebuilt std).
  components: ["rust-src"],
};

/** The roots every linux image writes to. Locations under a root are
 * derived in components/paths.ts, so each root is written exactly once. */
const linuxPaths: LinuxImageBase["paths"] = {
  bin: "/usr/local/bin",
  opt: "/opt",
  include: "/usr/local/include",
  buildkiteUser: "buildkite-agent",
  buildkiteHome: "/var/lib/buildkite-agent",
  buildkiteAgentEntry: "agent.mjs",
  buildkiteDirs: ["/var/cache/buildkite-agent", "/var/log/buildkite-agent", "/var/run/buildkite-agent"],
  // Checkout/work dir = the buildkite home's build subdir (unchanged from
  // before it was an explicit fact); a stable path keeps ccache effective.
  workDir: "/var/lib/buildkite-agent/build",
  caches: {
    prefetch: "/opt/bun-prefetch",
    // Not warming a `bun install` cache right now; set a path to re-enable.
    install: null,
  },
  coresDirPattern: "/var/bun-cores-{distro}-{release}-{arch}",
};

const linuxSystem: LinuxImageBase["system"] = {
  limits: [
    "core",
    "data",
    "fsize",
    "memlock",
    "nofile",
    "rss",
    "stack",
    "cpu",
    "nproc",
    "as",
    "locks",
    "sigpending",
    "msgqueue",
  ],
  countedLimits: { nofile: 1048576, nproc: 1048576 },
};

const aptCommon = [
  "bash",
  "ca-certificates",
  "curl",
  "htop",
  "gnupg",
  "git",
  // apt.llvm.org/llvm.sh greps `lsb_release -cs`; debian slim images don't
  // ship it (ubuntu cloud images do).
  "lsb-release",
  "unzip",
  "wget",
  "libc6-dbg",
  "xz-utils",
  "jq",
  "skopeo",
  "ccache",
  "gdb",
  "python3-fuse",
];

const aptBuildEssentials = [
  "build-essential",
  "ninja-build",
  "xz-utils",
  "pkg-config",
  "golang",
  "apache2-utils",
  "make",
  "nasm",
  "python3",
  "libtool",
  "ruby",
  "perl",
];

const aptChromium = [
  "fonts-liberation",
  "libatk-bridge2.0-0",
  "libatk1.0-0",
  "libc6",
  "libcairo2",
  "libcups2",
  "libdbus-1-3",
  "libexpat1",
  "libfontconfig1",
  "libgbm1",
  "libgcc1",
  "libglib2.0-0",
  "libgtk-3-0",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libpangocairo-1.0-0",
  "libstdc++6",
  "libx11-6",
  "libx11-xcb1",
  "libxcb1",
  "libxcomposite1",
  "libxcursor1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxi6",
  "libxrandr2",
  "libxrender1",
  "libxss1",
  "libxtst6",
  "xdg-utils",
];

const debianPackages: LinuxPackages = {
  manager: "apt",
  // Trixie dropped software-properties-common.
  common: ["apt-transport-https", ...aptCommon],
  buildEssentials: aptBuildEssentials,
  chromium: aptChromium,
  // debian ships every target arch in one qemu-user package.
  qemu: ["qemu-user"],
  llvm: [],
};

const ubuntuPackages: LinuxPackages = {
  manager: "apt",
  common: ["apt-transport-https", "software-properties-common", ...aptCommon],
  buildEssentials: aptBuildEssentials,
  chromium: aptChromium,
  qemu: ["qemu-user"],
  llvm: [],
};

const alpinePackages = (arch: Arch): LinuxPackages => ({
  manager: "apk",
  // bun's own runtime needs libgcc/libstdc++ on musl.
  common: [
    "bash",
    "ca-certificates",
    "curl",
    "htop",
    "gnupg",
    "git",
    "unzip",
    "wget",
    "tar",
    "xz",
    "jq",
    "ccache",
    "gdb",
    "libgcc",
    "libstdc++",
    // shadow provides usermod/groupmod (busybox does not); addUserToGroup
    // relies on it. Declared explicitly rather than trusting the base
    // image to pull it in transitively.
    "shadow",
  ],
  buildEssentials: [
    "build-base",
    "linux-headers",
    "ninja",
    "go",
    "xz",
    "apache2-utils",
    "make",
    "nasm",
    "python3",
    "libtool",
    "ruby",
    "perl",
    "cmake",
    "docker",
    "docker-cli-compose",
    // python-fuse builds from source on alpine.
    "python3-dev",
    "fuse-dev",
    "pkgconf",
    "py3-setuptools",
  ],
  chromium: ["chromium", "nss", "freetype", "harfbuzz", "ttf-freefont"],
  qemu: [arch === "x64" ? "qemu-x86_64" : "qemu-aarch64"],
  // scudo-malloc: the allocator the alpine build links against.
  llvm: [`llvm${llvm.major}`, `clang${llvm.major}`, "scudo-malloc", `lld${llvm.major}`, `llvm${llvm.major}-dev`],
});

const debianAmi = (arch: Arch): LinuxImageBase["base"] => ({
  owner: "amazon",
  nameGlob: `debian-13-${arch === "aarch64" ? "arm64" : "amd64"}-*`,
  sshUsername: "admin",
});

const ubuntuAmi = (release: string, arch: Arch): LinuxImageBase["base"] => ({
  // Canonical's AWS account id.
  owner: "099720109477",
  nameGlob: `ubuntu/images/hvm-ssd*/ubuntu-*-${release}-${arch === "aarch64" ? "arm64" : "amd64"}-server-*`,
  sshUsername: "ubuntu",
});

const alpineAmi = (arch: Arch): LinuxImageBase["base"] => ({
  // Alpine's official AWS account id.
  owner: "538276064493",
  nameGlob: `alpine-${alpineRelease}.*-${arch === "aarch64" ? "aarch64" : "x86_64"}-uefi-cloudinit-*`,
  // The cloudinit alpine AMIs are logged into as root (the existing bake
  // has always connected as root; alpine's stock cloud-init user is not
  // present on this AMI family).
  sshUsername: "root",
});

const linuxBake = (arch: Arch): LinuxImageBase["bake"] => ({
  instanceType: arch === "aarch64" ? "t4g.large" : "t3.large",
  diskSizeGb: 100,
});

/** The tools/config every linux image shares, so an entry only spells out
 * what distinguishes it. */
const linuxShared: LinuxSharedFields = {
  os: "linux",
  cloud: "aws",
  nodejs,
  bun,
  llvm,
  cmake,
  curlH3,
  buildkiteAgent,
  age,
  pythonFuse,
  rust: linuxRust,
  paths: linuxPaths,
  system: linuxSystem,
  // FLOATING installer scripts.
  dockerInstallUrl: "https://get.docker.com",
  tailscaleInstallUrl: "https://tailscale.com/install.sh",
};

// FLOATING: Google's current stable Chrome deb (x64 only; no arm64 build).
const chromeDebUrl = "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb";

const linuxCommonComponents = [
  "base-system",
  "ci-user",
  "nodejs",
  "bun",
  "curl-h3",
  "age",
  "python-fuse",
  "cmake",
  "llvm",
  "rust",
  "docker",
  "tailscale",
  "chromium",
  "buildkite-agent",
  "prefetch",
  "core-dumps",
  "cleanup",
] as const;

/** The CI finalization tail every linux image ends with. Install steps
 * (a browser, a cross toolchain) belong BEFORE it: cleanup empties /tmp
 * (the download scratch) and trims disks for capture, so nothing may
 * install after it. Insert with withInstall(), never by appending. */
const linuxFinalization = ["buildkite-agent", "prefetch", "core-dumps", "cleanup"] as const;

/** The common list with extra install-time components placed before the
 * finalization tail. */
function withInstall(...extra: string[]): string[] {
  const tail = linuxCommonComponents.length - linuxFinalization.length;
  return [...linuxCommonComponents.slice(0, tail), ...extra, ...linuxCommonComponents.slice(tail)];
}

/** The build host additionally installs the cross toolchains, before the
 * CI finalization steps (buildkite-agent, prefetch, core-dumps, cleanup). */
const linuxBuildHostComponents = [
  "base-system",
  "ci-user",
  "nodejs",
  "bun",
  "curl-h3",
  "age",
  "python-fuse",
  "cmake",
  "llvm",
  "rust",
  "docker",
  "tailscale",
  "chromium",
  "cross-binutils",
  "android-ndk",
  "freebsd-sysroot",
  "glibc-sysroot",
  "musl-sysroot",
  "windows-sysroot",
  "macos-sdk",
  "buildkite-agent",
  "prefetch",
  "core-dumps",
  "cleanup",
] as const;

// ---------------------------------------------------------------------------
// The images
// ---------------------------------------------------------------------------

export const linuxBuildHost: LinuxBuildHostImage = {
  ...linuxShared,
  key: "linux-aarch64-13-debian",
  arch: "aarch64",
  distro: "debian",
  release: "13",
  abi: "gnu",
  buildHost: true,
  components: linuxBuildHostComponents,
  base: debianAmi("aarch64"),
  bake: linuxBake("aarch64"),
  packages: debianPackages,
  crossToolchains,
};

export const linuxTestImages: readonly LinuxTestImage[] = [
  {
    ...linuxShared,
    key: "linux-x64-13-debian",
    arch: "x64",
    distro: "debian",
    release: "13",
    abi: "gnu",
    buildHost: false,
    components: withInstall("chrome"),
    base: debianAmi("x64"),
    bake: linuxBake("x64"),
    packages: debianPackages,
    chromeDebUrl,
  },
  {
    ...linuxShared,
    key: "linux-aarch64-2504-ubuntu",
    arch: "aarch64",
    distro: "ubuntu",
    release: "25.04",
    abi: "gnu",
    buildHost: false,
    components: linuxCommonComponents,
    base: ubuntuAmi("25.04", "aarch64"),
    bake: linuxBake("aarch64"),
    packages: ubuntuPackages,
  },
  {
    ...linuxShared,
    key: "linux-x64-2504-ubuntu",
    arch: "x64",
    distro: "ubuntu",
    release: "25.04",
    abi: "gnu",
    buildHost: false,
    components: withInstall("chrome"),
    base: ubuntuAmi("25.04", "x64"),
    bake: linuxBake("x64"),
    packages: ubuntuPackages,
    chromeDebUrl,
  },
  {
    ...linuxShared,
    key: `linux-aarch64-${alpineRelease.replace(/\./g, "")}-alpine-musl`,
    arch: "aarch64",
    distro: "alpine",
    release: alpineRelease,
    abi: "musl",
    buildHost: false,
    components: linuxCommonComponents,
    base: alpineAmi("aarch64"),
    bake: linuxBake("aarch64"),
    packages: alpinePackages("aarch64"),
  },
  {
    ...linuxShared,
    key: `linux-x64-${alpineRelease.replace(/\./g, "")}-alpine-musl`,
    arch: "x64",
    distro: "alpine",
    release: alpineRelease,
    abi: "musl",
    buildHost: false,
    components: linuxCommonComponents,
    base: alpineAmi("x64"),
    bake: linuxBake("x64"),
    packages: alpinePackages("x64"),
    chromeDebUrl: null,
  },
];
