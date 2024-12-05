import { spawn } from "./spawn";
import { exists, read } from "./fs";
import { debug } from "./console";

export const os = process.platform;

export const arch = os === "darwin" && process.arch === "x64" && isRosetta2() ? "arm64" : process.arch;

export const avx2 =
  arch === "x64" &&
  ((os === "linux" && isLinuxAVX2()) || (os === "darwin" && isDarwinAVX2()) || (os === "win32" && isWindowsAVX2()));

export const abi = os === "linux" && isLinuxMusl() ? "musl" : undefined;

export type Platform = {
  os: string;
  arch: string;
  abi?: "musl";
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
  {
    os: "linux",
    arch: "aarch64",
    abi: "musl",
    bin: "bun-linux-aarch64-musl",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: true,
    bin: "bun-linux-x64-musl",
    exe: "bin/bun",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    bin: "bun-linux-x64-musl-baseline",
    exe: "bin/bun",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: true,
    bin: "bun-windows-x64",
    exe: "bin/bun.exe",
  },
  {
    os: "win32",
    arch: "x64",
    bin: "bun-windows-x64-baseline",
    exe: "bin/bun.exe",
  },
];

export const supportedPlatforms: Platform[] = platforms
  .filter(
    platform =>
      platform.os === os &&
      platform.arch === arch &&
      (!platform.avx2 || avx2) &&
      (!platform.abi || abi === platform.abi),
  )
  .sort((a, b) => (a.avx2 === b.avx2 ? 0 : a.avx2 ? -1 : 1));

function isLinuxMusl(): boolean {
  try {
    return exists("/etc/alpine-release");
  } catch (error) {
    debug("isLinuxMusl failed", error);
    return false;
  }
}

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

function isWindowsAVX2(): boolean {
  try {
    return (
      spawn("powershell", [
        "-c",
        `(Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name 'Kernel32' -Namespace 'Win32' -PassThru)::IsProcessorFeaturePresent(40);`,
      ]).stdout.trim() === "True"
    );
  } catch (error) {
    debug("isWindowsAVX2 failed", error);
    return false;
  }
}
