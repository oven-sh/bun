import { spawn } from "./spawn";
import { read } from "./fs";
import { debug } from "./console";

export const os = process.platform;

export const arch = os === "darwin" && process.arch === "x64" && isRosetta2() ? "arm64" : process.arch;

export const avx2 = (arch === "x64" && os === "linux" && isLinuxAVX2()) || (os === "darwin" && isDarwinAVX2());

export type Platform = {
  os: string;
  arch: string;
  avx2?: boolean;
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
    avx2: true,
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
    avx2: true,
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
  .filter(platform => platform.os === os && platform.arch === arch && (!platform.avx2 || avx2))
  .sort((a, b) => (a.avx2 === b.avx2 ? 0 : a.avx2 ? -1 : 1));

function isLinuxAVX2(): boolean {
  try {
    return read("/proc/cpuinfo").includes("avx2");
  } catch (error) {
    debug("isLinuxAVX2 failed", error);
    return false;
  }
}

function isDarwinAVX2(): boolean {
  try {
    const { exitCode, stdout } = spawn("sysctl", ["-n", "machdep.cpu"]);
    return exitCode === 0 && stdout.includes("AVX2");
  } catch (error) {
    debug("isDarwinAVX2 failed", error);
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
