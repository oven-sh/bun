import { $ } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config";

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

// The guest gets the working tree only. Nothing in it reads the checkout's .git (the runner takes the commit from
// the forwarded BUILDKITE_* env), and the `git gc --auto` the agent's fetch leaves running rewrites .git while
// rsync reads it: a vanished .git/gc.pid fails the sync with exit 23. Anchored, so a nested repo still copies whole.
export const checkoutExcludes = ["--exclude=/.git"];

export async function ensureHostKey(): Promise<string> {
  if (!(await Bun.file(hostKey).exists())) {
    await $`ssh-keygen -q -t ed25519 -N "" -C ${`${process.env.USER}@darwin-ci`} -f ${hostKey}`;
  }
  return (await Bun.file(`${hostKey}.pub`).text()).trim();
}

export function guest(ip: string) {
  const target = `${config.tart.guestUser}@${ip}`;
  const rsh = `ssh ${sshOptions.join(" ")}`;

  return {
    ip,

    run(command: string, forward: string[] = []): Promise<number> {
      const proc = Bun.spawn(["ssh", ...sshOptions, ...forward, target, command], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      return proc.exited;
    },

    capture: (command: string) => $`ssh ${sshOptions} ${target} ${command} < /dev/null`.text(),

    push: (local: string, remote: string) => $`scp ${sshOptions} -q ${local} ${target}:${remote}`.quiet(),

    syncTo: (localDir: string, remoteDir: string) =>
      $`rsync -a --delete ${checkoutExcludes} -e ${rsh} ${localDir}/ ${target}:${remoteDir}/`.quiet(),

    collectReports: (remoteDir: string, localDir: string) =>
      $`rsync -a -e ${rsh} --include=*/ --include=*.xml --include=*.junit --exclude=* --prune-empty-dirs ${target}:${remoteDir}/ ${localDir}/`
        .quiet()
        .nothrow(),
  };
}
