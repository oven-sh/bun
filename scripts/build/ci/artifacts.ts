// Download URLs derived from spec.ts values. This is code, not data: it
// turns the pinned versions/bases in an image's spec into concrete URLs. As
// recipe code it feeds the generated bootstrap (see generate.ts), and the URLs
// it resolves feed the hash too. Every URL an image bake fetches should be
// constructible from here, from the sub-spec passed in.

import type { AgeSpec, Arch, BunSpec, CrossToolchains, NodejsSpec, PinnedRelease, WindowsX64Image } from "./types.ts";

export type Download = {
  /** What to fetch. */
  url: string;
  /** Expected sha256, or null when the artifact cannot be pinned (a
   * FLOATING installer). null is fetched-but-unverified, by design. */
  sha256: string | null;
};

type Os = "linux" | "windows" | "darwin";
type Abi = "gnu" | "musl" | null;

const nodeCpu = (arch: Arch): string => (arch === "aarch64" ? "arm64" : "x64");

/** Node.js binary archive. Windows is a .zip; POSIX are .tar.gz. */
export function nodejsDownload(node: NodejsSpec, os: Os, arch: Arch, abi: Abi): Download {
  const v = node.version;
  const cpu = nodeCpu(arch);
  if (os === "windows") {
    return { url: `${node.distBase}/v${v}/node-v${v}-win-${cpu}.zip`, sha256: null };
  }
  const platform = os === "darwin" ? "darwin" : "linux";
  if (abi === "musl") {
    return { url: `${node.muslDistBase}/v${v}/node-v${v}-${platform}-${cpu}-musl.tar.gz`, sha256: null };
  }
  return { url: `${node.distBase}/v${v}/node-v${v}-${platform}-${cpu}.tar.gz`, sha256: null };
}

/** The folder name inside the node archive. */
export function nodejsFolderName(node: NodejsSpec, os: Os, arch: Arch, abi: Abi): string {
  const cpu = nodeCpu(arch);
  const platform = os === "darwin" ? "darwin" : os === "windows" ? "win" : "linux";
  return `node-v${node.version}-${platform}-${cpu}${abi === "musl" ? "-musl" : ""}`;
}

export function nodejsHeadersDownload(node: NodejsSpec): Download {
  const v = node.version;
  return { url: `${node.headersDistBase}/v${v}/node-v${v}-headers.tar.gz`, sha256: null };
}

/** Windows: node.lib for node-gyp linking. */
export function nodejsWinLibDownload(node: NodejsSpec, arch: Arch): Download {
  return { url: `${node.distBase}/v${node.version}/win-${nodeCpu(arch)}/node.lib`, sha256: null };
}

export function bunTriplet(os: Os, arch: Arch, abi: Abi): string {
  if (os === "windows") {
    return arch === "aarch64" ? "bun-windows-aarch64" : "bun-windows-x64";
  }
  return `bun-${os}-${arch}${abi === "musl" ? "-musl" : ""}`;
}

export function bunDownload(bun: BunSpec, os: Os, arch: Arch, abi: Abi): Download {
  return { url: `${bun.releaseBase}/bun-v${bun.version}/${bunTriplet(os, arch, abi)}.zip`, sha256: null };
}

export function cmakeDownload(cmake: PinnedRelease, arch: Arch): Download {
  const v = cmake.version;
  const cpu = arch === "aarch64" ? "aarch64" : "x86_64";
  return { url: `${cmake.releaseBase}/v${v}/cmake-${v}-linux-${cpu}.sh`, sha256: null };
}

export function curlH3Download(curlH3: PinnedRelease, os: Os, arch: Arch, abi: Abi): Download {
  const v = curlH3.version;
  const cpu = arch === "aarch64" ? "aarch64" : "x86_64";
  let asset: string;
  if (os === "windows") {
    asset = `curl-windows-${cpu}`;
  } else if (os === "darwin") {
    asset = arch === "aarch64" ? "curl-macos-arm64" : "curl-macos-x86_64";
  } else {
    asset = `curl-linux-${cpu}-${abi === "musl" ? "musl" : "glibc"}`;
  }
  return { url: `${curlH3.releaseBase}/${v}/${asset}-${v}.tar.xz`, sha256: null };
}

