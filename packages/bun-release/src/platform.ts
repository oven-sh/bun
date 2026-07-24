import { debug } from "./console";
import { exists } from "./fs";
import { spawn } from "./spawn";

export const os = process.platform;

export const arch = os === "darwin" && process.arch === "x64" && isRosetta2() ? "arm64" : process.arch;

export const abi = os === "android" ? "android" : os === "linux" && isLinuxMusl() ? "musl" : undefined;

export type Platform = {
  os: string;
  arch: string;
  abi?: "musl" | "android";
  /** Back-compat alias package; same binary as the plain entry. Skipped by the postinstall picker. */
  alias?: boolean;
  bin: string;
  exe: string;
};

export const platforms: Platform[] = [
  {
    os: "darwin",
    arch: "arm64",
    bin: "bun-darwin-aarch64",
    exe: "bin/bun",
  },
  {
    os: "darwin",
    arch: "x64",
    bin: "bun-darwin-x64",
    exe: "bin/bun",
  },
  {
    os: "darwin",
    arch: "x64",
    alias: true,
    bin: "bun-darwin-x64-baseline",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "arm64",
    bin: "bun-linux-aarch64",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    bin: "bun-linux-x64",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    alias: true,
    bin: "bun-linux-x64-baseline",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
    bin: "bun-linux-aarch64-musl",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    bin: "bun-linux-x64-musl",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    alias: true,
    bin: "bun-linux-x64-musl-baseline",
    exe: "bin/bun",
  },
  {
    // Node's process.platform is "android" on Android (Termux etc.), not "linux".
    // The release asset is still named bun-linux-* for consistency with the
    // build triplet, but npm's os field must be "android" for optionalDependency
    // resolution to pick it up on-device.
    os: "android",
    arch: "arm64",
    abi: "android",
    bin: "bun-linux-aarch64-android",
    exe: "bin/bun",
  },
  {
    os: "android",
    arch: "x64",
    abi: "android",
    bin: "bun-linux-x64-android",
    exe: "bin/bun",
  },
  {
    os: "freebsd",
    arch: "arm64",
    bin: "bun-freebsd-aarch64",
    exe: "bin/bun",
  },
  {
    os: "freebsd",
    arch: "x64",
    bin: "bun-freebsd-x64",
    exe: "bin/bun",
  },
  {
    os: "win32",
    arch: "x64",
    bin: "bun-windows-x64",
    exe: "bin/bun.exe",
  },
  {
    os: "win32",
    arch: "x64",
    alias: true,
    bin: "bun-windows-x64-baseline",
    exe: "bin/bun.exe",
  },
  {
    os: "win32",
    arch: "arm64",
    bin: "bun-windows-aarch64",
    exe: "bin/bun.exe",
  },
];

export const supportedPlatforms: Platform[] = platforms.filter(
  platform =>
    platform.os === os && platform.arch === arch && !platform.alias && (!platform.abi || abi === platform.abi),
);

function isLinuxMusl(): boolean {
  try {
    return exists("/etc/alpine-release");
  } catch (error) {
    debug("isLinuxMusl failed", error);
    return false;
  }
}

function isRosetta2(): boolean {
  try {
    const { exitCode, stdout } = spawn("sysctl", ["-n", "sysctl.proc_translated"]);
    return exitCode === 0 && stdout.includes("1");
  } catch (error) {
    debug("isRosetta2 failed", error);
    return false;
  }
}
