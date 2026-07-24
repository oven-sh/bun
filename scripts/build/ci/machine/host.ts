// Host detection: what machine is bootstrap actually running on?
//
// The spec entry says what image we're baking (distro, arch, packages); the
// host is probed only for what the recipe needs at runtime — the operating
// system (bootstrap refuses to run a linux entry on a non-linux box and
// vice versa) and the invoking user's identity and home directory. The
// distro / package manager come from the entry, not from probing: the same
// entry chose the base image, so a mismatch would mean the entry's own base
// fact is wrong.

import { userInfo } from "node:os";
import { log, runOutput } from "./runtime.ts";

export type Host = {
  os: "linux" | "darwin" | "windows";
  /** The invoking (non-root) user, when run under sudo. */
  user: string;
  home: string;
};

/** Detect the host. Read-only probes only; safe in dry-run. */
export async function detectHost(): Promise<Host> {
  const os = detectOs();
  const user = process.env.SUDO_USER || userInfo().username;
  const home = await homeOf(user, os);
  log(`Host: ${os}, user ${user} (home ${home})`);
  return { os, user, home };
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
