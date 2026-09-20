/**
 * Bun's CI machine images: which exist, what each is built from, and the
 * version of everything installed on them. This is the only place those
 * versions are written; the rest of the repository imports them from here.
 *
 * Changing anything in this file changes the hash of the images it affects,
 * and the next CI build bakes the images whose names do not exist yet.
 */

import type { Image, LinuxImage, Tool, WindowsImage } from "./image.ts";
import { age } from "./tools/age.ts";
import { agentService } from "./tools/agent-service.ts";
import { agentUser } from "./tools/agent-user.ts";
import { androidNdk } from "./tools/android-ndk.ts";
import { buildkiteAgent } from "./tools/buildkite-agent.ts";
import { bun } from "./tools/bun.ts";
import { ccache } from "./tools/ccache.ts";
import { chrome } from "./tools/chrome.ts";
import { cleanup } from "./tools/cleanup.ts";
import { cmake } from "./tools/cmake.ts";
import { coreDumps } from "./tools/core-dumps.ts";
import { crossCompilerRt } from "./tools/cross-compiler-rt.ts";
import { curlH3 } from "./tools/curl-h3.ts";
import { docker } from "./tools/docker.ts";
import { freebsdSysroot } from "./tools/freebsd-sysroot.ts";
import { glibcSysroot } from "./tools/glibc-sysroot.ts";
import { intelSde } from "./tools/intel-sde.ts";
import { llvm } from "./tools/llvm.ts";
import { macosSdk } from "./tools/macos-sdk.ts";
import { muslSysroot } from "./tools/musl-sysroot.ts";
import { noTmpfs } from "./tools/no-tmpfs.ts";
import { nodejs } from "./tools/nodejs.ts";
import { nssm } from "./tools/nssm.ts";
import { openssh } from "./tools/openssh.ts";
import { packages } from "./tools/packages.ts";
import { pdbAddr2line } from "./tools/pdb-addr2line.ts";
import { prefetchBuildDeps, prefetchInstallCache, prefetchTestImages, prefetchWindows } from "./tools/prefetch.ts";
import { pwsh } from "./tools/pwsh.ts";
import { pythonFuse } from "./tools/python-fuse.ts";
import { rust } from "./tools/rust.ts";
import { scoop, scoopPackages } from "./tools/scoop.ts";
import { tailscale } from "./tools/tailscale.ts";
import { ulimits } from "./tools/ulimits.ts";
import { visualStudio } from "./tools/visual-studio.ts";
import { windowsSysroot } from "./tools/windows-sysroot.ts";
import { uninstallDefender, windowsSystem } from "./tools/windows-system.ts";

const alpineRelease = "3.23";

export const pins = {
  nodejs: { version: "26.3.0", nodeGypInstallVersion: "11" },
  bun: { version: "1.3.13" },
  curlH3: { version: "8.19.0" },
  buildkiteAgent: { version: "3.114.0" },
  cmake: { version: "3.30.5" },
  llvm: { version: "23.1.1" },
  rust: {
    rustup: "1.28.2",
    channel: "nightly-2026-09-15",
    components: ["rust-src", "rustfmt", "clippy", "miri", "llvm-tools"],
    targets: [
      "aarch64-unknown-linux-gnu",
      "x86_64-unknown-linux-gnu",
      "aarch64-unknown-linux-musl",
      "x86_64-unknown-linux-musl",
      "aarch64-linux-android",
      "x86_64-linux-android",
      "x86_64-unknown-freebsd",
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "aarch64-pc-windows-msvc",
      "x86_64-pc-windows-msvc",
    ],
  },
  androidNdk: { version: "r27c", apiLevel: 28 },
  // A FreeBSD release moves from download.freebsd.org to the archive when it reaches end of life.
  freebsd: { version: "14.3", baseUrl: "https://archive.freebsd.org/old-releases" },
  glibcSysroot: { gccDebsUrl: "https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs" },
  muslSysroot: { alpineRelease },
  windowsSysroot: { xwin: "0.9.0", sdk: "10.0.26100", crt: "14.44.17.14" },
  macosSdk: { sdk: "26.5", commandLineTools: "26.5" },
  pythonFuse: { version: "1.0.9" },
  age: {
    version: "1.2.1",
    sha256: {
      x64: "7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50",
      aarch64: "57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f",
    },
  },
  // Windows only.
  // Packer runs the Windows bakes from a Linux machine of the hosted queue.
  packer: {
    version: "1.15.0",
    azurePlugin: "2.5.0",
    sha256: {
      x64: "2fd1149c5c6c7604ced64d7b56638af05f6b7ed3f6835182bc913ddaba1f16b8",
      aarch64: "1687f43bd120601f62e54b970b1cc06f83e95897357dc5c679b57ec9d2fb40a7",
    },
  },
  pwsh: { version: "7.5.2" },
  openssh: { version: "v9.8.1.0p1-Preview" },
  ccache: { version: "4.12.2" },
  visualStudio: { channel: "17" },
  pdbAddr2line: { version: "0.11.2" },
  intelSde: {
    version: "9.58.0-2025-06-16",
    sha256: "EBB8B3B63FCB0B6C1F9721118BA4883703D2AED9E0DB2DEFED4E44FBA78D9CA9",
  },
  nssm: { version: "2.24-103-gdee49fc" },
  windowsSystem: { disabledServices: ["WSearch", "wuauserv", "DiagTrack", "dmwappushservice", "PcaSvc", "SysMain"] },
} as const;

