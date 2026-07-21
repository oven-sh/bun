// Host detection: what machine is bootstrap actually running on?
//
// The spec entry says what image we're baking; the host is what we probe.
// bootstrap asserts they agree (an alpine spec entry must be running on an
// alpine box) so a mis-launched bake fails at step 1 with a clear message
// instead of installing the wrong packages.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { log, runOutput, which } from "./runtime.ts";

export type Host = {
  os: "linux" | "darwin" | "windows";
  arch: "x64" | "aarch64";
  /** e.g. "debian", "ubuntu", "alpine", "macos"; undefined if unknown. */
  distro: string | undefined;
  release: string | undefined;
  /** linux only. */
  abi: "gnu" | "musl" | undefined;
  /** linux/darwin package manager on this box. */
  packageManager: "apt" | "apk" | "brew" | undefined;
  isRoot: boolean;
  /** The invoking (non-root) user, when run under sudo. */
  user: string;
  home: string;
};

/** Detect the host. Read-only probes only; safe in dry-run. */
export async function detectHost(): Promise<Host> {
  const os = detectOs();
  const arch = detectArch();
  const { distro, release } = detectDistro(os);
  const abi = os === "linux" ? detectAbi() : undefined;
  const packageManager = detectPackageManager(os);
  const isRoot = os === "windows" ? true : typeof process.getuid === "function" && process.getuid() === 0;
  const user = process.env.SUDO_USER || userInfo().username;
  const home = await homeOf(user, os);

  log(`Host: ${os} ${arch}${abi ? ` (${abi})` : ""}`);
  log(`Distribution: ${distro ?? "unknown"} ${release ?? ""}`);
  log(`Package manager: ${packageManager ?? "none"}`);
  log(`User: ${user} (home ${home})${isRoot ? " [running as root]" : ""}`);
  return { os, arch, distro, release, abi, packageManager, isRoot, user, home };
}

function detectOs(): Host["os"] {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported operating system: ${process.platform}`);
  }
}

function detectArch(): Host["arch"] {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "aarch64";
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}

function detectDistro(os: Host["os"]): { distro: string | undefined; release: string | undefined } {
  if (os === "linux") {
    const alpine = readIfExists("/etc/alpine-release");
    if (alpine !== undefined) {
      const version = alpine.trim();
      // "3.23.0" → "3.23"; "3.23_alpha..." → edge.
      const release = version.includes("_")
        ? `${version.split("_")[0]}-edge`
        : version.split(".").slice(0, 2).join(".");
      return { distro: "alpine", release };
    }
    const osRelease = readIfExists("/etc/os-release");
    if (osRelease !== undefined) {
      const fields = parseOsRelease(osRelease);
      return { distro: fields["ID"], release: fields["VERSION_ID"] };
    }
    return { distro: undefined, release: undefined };
  }
  if (os === "darwin") {
    return { distro: "macos", release: undefined };
  }
  return { distro: "windows", release: undefined };
}

function parseOsRelease(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) {
      fields[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1");
    }
  }
  return fields;
}

function detectAbi(): Host["abi"] {
  // `ldd --version` prints "musl libc" on musl, "GNU"/"GLIBC" on glibc
  // (musl's ldd prints it on stderr and exits non-zero — read both).
  const ldd = which("ldd");
  if (!ldd) return undefined;
  const result = spawnSync(ldd, ["--version"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/musl/i.test(output)) return "musl";
  if (/GNU|GLIBC/i.test(output)) return "gnu";
  return undefined;
}

function detectPackageManager(os: Host["os"]): Host["packageManager"] {
  if (os === "windows") return undefined;
  if (os === "darwin") return which("brew") ? "brew" : undefined;
  if (which("apt-get")) return "apt";
  if (which("apk")) return "apk";
  return undefined;
}

async function homeOf(user: string, os: Host["os"]): Promise<string> {
  if (os === "windows") {
    const profile = process.env.USERPROFILE;
    if (!profile) throw new Error(`Could not determine home directory: USERPROFILE is not set`);
    return profile;
  }
  // ~user expansion resolves the invoking user's home even under sudo,
  // where $HOME is root's.
  const home = await runOutput(["sh", "-c", `eval echo "~${user}"`], { allowFailure: true });
  if (!home || home === `~${user}`) {
    throw new Error(`Could not determine home directory for user "${user}"`);
  }
  return home;
}

function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
