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

export type Image = LinuxImage;

/** `linux-x64-13-debian`, `linux-aarch64-323-alpine-musl`: the part of an image's name before its hash. */
export function imageKey(image: Image): string {
  const release = image.release.replace(/\./g, "");
  const abi = image.abi === "musl" ? "-musl" : "";
  return `${image.os}-${image.arch}-${release}-${image.distro}${abi}`;
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
  /** Every URL the script downloads, so they can be checked before a bake starts. */
  urls: readonly string[];
};
