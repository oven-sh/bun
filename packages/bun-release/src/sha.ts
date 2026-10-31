import { spawn } from "./spawn";

// Bun embeds the full commit it was built from (it is what `Bun.revision`
// returns), so a released binary is itself the canonical record of the commit
// its release assets were built from. The rolling "canary" release has no
// other trustworthy record: its tag never moves, and heads/main advances past
// the assets whenever an upload fails or lags (#40880).
export function binaryRevision(exe: string): string {
  const { exitCode, stdout, stderr } = spawn(exe, ["--print", "Bun.revision"], {
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  });
  // spawnSync leaves stdout and stderr null when the binary cannot launch at
  // all (missing file, wrong architecture), and spawn() passes that through.
  const revision = (stdout ?? "").trim();
  if (exitCode !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`Could not read the build commit from ${exe}: ${stderr || stdout || "the binary did not run"}`);
  }
  return revision;
}

// The embedded sha makes the bytes of every released binary contain the full
// commit it was built from. This is how binaries for platforms that cannot
// run on this machine are checked against the sha stamped into package
// metadata.
export function binaryIncludesSha(binary: Buffer, sha: string): boolean {
  return binary.includes(sha, 0, "utf8");
}
