// What kind of machine this is: os, arch, abi, distro, kernel, hostname. The
// agent reports these as its tags, and the test runner checks the machine it
// lands on against what the pipeline asked for.

import { existsSync, readFileSync } from "node:fs";
import { hostname, release } from "node:os";
import { getEnv, isAndroid, isBuildkite, isGithubAction, isLinux, isMacOS, isWindows, spawnSync } from "./process.ts";

export type Os = "darwin" | "linux" | "windows" | "freebsd";

export type Arch = "x64" | "aarch64";

export type Abi = "musl" | "gnu" | "android";

function parseOs(string: string): Os {
  if (/darwin|apple|mac/i.test(string)) {
    return "darwin";
  }
  if (/linux|android/i.test(string)) {
    return "linux";
  }
  if (/freebsd/i.test(string)) {
    return "freebsd";
  }
  if (/win/i.test(string)) {
    return "windows";
  }
  throw new Error(`Unsupported operating system: ${string}`);
}

export function getOs(): Os {
  return parseOs(process.platform);
}

function parseArch(string: string): Arch {
  if (/x64|amd64|x86_64/i.test(string)) {
    return "x64";
  }
  if (/arm64|aarch64/i.test(string)) {
    return "aarch64";
  }
  throw new Error(`Unsupported architecture: ${string}`);
}

export function getArch(): Arch {
  return parseArch(process.arch);
}

export function getKernel(): string | undefined {
  if (isWindows) {
    return;
  }

  const kernel = release();
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(kernel);

  if (match) {
    const [, major, minor, patch] = match;
    if (patch) {
      return `${major}.${minor}.${patch}`;
    }
    return `${major}.${minor}`;
  }

  return kernel;
}

export function getAbi(): Abi | undefined {
  if (!isLinux) {
    return;
  }

  if (isAndroid || existsSync("/system/bin/linker64")) {
    return "android";
  }

  if (existsSync("/etc/alpine-release")) {
    return "musl";
  }

  const arch = getArch() === "x64" ? "x86_64" : "aarch64";
  const muslLibPath = `/lib/ld-musl-${arch}.so.1`;
  if (existsSync(muslLibPath)) {
    return "musl";
  }

  const gnuLibPath = `/lib/ld-linux-${arch}.so.2`;
  if (existsSync(gnuLibPath)) {
    return "gnu";
  }

  const { error, stdout } = spawnSync(["ldd", "--version"]);
  if (!error) {
    if (/musl/i.test(stdout)) {
      return "musl";
    }
    if (/gnu|glibc/i.test(stdout)) {
      return "gnu";
    }
  }

  return undefined;
}

export function getAbiVersion(): string | undefined {
  if (!isLinux) {
    return;
  }

  const { error, stdout } = spawnSync(["ldd", "--version"]);
  if (!error) {
    const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
    if (match) {
      const [, major, minor, patch] = match;
      if (patch) {
        return `${major}.${minor}.${patch}`;
      }
      return `${major}.${minor}`;
    }
  }

  return undefined;
}

export function getHostname(): string {
  if (isBuildkite) {
    const agent = getEnv("BUILDKITE_AGENT_NAME", false);
    if (agent) {
      return agent;
    }
  }

  if (isGithubAction) {
    const runner = getEnv("RUNNER_NAME", false);
    if (runner) {
      return runner;
    }
  }

  return hostname();
}

export function getDistro(): string | undefined {
  if (isMacOS) {
    return "macOS";
  }

  if (isLinux) {
    const alpinePath = "/etc/alpine-release";
    if (existsSync(alpinePath)) {
      return "alpine";
    }

    const releasePath = "/etc/os-release";
    if (existsSync(releasePath)) {
      const releaseFile = readFileSync(releasePath, "utf8");
      const match = releaseFile.match(/^ID=(.*)/m);
      if (match) {
        const id = match[1]!;
        return id.includes('"') ? (JSON.parse(id) as string) : id;
      }
    }

    const { error, stdout } = spawnSync(["lsb_release", "-is"]);
    if (!error) {
      return stdout.trim().toLowerCase();
    }
  }

  if (isWindows) {
    const { error, stdout } = spawnSync(["cmd", "/c", "ver"]);
    if (!error) {
      return stdout.trim();
    }
  }

  return undefined;
}

export function getDistroVersion(): string | undefined {
  if (isMacOS) {
    const { error, stdout } = spawnSync(["sw_vers", "-productVersion"]);
    if (!error) {
      return stdout.trim();
    }
  }

  if (isLinux) {
    const alpinePath = "/etc/alpine-release";
    if (existsSync(alpinePath)) {
      const release = readFileSync(alpinePath, "utf8").trim();
      if (release.includes("_")) {
        const [version] = release.split("_");
        return `${version}-edge`;
      }
      return release;
    }

    const releasePath = "/etc/os-release";
    if (existsSync(releasePath)) {
      const releaseFile = readFileSync(releasePath, "utf8");
      const match = releaseFile.match(/^VERSION_ID=(.*)/m);
      if (match) {
        const release = match[1]!;
        return release.includes('"') ? (JSON.parse(release) as string) : release;
      }
    }

    const { error, stdout } = spawnSync(["lsb_release", "-rs"]);
    if (!error) {
      return stdout.trim();
    }
  }

  if (isWindows) {
    const { error, stdout } = spawnSync(["cmd", "/c", "ver"]);
    if (!error) {
      return stdout.trim();
    }
  }

  return undefined;
}
