// Windows image facts: the per-platform half of the spec. Shared pins
// come from ./spec.ts; the windows image entries are exported for it to
// assemble the fleet list.

import { buildkiteAgent, bun, curlH3, epoch, llvm, nodejs } from "./spec.ts";
import type { WindowsImage, WindowsImageBase, WindowsSharedFields } from "./types.ts";

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
  epoch,
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

export const windowsImages: readonly WindowsImage[] = [
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
