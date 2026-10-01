import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { config, toolchain } from "./config";
import { fail, poll, probe, run, runInheritOrThrow, sleep, spawn, succeeds, sudoWrite } from "./shell";

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

export async function brewInstall(formula: string): Promise<void> {
  const parts = formula.split("/");
  const name = parts.pop()!;
  if (await succeeds([brew, "list", name])) return;
  // Homebrew refuses to load a formula from a tap it has not been told to trust
  // ("Refusing to load formula ... from untrusted tap"), which fails the install.
  // A tap formula is written org/repo/name. Trust the whole tap, not only the named
  // formula: `brew install cirruslabs/cli/tart` trusts tart by itself and still
  // refuses its dependency cirruslabs/cli/softnet from the same tap.
  if (parts.length === 2) {
    const tap = parts.join("/");
    await run([brew, "tap", tap]);
    await spawn([brew, "trust", tap]); // older Homebrew has no `trust`
  }
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

/**
 * The script that installs the toolchain on a machine of this architecture,
 * generated from the image spec (scripts/build/ci-images) of the bun
 * repository at `ref`. Returns its path. The checkout is left in place:
 * installBareAgent runs scripts/agent.ts from it.
 */
export async function generateBootstrap(ref: string): Promise<string> {
  rmSync(bootstrapCheckout, { recursive: true, force: true });
  await run(["git", "clone", "-q", "--depth=1", "--branch", ref, config.bun.repo, bootstrapCheckout]);
  const key = `darwin-${process.arch === "arm64" ? "aarch64" : "x64"}`;
  await run([process.execPath, "scripts/build/ci-images/spec.ts", key], { cwd: bootstrapCheckout });
  return join(bootstrapCheckout, "build", "ci-images", key, "bootstrap.sh");
}

export async function bootstrapToolchain(ref: string): Promise<void> {
  await runInheritOrThrow(["sh", await generateBootstrap(ref)]);
  await verifyToolchain();
}

export async function verifyToolchain(): Promise<void> {
  const missing: string[] = [];
  for (const tool of toolchain) {
    if (!(await succeeds(["bash", "-lc", `command -v ${tool}`]))) missing.push(tool);
  }
  if (missing.length) fail(`toolchain incomplete after bootstrap: ${missing.join(", ")}`);
}
