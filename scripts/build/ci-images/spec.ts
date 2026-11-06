#!/usr/bin/env node
/**
 * Bun's CI machines, in one file: which images exist and what each starts
 * from, every version and every place things go, what is set up on a machine
 * and how, and the generator that turns that into the scripts a bake runs.
 *
 *   1. The data: files, pins, locations, images, packages, the Windows bake.
 *   2. The tools: one function per thing a bake sets up, and their order.
 *   3. The machinery: the vocabulary the tools are written in, its sh and
 *      PowerShell renderers, the Packer template, and the generator.
 *
 * `bun run ci:images [key...]` writes build/ci-images/<key>/ and prints each
 * image's name, which is `<key>-<hash of that directory>`. A change here that
 * changes what a bake runs changes the name, and the next CI build bakes the
 * names that do not exist yet. Besides this file, only the files listed in
 * `files` below can do that.
 *
 * Nothing in here reads the environment or the machine it runs on.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Arch, agentUser, linuxAgentPaths, windowsAgentHome } from "../../agent.ts";
import { BuildError } from "../error.ts";

// ═══════════════════════════════════════════════════════════════════ 1. DATA

/**
 * Files of the repository that are copied into a bake directory and onto the
 * machine: their every byte is part of an image's name. Nothing else outside
 * this file is.
 */
const files = {
  /** The agent: installed as the machine's service, and run at every start. It runs there alone, so it owns the agent's directories (`linuxAgentPaths`, `windowsAgentHome`). */
  "agent.mts": "scripts/agent.ts",
  /** Third-party, vendored: unpacks the macOS SDK on the build image. */
  "xmac.mjs": "scripts/build/xmac.mjs",
} as const;

/** Every file of the repository that can change what a bake runs, and so an image's name. */
export const bakeInputs: readonly string[] = ["scripts/build/ci-images/spec.ts", ...Object.values(files)];

const alpineRelease = "3.23";
/** What an apt repository calls a release of Debian or Ubuntu. */
const aptSuites: Record<string, string> = { "13": "trixie", "25.04": "plucky" };

/** The file name of the image's record, on the machine and in a bake directory once the bake job has copied it out. */
export const imageRecordName = "bun-image.txt";

/**
 * Where a bake puts what is not the operating system's to place (a binary in
 * /usr/local/bin is). Whatever looks for one of these imports it from here:
 * the build's sysroot lookups, the download cache, the step that runs Intel
 * SDE. Two readers cannot import it and say it again: scripts/agent.ts, which
 * runs on the machines by itself, and scripts/darwin-ci/guest/job.sh, which is
 * shell, both put the Linux and macOS `rust` directory's bin on PATH.
 *
 * The agent's user and its own directories (home, cache and logs) are not here
 * but in scripts/agent.ts, as `agentUser`, `linuxAgentPaths` and
 * `windowsAgentHome`: that file is copied to the machine and runs there alone,
 * so it has to contain them, and the tools import them from it.
 *
 * Windows paths are written with `\` here, because the build system and
 * .buildkite/ci.ts use them as they are.
 */
export const locations = {
  /** The image's record: what the bake recorded about the machine (see the `recordImage` tool). */
  imageRecord: { linux: `/etc/${imageRecordName}`, windows: `C:\\${imageRecordName}` },
  /** `bun install`'s cache, filled while the image is baked. */
  installCache: { linux: "/var/cache/bun-install", windows: "C:\\bun-install-cache" },
  rust: { linux: "/opt/rust", darwin: "/opt/rust", windows: "C:\\Program Files\\Rust" },
  /** Debian and Ubuntu. Everywhere else a package manager places LLVM. */
  llvm: "/opt/llvm",
  bunNinja: { linux: "/opt/bun-ninja", darwin: "/opt/bun-ninja", windows: "C:\\Program Files\\bun-ninja" },
  /** Dependency sources for scripts/build/download.ts, fetched while the image is baked. */
  prefetch: { linux: "/opt/bun-prefetch", windows: "C:\\bun-prefetch" },
  // What the build image cross-compiles with.
  androidNdk: "/opt/android-ndk",
  macosSdk: "/opt/macos-sdk",
  windowsSysroot: "/opt/winsysroot",
  freebsdSysroot: { x64: "/opt/freebsd-sysroot", aarch64: "/opt/freebsd-sysroot-arm64" },
  glibcSysroot: { x64: "/opt/linux-sysroot-glibc", aarch64: "/opt/linux-sysroot-glibc-arm64" },
  muslSysroot: { x64: "/opt/linux-sysroot-musl", aarch64: "/opt/linux-sysroot-musl-arm64" },
  /** Homebrew chose a new prefix for Apple Silicon. */
  brew: { aarch64: "/opt/homebrew", x64: "/usr/local" },
  // Windows only.
  scoop: "C:\\Scoop",
  intelSde: "C:\\intel-sde",
  ccache: "C:\\Program Files\\ccache",
  openssh: "C:\\Program Files\\OpenSSH",
} as const;

/**
 * Raise this to bake every image again so that what the `prefetch` tool
 * downloads is current. What it downloads is decided by the commit being
 * built, not by this file, so a dependency bump does not rename an image: the
 * images keep working and their caches slowly miss more (a build log says
 * `using prefetch cache` for a hit and `fetching` for a miss). The number is
 * written into that tool's section of the generated scripts, which is
 * how it renames the images. It means nothing else.
 */
const prefetchTriggerVersion = 1;

/**
 * Every version, and the sha256 of every file a bake downloads by that version.
 * A sum is the one its publisher gives; the comment above it says where to find
 * the next one. "GitHub's" is the one GitHub computes for each file of a release
 * ("sha256:…" beside the file on the release's page, `digest` in the API). Where
 * there is neither, it is the sum of the file as it was when the pin was written.
 */
