/**
 * What a CI machine image is, as data. `spec.ts` is the only place images and
 * versions are written down; `generate.ts` turns one image into the directory
 * a bake runs, and the hash of that directory is the image's name.
 */

export type Arch = "x64" | "aarch64";

/**
 * `build`: the image every Bun target is compiled on (it also runs tests).
 * `test`: an image that only runs tests.
 */
export type Role = "build" | "test";

/** The cloud image a bake box boots from: an exact name, never a pattern. */
export type BaseImage = {
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
export type AzureBaseImage = {
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

/** `linux-x64-13-debian`, `linux-aarch64-323-alpine-musl`, `windows-x64-2019`, `darwin-aarch64`: the part of an image's name before its hash. */
export function imageKey(image: Image): string {
  if (image.os === "windows") {
    return `windows-${image.arch}-${image.release}`;
  }
  if (image.os === "darwin") {
    return `darwin-${image.arch}`;
  }
  const release = image.release.replace(/\./g, "");
  const abi = image.abi === "musl" ? "-musl" : "";
  return `linux-${image.arch}-${release}-${image.distro}${abi}`;
}

/**
 * One thing a bake installs or sets up. A tool is a script file plus the
 * values it is given; the script reads nothing else about the image, so
 * everything that decides what it does is visible here.
 */
export type Tool = {
  name: string;
  /** The script, relative to `tools/`. */
  script: string;
  /** Shell variables set before the script. It may read these and no other upper-case variable. */
  variables: Readonly<Record<string, string>>;
  /**
   * Files the script uses, copied into the bake directory (`$BAKE_DIR`) and so
   * part of the hash: the name there, and the file's path in the repository.
   */
  files?: Readonly<Record<string, string>>;
};
