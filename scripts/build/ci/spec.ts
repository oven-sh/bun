// The single source of truth for what goes into a Bun CI machine image.
//
// Every image is one fully-typed entry in `images` below: a complete manifest
// of what gets baked onto that machine — pinned tool versions, package
// lists, cross toolchains, base image, bake shape, and system tuning. The
// values are PLAIN DATA (no functions). Facts shared between images (the
// Node.js version, the LLVM version, ...) are declared once as constants and
// referenced by each entry, so there is exactly one place to change them.
// Nothing else in the repo may re-declare one of these values — bootstrap,
// ci.mjs, machine.mjs, and scripts/build/* import them from here. URL
// construction and other logic over this data lives in ./artifacts.ts.
//
// The types are the checklist: LinuxBuildHostImage requires the cross
// toolchains that LinuxTestImage may not have; WindowsX64Image requires the
// Intel SDE + x64-only Scoop packages that WindowsArm64Image may not have.
// A field that only some images bake exists only on those images' types.
//
// An image is named `${entry.key}-${hash}` (see ./naming.ts) where the hash
// digests `epoch`, that entry's ENTIRE manifest, the artifacts it resolves
// to, and the recipe code that produces it (./recipe.ts). So:
//
//   - Change a fact an image references, or the code that builds it → its
//     hash changes → CI bakes it fresh on that branch and reuses it on every
//     later push. There is no `[build images]` / `[publish images]` step
//     and no version number to bump; merging to main IS publishing, because
//     main computes the same hash the branch already baked.
//
//   - Whether an image bakes is a mechanical consequence of what changed —
//     never something to remember, and never possible to fool by editing
//     code without renaming the image.
//
// What a hash means: "same recipe", not "same bytes". Some inputs float by
// nature (OS package repositories, `latest` cloud base images, installer
// scripts served from a fixed URL). Those are marked FLOATING below. When one
// of them drifts underneath us in a way that breaks the image, bump `epoch`
// to force a re-bake — the one input that exists solely to be bumped.
//
// This module is imported by both node (>= 25, via type stripping) and bun.
// Keep it dependency-free, side-effect-free, function-free, and made of
// erasable TypeScript syntax only (no enums / namespaces).

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

/**
 * Included in every image's hash. Bump to force every image to re-bake
 * without changing any fact or code — for when a FLOATING input drifted
 * underneath us in a way that broke the image.
 */
export const epoch = 1;

/** Packer + provider plugin pins for the Windows bake (azure-arm). These
 * are recipe inputs: spec.ts is hashed, so bumping a pin renames the images
 * and rebakes them — a Packer upgrade legitimately can change the result. */
