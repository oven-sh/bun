import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { config, toolchain } from "./config";
import { fail, poll, probe, run, runInherit, runInheritOrThrow, sleep, spawn, succeeds, sudoWrite } from "./shell";

export const brewPrefix = process.arch === "arm64" ? "/opt/homebrew" : "/usr/local";
const brew = `${brewPrefix}/bin/brew`;
const tailscale = `${brewPrefix}/bin/tailscale`;

export async function disableRemoteManagement(): Promise<void> {
  const kickstart = "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart";
  await spawn(["sudo", kickstart, "-deactivate", "-stop"]);
  await spawn(["sudo", "launchctl", "disable", "system/com.apple.screensharing"]);
  await spawn(["sudo", "launchctl", "bootout", "system/com.apple.screensharing"]);
}

export async function hardenSshd(): Promise<void> {
  await sudoWrite(
    "/etc/ssh/sshd_config.d/000-hardening.conf",
    "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n",
  );
  await run(["sudo", "launchctl", "kickstart", "-k", "system/com.openssh.sshd"]);
}

export async function setHostname(name: string): Promise<void> {
  for (const key of ["ComputerName", "LocalHostName", "HostName"]) {
    await run(["sudo", "scutil", "--set", key, name]);
  }
}

// bootstrap.sh only appends PATH entries to profiles that already exist
export async function ensureShellProfiles(): Promise<void> {
  const home = homedir();
  await run(["touch", join(home, ".profile"), join(home, ".zshrc"), join(home, ".bash_profile")]);
}

export async function brewInstall(formula: string): Promise<void> {
  const name = formula.split("/").pop()!;
  if (await succeeds([brew, "list", name])) return;
  await runInheritOrThrow([brew, "install", formula]);
}

export async function joinTailnet(hostname: string, tags: string | undefined): Promise<void> {
  await brewInstall("tailscale");
  await spawn(["sudo", `${brewPrefix}/bin/tailscaled`, "install-system-daemon"]);
  await sleep(3000);
  if (await succeeds(["sudo", tailscale, "status"])) return;

  const tagArgs = tags ? [`--advertise-tags=${tags}`] : [];
  Bun.spawn(["sudo", tailscale, "up", "--ssh", ...tagArgs, `--hostname=${hostname}`], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();

  const url = await poll(15, 2000, async () => {
    const status = JSON.parse((await probe(["sudo", tailscale, "status", "--json"])) ?? "{}");
    return typeof status.AuthURL === "string" && status.AuthURL ? (status.AuthURL as string) : undefined;
  });
  console.log(
    url
      ? `    approve this host in the tailnet admin console: ${url}`
      : "    tailscale up started; run `tailscale status` for the login URL",
  );
}

export async function tailnetSummary(): Promise<string> {
  const status = await probe(["sudo", tailscale, "status", "--self", "--peers=false"]);
  return status?.split("\n")[0] || "not connected";
}

export async function installBuildkiteAgent(): Promise<void> {
  const { version, bin } = config.buildkiteAgent;
  if ((await probe([bin, "--version"]))?.includes(version)) return;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://github.com/buildkite/agent/releases/download/v${version}/buildkite-agent-darwin-${arch}-${version}.tar.gz`;
  const tmp = mkdtempSync(join(tmpdir(), "buildkite-agent-"));
  try {
    await run(["curl", "-fsSL", "-o", join(tmp, "agent.tgz"), url]);
    await run(["tar", "-xzf", join(tmp, "agent.tgz"), "-C", tmp]);
    await run(["sudo", "mkdir", "-p", "/usr/local/bin"]);
    await run(["sudo", "install", "-m", "755", join(tmp, "buildkite-agent"), bin]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function installSelf(): Promise<void> {
  const source = join(import.meta.dir, "..");
  await run(["sudo", "mkdir", "-p", config.installDir]);
  await run(["sudo", "rsync", "-a", "--delete", "--chmod=Fa+r,Da+rx", `${source}/`, `${config.installDir}/`]);
}

export const bootstrapCheckout = join(homedir(), "bun-bootstrap");

export async function bootstrapToolchain(): Promise<void> {
  rmSync(bootstrapCheckout, { recursive: true, force: true });
  await run(["git", "clone", "-q", "--depth=1", "--branch", config.bun.ref, config.bun.repo, bootstrapCheckout]);
  const status = await runInherit(["./scripts/bootstrap.sh"], { cwd: bootstrapCheckout });
  if (status !== 0) console.log(`bootstrap.sh exited ${status}; verifying toolchain`);
  await verifyToolchain();
}

export async function verifyToolchain(): Promise<void> {
  const missing: string[] = [];
  for (const tool of toolchain) {
    if (!(await succeeds(["bash", "-lc", `command -v ${tool}`]))) missing.push(tool);
  }
  if (missing.length) fail(`toolchain incomplete after bootstrap: ${missing.join(", ")}`);
}
