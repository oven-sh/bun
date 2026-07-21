// POSIX (linux) system operations: the vocabulary linux bootstrap steps are
// written in.
//
// Steps say WHAT ("ensure this directory", "install this binary", "add the
// user to this group") and these ops decide HOW (which command, run as root,
// quoting). Each op logs its intent in plain terms and then executes through
// runtime.run(), so a --dry-run prints intent + the exact command, and a
// failure reports both. ./ops-windows.ts mirrors the shared signatures for
// Windows.
//
// The genuine one-off scripts (sysroot assembly, symlink rewriting) use the
// labeled escape hatch shellScript(), whose required `describe` makes the
// exception visible in the code and the log.

import type { RunOptions, RunResult } from "./runtime.ts";
import { log, run, runOutput, sudo, verify, warn, which } from "./runtime.ts";

// ---------------------------------------------------------------------------
// Files and directories (all system paths → run as root)
// ---------------------------------------------------------------------------

/** Create a directory (and parents). Optional octal mode / "user:group". */
export async function ensureDirectory(path: string, options: { mode?: string; owner?: string } = {}): Promise<void> {
  log(
    `ensuring directory ${path}${options.mode ? ` (mode ${options.mode})` : ""}${options.owner ? ` (owner ${options.owner})` : ""}`,
  );
  await sudo(["mkdir", "-p", path]);
  if (options.mode) await sudo(["chmod", options.mode, path]);
  if (options.owner) await sudo(["chown", options.owner, path]);
}

/** Remove files/directories recursively (missing paths are fine). */
export async function removePaths(...paths: string[]): Promise<void> {
  log(`removing ${paths.join(", ")}`);
  await sudo(["rm", "-rf", ...paths]);
}

/** Merge the CONTENTS of `from` into `into`, preserving symlinks. Used to
 * lay an extracted release (node's bin/lib/include/share) over /usr/local. */
export async function copyIntoDirectory(from: string, into: string): Promise<void> {
  log(`copying contents of ${from} into ${into} (symlinks preserved)`);
  await sudo(["mkdir", "-p", into]);
  await sudo(["cp", "-R", `${from}/.`, `${into}/`]);
}

/** Copy one file to a system destination with an explicit mode. */
export async function installFile(spec: { from: string; to: string; mode: string }): Promise<void> {
  log(`installing ${spec.from} → ${spec.to} (mode ${spec.mode})`);
  await sudo(["cp", "-f", spec.from, spec.to]);
  await sudo(["chmod", spec.mode, spec.to]);
}

/** Point symlink `at` to `target`, replacing whatever is there. */
export async function ensureSymlink(target: string, at: string): Promise<void> {
  log(`symlinking ${at} → ${target}`);
  await sudo(["ln", "-sf", target, at]);
}

export async function moveFile(from: string, to: string): Promise<void> {
  log(`moving ${from} → ${to}`);
  await sudo(["mv", "-f", from, to]);
}

export async function setOwnerRecursive(path: string, owner: string): Promise<void> {
  log(`chown -R ${owner} ${path}`);
  await sudo(["chown", "-R", owner, path]);
}