export const packer = {
  version: "1.15.0",
  amazonPluginVersion: "1.3.9",
  azurePluginVersion: "2.5.0",
} as const;
import type {
  AgeSpec,
  Arch,
  BunSpec,
  CrossToolchains,
  Image,
  LinuxBuildHostImage,
  LinuxImageBase,
  LinuxPackages,
  LinuxRustSpec,
  LinuxSharedFields,
  LinuxTestImage,
  LlvmSpec,
  NodejsSpec,
  PinnedRelease,
  WindowsImage,
  WindowsImageBase,
  WindowsSharedFields,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Shared facts — declared once, referenced by every image that needs them
// ---------------------------------------------------------------------------

export const nodejs: NodejsSpec = {
  version: "26.3.0",
  gypInstallVersion: "11",
  distBase: "https://nodejs.org/dist",
  muslDistBase: "https://unofficial-builds.nodejs.org/download/release",
  headersDistBase: "https://nodejs.org/download/release",
};

export const bun: BunSpec = {
  version: "1.3.13",
  releaseBase: "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases",
};

/** FLOATING on linux via apt.llvm.org (serves the current point release
 * of `major`, currently `version`); pinned exactly via Scoop on Windows. */
export const llvm: LlvmSpec = {
  version: "21.1.8",
  major: 21,
  aptScriptUrl: "https://apt.llvm.org/llvm.sh",
};

export const cmake: PinnedRelease = {
  version: "3.30.5",
  releaseBase: "https://github.com/Kitware/CMake/releases/download",
};

/** Static curl with nghttp3/ngtcp2, installed as `curl-h3` for the HTTP/3
 * server tests. https://github.com/stunnel/static-curl/releases */
export const curlH3: PinnedRelease = {
  version: "8.19.0",
  releaseBase: "https://github.com/stunnel/static-curl/releases/download",
};

export const buildkiteAgent: PinnedRelease = {
  version: "3.114.0",
  releaseBase: "https://github.com/buildkite/agent/releases/download",
};

export const age: AgeSpec = {
  version: "1.2.1",
  releaseBase: "https://github.com/FiloSottile/age/releases/download",
  sha256: {
    "linux-amd64": "7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50",
    "linux-arm64": "57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f",
  },
};

export const pythonFuse: PinnedRelease = {
  version: "1.0.9",
  releaseBase: "https://github.com/libfuse/python-fuse/archive/refs/tags",
};

/** The alpine release the musl lanes run on. The alpine images, the musl
 * sysroot, and the verify-baseline host all follow it. */
export const alpineRelease = "3.23";

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

export const crossToolchains: CrossToolchains = {
  winSysroot: {
    xwinVersion: "0.9.0",
    xwinReleaseBase: "https://github.com/Jake-Shadle/xwin/releases/download",
    sdkVersion: "10.0.26100",
    crtVersion: "14.44.17.14",
    path: "/opt/winsysroot",
  },
  macosSdk: {
    version: "26.5",
    cltRelease: "26.5",
    path: "/opt/macos-sdk",
    xmacRawBase: "https://raw.githubusercontent.com/oven-sh/bun",
  },
  androidNdk: {
    version: "r27c",
    releaseBase: "https://dl.google.com/android/repository",
    path: "/opt/android-ndk",
  },
  freebsdSysroot: {
    version: "14.3",
    releaseBase: "https://download.freebsd.org/releases",
    paths: { amd64: "/opt/freebsd-sysroot", arm64: "/opt/freebsd-sysroot-arm64" },
  },
  glibcSysroot: {
    ubuntuImage: "docker.io/library/ubuntu:20.04",
    glibcVersion: "2.31",
    paths: { x86_64: "/opt/linux-sysroot-glibc", aarch64: "/opt/linux-sysroot-glibc-arm64" },
    aptBase: { x86_64: "http://archive.ubuntu.com/ubuntu", aarch64: "http://ports.ubuntu.com/ubuntu-ports" },
    dists: ["focal-updates", "focal"],
    packages: ["libc6", "libc6-dev", "linux-libc-dev", "libcrypt1", "libcrypt-dev"],
    // gcc-13 (libstdc++-13-dev, libgcc-13-dev) debs mirrored on a WebKit
    // release; assets are gcc-13-focal-{amd64,arm64}.tar.gz.
    gcc13ReleaseBase: "https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs",
  },
  muslSysroot: {
    alpineRelease,
    paths: { x86_64: "/opt/linux-sysroot-musl", aarch64: "/opt/linux-sysroot-musl-arm64" },
    packages: ["musl-dev", "libc-dev", "linux-headers", "g++", "libstdc++-dev"],
    cdnBase: "https://dl-cdn.alpinelinux.org/alpine",
  },
  // The build host is aarch64, so it needs the x86-64 GNU strip.
  crossBinutils: ["binutils-x86-64-linux-gnu"],
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
  dpkgOptions: ["force-unsafe-io", "no-debsig"],
  aptOptions: [
    'Acquire::Languages "none";',
    'Acquire::GzipIndexes "true";',
    'Acquire::CompressionTypes::Order:: "gz";',
    'APT::Get::Install-Recommends "false";',
    'APT::Get::Install-Suggests "false";',
    'Dpkg::Options { "--force-confdef"; "--force-confold"; }',
  ],
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
  gcc: null,
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

// ---------------------------------------------------------------------------
// Windows shared facts
// ---------------------------------------------------------------------------

/** Scoop packages in install order. 7zip before git (git's Scoop install
 * depends on it, and 7zip's post_install errors under ARM64 SYSTEM). */
const scoopCommonPackages = [
  { name: "7zip", command: "7z" },
  { name: "git", command: "git" },
  { name: `nodejs@${nodejs.version}`, command: "node" },
  { name: "cmake", command: "cmake" },
  { name: "ninja", command: "ninja" },
  { name: "python", command: "python" },
  { name: "make", command: "make" },
  { name: "cygwin", command: "cygpath" },
  { name: "nssm", command: "nssm" },
  { name: "perl", command: "perl" },
];

const azureGalleryCommon: WindowsImageBase["gallery"] = {
  name: "bunCIGallery2",
  location: "eastus2",
  resourceGroup: "BUN-CI",
  imageVersion: "1.0.0",
  storageAccountType: "Premium_LRS",
  replicationRegions: [
    null,
    "australiaeast",
    "brazilsouth",
    "canadacentral",
    "canadaeast",
    "centralindia",
    "centralus",
    "francecentral",
    "germanywestcentral",
    "italynorth",
    "japaneast",
    "japanwest",
    "koreacentral",
    "mexicocentral",
    "northcentralus",
    "northeurope",
    "southcentralus",
    "southeastasia",
    "spaincentral",
    "swedencentral",
    "switzerlandnorth",
    "uaenorth",
    "ukwest",
    "westeurope",
    "westus",
    "westus2",
    "westus3",
  ],
};

/** The tools/config every windows image shares. */
const windowsShared: WindowsSharedFields = {
  os: "windows",
  cloud: "azure",
  gallery: azureGalleryCommon,
  nodejs,
  bun,
  llvm,
  curlH3,
  buildkiteAgent,
  rust: {
    home: "C:\\Program Files\\Rust",
    // FLOATING: rustup-init.exe and the toolchain it selects.
    rustupUrl: "https://win.rustup.rs/",
  },
  powershell: {
    version: "7.5.2",
    releaseBase: "https://github.com/PowerShell/PowerShell/releases/download",
  },
  openssh: {
    version: "v9.8.1.0p1-Preview",
    releaseBase: "https://github.com/PowerShell/Win32-OpenSSH/releases/download",
  },
  ccache: {
    version: "4.12.2",
    releaseBase: "https://github.com/ccache/ccache/releases/download",
  },
  visualStudio: {
    bootstrapperUrl: "https://aka.ms/vs/17/release/vs_community.exe",
    workloadArgs: ["--add Microsoft.VisualStudio.Workload.NativeDesktop", "--includeRecommended"],
  },
  nssmFallbackZipUrl: "https://buncistore.blob.core.windows.net/artifacts/nssm-2.24-103-gdee49fc.zip",
  pdbAddr2line: { version: "0.11.2" },
  // Roots; derived locations come from components/paths.ts.
  paths: {
    system32: "C:\\Windows\\System32",
    programFiles: "C:\\Program Files",
    buildkiteHome: "C:\\buildkite-agent",
    buildkiteAgentEntry: "agent.mjs",
    workDir: "C:\\buildkite-agent\\build",
    caches: {
      prefetch: "C:\\bun-prefetch",
      // Not warming a `bun install` cache right now; set a path to re-enable.
      install: null,
    },
    node: "C:\\Scoop\\apps\\nodejs\\current\\node.exe",
  },
  optimize: {
    disabledServices: [
      "WSearch", //         Windows Search
      "wuauserv", //        Windows Update
      "DiagTrack", //       Connected User Experiences and Telemetry
      "dmwappushservice", // WAP Push Message Routing Service
      "PcaSvc", //          Program Compatibility Assistant
      "SysMain", //         Superfetch
    ],
    // High performance
    powerScheme: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
  },
};

// ---------------------------------------------------------------------------
// Component sequences (install order is data)
// ---------------------------------------------------------------------------

/** The install sequence every linux image shares. ci-user precedes nodejs
 * (whose gyp cache lands in the buildkite home) and prefetch. base-system
 * (build essentials) precedes python-fuse (built from source on alpine). */
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
  "gcc",
  "rust",
  "docker",
  "tailscale",
  "chromium",
  "buildkite-agent",
  "prefetch",
  "core-dumps",
  "cleanup",
] as const;

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
  "gcc",
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

/** The install sequence every windows image shares. visual-studio
 * precedes rust and pdb-addr2line: cargo (and rustc's msvc target) link
 * through the MSVC linker and Windows SDK libraries that Visual Studio
 * Build Tools installs — pdb-addr2line's `cargo install` cannot link
 * without them. */
const windowsCommonComponents = [
  "optimize-windows",
  "scoop",
  "nodejs",
  "powershell",
  "openssh",
  "bun",
  "curl-h3",
  "ccache",
  "visual-studio",
  "rust",
  "pdb-addr2line",
  "intel-sde",
  "buildkite-agent",
  // defender-removal precedes prefetch: prefetch's clone/install subprocess
  // churn has been leaving the parent unable to launch the next child on
  // some hosts; the removal only takes effect on reboot, so it is safe (and
  // correct) to schedule it before the cache warm-up.
  "defender-removal",
  "prefetch",
] as const;

// ---------------------------------------------------------------------------
// The images
// ---------------------------------------------------------------------------

const linuxBuildHost: LinuxBuildHostImage = {
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

const linuxTestImages: readonly LinuxTestImage[] = [
  {
    ...linuxShared,
    key: "linux-x64-13-debian",
    arch: "x64",
    distro: "debian",
    release: "13",
    abi: "gnu",
    buildHost: false,
    components: linuxCommonComponents,
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
    gcc: { version: "13" },
  },
  {
    ...linuxShared,
    key: "linux-x64-2504-ubuntu",
    arch: "x64",
    distro: "ubuntu",
    release: "25.04",
    abi: "gnu",
    buildHost: false,
    components: linuxCommonComponents,
    base: ubuntuAmi("25.04", "x64"),
    bake: linuxBake("x64"),
    packages: ubuntuPackages,
    gcc: { version: "13" },
    chromeDebUrl,
  },
  {
    ...linuxShared,
    key: "linux-aarch64-323-alpine-musl",
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
    key: "linux-x64-323-alpine-musl",
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

const windowsImages: readonly WindowsImage[] = [
  {
    ...windowsShared,
    key: "windows-x64-2019",
    arch: "x64",
    release: "2019",
    components: windowsCommonComponents,
    // Windows Server 2019 Gen2
    base: {
      publisher: "MicrosoftWindowsServer",
      offer: "WindowsServer",
      sku: "2019-datacenter-gensecond",
      version: "latest",
    },
    // D4as_v7 (AMD): D4ds_v6 hit repeated AllocationFailed in-region; the
    // CPU vendor of a build-only VM doesn't affect the produced image.
    bake: { vmSize: "Standard_D4as_v7", diskSizeGb: 150 },
    scoop: {
      installUrl: "https://get.scoop.sh",
      root: "C:\\Scoop",
      packages: [
        ...scoopCommonPackages,
        { name: `llvm@${llvm.version}`, command: "clang-cl" },
        // x64-only (no ARM64 build / not needed there).
        { name: "nasm", command: "nasm" },
        { name: "mingw", command: "gcc" },
      ],
    },
    intelSde: {
      version: "9.58.0-2025-06-16",
      sha256: "ebb8b3b63fcb0b6c1f9721118ba4883703d2aed9e0db2defed4e44fba78d9ca9",
      mirrorBase: "https://buncistore.blob.core.windows.net/artifacts",
      installDir: "C:\\intel-sde",
    },
  },
  {
    ...windowsShared,
    key: "windows-aarch64-11",
    arch: "aarch64",
    release: "11",
    components: windowsCommonComponents,
    // Windows 11 ARM64 Insider Preview (the only ARM64 Windows on Azure)
    base: {
      publisher: "MicrosoftWindowsDesktop",
      offer: "windows11preview-arm64",
      sku: "win11-24h2-pro",
      version: "latest",
    },
    bake: { vmSize: "Standard_D4pds_v6", diskSizeGb: 150 },
    scoop: {
      installUrl: "https://get.scoop.sh",
      root: "C:\\Scoop",
      packages: [...scoopCommonPackages, { name: `llvm-arm64@${llvm.version}`, command: "clang-cl" }],
    },
  },
];

/** Every image CI bakes. */
export const images: readonly Image[] = [linuxBuildHost, ...linuxTestImages, ...windowsImages];

/** The single linux build host image. */
export const buildHost: LinuxBuildHostImage = linuxBuildHost;