export function buildkiteAgentDownload(agent: PinnedRelease, os: Os, arch: Arch): Download {
  const v = agent.version;
  const cpu = arch === "aarch64" ? "arm64" : "amd64";
  if (os === "windows") {
    return { url: `${agent.releaseBase}/v${v}/buildkite-agent-windows-${cpu}-${v}.zip`, sha256: null };
  }
  return { url: `${agent.releaseBase}/v${v}/buildkite-agent-${os}-${cpu}-${v}.tar.gz`, sha256: null };
}

export function ageDownload(age: AgeSpec, os: Os, arch: Arch): Download {
  const v = age.version;
  const cpu = arch === "aarch64" ? "arm64" : "amd64";
  const sha256 = age.sha256[`${os}-${cpu}`] ?? null;
  return { url: `${age.releaseBase}/v${v}/age-v${v}-${os}-${cpu}.tar.gz`, sha256 };
}

export function pythonFuseDownload(fuse: PinnedRelease): Download {
  return { url: `${fuse.releaseBase}/v${fuse.version}.tar.gz`, sha256: null };
}

// --- Build-host cross toolchains ------------------------------------------

export function xwinDownload(cross: CrossToolchains, hostArch: Arch): Download {
  const v = cross.winSysroot.xwinVersion;
  const triple = hostArch === "aarch64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  return { url: `${cross.winSysroot.xwinReleaseBase}/${v}/xwin-${v}-${triple}.tar.gz`, sha256: null };
}

export function androidNdkDownload(cross: CrossToolchains): Download {
  const { releaseBase, version } = cross.androidNdk;
  return { url: `${releaseBase}/android-ndk-${version}-linux.zip`, sha256: null };
}

export function freebsdBaseDownload(cross: CrossToolchains, fbsdArch: "amd64" | "arm64"): Download {
  const { releaseBase, version } = cross.freebsdSysroot;
  return { url: `${releaseBase}/${fbsdArch}/${version}-RELEASE/base.txz`, sha256: null };
}

export function gcc13FocalDebsDownload(cross: CrossToolchains, debArch: "amd64" | "arm64"): Download {
  return { url: `${cross.glibcSysroot.gcc13ReleaseBase}/gcc-13-focal-${debArch}.tar.gz`, sha256: null };
}

export function ubuntuPackagesGzUrl(cross: CrossToolchains, sysrootArch: "x86_64" | "aarch64", dist: string): string {
  const debArch = sysrootArch === "x86_64" ? "amd64" : "arm64";
  return `${cross.glibcSysroot.aptBase[sysrootArch]}/dists/${dist}/main/binary-${debArch}/Packages.gz`;
}

// --- Windows-only ----------------------------------------------------------

export function powershellDownload(pwsh: PinnedRelease, arch: Arch): Download {
  const v = pwsh.version;
  const cpu = arch === "aarch64" ? "arm64" : "x64";
  return { url: `${pwsh.releaseBase}/v${v}/PowerShell-${v}-win-${cpu}.msi`, sha256: null };
}

export function opensshWindowsDownload(openssh: PinnedRelease, arch: Arch): Download {
  const cpu = arch === "aarch64" ? "Arm64" : "Win64";
  return { url: `${openssh.releaseBase}/${openssh.version}/OpenSSH-${cpu}.zip`, sha256: null };
}

export function ccacheWindowsDownload(ccache: PinnedRelease, arch: Arch): Download {
  const v = ccache.version;
  const cpu = arch === "aarch64" ? "aarch64" : "x86_64";
  return { url: `${ccache.releaseBase}/v${v}/ccache-${v}-windows-${cpu}.zip`, sha256: null };
}

/** The extracted folder name inside the ccache zip. */
export function ccacheWindowsFolder(ccache: PinnedRelease, arch: Arch): string {
  const cpu = arch === "aarch64" ? "aarch64" : "x86_64";
  return `ccache-${ccache.version}-windows-${cpu}`;
}

export function intelSdeDownload(sde: WindowsX64Image["intelSde"]): Download {
  return { url: `${sde.mirrorBase}/sde-external-${sde.version}-win.tar.xz`, sha256: sde.sha256 };
}

export function packerDownload(
  packerVersion: string,
  hostOs: "linux" | "darwin" | "windows",
  hostArch: Arch,
): Download {
  const platform = hostOs === "windows" ? "windows" : hostOs === "darwin" ? "darwin" : "linux";
  const cpu = hostArch === "aarch64" ? "arm64" : "amd64";
  return {
    url: `https://releases.hashicorp.com/packer/${packerVersion}/packer_${packerVersion}_${platform}_${cpu}.zip`,
    sha256: null,
  };
}