export async function setModeRecursive(path: string, mode: string): Promise<void> {
  log(`chmod -R ${mode} ${path}`);
  await sudo(["chmod", "-R", mode, path]);
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

export type ExtractOptions = {
  file: string;
  into: string;
  /** tar --strip-components */
  stripComponents?: number;
  /** Extract only these members (tar). */
  members?: string[];
  /** Extract as root (system destinations). Scratch extraction doesn't. */
  root?: boolean;
};

/** Extract a .tar.gz/.tgz/.tar.xz/.txz/.zip into a directory, choosing
 * the tool and flags from the extension. */
export async function extractArchive(spec: ExtractOptions): Promise<void> {
  const { file, into } = spec;
  log(`extracting ${file} into ${into}${spec.members ? ` (only: ${spec.members.join(" ")})` : ""}`);
  let command: string[];
  if (/\.zip$/i.test(file)) {
    command = ["unzip", "-o", "-q", file, "-d", into];
  } else {
    const compression = /\.(tar\.xz|txz)$/i.test(file) ? "J" : "z";
    command = ["tar", `-x${compression}f`, file, "-C", into];
    if (spec.stripComponents) command.push(`--strip-components=${spec.stripComponents}`);
    if (spec.members) command.push(...spec.members);
  }
  await (spec.root ? sudo(["mkdir", "-p", into]) : run(["mkdir", "-p", into]));
  await (spec.root ? sudo(command) : run(command));
}

// ---------------------------------------------------------------------------
// Users and groups
// ---------------------------------------------------------------------------

export type UserSpec = {
  name: string;
  home: string;
  shell: string;
  /** busybox adduser (alpine) vs shadow useradd (everyone else). */
  flavor: "busybox" | "shadow";
};

/** Create a system user if it doesn't exist. Idempotent. */
export async function ensureSystemUser(spec: UserSpec): Promise<void> {
  const existing = await runOutput(["sh", "-c", `getent passwd ${spec.name} || true`]);
  if (existing) {
    log(`user ${spec.name} already exists`);
    return;
  }
  log(`creating system user ${spec.name} (home ${spec.home}, shell ${spec.shell})`);
  if (spec.flavor === "busybox") {
    await sudo(["addgroup", "--system", spec.name]);
    await sudo([
      "adduser",
      spec.name,
      "--system",
      "--ingroup",
      spec.name,
      "--shell",
      spec.shell,
      "--home",
      spec.home,
      "--disabled-password",
    ]);
  } else {
    await sudo(["useradd", spec.name, "--system", "--shell", spec.shell, "--no-create-home", "--home-dir", spec.home]);
  }
}

/** Add a user to a group if the group exists (a missing group is a
 * logged no-op, e.g. no docker group on a machine without docker). */
export async function addUserToGroup(user: string, group: string): Promise<void> {
  const exists = await runOutput(["sh", "-c", `getent group ${group} || true`]);
  if (!exists) {
    log(`group ${group} does not exist; not adding ${user} to it`);
    return;
  }
  log(`adding user ${user} to group ${group}`);
  await sudo(["usermod", "-aG", group, user]);
}

// ---------------------------------------------------------------------------
// Services and kernel settings
// ---------------------------------------------------------------------------

/** systemd if present, else OpenRC (alpine). */
function initSystem(): "systemd" | "openrc" | undefined {
  if (which("systemctl")) return "systemd";
  if (which("rc-update")) return "openrc";
  return undefined;
}

/** Enable a service at boot (and start it now when `start`). */
export async function enableService(name: string, options: { start: boolean }): Promise<void> {
  const init = initSystem();
  log(`enabling service ${name} at boot (${init ?? "no init system"})${options.start ? " and starting it" : ""}`);
  if (init === "systemd") {
    await sudo(["systemctl", "enable", name]);
    // Best-effort start: a unit that needs a reboot (or first-boot state)
    // to come up still gets enabled; the image bakes it either way.
    if (options.start) await sudo(["systemctl", "start", name], { allowFailure: true });
  } else if (init === "openrc") {
    await sudo(["rc-update", "add", name, "default"]);
    // (same best-effort start as the systemd branch above)
    if (options.start) await sudo(["rc-service", name, "start"], { allowFailure: true });
  } else {
    warn(`no init system found; ${name} not enabled`);
  }
}

/** Stop and disable a service if it exists (systemd only). */
export async function disableServiceNow(name: string): Promise<void> {
  if (initSystem() !== "systemd") return;
  const units = await runOutput(["sh", "-c", `systemctl list-unit-files ${name} 2>/dev/null || true`]);
  if (!units.includes(name)) {
    log(`service ${name} not present; nothing to disable`);
    return;
  }
  log(`disabling service ${name} now`);
  await sudo(["systemctl", "disable", "--now", name], { allowFailure: true });
}

/** systemd: mask a unit so nothing can start it. */
export async function maskUnit(name: string): Promise<void> {
  if (initSystem() !== "systemd") {
    log(`no systemd; not masking ${name}`);
    return;
  }
  log(`masking unit ${name}`);
  await sudo(["systemctl", "mask", name]);
}

export async function reloadServiceManager(): Promise<void> {
  if (initSystem() !== "systemd") return;
  // Best-effort: a reload failure means only that new units apply on boot.
  await sudo(["systemctl", "daemon-reload"], { allowFailure: true });
}

/** Load kernel settings from a sysctl.d file now (values apply on boot
 * regardless). Best-effort: some knobs are read-only in some VMs. */
export async function applySysctlFile(path: string): Promise<void> {
  log(`applying sysctl settings from ${path}`);
  await sudo(["sysctl", "-p", path], { allowFailure: true });
}

/** Discard free space so the captured image is small. */
export async function trimFilesystems(): Promise<void> {
  if (!which("fstrim")) {
    log("no fstrim; skipping trim");
    return;
  }
  log("trimming filesystems (fstrim -av)");
  await sudo(["fstrim", "-av"], { allowFailure: true });
}

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

export type ScriptSpec = {
  /** What the script accomplishes — required, printed in the log. This is
   * what makes a raw script an explicit, labeled exception. */
  describe: string;
  script: string;
  root: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
  allowFailure?: boolean;
};

/**
 * Run a multi-line sh script for the few operations that are genuinely
 * scripts (assembling a sysroot from image layers, rewriting a tree of
 * symlinks, discovering a path at run time to symlink into it). The script
 * is echoed in full and its output streamed like any command.
 */
export function shellScript(spec: ScriptSpec): Promise<RunResult> {
  log(`script: ${spec.describe}`);
  const command = ["sh", "-c", spec.script];
  const options: RunOptions = {};
  if (spec.cwd !== undefined) options.cwd = spec.cwd;
  if (spec.env !== undefined) options.env = spec.env;
  if (spec.allowFailure !== undefined) options.allowFailure = spec.allowFailure;
  return spec.root ? sudo(["sh", "-c", spec.script], options) : run(command, options);
}

/** A named check that a step produced what it should. Re-exported so
 * step modules import their whole vocabulary from one place. */
export { verify };