const debianOwner = "136693071363";
const ubuntuOwner = "099720109477";
const alpineOwner = "538276064493";

export const images: readonly Image[] = [
  // The image every Bun target is compiled on.
  {
    os: "linux",
    arch: "aarch64",
    distro: "debian",
    release: "13",
    abi: "gnu",
    role: "build",
    base: { name: "debian-13-arm64-20260914-2601", owner: debianOwner },
  },
  {
    os: "linux",
    arch: "x64",
    distro: "debian",
    release: "13",
    abi: "gnu",
    role: "test",
    base: { name: "debian-13-amd64-20260914-2601", owner: debianOwner },
  },
  {
    os: "linux",
    arch: "aarch64",
    distro: "ubuntu",
    release: "25.04",
    abi: "gnu",
    role: "test",
    base: { name: "ubuntu/images/hvm-ssd-gp3/ubuntu-plucky-25.04-arm64-server-20251210", owner: ubuntuOwner },
  },
  {
    os: "linux",
    arch: "x64",
    distro: "ubuntu",
    release: "25.04",
    abi: "gnu",
    role: "test",
    base: { name: "ubuntu/images/hvm-ssd-gp3/ubuntu-plucky-25.04-amd64-server-20251210", owner: ubuntuOwner },
  },
  {
    os: "linux",
    arch: "aarch64",
    distro: "alpine",
    release: alpineRelease,
    abi: "musl",
    role: "test",
    base: { name: "alpine-3.23.6-aarch64-uefi-cloudinit-r0", owner: alpineOwner },
  },
  {
    os: "linux",
    arch: "x64",
    distro: "alpine",
    release: alpineRelease,
    abi: "musl",
    role: "test",
    base: { name: "alpine-3.23.6-x86_64-uefi-cloudinit-r0", owner: alpineOwner },
  },
  {
    os: "windows",
    arch: "x64",
    release: "2019",
    role: "test",
    base: {
      publisher: "MicrosoftWindowsServer",
      offer: "WindowsServer",
      sku: "2019-datacenter-gensecond",
      version: "latest",
    },
    // An AMD size: the Intel D4ds_v6 kept failing to allocate in the region, and the CPU's vendor does not change the image.
    bakeVmSize: "Standard_D4as_v7",
  },
  {
    os: "windows",
    arch: "aarch64",
    release: "11",
    role: "test",
    base: {
      publisher: "MicrosoftWindowsDesktop",
      offer: "windows11preview-arm64",
      sku: "win11-24h2-pro",
      version: "latest",
    },
    bakeVmSize: "Standard_D4pds_v6",
  },
];

/**
 * Packages from the distro's own repositories, by name. A repository serves
 * whatever version it has on the day of the bake.
 */