export const pins = {
  nodejs: {
    version: "26.12.1",
    nodeGypInstallVersion: "11",
    // SHASUMS256.txt beside the files; unofficial-builds.nodejs.org has its own for the musl builds.
    sha256: {
      headers: "a983cdcea96e85d137b9b807cc776bb5564fc9e3e1c9185d59bbfaa781efd08f",
      "linux-x64": "0fd1eb7770598f52a21995edf6ed35fc690400fa437c2386af329519e9143132",
      "linux-aarch64": "a6c01af459dd8972ab3fb08ee5da81244d26ba8c4944a62d5bbba8c597ae154f",
      "linux-x64-musl": "8bf9cc0e7f8e3c7ec5368dca19242cad651b6b09d35bcdcf290ac3f80925e8dd",
      "linux-aarch64-musl": "c3694551f6cb888fe0befb4cb2e13ffe45b0bb2528ec141e7c3a29a7d7974d13",
      "darwin-x64": "b85c2ea4420ad0bc4abf2dc6cf1f55130ed681f1cabf60cf3f526e4c9e2712ff",
      "darwin-aarch64": "1901d539912c02afa10d1cc126943a8855a7eedebe830119463470db5e6c59e8",
      // node.lib: Scoop installs Node.js itself on Windows.
      "windows-x64": "caad0090dc3add94c06abd01e395e8ec0f1586c10071bda1f99480445d695f6f",
      "windows-aarch64": "45084cbfc0170d7a30b29ab1eeeb2b0d770995ade0a13a4cc82cf31189f95c9f",
    },
  },
  bun: {
    version: "1.4.4",
    // The release's SHASUMS256.txt.
    sha256: {
      "linux-x64": "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c",
      "linux-aarch64": "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
      "linux-x64-musl": "a5a8ccc5e74dcb883fe974f125a7bdb3b41e5195ed1b870e73f17effd3eb2b2d",
      "linux-aarch64-musl": "57f01b02ac7113c61c935f28f38c2eab849e3c970dab21f8b640a87b1ef65009",
      "darwin-x64": "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e",
      "darwin-aarch64": "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
      "windows-x64": "cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5",
      "windows-aarch64": "2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09",
    },
  },
  curlH3: {
    version: "8.19.0",
    // GitHub's.
    sha256: {
      "linux-x64": "9c70e3ac08a6d8e211a891fe2fc871a9cd3314c291adb5bb1a38e7355ce98ff7",
      "linux-aarch64": "46873008eae6b7eb586aa56ce8787bdb8c1eccb52faf7055b32b6470c1b84cd6",
      "linux-x64-musl": "477cf25c53e438b5293610faadf4b932009973c08e8be3a283afa25189aa85da",
      "linux-aarch64-musl": "592b12257e97de01f73f681800b6f7ba43347e5880100cca4d33c6fec3eb286b",
      "darwin-x64": "2c1b01c09af832e0aab50027419ea1dda998d71da7a2b57f1c602ca8e2ee1cfa",
      "darwin-aarch64": "5687120e22bee309b74979eff543eacb9a202ec69550b488111157f0e234a290",
      "windows-x64": "a99b3bb9de19ca28456bca2a66cbf5f34d0f6f773116ef8769fc7f5780f181c4",
      "windows-aarch64": "38272d548deeddb76fba9c629eca5a9331c3b142b2dccfb3d72a189e81620d29",
    },
  },
  buildkiteAgent: {
    version: "4.7.0",
    // The release's buildkite-agent-<version>.SHA256SUMS.
    sha256: {
      "linux-x64": "6a71ae796642ffa15063a1e571f160a758287cb8b028a7c00a599081eecdd2f5",
      "linux-aarch64": "dfc9a41609cad90e4bf6a5acafcdf73e41790620128f562c88c06b532e9ce99f",
      "windows-x64": "8fa3e012e646d7203574e34e23e56c1c7f0a36bed496aeab63d7e53d590ac87b",
      "windows-aarch64": "92c5bdf99002d5f6636d9ad54af438694daafb33f4ed16d65a62449664a196cf",
    },
  },
  cmake: {
    version: "3.30.5",
    // The release's cmake-<version>-SHA-256.txt.
    sha256: {
      x64: "83de8839f3fb0d9caf982a0435da3fa8c4fbe2c817dfec99def310dc7e6a8404",
      aarch64: "93c3b8920379585dece1314f113c6c9008eaedfe56023c78d856fc86dad5b8e2",
    },
  },
  llvm: {
    version: "23.1.1",
    // GitHub's, of LLVM-<version>-Linux-X64.tar.xz and -ARM64.tar.xz.
    sha256: {
      x64: "832aeb58d105de1cabc7b982dd2c65de0610f7377df48ae8fc2dd8e97420a15c",
      aarch64: "3fbaaa6a1f147557a4095b9911f8dc2d4c745a11863982f76ee20e248c190a80",
    },
    // The lld and llvm-mt of LLVM's Linux release are linked against ICU 70, which is Ubuntu 22.04's (jammy's).
    icu: {
      directory: "i/icu",
      name: "libicu70",
      version: "70.1-2",
      sha256: {
        x64: "58a154f6307289813da2276f900498ef536ae7c0522d2cf31a3c3c5cf62dfd9a",
        aarch64: "ac68372cf4a976e6a206858fd9b28c68e49d37d650b9b8653270038a6e7bc174",
      },
    },
  },
  rust: {
    rustup: "1.28.2",
    // rustup-init.sha256 (.exe.sha256) beside each file.
    rustupSha256: {
      "linux-x64": "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c",
      "linux-aarch64": "e3853c5a252fca15252d07cb23a1bdd9377a8c6f3efa01531109281ae47f841c",
      "linux-x64-musl": "e6599a1c7be58a2d8eaca66a80e0dc006d87bbcf780a58b7343d6e14c1605cb2",
      "linux-aarch64-musl": "a97c8f56d7462908695348dd8c71ea6740c138ce303715793a690503a94fc9a9",
      "darwin-x64": "9c331076f62b4d0edeae63d9d1c9442d5fe39b37b05025ec8d41c5ed35486496",
      "darwin-aarch64": "20ef5516c31b1ac2290084199ba77dbbcaa1406c45c1d978ca68558ef5964ef5",
      "windows-x64": "88d8258dcf6ae4f7a80c7d1088e1f36fa7025a1cfd1343731b4ee6f385121fc0",
      "windows-aarch64": "de9f7d29ccd39efa59a3dda3ec363b396e09b92681229b9b8f6aaa4c84285e9c",
    },
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
  androidNdk: {
    version: "r27c",
    apiLevel: 28,
    // Google only publishes a SHA-1, in dl.google.com/android/repository/repository2-3.xml. This is of the file that has it.
    sha256: "59c2f6dc96743b5daf5d1626684640b20a6bd2b1d85b13156b90333741bad5cc",
  },
  // download.freebsd.org has a release until its end of life, and then only archive.freebsd.org/old-releases does.
  freebsd: {
    version: "14.4",
    baseUrl: "https://download.freebsd.org/releases",
    // base.txz in the MANIFEST beside it.
    sha256: {
      x64: "769f60a6eea2938ad6b7943cfbcc17dfaf7d1f7ba59a32b869a00349302df853",
      aarch64: "c456bf75ee3d0b4da0b0b527402b0a9e61497f02756b2cc5801b51e80b3f90c4",
    },
  },
  // The release WebKit's prebuilt is built on (glibc 2.31).
  glibcSysroot: {
    ubuntu: {
      release: "20.04",
      // What docker.io/library/ubuntu:20.04 names: an index with an image for each architecture.
      image: "sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214",
    },
    // libc's runtime and headers, at the newest versions of focal-updates and focal. The sums are their Packages indexes'.
    debs: [
      {
        directory: "g/glibc",
        name: "libc6",
        version: "2.31-0ubuntu9.18",
        sha256: {
          x64: "1b2281aac4935dfea1f89dfc19e445fdbb45303202af60679ccb8bf035f081a0",
          aarch64: "4ff60d84ad78f3aa598297dc6966549fa6489f57599f197562ad91547f388da0",
        },
      },
      {
        directory: "g/glibc",
        name: "libc6-dev",
        version: "2.31-0ubuntu9.18",
        sha256: {
          x64: "11029900f2315b93ce487792ae1bf15f0927e5e50880c091e6a440b14d4e164a",
          aarch64: "a690787a4ed5ad1bb9ce6aebe0bef3300e483e7ed97d11a6af3cdb107e642292",
        },
      },
      {
        directory: "l/linux",
        name: "linux-libc-dev",
        version: "5.4.0-216.236",
        sha256: {
          x64: "70c9addd36aabd2d031d5ea0fc444f8b193027aef79ff3d8275d25800aed8ede",
          aarch64: "9f487e7f3a9fff7f42f67172e139fd23c11b30e9b70bf6ae5a2e90b099547990",
        },
      },
      {
        directory: "libx/libxcrypt",
        name: "libcrypt1",
        version: "4.4.10-10ubuntu4",
        sha256: {
          x64: "231b4dbbe5865775f118cfa61394f1e16fa7102b6953a327e672499a20876d73",
          aarch64: "89907b6c1b613c430a53ef10909934b9ce5854a396cd173360495f6f8e5e7ea4",
        },
      },
      {
        directory: "libx/libxcrypt",
        name: "libcrypt-dev",
        version: "4.4.10-10ubuntu4",
        sha256: {
          x64: "f0a41d8e8cf379dbbdfc43169f34851ed452b3581e72c6654f2e290caf4e1b20",
          aarch64: "3cbd65247c73ec78e15e9364d3f15643591fe25849382251c77a49204f083e68",
        },
      },
    ],
    gccDebs: {
      url: "https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs",
      // GitHub's.
      sha256: {
        x64: "a2b3b6e10b175bbaaefeb3e9e703ca26a97ed6c1f19ca842d3e0b0c8f941e65b",
        aarch64: "be19db90d94c52c6061280bbadcaad9b09db1e9f2e77a12f8c18c5425d2eb056",
      },
    },
  },
  muslSysroot: { alpineRelease },
  windowsSysroot: {
    xwin: "0.9.0",
    // The .sha256 beside each file of the release.
    xwinSha256: {
      x64: "31e1033f30608ba6b821d17f1461042bd54c23424813c9b4e9ae15b6d32fa4cd",
      aarch64: "41466ca41e16fe7fc1b82a67babc7c3811021bf32de354b90b34d8c4edb153e2",
    },
    sdk: "10.0.26100",
    crt: "14.44.17.14",
  },
  macosSdk: { sdk: "26.5", commandLineTools: "26.5" },
  // Docker's and Tailscale's own apt repositories keep every version they have served. `keySha256` is of the
  // repository's signing key as it was when the pin was written.
  docker: {
    keySha256: "1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570",
    debian: { engine: "29.8.1", containerd: "2.3.6", buildx: "0.37.1", compose: "5.5.1" },
    // The last ones Docker built for Ubuntu 25.04.
    ubuntu: { engine: "29.2.1", containerd: "2.2.1", buildx: "0.31.1", compose: "5.0.2" },
  },
  tailscale: {
    version: "1.102.4",
    keySha256: "3e03dacf222698c60b8e2f990b809ca1b3e104de127767864284e6c228f1fb39",
  },
  // PyPI's.
  pythonFuse: { version: "1.0.9", sha256: "9ed59577c36ab218d700aa2839f021f12c252b357186057572b98e19bc2a8589" },
  // https://github.com/oven-sh/ninja/releases; the sums are the release's bun-ninja.json.
  bunNinja: {
    tag: "bun-ninja-5ecd8831",
    sha256: {
      "linux-x64": "1521dc92e7ebcdccbc259ff41e4c27a5a7982bcf183e37b1fc6ea5a603379f0c",
      "linux-aarch64": "a2f69edc6caacec7869c5d1e99b2380ebc93c5cc722c8f9946fb79b16e090579",
      "windows-x64": "ec046195268fd82abb314fa26cfe646ca42437d3da93a40cb4359b053f515d64",
      "windows-aarch64": "56a632d5da98cb801ef2311db8e5856b4d080de0fa71d7d0d4b2ed8ed4d13339",
      "darwin-x64": "228e16557a9eb088d4667836f2b2d2702c0eebe43fa0d8dc9956a50ef0610fc1",
      "darwin-aarch64": "1126c3e84b2914285bc73b132b1d53f1c3118ceffdf328fc40fa2f4eb9d8b8d8",
    },
  },
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
  /**
   * Scoop is installed from its repositories, not from a release. `mainBucket`
   * is what pins the apps of `scoopPackages`: it is a commit of the manifests
   * (github.com/ScoopInstaller/Main), and a manifest names one version of its
   * app, that version's URLs and their hashes. To bump an app, move the commit.
   */
  scoop: {
    // github.com/ScoopInstaller/Install; the sum is of install.ps1 at that commit.
    installer: {
      commit: "1e2f334083d609986d8c8bc9e31ae8e87c39fab4",
      sha256: "94f983b190438311e006b957db7c8422709e0ba62a6c2ac04e278164108f2512",
    },
    core: "11c0c8a79e4cee8786aae4b1181f1a1441d0ad57",
    mainBucket: "ac40cd17aa3d1db6806a4c41f8eaa2d4eb359e81",
  },
  pwsh: {
    version: "7.5.2",
    // The release's hashes.sha256.
    sha256: {
      x64: "c1280668cd5bd3834a80b91905d1484d440f62533f87749244f443960138384f",
      aarch64: "af19ecc24ccc5fe04d260f474140be6a05536be4820def97f13c33d26e7392bd",
    },
  },
  openssh: {
    version: "v9.8.1.0p1-Preview",
    // Of the files as they were when the pin was written: the release is older than GitHub's sums.
    sha256: {
      x64: "c7a1369cd73c8165be00c66e90291c4dd67784de7c3aa3af18c68ebedffa6ea9",
      aarch64: "89587076e80b416c3810bf2005fea6f35d093fbfabd9e45c167d245c23801562",
    },
  },
  ccache: {
    version: "4.12.2",
    // GitHub's.
    sha256: {
      x64: "82c1b130b25cc162531dc7a062dc5ea99349cd536bc9eba8a66d976802d66516",
      aarch64: "21cdedf2314fce5ddb711d390e6befe79e2d3ec1e3272385af63727314020785",
    },
  },
  /**
   * A row of "Fixed version bootstrappers" in
   * https://learn.microsoft.com/visualstudio/releases/2022/release-history.
   * `directory` and `sha256` are the two parts of the Build Tools link's path.
   */
  visualStudio: {
    version: "17.14.41",
    directory: "bc92e2cb-33de-4a0c-995d-efa817f16b16",
    sha256: "37bb0fb429d163ecebd272a865d11a37b906d152bef960da2ddb29c2e2fd6eeb",
  },
  pdbAddr2line: { version: "0.11.2" },
  intelSde: {
    version: "9.58.0-2025-06-16",
    sha256: "EBB8B3B63FCB0B6C1F9721118BA4883703D2AED9E0DB2DEFED4E44FBA78D9CA9",
  },
  // Of Bun's own copy of the file.
  nssm: {
    version: "2.24-103-gdee49fc",
    sha256: "dd65d65d805ce646148d7ba18a9fcd1a1e8402f9e3822981252a6544136aad22",
  },
  windowsSystem: { disabledServices: ["WSearch", "wuauserv", "DiagTrack", "dmwappushservice", "PcaSvc", "SysMain"] },
} as const;

const debianOwner = "136693071363";
const ubuntuOwner = "099720109477";
const alpineOwner = "538276064493";

export const images: readonly BakedImage[] = [
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
      version: "17763.9245.260906",
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
      version: "26100.9457.260913",
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
  // lsb-release: scripts/agent.ts asks it for the distro and its release.
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

/**
 * Roots of the distro's ca-certificates package that the machines do not trust,
 * by how their lines of /etc/ca-certificates.conf start.
 */
const droppedRoots = ["mozilla/Comodo_AAA", "mozilla/emSign"];

/**
 * The macOS test machines. CI does not bake them: scripts/darwin-ci runs the
 * generated script in the Tart guest image it builds, or on a bare host.
 */
export const macosMachines: readonly MacosImage[] = [
  { os: "darwin", arch: "aarch64" },
  { os: "darwin", arch: "x64" },
];

const brewPackages = ["cmake", "ninja", "nasm", "pkg-config", "golang", "ccache"];

const scoopPackages = {
  // 7zip comes first: Scoop unpacks Git's self-extracting archive with it.
  // No perl: `perl` on these machines is the one inside Git (git\usr\bin is on
  // PATH). Strawberry Perl would come first and, being a native Windows perl,
  // writes text files with CRLF.
  all: ["7zip", "git", "cmake", "ninja", "python", "make", "cygwin"],
  // Neither has an arm64 build.
  x64: ["nasm", "mingw"],
} as const;

/** Roots that the Windows machines do not trust, by how their names start. */
const droppedWindowsRoots = ["AAA Certificate Services", "emSign"];

/** Where `bun run ci:images` and CI write an image's bake directory, from the repository's root. */
export const bakeDirectory = (key: string) => `build/ci-images/${key}`;
/** Hosts more than one tool downloads from. */
const mirrors = {
  /** Bun's own copies of what has no stable public URL. */
  bunArtifacts: "https://buncistore.blob.core.windows.net/artifacts",
  alpine: "https://dl-cdn.alpinelinux.org/alpine",
  /** Ubuntu keeps every architecture but x86 apart. */
  ubuntu: { x64: "http://archive.ubuntu.com/ubuntu", aarch64: "http://ports.ubuntu.com/ubuntu-ports" },
} as const;

/** Alpine and Homebrew name LLVM's packages by its major, and so does clang its own directories. */
const llvmMajor = pins.llvm.version.split(".")[0]!;

/**
 * The programs of LLVM's Linux release that go on an image. The release also has
 * Flang, MLIR, LLDB, BOLT and the libraries to link LLVM into another program,
 * each program with all of LLVM inside it, and nothing here runs those.
 */
const llvmPrograms = [
  ...[`clang-${llvmMajor}`, "clang", "clang++", "clang-cl", "clang-cpp", "clang-format", "clang-tidy"],
  ...["lld", "ld.lld", "ld64.lld", "lld-link", "wasm-ld"],
  ...["llvm-ar", "llvm-ranlib", "llvm-lib", "llvm-dlltool"],
  ...["llvm-objcopy", "llvm-strip", "llvm-install-name-tool", "llvm-bitcode-strip"],
  ...["llvm-nm", "llvm-readobj", "llvm-readelf", "llvm-objdump", "llvm-otool", "llvm-size", "llvm-strings"],
  ...["llvm-cxxfilt", "llvm-undname", "llvm-symbolizer", "llvm-addr2line", "llvm-dwarfdump", "llvm-config"],
  ...["llvm-cov", "llvm-profdata"],
  // For macOS and Windows targets.
  ...["dsymutil", "llvm-lipo", "llvm-rc", "llvm-windres", "llvm-mt", "llvm-ml", "llvm-cvtres", "llvm-pdbutil"],
];

/** The same CPU, as each publisher spells it. */
const cpuName = { x64: "x86_64", aarch64: "aarch64" } as const;
const debianArch = { x64: "amd64", aarch64: "arm64" } as const;
const llvmArch = { x64: "X64", aarch64: "ARM64" } as const;
const nodeArch = { x64: "x64", aarch64: "arm64" } as const;

/** What the `prefetch` tool downloads is decided by the commit being built: a dependency bump does not rename an image. */
const prefetched: Identity = { kind: "notRecorded", reason: "decided by the commit being built, not by this file" };
const prefetchTrigger = `prefetchTriggerVersion ${prefetchTriggerVersion}: raise it in spec.ts to bake again and refresh what is prefetched.`;
/** The three `bun install`s a test job runs. */
const installedPackages = [".", "test", "scripts/ci-remap-server"];

/** How Packer bakes a Windows image (the template itself is rendered by `renderPackerTemplate`). */
export const windowsBake = {
  osDiskGb: 150,
  /** Packer publishes an image as this version of the gallery image definition named after it. */
  galleryVersion: "1.0.0",
  /** Where a published image is replicated, besides the gallery's own region: every region CI launches Windows machines in. */
  galleryRegions: [
    ...["australiaeast", "brazilsouth", "canadacentral", "canadaeast", "centralindia", "centralus", "francecentral"],
    ...[
      "germanywestcentral",
      "italynorth",
      "japaneast",
      "japanwest",
      "koreacentral",
      "mexicocentral",
      "northcentralus",
    ],
    ...["northeurope", "southcentralus", "southeastasia", "spaincentral", "swedencentral", "switzerlandnorth"],
    ...["uaenorth", "ukwest", "westeurope", "westus", "westus2", "westus3"],
  ],
} as const;

const limits = { openFiles: 1048576, processes: 1048576 };

// ══════════════════════════════════════════════════════════════════ 2. TOOLS
// A tool is one thing a bake sets up on the machine. Each is a function of the
// image, written in the vocabulary of section 3, and says what should be true.

/** Where an executable goes so that every user finds it. */
const bin = (image: Image, name: string) =>
  image.os === "windows" ? `C:/Windows/System32/${name}.exe` : `/usr/local/bin/${name}`;

/** `linux-x64`, `linux-aarch64-musl`, `windows-x64`, `darwin-aarch64`: what a publisher builds a file for, and the key of its sum in `pins`. */
const platform = (image: Image) =>
  image.os === "linux" && image.abi === "musl"
    ? (`linux-${image.arch}-musl` as const)
    : (`${image.os}-${image.arch}` as const);

function aptSuite(image: LinuxImage): string {
  const suite = aptSuites[image.release];
  if (!suite) throw new BuildError(`aptSuites has no name for ${image.distro} ${image.release}`);
  return suite;
}

/** Packages from the distro's own repositories. */
function packages(image: LinuxImage): Tool {
  return {
    name: "packages",
    identity: packageDatabase,
    steps: [
      image.distro === "alpine" ? apkAdd(apkPackages, { update: true }) : aptInstall(aptPackages, { update: true }),
    ],
  };
}

/**
 * The system's trusted roots without `droppedRoots`. curl, git, wget and the
 * agent read them. Bun and Node.js use lists of their own unless told otherwise.
 */
function caCertificates(): Tool {
  const trusted = "/etc/ssl/certs";
  // Names each file after the first that holds the first file's certificate, and fails if there is one.
  const stillHeld = [
    `/^-----BEGIN CERTIFICATE-----/ { body = ""; next }`,
    `/^-----END CERTIFICATE-----/ {`,
    `  if (NR == FNR) dropped = body`,
    `  else if (body == dropped) { print FILENAME " still holds " ARGV[1]; held = 1 }`,
    `  next`,
    `}`,
    `{ body = body $0 }`,
    `END { exit held }`,
  ].join("\n");
  return {
    name: "ca-certificates",
    identity: observed(run("grep", "-c", "BEGIN CERTIFICATE", `${trusted}/ca-certificates.crt`)),
    steps: [
      comment("A line that starts with ! names a root that the package has and the machine does not trust."),
      ...droppedRoots.map(root => run("sed", "-i", `s,^${root},!&,`, "/etc/ca-certificates.conf")),
      run("update-ca-certificates"),
      comment("A dropped root's file stays in /usr/share. A release without the file has nothing to look for."),
      ...droppedRoots.map(root =>
        forEachFile("root", text`/usr/share/ca-certificates/${root}${glob("*")}`, [
          ifExists(variable("root"), [
            run(
              "awk",
              stillHeld,
              variable("root"),
              text`${trusted}/${glob("*.crt")}`,
              text`${trusted}/${glob("*.pem")}`,
            ),
          ]),
        ]),
      ),
    ],
  };
}

/** No limit on anything, and high ones on open files and processes, for every session and service. */
function ulimits(image: LinuxImage): Tool {
  const names = [
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
  ];
  const value = (limit: string) =>
    limit === "nofile" ? limits.openFiles : limit === "nproc" ? limits.processes : "unlimited";
  if (image.distro === "alpine") {
    // OpenRC applies rc_ulimit to every service it starts, the agent included.
    const flags = ["c", "d", "e", "f", "i", "l", "m", "q", "r", "s", "t", "v", "x"]
      .map(flag => `-${flag} unlimited`)
      .join(" ");
    return {
      name: "ulimits",
      identity: configuration,
      steps: [appendLines("/etc/rc.conf", [`rc_ulimit="${flags} -n ${limits.openFiles} -u ${limits.processes}"`])],
    };
  }
  return {
    name: "ulimits",
    identity: configuration,
    steps: [
      directory("/etc/security/limits.d"),
      writeFile(
        "/etc/security/limits.d/99-unlimited.conf",
        names.flatMap(limit =>
          ["root", "*"].flatMap(who => [
            `${who} soft ${limit} ${value(limit)}`,
            `${who} hard ${limit} ${value(limit)}`,
          ]),
        ),
      ),
      comment(`systemd says "infinity" where limits.conf says "unlimited".`),
      appendLines(
        "/etc/systemd/system.conf",
        names.map(
          limit => `DefaultLimit${limit.toUpperCase()}=${value(limit) === "unlimited" ? "infinity" : value(limit)}`,
        ),
      ),
      appendLines("/etc/pam.d/common-session", ["session optional pam_limits.so"]),
      appendLines("/etc/pam.d/common-session-noninteractive", ["session optional pam_limits.so"]),
    ],
  };
}

/** The user CI's jobs run as, and the agent's directories. */
function agentAccount(): Tool {
  const { homePath, cachePath, logsPath } = linuxAgentPaths;
  const owner = `${agentUser}:${agentUser}`;
  return {
    name: "agent-account",
    identity: configuration,
    steps: [
      systemUser(agentUser, homePath),
      ...[homePath, cachePath, logsPath].map(path => directory(path, { owner })),
      comment("One checkout directory for every job, so compiler caches keyed on paths hit."),
      directory(`${homePath}/hooks`),
      writeFile(
        `${homePath}/hooks/environment`,
        ["#!/bin/sh", "set -efu", `export BUILDKITE_BUILD_CHECKOUT_PATH=${homePath}/build`],
        { executable: true },
      ),
      ownedBy(owner, `${homePath}/hooks`),
    ],
  };
}

/** Node.js, its headers, and the node-gyp cache that lets native addons build offline. */
function nodejs(image: Image): Tool {
  const { version, nodeGypInstallVersion, sha256 } = pins.nodejs;
  const arch = nodeArch[image.arch];
  const headers = unpackedArchive({
    url: `https://nodejs.org/download/release/v${version}/node-v${version}-headers.tar.gz`,
    sha256: sha256.headers,
    file: "headers.tar.gz",
    into: scratch("headers"),
    strip: 1,
  });
  /** node-gyp looks in its cache before it downloads anything. */
  const gypCache = (cache: Value, extra: Step[] = []): Step[] => [
    directory(cache),
    copy(scratch("headers/include"), cache),
    ...extra,
    writeFile(text`${cache}/installVersion`, [nodeGypInstallVersion]),
  ];
  return { name: "nodejs", identity: pinned(version), steps: image.os === "windows" ? onWindows() : elsewhere(image) };

  function onWindows(): Step[] {
    return [
      scoopInstall(`nodejs@${version}`),
      ...headers,
      comment("node.lib: what a native addon links against on Windows."),
      download(
        `https://nodejs.org/dist/v${version}/win-${arch}/node.lib`,
        scratch("node.lib"),
        sha256[platform(image)],
      ),
      comment("Two caches: the one of the user who runs this, and the one of the agent's service account."),
      ...[environment("LOCALAPPDATA"), `${windowsAgentHome}/AppData/Local`].flatMap(base => {
        const cache = text`${base}/node-gyp/Cache/${version}`;
        return gypCache(cache, [
          directory(text`${cache}/${arch}`),
          copy(scratch("node.lib"), text`${cache}/${arch}/node.lib`),
        ]);
      }),
    ];
  }

  function elsewhere(image: LinuxImage | MacosImage): Step[] {
    // nodejs.org only ships glibc builds.
    const url =
      image.os === "linux" && image.abi === "musl"
        ? `https://unofficial-builds.nodejs.org/download/release/v${version}/node-v${version}-linux-${arch}-musl.tar.gz`
        : `https://nodejs.org/dist/v${version}/node-v${version}-${image.os}-${arch}.tar.gz`;
    return [
      ...unpackedArchive({
        url,
        sha256: sha256[platform(image)],
        file: "node.tar.gz",
        into: scratch("node"),
        strip: 1,
      }),
      ...["/usr/local/bin", "/usr/local/lib", "/usr/local/include"].map(path => directory(path)),
      copy(scratch("node/bin/."), "/usr/local/bin/"),
      copy(scratch("node/lib/node_modules"), "/usr/local/lib/"),
      copy(scratch("node/include/node"), "/usr/local/include/"),
      ...headers,
      copy(scratch("headers/include/."), "/usr/local/include/"),
      ...(image.os === "linux"
        ? [
            ...gypCache(`${linuxAgentPaths.homePath}/.cache/node-gyp/${version}`),
            ownedBy(agentUser, `${linuxAgentPaths.homePath}/.cache`),
          ]
        : [...gypCache(text`${environment("HOME")}/Library/Caches/node-gyp/${version}`), addToPath("/usr/local/bin")]),
    ];
  }
}

function bun(image: Image): Tool {
  const triplet = `bun-${platform(image)}`;
  return {
    name: "bun",
    identity: pinned(pins.bun.version),
    steps: [
      ...executableFromArchive({
        url: `https://github.com/oven-sh/bun/releases/download/bun-v${pins.bun.version}/${triplet}.zip`,
        sha256: pins.bun.sha256[platform(image)],
        kind: "zip",
        member: `${triplet}/bun${image.os === "windows" ? ".exe" : ""}`,
        to: bin(image, "bun"),
      }),
      ...(image.os === "windows" ? [] : [symlink("bun", bin(image, "bunx"))]),
    ],
  };
}

/**
 * Bun's build of ninja (oven-sh/ninja), in a directory of its own that is not
 * on PATH: the build driver runs it from here (ninja-release.ts), and `ninja`
 * on PATH is still the machine's own. The release publishes each zip's sha256
 * in its bun-ninja.json, and the Linux binary is static, so every distro gets
 * the same one.
 */
function bunNinja(image: Image): Tool {
  const build = `${image.os}-${image.arch}` as const;
  return {
    name: "bun-ninja",
    identity: pinned(pins.bunNinja.tag),
    steps: unpackedArchive({
      url: `https://github.com/oven-sh/ninja/releases/download/${pins.bunNinja.tag}/bun-ninja-${build}.zip`,
      sha256: pins.bunNinja.sha256[build],
      file: "ninja.zip",
      into: locations.bunNinja[image.os],
      ...(image.os === "windows" ? {} : { only: ["ninja"] }),
    }),
  };
}

/** A static curl built with HTTP/3, as `curl-h3` beside the system's curl. The HTTP/3 tests find it through $CURL_HTTP3. */
function curlH3(image: Image): Tool {
  const { version } = pins.curlH3;
  const cpu = cpuName[image.arch];
  const asset =
    image.os === "linux"
      ? `curl-linux-${cpu}-${image.abi === "musl" ? "musl" : "glibc"}`
      : image.os === "windows"
        ? `curl-windows-${cpu}`
        : `curl-macos-${image.arch === "x64" ? "x86_64" : "arm64"}`;
  const url = `https://github.com/stunnel/static-curl/releases/download/${version}/${asset}-${version}.tar.xz`;
  const windows = image.os === "windows";
  return {
    name: "curl-h3",
    identity: pinned(version),
    steps: [
      ...executableFromArchive({
        url,
        sha256: pins.curlH3.sha256[platform(image)],
        kind: "tar.xz",
        member: windows ? "curl.exe" : "curl",
        // 7-Zip, which unpacks it on Windows, takes the whole archive out.
        ...(windows ? {} : { extractOnly: "curl" }),
        to: bin(image, "curl-h3"),
      }),
      ...(windows ? [copy(scratch("unpacked/curl-ca-bundle.crt"), "C:/Windows/System32/curl-ca-bundle.crt")] : []),
      setEnvironment("CURL_HTTP3", bin(image, "curl-h3")),
    ],
  };
}

/** Tailscale publishes no package for Alpine, which has its own. */
function tailscale(image: LinuxImage): Tool {
  if (image.distro === "alpine") {
    return {
      name: "tailscale",
      identity: packageDatabase,
      steps: [apkAdd(["tailscale"]), service("tailscale", "enabled"), service("tailscale", "started")],
    };
  }
  const { version, keySha256 } = pins.tailscale;
  const repository = `https://pkgs.tailscale.com/stable/${image.distro}`;
  const suite = aptSuite(image);
  return {
    name: "tailscale",
    identity: pinned(version),
    steps: [
      ...aptRepository({
        name: "tailscale",
        key: { url: `${repository}/${suite}.noarmor.gpg`, sha256: keySha256, kind: "gpg" },
        url: repository,
        suite,
        component: "main",
      }),
      aptInstall([`tailscale=${version}`], { update: true }),
    ],
  };
}

function buildkiteAgent(image: BakedImage): Tool {
  const { version } = pins.buildkiteAgent;
  const sha256 = pins.buildkiteAgent.sha256[`${image.os}-${image.arch}`];
  const release = `https://github.com/buildkite/agent/releases/download/v${version}`;
  const onWindows = [
    directory(`${windowsAgentHome}/bin`),
    directory(`${windowsAgentHome}/hooks`),
    ...executableFromArchive({
      url: `${release}/buildkite-agent-windows-${debianArch[image.arch]}-${version}.zip`,
      sha256,
      kind: "zip",
      member: "buildkite-agent.exe",
      to: `${windowsAgentHome}/bin/buildkite-agent.exe`,
    }),
    addToPath(`${windowsAgentHome}/bin`),
    comment("One checkout directory for every job, so compiler caches keyed on paths hit."),
    writeFile(`${windowsAgentHome}/hooks/environment.ps1`, [
      `$env:BUILDKITE_BUILD_CHECKOUT_PATH = "${windowsAgentHome}\\build"`,
    ]),
  ];
  const onLinux = executableFromArchive({
    url: `${release}/buildkite-agent-linux-${debianArch[image.arch]}-${version}.tar.gz`,
    sha256,
    kind: "tar.gz",
    member: "buildkite-agent",
    extractOnly: "./buildkite-agent",
    to: bin(image, "buildkite-agent"),
  });
  return { name: "buildkite-agent", identity: pinned(version), steps: image.os === "windows" ? onWindows : onLinux };
}

function cmake(image: LinuxImage): Tool {
  if (image.distro === "alpine") return { name: "cmake", identity: packageDatabase, steps: [apkAdd(["cmake"])] };
  const { version, sha256 } = pins.cmake;
  const url = `https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-linux-${cpuName[image.arch]}.sh`;
  return {
    name: "cmake",
    identity: pinned(version),
    steps: [
      download(url, scratch("cmake.sh"), sha256[image.arch]),
      run("sh", scratch("cmake.sh"), "--skip-license", "--prefix=/usr"),
    ],
  };
}

/**
 * clang, lld and the LLVM tools: the exact release on Debian and Ubuntu, from
 * LLVM's own build of it, and on Windows, from Scoop. LLVM has no build for
 * musl or for an Intel Mac, and neither Alpine nor Homebrew can be asked for a
 * patch release, only for a major; scripts/build/tools.ts is what decides
 * whether the compiler it finds is close enough to the pin.
 */
function llvm(image: Image): Tool {
  const { version } = pins.llvm;
  const major = llvmMajor;
  if (image.os === "windows") {
    return {
      name: "llvm",
      identity: pinned(version),
      steps: [scoopInstall(`${image.arch === "x64" ? "llvm" : "llvm-arm64"}@${version}`)],
    };
  }
  if (image.os === "darwin") {
    const prefix = locations.brew[image.arch];
    const keg = `${prefix}/opt/llvm@${major}/bin`;
    return {
      name: "llvm",
      identity: packageDatabase,
      steps: [
        brewInstall([`llvm@${major}`], { formula: true }),
        comment(
          "llvm@N is keg-only, and `brew link --force` refuses it while N is Homebrew's current LLVM.\n" +
            "scripts/darwin-ci runs a job with only Homebrew's bin on PATH, no profile, so the keg's tools are linked there.",
        ),
        forEachFile("tool", text`${keg}/${glob("*")}`, [symlink(variable("tool"), `${prefix}/bin/`)]),
        addToPath(keg),
      ],
    };
  }
  if (image.distro === "alpine") {
    return {
      name: "llvm",
      identity: packageDatabase,
      steps: [
        comment(
          "Alpine's release stops at an older LLVM; newer majors are in edge/main. `@edge` is a tagged\n" +
            "repository: apk takes a package from it only when asked for with the tag, so musl and libstdc++\n" +
            "stay the release's. llvmN-dev is left out: it needs edge's python3.",
        ),
        appendLines("/etc/apk/repositories", [`@edge ${mirrors.alpine}/edge/main`]),
        apkAdd([`llvm${major}@edge`, `clang${major}@edge`, `lld${major}@edge`, "scudo-malloc"], { update: true }),
        comment("llvm-symbolizer, llvm-objcopy and the rest are only versioned in /usr/bin."),
        addToPath(`/usr/lib/llvm${major}/bin`),
      ],
    };
  }
  return {
    name: "llvm",
    identity: pinned(version),
    steps: [
      ...llvmRelease(image.arch, [...llvmPrograms.map(name => `bin/${name}`), `lib/clang/${major}`]),
      ...installedDeb({
        url: ubuntuDebUrl(pins.llvm.icu, image.arch),
        sha256: pins.llvm.icu.sha256[image.arch],
        file: "libicu.deb",
      }),
      addToPath(`${locations.llvm}/bin`),
    ],
  };
}

/** These files and directories of LLVM's Linux release for `arch`, where the image has LLVM. */
function llvmRelease(arch: Arch, members: string[]): Step[] {
  const { version, sha256 } = pins.llvm;
  const root = `LLVM-${version}-Linux-${llvmArch[arch]}`;
  return unpackedArchive({
    url: `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version}/${root}.tar.xz`,
    sha256: sha256[arch],
    file: `llvm-${arch}.tar.xz`,
    into: locations.llvm,
    strip: 1,
    only: members.map(member => `${root}/${member}`),
  });
}

/**
 * rustup and the toolchain Bun is built with, in a home every user can use.
 * rust-toolchain.toml has to say the same thing, because rustup reads it; a
 * source lint keeps the two in step.
 */
function rust(image: Image): Tool {
  const { rustup, rustupSha256, channel, components, targets } = pins.rust;
  const cpu = cpuName[image.arch];
  const host =
    image.os === "linux"
      ? `${cpu}-unknown-linux-${image.abi}`
      : image.os === "windows"
        ? `${cpu}-pc-windows-msvc`
        : `${cpu}-apple-darwin`;
  const home = locations.rust[image.os];
  const installer = scratch(image.os === "windows" ? "rustup-init.exe" : "rustup-init");
  const install = [
    download(
      `https://static.rust-lang.org/rustup/archive/${rustup}/${host}/rustup-init${image.os === "windows" ? ".exe" : ""}`,
      installer,
      rustupSha256[platform(image)],
    ),
    ...(image.os === "windows" ? [] : [mode("+x", installer)]),
    run(
      installer,
      "-y",
      "--no-modify-path",
      "--profile",
      "minimal",
      "--default-toolchain",
      channel,
      "--component",
      components.join(","),
      "--target",
      targets.join(","),
    ),
  ];
  const onWindows = [
    setEnvironment("CARGO_HOME", `${home}/cargo`),
    setEnvironment("RUSTUP_HOME", `${home}/rustup`),
    ...install,
    addToPath(`${home}/cargo/bin`),
  ];
  const elsewhere = [
    // A Mac is set up by its admin user, and a bare host runs its jobs as another.
    ...(image.os === "darwin" ? [directory(home, { owner: output(run("id", "-un")) })] : []),
    setEnvironment("RUSTUP_HOME", home),
    setEnvironment("CARGO_HOME", home),
    ...install,
    addToPath(`${home}/bin`),
    // Builds run as the agent's user, and cargo writes its registry here.
    image.os === "linux" ? ownedBy(`${agentUser}:${agentUser}`, home) : mode("a+rwX", home, { recursive: true }),
  ];
  return {
    name: "rust",
    identity: pinned(`${channel} (rustup ${rustup})`),
    steps: image.os === "windows" ? onWindows : elsewhere,
  };
}

/** The x86-64 compiler runtime, so the arm64 build image can link for x64. A release of LLVM has only its own architecture's. */
function crossCompilerRt(): Tool {
  return {
    name: "cross-compiler-rt",
    identity: pinned(pins.llvm.version),
    steps: llvmRelease("x64", [`lib/clang/${llvmMajor}/lib/x86_64-unknown-linux-gnu`]),
  };
}

function androidNdk(): Tool {
  const { version, apiLevel, sha256 } = pins.androidNdk;
  const ndk = locations.androidNdk;
  const parent = ndk.slice(0, ndk.lastIndexOf("/"));
  const prebuilt = `${ndk}/toolchains/llvm/prebuilt/linux-x86_64`;
  const resourceDir = variable("resource_dir");
  const ndkRuntime = text`${prebuilt}/lib/clang/${variable("ndk_clang")}/lib/linux`;
  return {
    name: "android-ndk",
    identity: pinned(version),
    steps: [
      ...unpackedArchive({
        url: `https://dl.google.com/android/repository/android-ndk-${version}-linux.zip`,
        sha256,
        file: "ndk.zip",
        into: parent,
      }),
      move(`${parent}/android-ndk-${version}`, ndk),
      comment("The NDK's own clang, lldb and non-Android runtimes: about 1.1 GB nothing uses."),
      remove(
        `${prebuilt}/bin`,
        `${prebuilt}/python3`,
        `${prebuilt}/lib/liblldb.so`,
        `${ndk}/simpleperf`,
        `${ndk}/shader-tools`,
        `${ndk}/sources`,
      ),
      setEnvironment("ANDROID_NDK_ROOT", ndk),
      comment(
        "clang looks for libclang_rt.builtins and libunwind in its own resource directory and nowhere else,\n" +
          "so the NDK's are linked into it: in the per-triple layout, and in the flat one clang looks in after it.",
      ),
      set("resource_dir", output(run("clang", "-print-resource-dir"))),
      set("ndk_clang", output(pipe(run("ls", `${prebuilt}/lib/clang/`), run("head", "-n1")))),
      ...["aarch64", "x86_64"].flatMap(arch => {
        const triple = text`${resourceDir}/lib/${arch}-unknown-linux-android${apiLevel}`;
        return [
          directory(text`${resourceDir}/lib/linux/${arch}`),
          directory(triple),
          symlink(text`${ndkRuntime}/libclang_rt.builtins-${arch}-android.a`, text`${resourceDir}/lib/linux/`),
          symlink(text`${ndkRuntime}/${arch}/libunwind.a`, text`${resourceDir}/lib/linux/${arch}/`),
          symlink(text`${ndkRuntime}/libclang_rt.builtins-${arch}-android.a`, text`${triple}/libclang_rt.builtins.a`),
          symlink(text`${ndkRuntime}/${arch}/libunwind.a`, text`${triple}/libunwind.a`),
        ];
      }),
    ],
  };
}

function freebsdSysroot(): Tool {
  const { version, baseUrl, sha256 } = pins.freebsd;
  return {
    name: "freebsd-sysroot",
    identity: pinned(version),
    steps: (["x64", "aarch64"] as const).flatMap(arch =>
      unpackedArchive({
        url: `${baseUrl}/${debianArch[arch]}/${version}-RELEASE/base.txz`,
        sha256: sha256[arch],
        file: `base-${arch}.tar.xz`,
        into: locations.freebsdSysroot[arch],
        only: ["./usr/include", "./usr/lib", "./lib"],
      }),
    ),
  };
}

/**
 * ubuntu:20.04's root filesystem (glibc 2.31), focal's libc headers, and
 * gcc-13's libstdc++: the environment WebKit's prebuilt is built in. The
 * architectures and package names are known here, so the script loops only
 * over what is known on the machine.
 */
function glibcSysroot(): Tool {
  const { ubuntu, debs, gccDebs } = pins.glibcSysroot;
  return {
    name: "glibc-sysroot",
    identity: observed(treeDigest(locations.glibcSysroot.x64, locations.glibcSysroot.aarch64)),
    steps: [
      comment("binutils-x86-64-linux-gnu: a strip that accepts x86-64 objects on the arm64 host."),
      aptInstall(["skopeo", "jq", "binutils-x86-64-linux-gnu"]),
      ...(["x64", "aarch64"] as const).flatMap((arch): Step[] => {
        const deb = debianArch[arch];
        const triple = `${cpuName[arch]}-linux-gnu`;
        const sysroot = locations.glibcSysroot[arch];
        const image = scratch(`image-${deb}`);
        return [
          comment(
            `${deb}: ubuntu:${ubuntu.release}'s root filesystem. Device nodes cannot be made here and are not needed.`,
          ),
          directory(sysroot),
          run(
            "skopeo",
            "copy",
            "--override-arch",
            deb,
            `docker://docker.io/library/ubuntu@${ubuntu.image}`,
            text`dir:${image}`,
          ),
          forEachOutput(
            "layer",
            pipe(run("jq", "-r", ".layers[].digest", text`${image}/manifest.json`), run("sed", "s/^sha256://")),
            [tolerate(run("tar", "-xzf", text`${image}/${variable("layer")}`, "-C", sysroot))],
          ),
          comment(`${deb}: libc's runtime and headers.`),
          ...debs.flatMap((libcDeb): Step[] => [
            download(ubuntuDebUrl(libcDeb, arch), scratch("package.deb"), libcDeb.sha256[arch]),
            run("dpkg-deb", "-x", scratch("package.deb"), sysroot),
          ]),
          comment(`${deb}: absolute symlinks point at the host; keep them inside the sysroot.`),
          forEachOutput("link", run("find", sysroot, "-type", "l"), [
            set("target", output(run("readlink", variable("link")))),
            whenStartsWith(variable("target"), "/", [symlink(text`${sysroot}${variable("target")}`, variable("link"))]),
          ]),
          comment("libc.so is a linker script that names /lib/<triple>/."),
          unlessExists(`${sysroot}/lib/${triple}/libc.so.6`, [
            directory(`${sysroot}/lib`),
            symlink(`../usr/lib/${triple}`, `${sysroot}/lib/${triple}`),
          ]),
          ...(arch === "x64"
            ? [unlessExists(`${sysroot}/lib64`, [symlink(`usr/lib/${triple}`, `${sysroot}/lib64`)])]
            : []),
          comment(`${deb}: gcc-13's libstdc++ and libgcc, the same packages WebKit's image uses.`),
          ...unpackedArchive({
            url: `${gccDebs.url}/gcc-13-focal-${deb}.tar.gz`,
            sha256: gccDebs.sha256[arch],
            file: `gcc-${deb}.tar.gz`,
            into: scratch(`gcc-${deb}`),
          }),
          forEachFile("deb", text`${scratch(`gcc-${deb}`)}/${glob("*.deb")}`, [
            run("dpkg-deb", "-x", variable("deb"), sysroot),
          ]),
        ];
      }),
    ],
  };
}

/**
 * Alpine's musl, headers and libstdc++ for both architectures. apk.static
 * installs packages of any architecture into any root. A release's repository
 * has only the newest build of each package, so there is no version to ask for.
 */
function muslSysroot(image: LinuxImage): Tool {
  const newest = unchecked("Alpine's repository has only the newest build of a package.");
  const repository = `${mirrors.alpine}/v${pins.muslSysroot.alpineRelease}/main`;
  const host = cpuName[image.arch];
  const versionOf = `/^P:apk-tools-static$/{f=1} f&&/^V:/{print substr($0,3); exit}`;
  return {
    name: "musl-sysroot",
    identity: observed(treeDigest(locations.muslSysroot.x64, locations.muslSysroot.aarch64)),
    steps: [
      download(`${repository}/${host}/APKINDEX.tar.gz`, scratch("APKINDEX.tar.gz"), newest),
      set("version", output(pipe(run("tar", "-xzOf", scratch("APKINDEX.tar.gz"), "APKINDEX"), run("awk", versionOf)))),
      failUnlessNotEmpty(variable("version"), "the Alpine index has no apk-tools-static"),
      comment("An .apk is a gzipped tar."),
      ...unpackedArchive({
        url: text`${repository}/${host}/apk-tools-static-${variable("version")}.apk`,
        sha256: newest,
        file: "apk-tools-static.tar.gz",
        into: scratch(),
        only: ["sbin/apk.static"],
      }),
      ...(["x64", "aarch64"] as const).flatMap(arch => [
        directory(locations.muslSysroot[arch]),
        run(
          scratch("sbin/apk.static"),
          ...["--arch", cpuName[arch], "--root", locations.muslSysroot[arch], "--repository", repository],
          ...[
            "--allow-untrusted",
            "--no-cache",
            "--initdb",
            "add",
            "musl-dev",
            "libc-dev",
            "linux-headers",
            "g++",
            "libstdc++-dev",
          ],
        ),
        comment("apk's log has the time of the install in it: with it, no two bakes observe the same sysroot."),
        remove(`${locations.muslSysroot[arch]}/var/log/apk.log`),
      ]),
    ],
  };
}

/** The MSVC CRT, the Windows SDK and ATL, which xwin downloads from Microsoft. */
function windowsSysroot(image: LinuxImage): Tool {
  const { xwin, xwinSha256, sdk, crt } = pins.windowsSysroot;
  const sysroot = locations.windowsSysroot;
  const host = `${cpuName[image.arch]}-unknown-linux-musl`;
  return {
    name: "windows-sysroot",
    identity: pinned(`xwin ${xwin}, SDK ${sdk}, CRT ${crt}`),
    steps: [
      ...unpackedArchive({
        url: `https://github.com/Jake-Shadle/xwin/releases/download/${xwin}/xwin-${xwin}-${host}.tar.gz`,
        sha256: xwinSha256[image.arch],
        file: "xwin.tar.gz",
        into: scratch("xwin"),
        strip: 1,
      }),
      directory(sysroot),
      comment(
        "splat moves what it unpacked with rename(2), which cannot cross filesystems: the cache goes next to the output.",
      ),
      discardOutput(
        run(
          scratch("xwin/xwin"),
          ...[
            "--accept-license",
            "--arch",
            "x86_64,aarch64",
            "--sdk-version",
            sdk,
            "--crt-version",
            crt,
            "--include-atl",
          ],
          ...[
            "--cache-dir",
            `${sysroot}.cache`,
            "splat",
            "--use-winsysroot-style",
            "--preserve-ms-arch-notation",
            "--include-debug-libs",
          ],
          ...["--output", sysroot],
        ),
      ),
      remove(`${sysroot}.cache`),
      comment("clang-cl asks for Include and Lib; xwin writes them in lower case."),
      symlink("include", `${sysroot}/Windows Kits/10/Include`),
      symlink("lib", `${sysroot}/Windows Kits/10/Lib`),
    ],
  };
}

/** Apple's SDK, which the vendored xmac downloads from Apple's software-update servers. */
function macosSdk(): Tool {
  const { sdk, commandLineTools } = pins.macosSdk;
  return {
    name: "macos-sdk",
    identity: pinned(`${sdk} (Command Line Tools ${commandLineTools})`),
    steps: [
      discardOutput(
        run(
          "bun",
          bakeFile("xmac.mjs"),
          ...["splat", "--accept-license", "--sdk-only", "--release", commandLineTools, "--sdk", sdk],
          ...["--output", scratch("sdk"), "--cache-dir", scratch("sdk-cache")],
        ),
      ),
      directory(locations.macosSdk),
      move(scratch(`sdk/SDKs/MacOSX${sdk}.sdk`), `${locations.macosSdk}/`),
    ],
  };
}

/** Docker publishes no package for Alpine, which has its own. */
function docker(image: LinuxImage): Tool {
  const ready = [service("docker", "enabled"), addUserToGroup(agentUser, "docker")];
  if (image.distro === "alpine") {
    return { name: "docker", identity: packageDatabase, steps: [apkAdd(["docker", "docker-cli-compose"]), ...ready] };
  }
  const { engine, containerd, buildx, compose } = pins.docker[image.distro];
  const repository = `https://download.docker.com/linux/${image.distro}`;
  const suite = aptSuite(image);
  const build = `-1~${image.distro}.${image.release}~${suite}`;
  return {
    name: "docker",
    identity: pinned(engine),
    steps: [
      ...aptRepository({
        name: "docker",
        key: { url: `${repository}/gpg`, sha256: pins.docker.keySha256, kind: "asc" },
        url: repository,
        suite,
        component: "stable",
      }),
      aptInstall(
        [
          `docker-ce=5:${engine}${build}`,
          `docker-ce-cli=5:${engine}${build}`,
          `containerd.io=${containerd}${build}`,
          `docker-buildx-plugin=${buildx}${build}`,
          `docker-compose-plugin=${compose}${build}`,
          // docker-ce only recommends these. Where the kernel has AppArmor on, no container starts without its parser,
          // and Docker unpacks an image's layers with pigz when it is there.
          ...["apparmor", "pigz"],
        ],
        { update: true },
      ),
      ...ready,
    ],
  };
}

/** Google publishes Chrome for apt on amd64 only, and takes a version's file away some releases later. */
function chrome(): Tool {
  return {
    name: "chrome",
    identity: packageDatabase,
    steps: installedDeb({
      url: "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
      sha256: unchecked("this URL is the current release, and no URL of one release lasts."),
      file: "chrome.deb",
    }),
  };
}

/** Alpine has no python-fuse package. */
function pythonFuse(): Tool {
  const { version, sha256 } = pins.pythonFuse;
  return {
    name: "python-fuse",
    identity: pinned(version),
    steps: [
      apkAdd(["python3-dev", "fuse-dev", "pkgconf", "py3-setuptools"]),
      ...unpackedArchive({
        url: `https://files.pythonhosted.org/packages/source/f/fuse-python/fuse_python-${version}.tar.gz`,
        sha256,
        file: "python-fuse.tar.gz",
        into: scratch(),
      }),
      inDirectory(scratch(`fuse_python-${version}`), [
        run("python3", "setup.py", "build"),
        run("python3", "setup.py", "install"),
      ]),
      appendLines("/etc/modules-load.d/fuse.conf", ["fuse"]),
    ],
  };
}

/**
 * Alpine 3.23.6's dhcpcd (10.5.2) never returns from `dhcpcd --waitip`, which cloud-init waits on for its
 * 300 second timeout at every boot. busybox's udhcpc is a DHCP client cloud-init supports, and it does not hang.
 */
function cloudInitDhcpClient(): Tool {
  return {
    name: "cloud-init-dhcp-client",
    identity: configuration,
    steps: [
      run("which", "udhcpc"),
      directory("/etc/cloud/cloud.cfg.d"),
      writeFile("/etc/cloud/cloud.cfg.d/99-dhcp-client.cfg", [
        "system_info:",
        "  network:",
        "    dhcp_client_priority: [udhcpc, dhcpcd]",
      ]),
    ],
  };
}

/** Encrypts the core dumps a failed test uploads. */
function age(image: LinuxImage): Tool {
  const { version, sha256 } = pins.age;
  return {
    name: "age",
    identity: pinned(version),
    steps: executableFromArchive({
      url: `https://github.com/FiloSottile/age/releases/download/v${version}/age-v${version}-linux-${debianArch[image.arch]}.tar.gz`,
      sha256: sha256[image.arch],
      kind: "tar.gz",
      member: "age/age",
      extractOnly: "age/age",
      to: bin(image, "age"),
    }),
  };
}

/** Core files go to one directory the test runner collects from, and gdb reads them. */
function coreDumps(image: LinuxImage): Tool {
  const cores = `/var/bun-cores-${image.distro}-${image.release}-${image.arch}`;
  const alpine = image.distro === "alpine";
  return {
    name: "core-dumps",
    identity: packageDatabase,
    steps: [
      directory(cores, { mode: "1777" }),
      directory("/etc/sysctl.d"),
      appendLines("/etc/sysctl.d/local.conf", [`kernel.core_pattern = ${cores}/%e-%p.core`]),
      ...(alpine
        ? []
        : [
            comment("Ubuntu's crash reporter would take the cores instead."),
            ifSucceeds(pipe(run("systemctl", "list-unit-files", "apport.service"), run("grep", "-q", "apport")), [
              service("apport.service", "disabled"),
            ]),
          ]),
      alpine ? apkAdd(["gdb"]) : aptInstall(["gdb"]),
      comment(
        "The test runner reads the pattern back with `sysctl`, as the agent's user, and Debian gives a user who is not root no sbin directory on PATH.",
      ),
      addToPath("/sbin"),
    ],
  };
}

/** /tmp on the disk: a tmpfs /tmp counts against memory, and tests write a lot there. */
function noTmpfs(): Tool {
  return { name: "no-tmpfs", identity: configuration, steps: [service("tmp.mount", "masked")] };
}

/**
 * What a build and a test job would otherwise download each time: dependency
 * sources for scripts/build/download.ts, the Docker images the tests use, and
 * `bun install`'s cache for the installs a test job runs. What is fetched is
 * decided by the commit being built, not by this file, so a dependency bump
 * does not rename an image (see `prefetchTriggerVersion`). The commit is
 * cloned for it and the clone is removed: nothing of it belongs in the image.
 */
function prefetch(image: BakedImage): Tool {
  const windows = image.os === "windows";
  const clone = windows ? "C:/bun-checkout" : "/var/tmp/bun-checkout";
  const sources = locations.prefetch[image.os];
  const cache = locations.installCache[image.os];
  return {
    name: "prefetch",
    identity: prefetched,
    steps: [
      comment(prefetchTrigger),
      run("git", "init", "--quiet", clone),
      run("git", "-C", clone, "fetch", "--quiet", "--depth=1", "https://github.com/oven-sh/bun.git", commit),
      run("git", "-C", clone, "checkout", "--quiet", "FETCH_HEAD"),
      comment("Dependency sources, read-only, so a build downloads none."),
      directory(sources),
      inDirectory(clone, [run("bun", "scripts/prefetch-deps.ts", sources)]),
      windows ? run("attrib", "+R", `${sources}/*`, "/S", "/D") : mode("a-w", sources, { recursive: true }),
      setEnvironment("BUN_BUILD_PREFETCH_DIR", sources),
      ...(windows
        ? []
        : [
            comment("The Docker images the tests use."),
            service("docker", "started"),
            inDirectory(clone, [run("bun", "test/docker/prepare-ci.ts")]),
          ]),
      comment("bun install's cache."),
      directory(cache),
      ...installedPackages.map(path =>
        inDirectory(`${clone}/${path}`, [
          withEnvironment({ BUN_INSTALL_CACHE_DIR: cache }, run("bun", "install", "--ignore-scripts")),
        ]),
      ),
      ...(windows ? [] : [ownedBy(`${agentUser}:${agentUser}`, cache)]),
      setEnvironment("BUN_INSTALL_CACHE_DIR", cache),
      // Remove-Item gives up on Git's read-only objects and on long paths.
      windows ? run("cmd", "/c", "rmdir", "/s", "/q", clone) : remove(clone),
    ],
  };
}

/** scripts/agent.ts installs itself as the machine's service. */
function agentService(): Tool {
  return { name: "agent-service", identity: configuration, steps: [run("node", bakeFile("agent.mts"), "install")] };
}

/**
 * The image's record: what this image is, the name it was baked under, and
 * what arrived on the day of the bake. For keying caches of build outputs on
 * the machine that made them (same bytes, same machine content), so nothing in
 * it may differ between two identical machines. It never feeds the image's
 * name. The bake job also publishes it as an artifact.
 *
 * It is lines, so that both shells can write it with ordinary steps:
 *
 *   name: <the image's name>
 *   image: <the spec's facts, as one line of JSON>
 *   tool <name>: <the kind of its identity, then a pinned value or a notRecorded reason>
 *   observed <name>: <a line an `observed` tool's step printed>
 *   package <a line of the package manager's database>
 */
function recordImage(image: BakedImage): Tool {
  const record = locations.imageRecord[image.os];
  // sh has no pipefail: a query whose output went straight into sort and sed could fail and leave a record
  // with no packages. So the query is a statement of its own, into a scratch file, and the rest reads the file.
  const packageList = scratch("packages");
  const queryPackages: Step[] =
    image.os === "windows"
      ? [toFile(scoopApps(), packageList)]
      : image.distro === "alpine"
        ? [
            toFile(run("apk", "list", "--installed"), scratch("apk-list")),
            // "name-version arch {origin} (license) [installed]"
            toFile(run("cut", "-d", " ", "-f1", scratch("apk-list")), packageList),
          ]
        : [
            // binary:Package says which architecture a package of another one is for.
            toFile(run("dpkg-query", "--show", "--showformat", "${binary:Package} ${Version}\\n"), packageList),
          ];
  /** A file's lines into the record, each after `prefix`; a file with none fails the bake. */
  const recordLines = (prefix: string, file: Value, failure: string, order: (lines: Step) => Step = lines => lines) => [
    failUnlessNotEmpty(output(linesOf(file)), failure),
    toFile(prefixed(prefix, order(linesOf(file))), record, { append: true }),
  ];
  return {
    name: "record-image",
    identity: configuration,
    // The record lists every tool, this one included, so the list is only asked for when the steps are.
    get steps() {
      const all = tools(image);
      return [
        toFile(printLine(text`name: ${imageName}`), record),
        appendLines(record, [`image: ${JSON.stringify(image)}`, ...all.map(recordedTool)]),
        ...all
          .filter(tool => tool.identity.kind === "observed")
          .flatMap(({ name }) =>
            recordLines(`observed ${name}: `, bakeFile(`observed/${name}`), `nothing was observed for ${name}`),
          ),
        ...queryPackages,
        recordLines("package ", packageList, "the package manager listed no packages", sorted),
      ].flat();
    },
  };
}

/** A tool's line of the image's record. */
export function recordedTool({ name, identity }: Tool): string {
  const value =
    identity.kind === "pinned" ? ` ${identity.value}` : identity.kind === "notRecorded" ? ` ${identity.reason}` : "";
  return `tool ${name}: ${identity.kind}${value}`;
}

function cleanup(image: LinuxImage): Tool {
  const everythingIn = (path: string) => text`${path}/${glob("*")}`;
  return {
    name: "cleanup",
    identity: configuration,
    steps: [
      ...(image.distro === "alpine"
        ? [remove(everythingIn("/var/cache/apk"))]
        : [run("apt-get", "clean"), remove(everythingIn("/var/lib/apt/lists"))]),
      remove(everythingIn("/tmp"), everythingIn("/var/tmp")),
      comment("Tells the disk which blocks are free, so the snapshot does not store them."),
      tolerate(run("fstrim", "--all")),
    ],
  };
}

// ---- Windows only

function windowsSystem(): Tool {
  return {
    name: "windows-system",
    identity: configuration,
    steps: [
      comment("Real-time scanning of every file a build writes costs more than the build."),
      cmdlet("Set-MpPreference", { DisableRealtimeMonitoring: expression("$true") }),
      cmdlet("Add-MpPreference", { ExclusionPath: ["C:/", "D:/"] }),
      comment("Windows 11's Smart App Control blocks unsigned executables, which is what tests build."),
      ifExists("HKLM:/SYSTEM/CurrentControlSet/Control/CI/Policy", [
        registryValue("HKLM:/SYSTEM/CurrentControlSet/Control/CI/Policy", "VerifiedAndReputablePolicyState", 0),
        ifSucceeds(cmdlet("Get-Command", { ErrorAction: "SilentlyContinue" }, "CiTool"), [
          discardOutput(run("CiTool", "--refresh", "-json")),
        ]),
      ]),
      registryValue(
        "HKLM:/SOFTWARE/Policies/Microsoft/Windows Advanced Threat Protection",
        "ForceDefenderPassiveMode",
        1,
        { onlyIfKeyExists: true },
      ),
      comment(
        "Search indexing, Windows Update, telemetry, WAP push, the compatibility assistant and Superfetch,\n" +
          "off from the image's first boot. A Windows edition that lacks one has nothing to disable.",
      ),
      ...pins.windowsSystem.disabledServices.map(name => serviceStartup(name, "Disabled", { onlyIfExists: true })),
      comment(`The "High performance" power plan, and nothing ever sleeps.`),
      run("powercfg", "/setactive", "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"),
      ...["monitor", "standby", "hibernate"].flatMap(what =>
        ["ac", "dc"].map(power => run("powercfg", "/change", `${what}-timeout-${power}`, 0)),
      ),
    ],
  };
}

/**
 * Windows' trusted roots without `droppedWindowsRoots`. curl.exe, PowerShell, Git
 * and the agent read them. Bun and Node.js use lists of their own unless told otherwise.
 */
function disallowedRoots(): Tool {
  return {
    name: "disallowed-roots",
    identity: observed(printLine(property(cmdlet("Get-ChildItem", {}, "Cert:\\LocalMachine\\Disallowed"), "Count"))),
    steps: [disallowRoots(droppedWindowsRoots)],
  };
}

function scoop(image: WindowsImage): Tool {
  const home = locations.scoop;
  const { installer, core, mainBucket } = pins.scoop;
  /** A directory of Scoop's, as it is at a commit of the repository it comes from. */
  const atCommit = (directory: string, repository: string, commit: string) => [
    ...unpackedArchive({
      url: `https://github.com/ScoopInstaller/${repository}/archive/${commit}.zip`,
      sha256: namedByCommit,
      file: `${repository}.zip`,
      into: scratch(),
    }),
    remove(`${home}/${directory}`),
    move(scratch(`${repository}-${commit}`), `${home}/${directory}`),
  ];
  return {
    name: "scoop",
    identity: packageDatabase,
    steps: [
      setEnvironment("SCOOP", home),
      download(
        `https://raw.githubusercontent.com/ScoopInstaller/Install/${installer.commit}/install.ps1`,
        scratch("install-scoop.ps1"),
        installer.sha256,
      ),
      runScript(scratch("install-scoop.ps1"), { RunAsAdmin: true, ScoopDir: home }),
      comment("The installer takes the newest Scoop and the newest manifests, whatever its own commit."),
      ...atCommit("apps/scoop/current", "Scoop", core),
      ...atCommit("buckets/main", "Main", mainBucket),
      addToPath(`${home}/shims`),
      ...[...scoopPackages.all, ...(image.arch === "x64" ? scoopPackages.x64 : [])].map(name => scoopInstall(name)),
      comment("Git's own Unix tools (sh, tar, perl, …) and Cygwin's, for the scripts tests run."),
      addToPath(`${home}/apps/git/current/usr/bin`),
      addToPath(`${home}/apps/cygwin/current/root/bin`),
      run("git", "config", "--system", "--add", "safe.directory", "*"),
      run("git", "config", "--system", "core.autocrlf", "false"),
      run("git", "config", "--system", "core.eol", "lf"),
      run("git", "config", "--system", "core.longpaths", "true"),
      comment("Windows' trusted roots, not the list Git comes with."),
      run("git", "config", "--system", "http.sslBackend", "schannel"),
    ],
  };
}

/** The service manager scripts/agent.ts registers the agent with. There is no arm64 build; the x64 one runs under emulation. */
function nssm(image: WindowsImage): Tool {
  const root = `nssm-${pins.nssm.version}`;
  return {
    name: "nssm",
    identity: pinned(pins.nssm.version),
    steps: executableFromArchive({
      url: `${mirrors.bunArtifacts}/${root}.zip`,
      sha256: pins.nssm.sha256,
      kind: "zip",
      member: `${root}/win64/nssm.exe`,
      to: bin(image, "nssm"),
    }),
  };
}

/** PowerShell 7. The bake itself runs under Windows PowerShell 5.1. */
function pwsh(image: WindowsImage): Tool {
  const { version, sha256 } = pins.pwsh;
  const msi = scratch("pwsh.msi");
  return {
    name: "pwsh",
    identity: pinned(version),
    steps: [
      download(
        `https://github.com/PowerShell/PowerShell/releases/download/v${version}/PowerShell-${version}-win-${nodeArch[image.arch]}.msi`,
        msi,
        sha256[image.arch],
      ),
      runInstaller("the PowerShell installer", "msiexec", text`/i "${msi}" /quiet /norestart ADD_PATH=1`),
      refreshPath,
    ],
  };
}

/** sshd, with key logins only, for whoever is a public member of the GitHub organization. */
function openssh(image: WindowsImage): Tool {
  const home = locations.openssh;
  const keysScript = "C:/ProgramData/ssh/fetch-ssh-keys.ps1";
  return {
    name: "openssh",
    identity: pinned(pins.openssh.version),
    steps: [
      ...unpackedArchive({
        url: `https://github.com/PowerShell/Win32-OpenSSH/releases/download/${pins.openssh.version}/OpenSSH-${image.arch === "x64" ? "Win64" : "Arm64"}.zip`,
        sha256: pins.openssh.sha256[image.arch],
        file: "OpenSSH.zip",
        into: scratch("unpacked"),
      }),
      directory(home),
      comment("The archive has one top-level directory, whatever it is called."),
      pipe(
        cmdlet("Get-ChildItem", {
          Path: property(
            pipe(
              cmdlet("Get-ChildItem", { Path: scratch("unpacked"), Directory: true }),
              cmdlet("Select-Object", { First: 1 }),
            ),
            "FullName",
          ),
          Recurse: true,
        }),
        cmdlet("Move-Item", { Destination: home, Force: true }),
      ),
      runScript(`${home}/install-sshd.ps1`),
      runScript(`${home}/FixHostFilePermissions.ps1`, { Confirm: false }),
      serviceStartup("sshd", "Automatic"),
      discardOutput(
        cmdlet("New-ItemProperty", {
          Path: "HKLM:/SOFTWARE/OpenSSH",
          Name: "DefaultShell",
          Value: property(cmdlet("Get-Command", {}, "pwsh"), "Path"),
          PropertyType: "String",
          Force: true,
        }),
      ),
      firewallAllowInbound({ name: "OpenSSH-Server", displayName: "OpenSSH Server (sshd)", port: 22 }),
      comment(
        "sshd writes its default configuration the first time it starts, with both settings commented out.\n" +
          "That start also makes the host keys, which must not be in the image: every machine from it would\n" +
          "have the same ones. sshd makes new ones when it finds none.",
      ),
      cmdlet("Start-Service", {}, "sshd"),
      cmdlet("Stop-Service", {}, "sshd"),
      cmdlet("Remove-Item", { Force: true }, "C:/ProgramData/ssh/ssh_host_*"),
      editLines("C:/ProgramData/ssh/sshd_config", [
        ["^#?PubkeyAuthentication .*", "PubkeyAuthentication yes"],
        ["^#?PasswordAuthentication .*", "PasswordAuthentication no"],
      ]),
      comment("Their keys are fetched each time the machine starts."),
      copy(bakeFile("fetch-ssh-keys.ps1"), keysScript),
      ...scheduledTaskAtStartup({
        name: "FetchSshKeys",
        program: "pwsh.exe",
        arguments: `-NoProfile -ExecutionPolicy Bypass -File "${keysScript.replace(/\//g, "\\")}"`,
      }),
    ],
  };
}

function ccache(image: WindowsImage): Tool {
  const { version, sha256 } = pins.ccache;
  const root = `ccache-${version}-windows-${cpuName[image.arch]}`;
  return {
    name: "ccache",
    identity: pinned(version),
    steps: [
      ...unpackedArchive({
        url: `https://github.com/ccache/ccache/releases/download/v${version}/${root}.zip`,
        sha256: sha256[image.arch],
        file: "ccache.zip",
        into: scratch("unpacked"),
      }),
      directory(locations.ccache),
      copy(scratch(`unpacked/${root}/*`), locations.ccache),
      addToPath(locations.ccache),
    ],
  };
}

/**
 * MSVC, the Windows SDK and their build tools. It is Build Tools and not the
 * IDE's free edition because Microsoft only publishes an installer of one exact
 * version for the former; the latter's always installs the newest.
 */
function visualStudio(): Tool {
  const { version, directory, sha256 } = pins.visualStudio;
  const installer = scratch("vs_BuildTools.exe");
  const components = [
    // "Desktop development with C++".
    "Microsoft.VisualStudio.Workload.VCTools",
    // In Build Tools that workload recommends neither the arm64 compiler nor ATL.
    "Microsoft.VisualStudio.Component.VC.Tools.ARM64",
    "Microsoft.VisualStudio.Component.VC.ATL",
    "Microsoft.VisualStudio.Component.VC.ATL.ARM64",
  ];
  return {
    name: "visual-studio",
    identity: pinned(version),
    steps: [
      download(
        `https://download.visualstudio.microsoft.com/download/pr/${directory}/${sha256}/vs_BuildTools.exe`,
        installer,
        sha256,
      ),
      runInstaller(
        "the Visual Studio installer",
        installer,
        `--passive --norestart --wait --force --locale en-US ${components.map(id => `--add ${id}`).join(" ")} --includeRecommended`,
        [0, 3010],
        // dd_<program>_<time>.log and its _errors.log. Not dd_setup_<time>_<n>_<package>.log: there are hundreds,
        // and an MSI's ends with every property of the machine and the user.
        [printEndOfLogs(environment("TEMP"), /^dd_[a-z_]+_\d+(_errors)?\.log$/)],
      ),
    ],
  };
}

/** Symbolicates the stack traces of a crashed bun.exe from its .pdb. */
function pdbAddr2line(image: WindowsImage): Tool {
  return {
    name: "pdb-addr2line",
    identity: pinned(pins.pdbAddr2line.version),
    steps: [
      run("cargo", "install", "--locked", "--examples", `pdb-addr2line@${pins.pdbAddr2line.version}`),
      installExecutable(text`${environment("CARGO_HOME")}/bin/pdb-addr2line.exe`, bin(image, "pdb-addr2line")),
    ],
  };
}

/** Intel's emulator: runs the baseline x64 build on a CPU model without the newer instructions, to prove the build does not use them. */
function intelSde(): Tool {
  const { version, sha256 } = pins.intelSde;
  const root = `sde-external-${version}-win`;
  return {
    name: "intel-sde",
    identity: pinned(version),
    steps: [
      ...unpackedArchive({
        url: `${mirrors.bunArtifacts}/${root}.tar.xz`,
        sha256,
        file: "sde.tar.xz",
        into: scratch("sde"),
      }),
      move(scratch(`sde/${root}`), locations.intelSde),
    ],
  };
}

/** Windows Server can remove Defender altogether; it takes effect at the restart that ends the bake. Windows 11 cannot, and keeps it disabled. */
function uninstallDefender(): Tool {
  return {
    name: "uninstall-defender",
    identity: configuration,
    steps: [discardOutput(cmdlet("Uninstall-WindowsFeature", { Name: "Windows-Defender" }))],
  };
}

// ---- macOS only

/** Homebrew is already there: the Tart base image ships it, and scripts/darwin-ci installs it on a bare host before anything else. */
function brew(image: MacosImage): Tool {
  return {
    name: "brew",
    identity: packageDatabase,
    steps: [addToPath(`${locations.brew[image.arch]}/bin`), brewInstall(brewPackages)],
  };
}

// ---- what a machine gets, in order

export function tools(image: Image): readonly Tool[] {
  if (image.os === "darwin") {
    return [brew(image), nodejs(image), bun(image), bunNinja(image), curlH3(image), llvm(image), rust(image)];
  }
  if (image.os === "windows") {
    return [
      windowsSystem(),
      disallowedRoots(),
      scoop(image),
      nodejs(image),
      llvm(image),
      nssm(image),
      pwsh(image),
      openssh(image),
      bun(image),
      bunNinja(image),
      curlH3(image),
      ccache(image),
      rust(image),
      visualStudio(),
      pdbAddr2line(image),
      ...(image.arch === "x64" ? [intelSde()] : []),
      buildkiteAgent(image),
      prefetch(image),
      agentService(),
      recordImage(image),
      ...(image.release === "2019" ? [uninstallDefender()] : []),
    ];
  }
  const apt = image.distro !== "alpine";
  return [
    packages(image),
    caCertificates(),
    ulimits(image),
    ...(apt ? [] : [cloudInitDhcpClient()]),
    agentAccount(),
    nodejs(image),
    bun(image),
    bunNinja(image),
    curlH3(image),
    tailscale(image),
    buildkiteAgent(image),
    cmake(image),
    llvm(image),
    rust(image),
    // What the build image cross-compiles with.
    ...(image.role === "build"
      ? [
          crossCompilerRt(),
          androidNdk(),
          freebsdSysroot(),
          glibcSysroot(),
          muslSysroot(image),
          windowsSysroot(image),
          macosSdk(),
        ]
      : []),
    docker(image),
    ...(apt && image.arch === "x64" ? [chrome()] : []),
    ...(apt ? [] : [pythonFuse()]),
    age(image),
    coreDumps(image),
    ...(apt ? [noTmpfs()] : []),
    prefetch(image),
    agentService(),
    recordImage(image),
    cleanup(image),
  ];
}

// ══════════════════════════════════════════════════════════════ 3. MACHINERY

// ---------------------------------------------------------------------- types

/**
 * `build`: the image every Bun target is compiled on (it also runs tests).
 * `test`: an image that only runs tests.
 */
type Role = "build" | "test";

/** The cloud image a bake box boots from: an exact name, never a pattern. */
type BaseImage = {
  /** The AMI's name. */
  name: string;
  /** The AWS account that publishes it. */
  owner: string;
};

export type LinuxImage = {
  os: "linux";
  arch: Arch;
  distro: "debian" | "ubuntu" | "alpine";
  release: string;
  abi: "gnu" | "musl";
  role: Role;
  base: BaseImage;
};

/** The Azure Marketplace image a Windows bake starts from; `version` is exact, never "latest". */
type AzureBaseImage = {
  publisher: string;
  offer: string;
  sku: string;
  version: string;
};

export type WindowsImage = {
  os: "windows";
  arch: Arch;
  /** "2019" is Windows Server 2019; "11" is Windows 11 (there is no Windows Server for arm64). */
  release: "2019" | "11";
  role: "test";
  base: AzureBaseImage;
  /** The size of the VM the bake runs on. CI's own VM sizes are in .buildkite/ci.ts. */
  bakeVmSize: string;
};

/** An image CI bakes, names by its hash and starts machines from. */
export type BakedImage = LinuxImage | WindowsImage;

/**
 * A macOS machine. CI does not bake or name one: scripts/darwin-ci sets a
 * machine up (a Tart guest image, or a bare host) by running the script that
 * is generated for it.
 */
export type MacosImage = {
  os: "darwin";
  arch: Arch;
};

export type Image = BakedImage | MacosImage;

/**
 * `linux-x64-debian`, `linux-aarch64-alpine`, `windows-x64`, `darwin-aarch64`:
 * the part of an image's name before its hash. CI has one image per operating
 * system (or distro) and architecture, so the key does not say which release
 * it is; the release is part of what the hash covers.
 */
export function imageKey(image: Image): string {
  return image.os === "linux" ? `linux-${image.arch}-${image.distro}` : `${image.os}-${image.arch}`;
}

// ---------------------------------------------------------------- rendering

type Context = {
  image: Image;
  usesScratch: boolean;
  /** PowerShell: the native program the statement being rendered runs. A program's failure is only its exit code there, so `render` checks it after the statement. */
  native: string | undefined;
};
/** One or more lines of the generated script. */
export type Step = (context: Context) => string[];
/**
 * How what a tool puts on the machine is known, for the image's record. A tool
 * cannot be written without saying which:
 *
 * - `pinned`: known in this file. The value is written into the record as it is.
 * - `observed`: only known on the machine. The step's output is the record.
 * - `packageDatabase`: it arrives through apt, apk, Scoop or Homebrew, whose
 *   database the record lists with exact versions.
 * - `configuration`: nothing arrives from outside; this file decides all of it.
 * - `notRecorded`: deliberately outside the record, and why.
 */
export type Identity =
  | { kind: "pinned"; value: string }
  | { kind: "observed"; step: Step }
  | { kind: "packageDatabase" }
  | { kind: "configuration" }
  | { kind: "notRecorded"; reason: string };
const pinned = (value: string): Identity => ({ kind: "pinned", value });
const observed = (step: Step): Identity => ({ kind: "observed", step });
const packageDatabase: Identity = { kind: "packageDatabase" };
const configuration: Identity = { kind: "configuration" };
const notRecorded = (reason: string): Identity => ({ kind: "notRecorded", reason });

export type Tool = { name: string; identity: Identity; steps: readonly Step[] };

const isPowerShell = (c: Context) => c.image.os === "windows";
/**
 * Linux bakes run as root. A Mac is set up by its admin user, because Homebrew
 * refuses root, so there a command gets `sudo` when what it writes belongs to
 * the system: an absolute path that is not Homebrew's own.
 */
function sudo(c: Context, ...written: Value[]): string {
  if (c.image.os !== "darwin") return "";
  const system = written.some(value => {
    const first = typeof value === "object" ? value.parts[0] : String(value);
    return typeof first === "string" && first.startsWith("/") && !first.startsWith("/opt/homebrew");
  });
  return system ? "sudo " : "";
}
const indent = (lines: string[]) => lines.map(line => (line ? "  " + line : line));
/** Statements, one after another. sh stops at a failed command by itself (`set -e`); PowerShell only does for cmdlets, so a statement that ran a native program is followed by a check of its exit code. */
function render(steps: readonly Step[], c: Context): string[] {
  return steps.flatMap(step => {
    c.native = undefined;
    const lines = step(c);
    const program = c.native;
    c.native = undefined;
    return program === undefined
      ? lines
      : [...lines, `if ($LASTEXITCODE -ne 0) { throw "bootstrap: ${program} exited with code $LASTEXITCODE" }`];
  });
}
function oneLine(step: Step, c: Context): string {
  const lines = step(c);
  if (lines.length !== 1) throw new Error(`Expected a single command, got:\n${lines.join("\n")}`);
  return lines[0]!;
}

// ------------------------------------------------------------------- values
// A value is one argument. Text known here is a string or a number. What is
// only known when the script runs is a part.

type Part =
  | string
  | { variable: string }
  | { environment: string }
  | { output: Step }
  | { member: [Step, string] }
  | { scratch: string }
  | { glob: string }
  | { expression: string };
export type Value = string | number | { parts: readonly Part[] };

/** A variable of the generated script, made with `set`. */
const variable = (name: string): Value => ({ parts: [{ variable: name }] });
/** A variable of the process's environment. */
const environment = (name: string): Value => ({ parts: [{ environment: name }] });
/** What a command prints. */
const output = (step: Step): Value => ({ parts: [{ output: step }] });
/** PowerShell's `(command).Property`. */
const property = (step: Step, name: string): Value => ({ parts: [{ member: [step, name] }] });
/** A path in the tool's scratch directory, which the generator makes and removes. */
const scratch = (name = ""): Value => ({ parts: [{ scratch: name }] });
/** A pattern the shell expands: text`${directory}/${glob("*.deb")}`. */
const glob = (pattern: string): Value => ({ parts: [{ glob: pattern }] });
/** Text the shell has to see as it is, like PowerShell's `$true`. */
const expression = (code: string): Value => ({ parts: [{ expression: code }] });
/** text`${sysroot}/lib/${triple}`: several pieces as one argument. */
function text(strings: TemplateStringsArray, ...values: Value[]): Value {
  const parts: Part[] = [];
  strings.forEach((literal, index) => {
    if (literal) parts.push(literal);
    const value = values[index];
    if (value === undefined) return;
    if (typeof value === "object") parts.push(...value.parts);
    else parts.push(String(value));
  });
  return { parts };
}

// What the generated script is told when it runs.
/** The commit being built. A tool that needs the repository clones it. */
const commit: Value = variable("REPO_COMMIT");
/** The name the image is baked under. It is the hash of the script, so the script is told it. */
const imageName: Value = variable("IMAGE_NAME");
/** A file of the bake directory: one of `files`, a program `generateImage` writes, or what a tool observed. */
const bakeFile = (name: string): Value => ({ parts: [{ variable: "BAKE_DIR" }, `/${name}`] });

/** `asExpression`: the value is an operand (`$x = …`, an array element, `-replace …`), where PowerShell reads a bare word as a command and `1.10` as a number. */
function renderValue(value: Value, c: Context, asExpression = false): string {
  const parts: readonly Part[] = typeof value === "object" ? value.parts : [String(value)];
  const literal = parts.every(part => typeof part === "string");
  const scratchPath = (name: string, separator: string) => {
    c.usesScratch = true;
    return name ? `$scratch${separator}${name}` : "$scratch";
  };

  if (isPowerShell(c)) {
    // Paths are written with "/" in this file. A value is a Windows path when it
    // starts with a drive, a registry hive or something only known on the
    // machine; a URL or a program's "/flag" is not one.
    const first = parts[0]!;
    const isPath = typeof first === "string" ? /^([A-Za-z]|HKLM|HKCU):[\\/]/.test(first) : !("expression" in first);
    const slashes = (s: string) => (isPath ? s.replace(/\//g, "\\") : s);
    if (literal) {
      const s = slashes(parts.join(""));
      return !asExpression && /^[A-Za-z0-9_.=-]+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
    }
    const only = parts.length === 1 ? parts[0]! : undefined;
    if (typeof only === "object") {
      if ("variable" in only) return `$${only.variable}`;
      if ("environment" in only) return `$env:${only.environment}`;
      if ("output" in only) return `(${oneLine(only.output, c)})`;
      if ("member" in only) return `(${oneLine(only.member[0], c)}).${only.member[1]}`;
      if ("expression" in only) return only.expression;
    }
    const inner = parts.map(part => {
      if (typeof part === "string") return slashes(part).replace(/[`"$]/g, "`$&");
      if ("variable" in part) return `$${part.variable}`;
      if ("environment" in part) return `$env:${part.environment}`;
      if ("scratch" in part) return scratchPath(part.scratch.replace(/\//g, "\\"), "\\");
      if ("output" in part) return `$(${oneLine(part.output, c)})`;
      if ("member" in part) return `$((${oneLine(part.member[0], c)}).${part.member[1]})`;
      if ("glob" in part) return part.glob;
      return part.expression;
    });
    return `"${inner.join("")}"`;
  }

  if (literal) {
    const s = parts.join("");
    return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  }
  let out = "";
  let quoted = "";
  const flush = () => ((out += quoted ? `"${quoted}"` : ""), (quoted = ""));
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    const name = (n: string) => (typeof next === "string" && /^[A-Za-z0-9_]/.test(next) ? `\${${n}}` : `$${n}`);
    if (typeof part === "string") quoted += part.replace(/[\\"$`]/g, "\\$&");
    else if ("variable" in part) quoted += name(part.variable);
    else if ("environment" in part) quoted += name(part.environment);
    else if ("scratch" in part) quoted += scratchPath(part.scratch, "/");
    else if ("output" in part) quoted += `$(${oneLine(part.output, c)})`;
    else if ("glob" in part) (flush(), (out += part.glob));
    else if ("expression" in part) (flush(), (out += part.expression));
    else throw new Error("sh has no (command).Property");
  });
  flush();
  return out;
}

// ------------------------------------------------------------ general steps

const comment =
  (note: string): Step =>
  () =>
    note.split("\n").map(line => `# ${line}`);

/** Any program. Its failure fails the bake: `set -e` in sh, the `$LASTEXITCODE` check `render` adds in PowerShell. */
const run =
  (program: Value, ...args: Value[]): Step =>
  c => {
    const rendered = [program, ...args].map(a => renderValue(a, c));
    if (!isPowerShell(c)) return [rendered.join(" ")];
    c.native = typeof program === "string" ? program : "the program";
    // A quoted path is a string to PowerShell until `&` calls it.
    return [(/^['"]/.test(rendered[0]!) ? "& " : "") + rendered.join(" ")];
  };

const set =
  (name: string, value: Value): Step =>
  c => [isPowerShell(c) ? `$${name} = ${renderValue(value, c, true)}` : `${name}=${renderValue(value, c)}`];

const pipe =
  (...steps: Step[]): Step =>
  c => [steps.map(step => oneLine(step, c)).join(" | ")];

/** What the command prints, as the file's content, or with `append` at its end. PowerShell writes ASCII: its default is UTF-16. */
const toFile =
  (step: Step, file: Value, options: { append?: boolean } = {}): Step =>
  c => [
    isPowerShell(c)
      ? `${oneLine(step, c)} | Out-File ${options.append ? "-Append " : ""}-Encoding ascii ${renderValue(file, c)}`
      : `${oneLine(step, c)} ${options.append ? ">>" : ">"} ${renderValue(file, c)}`,
  ];

/** Prints the value as a line. */
const printLine =
  (value: Value): Step =>
  c => [isPowerShell(c) ? renderValue(value, c, true) : `printf '%s\\n' ${renderValue(value, c)}`];

/** Prints the file's lines. */
const linesOf =
  (file: Value): Step =>
  c => [`${isPowerShell(c) ? "Get-Content" : "cat"} ${renderValue(file, c)}`];

/** Each line the command prints, with this before it. */
const prefixed =
  (prefix: string, step: Step): Step =>
  c => [
    isPowerShell(c)
      ? `${oneLine(step, c)} | ForEach-Object { ${renderValue(text`${prefix}${expression("$_")}`, c, true)} }`
      : `${oneLine(step, c)} | sed ${renderValue(`s/^/${prefix.replace(/[\\/&]/g, "\\$&")}/`, c)}`,
  ];

/**
 * The lines the command prints, in an order that is the same for every bake of
 * an image: byte order in sh whatever the locale, and in PowerShell the order of
 * the session's culture, which comes from the image's pinned base.
 */
const sorted =
  (step: Step): Step =>
  c => [`${oneLine(step, c)} | ${isPowerShell(c) ? "Sort-Object" : "LC_ALL=C sort"}`];

/** What the command prints is not worth reading. */
const discardOutput =
  (step: Step): Step =>
  c => [`${oneLine(step, c)} ${isPowerShell(c) ? "| Out-Null" : "> /dev/null"}`];

/** The command's complaints are expected, and its failure does not matter. */
const tolerate =
  (step: Step): Step =>
  c => {
    const line = oneLine(step, c);
    c.native = undefined;
    return [isPowerShell(c) ? `${line} -ErrorAction SilentlyContinue` : `${line} 2>/dev/null || true`];
  };

/** The steps, with this as the working directory. */
const inDirectory =
  (directory: Value, steps: Step[]): Step =>
  c =>
    isPowerShell(c)
      ? [`Push-Location ${renderValue(directory, c)}`, ...render(steps, c), "Pop-Location"]
      : ["(", ...indent([`cd ${renderValue(directory, c)}`, ...render(steps, c)]), ")"];

/** The command, with these in its environment. */
const withEnvironment =
  (variables: Record<string, Value>, step: Step): Step =>
  c => {
    const entries = Object.entries(variables);
    return isPowerShell(c)
      ? [...entries.map(([name, value]) => `$env:${name} = ${renderValue(value, c)}`), ...step(c)]
      : [`${entries.map(([name, value]) => `${name}=${renderValue(value, c)}`).join(" ")} ${oneLine(step, c)}`];
  };

const failUnlessNotEmpty =
  (value: Value, message: Value): Step =>
  c =>
    isPowerShell(c)
      ? [`if (-not ${renderValue(value, c)}) { throw ${renderValue(text`bootstrap: ${message}`, c, true)} }`]
      : [`[ -n ${renderValue(value, c)} ] || { echo ${renderValue(text`bootstrap: ${message}`, c)} >&2; exit 1; }`];

const ifExists =
  (path: Value, steps: Step[]): Step =>
  c =>
    isPowerShell(c)
      ? [`if (Test-Path ${renderValue(path, c)}) {`, ...indent(render(steps, c)), "}"]
      : [`if [ -e ${renderValue(path, c)} ]; then`, ...indent(render(steps, c)), "fi"];

const unlessExists =
  (path: Value, steps: Step[]): Step =>
  c =>
    isPowerShell(c)
      ? [`if (-not (Test-Path ${renderValue(path, c)})) {`, ...indent(render(steps, c)), "}"]
      : [`if ! [ -e ${renderValue(path, c)} ]; then`, ...indent(render(steps, c)), "fi"];

/** The steps, when the command succeeds (sh) or returns something (PowerShell). */
const ifSucceeds =
  (condition: Step, steps: Step[]): Step =>
  c =>
    isPowerShell(c)
      ? [`if (${oneLine(condition, c)}) {`, ...indent(render(steps, c)), "}"]
      : [`if ${oneLine(condition, c)}; then`, ...indent(render(steps, c)), "fi"];

/** Once for each line a command prints (sh) or each object it returns (PowerShell). */
const forEachOutput =
  (name: string, producer: Step, steps: Step[]): Step =>
  c =>
    isPowerShell(c)
      ? [`foreach ($${name} in ${oneLine(producer, c)}) {`, ...indent(render(steps, c)), "}"]
      : [`${oneLine(producer, c)} | while read -r ${name}; do`, ...indent(render(steps, c)), "done"];

/** Once for each file a pattern matches. */
const forEachFile =
  (name: string, pattern: Value, steps: Step[]): Step =>
  c => [`for ${name} in ${renderValue(pattern, c)}; do`, ...indent(render(steps, c)), "done"];

const whenStartsWith =
  (value: Value, prefix: string, steps: Step[]): Step =>
  c => [`case ${renderValue(value, c)} in ${prefix}*)`, ...indent(render(steps, c)), "  ;;", "esac"];

// --------------------------------------------------------------------- files

const directory =
  (path: Value, options: { owner?: Value; mode?: string } = {}): Step =>
  c => {
    const p = renderValue(path, c);
    if (isPowerShell(c)) return [`New-Item -ItemType Directory -Force ${p} | Out-Null`];
    return [
      `${sudo(c, path)}mkdir -p ${p}`,
      ...(options.mode ? [`${sudo(c, path)}chmod ${options.mode} ${p}`] : []),
      ...(options.owner ? [`${sudo(c, path)}chown ${renderValue(options.owner, c)} ${p}`] : []),
    ];
  };

const remove =
  (...paths: Value[]): Step =>
  c => [
    isPowerShell(c)
      ? `Remove-Item ${paths.map(p => renderValue(p, c)).join(", ")} -Recurse -Force`
      : `${sudo(c, ...paths)}rm -rf ${paths.map(p => renderValue(p, c)).join(" ")}`,
  ];

const move =
  (from: Value, to: Value): Step =>
  c => [
    isPowerShell(c)
      ? `Move-Item ${renderValue(from, c)} ${renderValue(to, c)} -Force`
      : `${sudo(c, to)}mv ${renderValue(from, c)} ${renderValue(to, c)}`,
  ];

/** A file, or a directory with everything in it. */
const copy =
  (from: Value, to: Value): Step =>
  c => [
    isPowerShell(c)
      ? `Copy-Item ${renderValue(from, c)} ${renderValue(to, c)} -Recurse -Force`
      : `${sudo(c, to)}cp -R ${renderValue(from, c)} ${renderValue(to, c)}`,
  ];

const symlink =
  (target: Value, link: Value): Step =>
  c => [`${sudo(c, link)}ln -sfn ${renderValue(target, c)} ${renderValue(link, c)}`];

const ownedBy =
  (owner: Value, path: Value): Step =>
  c => [`${sudo(c, path)}chown -R ${renderValue(owner, c)} ${renderValue(path, c)}`];

const mode =
  (bits: string, path: Value, options: { recursive?: boolean } = {}): Step =>
  c => [`${sudo(c, path)}chmod ${options.recursive ? "-R " : ""}${bits} ${renderValue(path, c)}`];

/** An executable, where every user finds it. */
const installExecutable =
  (file: Value, destination: Value): Step =>
  c =>
    isPowerShell(c)
      ? [`Copy-Item ${renderValue(file, c)} ${renderValue(destination, c)} -Force`]
      : [`${sudo(c, destination)}install -m 755 ${renderValue(file, c)} ${renderValue(destination, c)}`];

/** A file with exactly these lines, or with `append` these lines at the end of a file that may exist. */
const writeFile =
  (path: Value, lines: string[], options: { executable?: boolean; append?: boolean } = {}): Step =>
  c => {
    const p = renderValue(path, c);
    if (isPowerShell(c)) {
      // ascii: Windows PowerShell 5.1's UTF8 writes a byte-order mark, which breaks a reader that parses the file (node-gyp's installVersion).
      return [
        `${options.append ? "Add" : "Set"}-Content -Path ${p} -Encoding ascii -Value @(`,
        ...indent(lines.map((l, i) => `${renderValue(l, c, true)}${i < lines.length - 1 ? "," : ""}`)),
        ")",
      ];
    }
    return [
      `cat ${options.append ? ">>" : ">"} ${p} <<'EOF'`,
      ...lines,
      "EOF",
      ...(options.executable ? [`chmod +x ${p}`] : []),
    ];
  };

const appendLines = (path: Value, lines: string[]): Step => writeFile(path, lines, { append: true });

/**
 * One sha256 for the content of these directories: every file's hash and every
 * symlink's target, by sorted path. Modes, owners and times are not in it.
 */
const treeDigest =
  (...roots: string[]): Step =>
  () => [
    `{ find ${roots.join(" ")} -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum; find ${roots.join(" ")} -type l -printf '%p -> %l\\n' | LC_ALL=C sort; } | sha256sum | cut -d' ' -f1`,
  ];

/** PowerShell: each line of the file with the replacements applied, written back. */
const editLines =
  (file: Value, replacements: [pattern: string, replacement: string][]): Step =>
  c => [
    `(Get-Content ${renderValue(file, c)})${replacements.map(([a, b]) => ` -replace ${renderValue(a, c, true)}, ${renderValue(b, c, true)}`).join("")} | Set-Content ${renderValue(file, c)}`,
  ];

// ------------------------------------------------ PATH and the environment

/** For the rest of the script, and for every login shell or process of the machine. */
/** PowerShell: what this process sees of PATH is read again from what the machine and the user have. */
const refreshPath: Step = () => [
  `$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")`,
];

/**
 * A line every later shell of the machine reads, and the same for the rest of
 * this script. Linux: CI runs every command in a login shell (`sh -elc`), and
 * every login shell reads /etc/profile.d. macOS: zsh is the default shell and
 * scripts/darwin-ci looks for the tools with `bash -lc`; a Mac is set up again
 * when the pins move, so a line is only written once.
 */
const exported =
  (line: string, now: string): Step =>
  c =>
    c.image.os === "linux"
      ? [`echo ${renderValue(line, c)} >> /etc/profile.d/bun-ci.sh`, now]
      : [
          `for file in "$HOME/.profile" "$HOME/.zshrc" "$HOME/.bash_profile"; do`,
          `  touch "$file"`,
          `  grep -qxF ${renderValue(line, c)} "$file" || echo ${renderValue(line, c)} >> "$file"`,
          "done",
          now,
        ];

/** For the rest of the script, and for every later process of the machine. */
const addToPath =
  (path: string): Step =>
  c =>
    isPowerShell(c)
      ? [
          `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "Machine").TrimEnd(";") + ${renderValue(`;${path.replace(/\//g, "\\")}`, c, true)}, "Machine")`,
          ...refreshPath(c),
        ]
      : exported(`export PATH="${path}:$PATH"`, `export PATH="${path}:$PATH"`)(c);

const setEnvironment =
  (name: string, value: string): Step =>
  c =>
    isPowerShell(c)
      ? ["Machine", "Process"].map(
          scope => `[Environment]::SetEnvironmentVariable('${name}', ${renderValue(value, c, true)}, "${scope}")`,
        )
      : exported(`export ${name}="${value}"`, `export ${name}=${renderValue(value, c)}`)(c);

// ----------------------------------------------------------------- downloads

/**
 * What a download is checked against: the file's sha256, from `pins`, or why
 * this file cannot say one. A download cannot be written without either, and
 * the reason is a comment above it in the script.
 */
type Checksum = string | { unchecked: string };
const unchecked = (reason: string): Checksum => ({ unchecked: reason });
/** GitHub makes the archive of a commit when it is asked for one, and does not promise the same bytes each time. */
const namedByCommit = unchecked("the commit in the URL names the content.");

/** curl, which every system has: Windows ships curl.exe, and has to be asked for it by that name, because Windows PowerShell 5.1 calls Invoke-WebRequest `curl`. */
const download =
  (url: Value, file: Value, sha256: Checksum): Step =>
  c => {
    const curl = run(
      isPowerShell(c) ? "curl.exe" : "curl",
      ...["--fail", "--silent", "--show-error", "--location", "--retry", 3, "--output", file, url],
    );
    return render(
      typeof sha256 === "string" ? [curl, checksum(file, sha256)] : [comment(`Not checked: ${sha256.unchecked}`), curl],
      c,
    );
  };

const checksum =
  (file: Value, sha256: string): Step =>
  c => [
    isPowerShell(c)
      ? `if ((Get-FileHash ${renderValue(file, c)} -Algorithm SHA256).Hash -ne '${sha256}') { throw ${renderValue(text`bootstrap: the sha256 of ${file} is not ${sha256}`, c, true)} }`
      : `echo ${renderValue(text`${sha256}  ${file}`, c)} | ${c.image.os === "darwin" ? "shasum -a 256" : "sha256sum"} -c - > /dev/null`,
  ];

type ArchiveKind = "zip" | "tar.gz" | "tar.xz";
/** `only`: just these members. `strip`: drop this many leading directories (tar). */
const unpack =
  (archive: Value, into: Value, options: { kind: ArchiveKind; only?: string[]; strip?: number }): Step =>
  c => {
    const a = renderValue(archive, c);
    const d = renderValue(into, c);
    const only = (options.only ?? []).map(member => renderValue(member, c));
    if (options.kind === "zip") {
      return isPowerShell(c)
        ? [`Expand-Archive -Path ${a} -DestinationPath ${d} -Force`]
        : [[`${sudo(c, into)}unzip`, "-q", "-o", a, ...only, "-d", d].join(" ")];
    }
    if (isPowerShell(c) && options.kind === "tar.xz") {
      // Windows Server 2019's tar cannot read xz. 7-Zip takes the .tar out of the .xz, then the files out of the .tar.
      const last = typeof archive === "object" ? archive.parts[archive.parts.length - 1] : undefined;
      if (typeof last !== "object" || !("scratch" in last))
        throw new Error("On Windows a .tar.xz is unpacked from the scratch directory");
      const tar = text`${into}/${last.scratch.replace(/^.*\//, "").replace(/\.xz$/, "")}`;
      const sevenZip = (file: Value) => discardOutput(run("7z", "x", file, text`-o${into}`, "-y"));
      return render([sevenZip(archive), sevenZip(tar)], c);
    }
    const strip = options.strip ? [`--strip-components=${options.strip}`] : [];
    const flag = options.kind === "tar.gz" ? "-xzf" : "-xJf";
    if (isPowerShell(c)) return run("tar", flag, archive, "-C", into, ...strip, ...(options.only ?? []))(c);
    return [[`${sudo(c, into)}tar`, flag, a, "-C", d, ...strip, ...only].join(" ")];
  };

// ---------------------------------------------------------------- composites

/** A published archive, downloaded into the tool's scratch directory as `file` and unpacked into a directory. */
function unpackedArchive(options: {
  url: Value;
  sha256: Checksum;
  /** Its name says its kind: Windows unpacks a .tar.xz by that name. */
  file: `${string}.${ArchiveKind}`;
  into: Value;
  strip?: number;
  only?: string[];
}): Step[] {
  const archive = scratch(options.file);
  const kind = (["tar.gz", "tar.xz", "zip"] as const).find(kind => options.file.endsWith(`.${kind}`))!;
  return [
    download(options.url, archive, options.sha256),
    directory(options.into),
    unpack(archive, options.into, {
      kind,
      ...(options.strip ? { strip: options.strip } : {}),
      ...(options.only ? { only: options.only } : {}),
    }),
  ];
}

/** One executable out of a published archive, installed where every user finds it. */
function executableFromArchive(options: {
  url: string;
  sha256: Checksum;
  kind: ArchiveKind;
  /** The executable's path inside the archive. */
  member: string;
  to: Value;
  /** tar only: take just the member out, by this name. */
  extractOnly?: string;
}): Step[] {
  return [
    ...unpackedArchive({
      url: options.url,
      sha256: options.sha256,
      file: `archive.${options.kind}`,
      into: scratch("unpacked"),
      ...(options.extractOnly ? { only: [options.extractOnly] } : {}),
    }),
    installExecutable(scratch(`unpacked/${options.member}`), options.to),
  ];
}

/** A .deb that is in none of the machine's repositories. apt installs it, and what it depends on from the distro. */
function installedDeb(options: { url: string; sha256: Checksum; file: `${string}.deb` }): Step[] {
  return [
    download(options.url, scratch(options.file), options.sha256),
    run("apt-get", "install", "--yes", scratch(options.file)),
  ];
}

/** A package of Ubuntu's archive: the file's place in the pool, and its SHA256 in the release's Packages index. */
type UbuntuDeb = { directory: string; name: string; version: string; sha256: Record<Arch, string> };
const ubuntuDebUrl = (deb: UbuntuDeb, arch: Arch) =>
  `${mirrors.ubuntu[arch]}/pool/main/${deb.directory}/${deb.name}_${deb.version}_${debianArch[arch]}.deb`;

/**
 * A publisher's own apt repository, for packages asked for as `name=version`.
 * apt tells an armored key (.asc) from a binary one (.gpg) by the file's name.
 */
function aptRepository(options: {
  name: string;
  key: { url: string; sha256: string; kind: "asc" | "gpg" };
  url: string;
  suite: string;
  component: string;
}): Step[] {
  const key = `/etc/apt/keyrings/${options.name}.${options.key.kind}`;
  return [
    directory("/etc/apt/keyrings"),
    download(options.key.url, key, options.key.sha256),
    writeFile(`/etc/apt/sources.list.d/${options.name}.list`, [
      `deb [signed-by=${key}] ${options.url} ${options.suite} ${options.component}`,
    ]),
  ];
}

// ------------------------------------------------------------------ packages

const aptInstall =
  (names: readonly string[], options: { update?: boolean } = {}): Step =>
  () => [
    ...(options.update ? ["apt-get update --yes"] : []),
    `apt-get install --yes --no-install-recommends ${names.join(" ")}`,
  ];

const apkAdd =
  (names: readonly string[], options: { update?: boolean } = {}): Step =>
  () => [
    ...(options.update ? ["apk update"] : []),
    `apk add --no-cache --no-interactive --no-progress ${names.join(" ")}`,
  ];

const brewInstall =
  (names: readonly string[], options: { formula?: boolean } = {}): Step =>
  () => [`brew install --quiet ${options.formula ? "--formula " : ""}${names.join(" ")}`];

/** Scoop's installed apps, a "name version" line each. */
const scoopApps = (): Step =>
  pipe(
    // `run`, so that scoop's exit code is checked after the statement.
    run("scoop", "export"),
    // Scoop prints its JSON as several lines; ConvertFrom-Json is given them as one string.
    cmdlet("Out-String"),
    cmdlet("ConvertFrom-Json"),
    cmdlet("Select-Object", { ExpandProperty: "apps" }),
    cmdlet("ForEach-Object", {}, expression(`{ "$($_.Name) $($_.Version)" }`)),
  );

/**
 * `name` or `name@version`. Scoop is PowerShell running in this session, and
 * its manifests' cleanup steps write errors that are not failures (7zip on
 * ARM64 cannot delete its own 7zr.exe; llvm on ARM64 has no Uninstall.exe to
 * remove), so it runs with errors not ending the script, and whether the
 * install worked is decided by the app's directory existing. Scoop also puts
 * an app's directories (node, clang, python have no shim) on the PATH of the
 * user who installs it; the agent's jobs run as another account, so they go on
 * the machine's PATH. Left to itself, `scoop install` first updates a Scoop that
 * is three hours old, manifests included, which would undo `pins.scoop`.
 */
const scoopInstall =
  (name: string): Step =>
  c => {
    const scoop = locations.scoop;
    const machinePath = `[Environment]::GetEnvironmentVariable("Path", "Machine")`;
    return [
      `$ErrorActionPreference = "SilentlyContinue"`,
      `scoop install --no-update-scoop ${renderValue(name, c)} *>&1 | ForEach-Object { "$_" } | Write-Host`,
      `$ErrorActionPreference = "Stop"`,
      `foreach ($directory in [Environment]::GetEnvironmentVariable("Path", "User").Split(";")) {`,
      `  if ($directory -like '${scoop}\\*' -and ${machinePath}.Split(";") -notcontains $directory) {`,
      `    [Environment]::SetEnvironmentVariable("Path", ${machinePath}.TrimEnd(";") + ";$directory", "Machine")`,
      "  }",
      "}",
      ...refreshPath(c),
      `if (-not (Test-Path '${scoop}\\apps\\${name.split("@")[0]}\\current')) { throw "bootstrap: scoop install ${name} failed" }`,
    ];
  };

// ------------------------------------------- Linux: users and services
// One description; the renderer uses the distro's own tools.

const isAlpine = (c: Context) => c.image.os === "linux" && c.image.distro === "alpine";

/** A system user with a group of the same name and no login. */
const systemUser =
  (name: string, home: string): Step =>
  c =>
    isAlpine(c)
      ? [`addgroup -S ${name}`, `adduser -S -G ${name} -s /bin/sh -h ${home} -H -D ${name}`]
      : [
          `groupadd --system ${name}`,
          `useradd --system --gid ${name} --shell /bin/sh --no-create-home --home-dir ${home} ${name}`,
        ];

const addUserToGroup =
  (user: string, group: string): Step =>
  c => [isAlpine(c) ? `addgroup ${user} ${group}` : `usermod -aG ${group} ${user}`];

/** `enabled`: starts with the machine. `started`: running now. `masked`, `disabled`: systemd only. */
const service =
  (name: string, state: "enabled" | "started" | "masked" | "disabled"): Step =>
  c => {
    if (!isAlpine(c))
      return [
        `systemctl ${{ enabled: "enable", started: "start", masked: "mask", disabled: "disable" }[state]} ${name}`,
      ];
    if (state === "enabled") return [`rc-update add ${name} default`];
    if (state === "started") return [`rc-service ${name} start`];
    throw new Error(`OpenRC has no "${state}"`);
  };

// ------------------------------------------------------ Windows: intent

type Named = Record<string, Value | readonly Value[] | boolean>;
/** A cmdlet: positional arguments, then named ones. `true` is a switch. */
const cmdlet =
  (name: string, named: Named = {}, ...positional: Value[]): Step =>
  c => [
    [
      name,
      ...positional.map(p => renderValue(p, c)),
      ...Object.entries(named).map(([key, value]) =>
        value === true
          ? `-${key}`
          : value === false
            ? `-${key}:$false`
            : `-${key} ${Array.isArray(value) ? value.map(v => renderValue(v, c)).join(", ") : renderValue(value as Value, c)}`,
      ),
    ].join(" "),
  ];

/** `& script.ps1 …` */
const runScript =
  (script: Value, named: Named = {}): Step =>
  c => [`& ${oneLine(cmdlet(renderValue(script, c), named), c)}`];

const registryValue =
  (key: string, name: string, value: number, options: { onlyIfKeyExists?: boolean } = {}): Step =>
  c => {
    const write = cmdlet("Set-ItemProperty", { Path: key, Name: name, Value: value, Type: "DWORD" });
    return options.onlyIfKeyExists ? ifExists(key, [write])(c) : write(c);
  };

const serviceStartup =
  (name: string, startup: "Automatic" | "Disabled", options: { onlyIfExists?: boolean } = {}): Step =>
  c => {
    const write = cmdlet("Set-Service", { Name: name, StartupType: startup });
    return options.onlyIfExists
      ? ifSucceeds(cmdlet("Get-Service", { ErrorAction: "SilentlyContinue" }, name), [write])(c)
      : write(c);
  };

const firewallAllowInbound = (options: { name: string; displayName: string; port: number }): Step =>
  discardOutput(
    cmdlet("New-NetFirewallRule", {
      Profile: "Any",
      Name: options.name,
      DisplayName: options.displayName,
      Enabled: "True",
      Direction: "Inbound",
      Protocol: "TCP",
      Action: "Allow",
      LocalPort: options.port,
    }),
  );

/**
 * Windows refuses a certificate of the machine's Disallowed store, whichever other store has it. A root is trusted
 * without being in a store: Windows fetches one that Windows Update lists when a chain first ends in it.
 */
const disallowRoots =
  (names: readonly string[]): Step =>
  c => {
    const x509 = "System.Security.Cryptography.X509Certificates";
    const named = names.map(name => `$name -like ${renderValue(`${name}*`, c, true)}`).join(" -or ");
    return [
      ...render([discardOutput(run("certutil", "-generateSSTFromWU", scratch("roots.sst")))], c),
      `$roots = New-Object ${x509}.X509Certificate2Collection`,
      `$roots.Import(${renderValue(scratch("roots.sst"), c)})`,
      `$roots.AddRange((Get-ChildItem 'Cert:\\LocalMachine\\Root', 'Cert:\\LocalMachine\\AuthRoot'))`,
      `$dropped = $roots | Where-Object { $name = $_.GetNameInfo("SimpleName", $false); ${named} }`,
      `$disallowed = Get-Item 'Cert:\\LocalMachine\\Disallowed'`,
      `$disallowed.Open("ReadWrite")`,
      `foreach ($root in $dropped) { $disallowed.Add($root) }`,
      `$disallowed.Close()`,
      // ExplicitDistrust is the status of a certificate that is in a Disallowed store. One that fails otherwise is not refused by it.
      `foreach ($root in $dropped) {`,
      `  foreach ($attempt in 1..3) {`,
      `    $chain = New-Object ${x509}.X509Chain $true`,
      `    $chain.ChainPolicy.RevocationMode = "NoCheck"`,
      `    if (-not $chain.Build($root) -and $chain.ChainStatus.Status -contains "ExplicitDistrust") { break }`,
      `    if ($attempt -eq 3) { throw "bootstrap: $($root.Subject) is not refused" }`,
      `    Start-Sleep -Seconds 2`,
      `  }`,
      "}",
    ];
  };

/** A task that runs as SYSTEM each time the machine starts. */
const scheduledTaskAtStartup = (options: { name: string; program: string; arguments: string }): Step[] => [
  set("action", output(cmdlet("New-ScheduledTaskAction", { Execute: options.program, Argument: options.arguments }))),
  set(
    "settings",
    output(cmdlet("New-ScheduledTaskSettingsSet", { AllowStartIfOnBatteries: true, DontStopIfGoingOnBatteries: true })),
  ),
  discardOutput(
    cmdlet("Register-ScheduledTask", {
      TaskName: options.name,
      Action: variable("action"),
      Trigger: output(cmdlet("New-ScheduledTaskTrigger", { AtStartup: true })),
      Settings: variable("settings"),
      User: "SYSTEM",
      RunLevel: "Highest",
      Force: true,
    }),
  ),
];

/**
 * An installer that reports through its exit code. 3010: installed, and a restart is needed; the bake ends with one.
 * `onFailure` runs before the bake fails: the machine is deleted next, and what the installer wrote with it.
 */
const runInstaller =
  (what: string, program: Value, argumentList: Value, okExitCodes: number[] = [0], onFailure: Step[] = []): Step =>
  c => {
    const failed = okExitCodes.map(code => `$process.ExitCode -ne ${code}`).join(" -and ");
    const fail = `throw "bootstrap: ${what} exited with code $($process.ExitCode)"`;
    return [
      `$process = Start-Process ${renderValue(program, c)} -ArgumentList ${renderValue(argumentList, c)} -Wait -PassThru -NoNewWindow`,
      ...(onFailure.length > 0
        ? [`if (${failed}) {`, ...indent([...render(onFailure, c), fail]), "}"]
        : [`if (${failed}) { ${fail} }`]),
    ];
  };

/**
 * The last lines of the logs in `directory` that `names` matches. Anyone can read a bake's output, so `names` says
 * what may be shown rather than what may not, and two things are left out of it: lines about telemetry, which have
 * ids of the machine and the user, and the query of a URL, which can be a key to what it downloads.
 */
const printEndOfLogs =
  (directory: Value, names: RegExp): Step =>
  c => [
    `foreach ($log in Get-ChildItem ${renderValue(directory, c)} -File | Where-Object { $_.Name -match ${renderValue(names.source, c, true)} } | Sort-Object LastWriteTime) {`,
    `  "---- the end of $($log.Name)"`,
    // A log that cannot be read must not replace the installer's exit code as the bake's error.
    `  Get-Content $log.FullName -Tail 100 -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch 'telemetry' } | ForEach-Object { $_ -replace '(https?://[^\\s?]+)\\?\\S*', '$1?...' }`,
    `}`,
  ];

// --------------------------------------------------------------------- tools

/**
 * A tool's section of the script. A tool that uses `scratch` gets a scratch
 * directory made before its steps and removed after them: on the disk, not
 * under /tmp, which is a tmpfs on the Debian base image while it is baked.
 */
function renderTool(tool: Tool, image: Image): string {
  const context: Context = { image, usesScratch: false, native: undefined };
  // Everything is rendered before the scratch directory is decided on: the observation may be what uses it.
  const body = render(
    [
      ...tool.steps,
      ...(tool.identity.kind === "observed" ? [toFile(tool.identity.step, bakeFile(`observed/${tool.name}`))] : []),
    ],
    context,
  );
  const lines = [`# ---- ${tool.name}`];
  if (context.usesScratch) {
    lines.push(
      ...{
        windows: [
          `$scratch = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName())`,
          `New-Item -ItemType Directory -Force $scratch | Out-Null`,
        ],
        linux: ["scratch=$(mktemp -d -p /var/tmp)"],
        darwin: ["scratch=$(mktemp -d)"],
      }[image.os],
    );
  }
  lines.push(...body);
  if (context.usesScratch) {
    // Windows: a directory that cannot be deleted yet (Defender is still scanning an installer that just ran) is not a failure.
    lines.push(
      image.os === "windows"
        ? "Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue"
        : 'rm -rf "$scratch"',
    );
  }
  return lines.join("\n") + "\n";
}

// -------------------------------------- the program the bake puts on the machine

/** Run at every start of a Windows machine, by the task the `openssh` tool registers. */
const fetchSshKeysProgram = [
  "# Installed by the openssh tool and run at every start: the SSH keys of the GitHub",
  "# organization's public members become the machine's administrator keys.",
  '$members = Invoke-RestMethod -Uri "https://api.github.com/orgs/oven-sh/members" -Headers @{ "User-Agent" = "bun-ci" }',
  "$keys = @()",
  "foreach ($member in $members) {",
  '  if ($member.type -ne "User" -or -not $member.login) { continue }',
  '  $userKeys = (Invoke-WebRequest -Uri "https://github.com/$($member.login).keys" -UseBasicParsing).Content',
  "  if ($userKeys) { $keys += $userKeys.Trim() }",
  "}",
  "if ($keys.Count -gt 0) {",
  '  $keysPath = "C:\\ProgramData\\ssh\\administrators_authorized_keys"',
  '  Set-Content -Path $keysPath -Value ($keys -join "`n") -Force',
  '  icacls $keysPath /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(R)" | Out-Null',
  "}",
].join("\n");

// --------------------------------------------------------------------- Packer

/** Every variable the template needs; scripts/ci-image.ts passes them all. */
export const packerVariables = [
  ...["client_id", "client_secret", "subscription_id", "tenant_id"],
  // The resource group the bake's VM is created in, and the gallery's.
  ...["resource_group", "gallery_resource_group", "gallery_name", "location"],
  ...["image_name", "bake_directory", "repo_commit"],
] as const;

/** Sysprep generalizes the disk so every VM created from it gets its own identity. It must be the last thing that runs. */
const sysprep = String.raw`
Remove-Item -Recurse -Force C:\Windows\Panther -ErrorAction SilentlyContinue
# A pending restart makes Sysprep refuse to run.
Remove-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update' -Name 'RebootRequired' -Force -ErrorAction SilentlyContinue
Remove-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name 'PendingFileRenameOperations' -Force -ErrorAction SilentlyContinue
while ((Get-Service RdAgent).Status -ne 'Running') { Start-Sleep -s 5 }
while ((Get-Service WindowsAzureGuestAgent).Status -ne 'Running') { Start-Sleep -s 5 }
& $env:SystemRoot\System32\Sysprep\Sysprep.exe /oobe /generalize /quiet /quit /mode:vm
$elapsed = 0
while ($true) {
  $state = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Setup\State).ImageState
  Write-Output "ImageState: $state ($elapsed s)"
  if ($state -eq 'IMAGE_STATE_GENERALIZE_RESEAL_TO_OOBE') { break }
  if ($elapsed -ge 300) {
    Get-Content "$env:SystemRoot\System32\Sysprep\Panther\setupact.log" -Tail 100 -ErrorAction SilentlyContinue
    throw "Sysprep is stuck at $state"
  }
  Start-Sleep -s 10
  $elapsed += 10
}
`.trim();

/** An HCL heredoc; Packer reads `${` as its own interpolation, and `$${` as a literal `${`. */
function heredoc(text: string): string {
  return `<<-EOT\n${text.replace(/\$\{/g, "$$${")}\nEOT`;
}

function renderPackerTemplate(image: WindowsImage): string {
  const pin = pins.packer;
  return `# Generated from scripts/build/ci-images/spec.ts. Do not edit.

packer {
  required_version = "= ${pin.version}"
  required_plugins {
    azure = {
      source  = "github.com/hashicorp/azure"
      version = "= ${pin.azurePlugin}"
    }
  }
}

${packerVariables.map(name => `variable "${name}" {\n  type      = string\n  sensitive = ${name === "client_secret"}\n}\n`).join("\n")}
source "azure-arm" "image" {
  client_id       = var.client_id
  client_secret   = var.client_secret
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  os_type         = "Windows"
  image_publisher = "${image.base.publisher}"
  image_offer     = "${image.base.offer}"
  image_sku       = "${image.base.sku}"
  image_version   = "${image.base.version}"

  vm_size                   = "${image.bakeVmSize}"
  build_resource_group_name = var.resource_group
  os_disk_size_gb           = ${windowsBake.osDiskGb}

  security_type       = "TrustedLaunch"
  secure_boot_enabled = true
  vtpm_enabled        = true

  communicator   = "winrm"
  winrm_use_ssl  = true
  winrm_insecure = true
  winrm_timeout  = "15m"
  winrm_username = "packer"

  # Replicating to every region takes longer than Packer's default hour.
  shared_image_gallery_timeout = "3h"
  shared_image_gallery_destination {
    subscription         = var.subscription_id
    resource_group       = var.gallery_resource_group
    gallery_name         = var.gallery_name
    image_name           = var.image_name
    image_version        = "${windowsBake.galleryVersion}"
    storage_account_type = "Premium_LRS"
    target_region { name = var.location }
${windowsBake.galleryRegions.map(region => `    target_region { name = "${region}" }`).join("\n")}
  }

  azure_tags = {
    os   = "windows"
    arch = "${image.arch}"
  }
}

build {
  sources = ["source.azure-arm.image"]

  provisioner "file" {
    source      = "\${var.bake_directory}/"
    destination = "C:\\\\bake"
  }

  # 3010: done, and a restart is needed; the next step is one.
  provisioner "powershell" {
    inline           = ["& C:\\\\bake\\\\bootstrap.ps1"]
    environment_vars = ["REPO_COMMIT=\${var.repo_commit}", "IMAGE_NAME=\${var.image_name}"]
    valid_exit_codes = [0, 3010]
  }

  # What the bake installed, for the job to publish. Sysprep is next, and nothing can be fetched after it.
  provisioner "file" {
    direction   = "download"
    source      = "${locations.imageRecord.windows.replace(/\\/g, "\\\\")}"
    destination = "\${var.bake_directory}/${imageRecordName}"
  }

  provisioner "windows-restart" {
    restart_timeout = "10m"
  }

  provisioner "powershell" {
    inline = [${heredoc(["Remove-Item -Recurse -Force C:\\bake", sysprep].join("\n"))}
    ]
  }
}
`;
}

// ------------------------------------------------------------------ generator

const repoRoot = resolve(import.meta.dirname, "../../..");

/**
 * The script a bake runs. Linux: `sh bootstrap.sh <commit> <image name>`, as
 * root on the machine being baked. Windows: Packer uploads the directory and runs
 * `bootstrap.ps1` with REPO_COMMIT and IMAGE_NAME in the environment. macOS:
 * scripts/darwin-ci runs `sh bootstrap.sh` as the machine's admin user.
 */
function renderBootstrap(image: Image): string {
  const generated = `# Generated by scripts/build/ci-images/spec.ts for ${imageKey(image)}. Do not edit.`;
  const sections = tools(image).map(tool => renderTool(tool, image));
  switch (image.os) {
    case "linux":
      return [
        ...["#!/bin/sh", generated, "# Runs as root. A failed command ends the bake.", "set -eu", ""],
        `[ $# -eq 2 ] || { echo "usage: bootstrap.sh <commit> <image name>" >&2; exit 1; }`,
        `BAKE_DIR=$(cd "$(dirname "$0")" && pwd)`,
        `REPO_COMMIT=$1`,
        `IMAGE_NAME=$2`,
        `mkdir -p "$BAKE_DIR/observed"`,
        // Nobody is there to answer a package's questions: not ours, and not those of the installers that call apt (LLVM's, Docker's, Chrome's .deb).
        ...(image.distro === "alpine" ? [] : ["export DEBIAN_FRONTEND=noninteractive"]),
        "",
        ...sections,
      ].join("\n");
    case "darwin":
      return [
        "#!/bin/sh",
        generated,
        "# Runs as the machine's admin user, because Homebrew refuses to run as root, and uses sudo for what belongs to",
        "# the system. A failed command ends it.",
        "set -eu",
        "",
        `[ "$(id -u)" != 0 ] || { echo "run this as the machine's admin user: Homebrew refuses to run as root" >&2; exit 1; }`,
        "",
        ...sections,
      ].join("\n");
    case "windows":
      return [
        generated,
        "# Runs under Windows PowerShell 5.1: PowerShell 7 is one of the things it installs. A failed cmdlet ends the",
        "# bake; a native program only reports through its exit code, which is checked after each one.",
        `$ErrorActionPreference = "Stop"`,
        `$ProgressPreference = "SilentlyContinue"`,
        "",
        "$BAKE_DIR = $PSScriptRoot",
        "$REPO_COMMIT = $env:REPO_COMMIT",
        "$IMAGE_NAME = $env:IMAGE_NAME",
        `if (-not $REPO_COMMIT -or -not $IMAGE_NAME) { throw "bootstrap: REPO_COMMIT and IMAGE_NAME must be set" }`,
        `New-Item -ItemType Directory -Force "$BAKE_DIR\\observed" | Out-Null`,
        "",
        ...sections,
      ].join("\n");
  }
}

/** sha256 over every file, by sorted name. */
export function hashFiles(contents: ReadonlyMap<string, string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const name of [...contents.keys()].sort()) {
    hash.update(name).update("\0").update(contents.get(name)!).update("\0");
  }
  return hash.digest("hex");
}

/**
 * An image's bake directory, by file name: image.json (what the image is), the
 * script, the files the script puts on the machine, and for Windows the Packer
 * template. Nothing else decides what a bake does.
 */
function bakeFiles(image: Image): Map<string, string | Uint8Array> {
  const contents = new Map<string, string | Uint8Array>([
    ["image.json", JSON.stringify(image, null, 2) + "\n"],
    [image.os === "windows" ? "bootstrap.ps1" : "bootstrap.sh", renderBootstrap(image)],
  ]);
  if (image.os !== "darwin") {
    contents.set("agent.mts", readFileSync(join(repoRoot, files["agent.mts"])));
  }
  if (image.os === "linux" && image.role === "build") {
    contents.set("xmac.mjs", readFileSync(join(repoRoot, files["xmac.mjs"])));
  }
  if (image.os === "windows") {
    contents.set("fetch-ssh-keys.ps1", fetchSshKeysProgram + "\n");
    contents.set("image.pkr.hcl", renderPackerTemplate(image));
  }
  return contents;
}

export type GeneratedImage = {
  key: string;
  /** `<key>-<16 hex>`: the name the image is baked and booted under. */
  name: string;
  directory: string;
};

/** Writes the image's bake directory under `root`. The image's name is the hash of what is written, so nothing else is in it. */
export function generateImage(image: Image, root: string): GeneratedImage {
  const key = imageKey(image);
  const directory = join(root, bakeDirectory(key));
  const contents = bakeFiles(image);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of contents) {
    writeFileSync(join(directory, name), content);
  }
  return { key, name: `${key}-${hashFiles(contents).slice(0, 16)}`, directory };
}

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  const known = new Map([...images, ...macosMachines].map(image => [imageKey(image), image]));
  for (const key of wanted) {
    if (!known.has(key)) {
      throw new BuildError(`No image named ${key}`, { hint: `Images: ${[...known.keys()].join(", ")}` });
    }
  }
  for (const [key, image] of known) {
    if (wanted.length && !wanted.includes(key)) continue;
    const { name, directory } = generateImage(image, repoRoot);
    console.log(`${name}  ${directory}`);
  }
}
