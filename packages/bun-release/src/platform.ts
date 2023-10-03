import { spawn } from "./spawn";
import { read } from "./fs";
import { debug } from "./console";

export const os = process.platform;

export const arch = os === "darwin" && process.arch === "x64" && isRosetta2() ? "arm64" : process.arch;

export const avx = arch === "x64" && ((os === "linux" && isLinuxAVX()) || (os === "darwin" && isDarwinAVX()));

export type Platform = {
  os: string;
  arch: string;
  avx?: boolean;
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
    avx: true,
    bin: "bun-darwin-x64",
    exe: "bin/bun",
  },
  {
    os: "darwin",
    arch: "x64",
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
    avx: true,
    bin: "bun-linux-x64",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    bin: "bun-linux-x64-baseline",
    exe: "bin/bun",
  },
];

export const supportedPlatforms: Platform[] = platforms
  .filter(platform => platform.os === os && platform.arch === arch && (!platform.avx || avx))
  .sort((a, b) => (a.avx === b.avx ? 0 : a.avx ? -1 : 1));

function isLinuxAVX(): boolean {
  try {
    return read("/proc/cpuinfo").includes("avx");
  } catch (error) {
    debug("isLinuxAVX failed", error);
    return false;
  }
}

function isDarwinAVX(): boolean {
  try {
    const { exitCode, stdout } = spawn("sysctl", ["-n", "machdep.cpu"]);
    return exitCode === 0 && stdout.includes("AVX");
  } catch (error) {
    debug("isDarwinAVX failed", error);
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
