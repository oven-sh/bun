import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config";
import { run, runInherit } from "./shell";

export const hostKey = join(homedir(), ".ssh", "id_ed25519");

const sshOptions = [
  "-i",
  hostKey,
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "IdentityAgent=none",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "ServerAliveInterval=30",
];

export async function ensureHostKey(): Promise<string> {
  if (!(await Bun.file(hostKey).exists())) {
    await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", `${process.env.USER}@darwin-ci`, "-f", hostKey]);
  }
  return (await Bun.file(`${hostKey}.pub`).text()).trim();
}

export function guest(ip: string) {
  const target = `${config.tart.guestUser}@${ip}`;
  const rsh = ["-e", `ssh ${sshOptions.join(" ")}`];

  return {
    ip,

    // the remote sshd hands `command` to the guest user's shell, so callers quote its arguments with shellQuote
    run: (command: string, forward: string[] = []) => runInherit(["ssh", ...sshOptions, ...forward, target, command]),

    push: (local: string, remote: string) => run(["scp", ...sshOptions, "-q", local, `${target}:${remote}`]),

    syncTo: (localDir: string, remoteDir: string) =>
      run(["rsync", "-a", "--delete", ...rsh, `${localDir}/`, `${target}:${remoteDir}/`]),

    collectReports: (remoteDir: string, localDir: string) =>
      run([
        "rsync",
        "-a",
        ...rsh,
        "--include=*/",
        "--include=*.xml",
        "--include=*.junit",
        "--exclude=*",
        "--prune-empty-dirs",
        `${target}:${remoteDir}/`,
        `${localDir}/`,
      ]),
  };
}