const aptPackages = [
  // Tools the other steps and CI itself run.
  ...["apt-transport-https", "bash", "ca-certificates", "curl", "git", "gnupg", "htop", "unzip", "wget", "xz-utils"],
  // lsb-release: apt.llvm.org's installer asks it for the release's name.
  // libatomic1: nodejs.org's binary links it. libc6-dbg: symbols for core dumps.
  ...["lsb-release", "libatomic1", "libc6-dbg"],
  // Building Bun and its dependencies.
  ...[
    "build-essential",
    "ccache",
    "golang",
    "libtool",
    "make",
    "nasm",
    "ninja-build",
    "perl",
    "pkg-config",
    "python3",
    "ruby",
  ],
  // Tests: `ab`, and FUSE mounts from Python.
  ...["apache2-utils", "python3-fuse"],
  // What a headless Chrome links against.
  ...["fonts-liberation", "libasound2t64", "libatk-bridge2.0-0", "libatk1.0-0", "libc6", "libcairo2", "libcups2"],
  ...["libdbus-1-3", "libexpat1", "libfontconfig1", "libgbm1", "libgcc1", "libglib2.0-0", "libgtk-3-0", "libnspr4"],
  ...["libnss3", "libpango-1.0-0", "libpangocairo-1.0-0", "libstdc++6", "libx11-6", "libx11-xcb1", "libxcb1"],
  ...["libxcomposite1", "libxcursor1", "libxdamage1", "libxext6", "libxfixes3", "libxi6", "libxrandr2", "libxrender1"],
  ...["libxss1", "libxtst6", "xdg-utils"],
];

const apkPackages = [
  ...["bash", "ca-certificates", "curl", "git", "gnupg", "htop", "tar", "unzip", "wget", "xz"],
  // Bun's own binary links these.
  ...["libgcc", "libstdc++"],
  ...["build-base", "ccache", "go", "libtool", "linux-headers", "make", "nasm", "ninja", "perl", "python3", "ruby"],
  ...["apache2-utils"],
  // The browser tests use the distro's Chromium.
  ...["chromium", "freetype", "harfbuzz", "nss", "ttf-freefont"],
];

/** What a bake installs on a Linux image, in order. */
export function linuxTools(image: LinuxImage): readonly Tool[] {
  const apt = image.distro !== "alpine";
  return [
    packages(
      image,
      // add-apt-repository, which apt.llvm.org's installer uses on Ubuntu.
      image.distro === "ubuntu" ? [...aptPackages, "software-properties-common"] : apt ? aptPackages : apkPackages,
    ),
    ulimits(image),
    agentUser(image),
    nodejs(image, pins.nodejs),
    bun(image, pins.bun),
    curlH3(image, pins.curlH3),
    tailscale(),
    buildkiteAgent(image, pins.buildkiteAgent),
    cmake(image, pins.cmake),
    llvm(image, pins.llvm),
    rust(image, pins.rust),
    ...(image.role === "build"
      ? [
          crossCompilerRt(pins.llvm),
          androidNdk(pins.androidNdk),
          freebsdSysroot(pins.freebsd),
          glibcSysroot(pins.glibcSysroot),
          muslSysroot(image, pins.muslSysroot),
          windowsSysroot(image, pins.windowsSysroot),
          macosSdk(pins.macosSdk),
        ]
      : []),
    docker(image),
    // Google publishes Chrome for apt on amd64 only.
    ...(apt && image.arch === "x64" ? [chrome()] : []),
    // Alpine has no python-fuse package.
    ...(apt ? [] : [pythonFuse(pins.pythonFuse)]),
    age(image, pins.age),
    coreDumps(image),
    ...(apt ? [noTmpfs()] : []),
    prefetchBuildDeps(),
    prefetchTestImages(image),
    prefetchInstallCache(),
    agentService(image),
    cleanup(image),
  ];
}

/** What a bake installs on a Windows image, in order. */
export function windowsTools(image: WindowsImage): readonly Tool[] {
  const x64 = image.arch === "x64";
  return [
    windowsSystem(pins.windowsSystem),
    scoop(),
    scoopPackages([
      ...["7zip", "git", "cmake", "ninja", "python", "make", "cygwin", "perl"],
      // Neither has an arm64 build.
      ...(x64 ? ["nasm", "mingw"] : []),
    ]),
    nodejs(image, pins.nodejs),
    llvm(image, pins.llvm),
    nssm(pins.nssm),
    pwsh(image, pins.pwsh),
    openssh(image, pins.openssh),
    bun(image, pins.bun),
    curlH3(image, pins.curlH3),
    ccache(image, pins.ccache),
    rust(image, pins.rust),
    visualStudio(pins.visualStudio),
    pdbAddr2line(pins.pdbAddr2line),
    ...(x64 ? [intelSde(pins.intelSde)] : []),
    buildkiteAgent(image, pins.buildkiteAgent),
    prefetchWindows(),
    agentService(image),
    ...(image.release === "2019" ? [uninstallDefender()] : []),
  ];
}

export function tools(image: Image): readonly Tool[] {
  return image.os === "windows" ? windowsTools(image) : linuxTools(image);
}
