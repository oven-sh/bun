import { $ } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, toolchain } from "./config";
import { fail, output, poll, sleep, succeeds, sudoWrite } from "./shell";

export const brewPrefix = process.arch === "arm64" ? "/opt/homebrew" : "/usr/local";
const brew = `${brewPrefix}/bin/brew`;
const tailscale = `${brewPrefix}/bin/tailscale`;

export async function disableRemoteManagement(): Promise<void> {
  const kickstart = "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart";
  await $`sudo ${kickstart} -deactivate -stop`.quiet().nothrow();
  await $`sudo launchctl disable system/com.apple.screensharing`.quiet().nothrow();
  await $`sudo launchctl bootout system/com.apple.screensharing`.quiet().nothrow();
}

export async function hardenSshd(): Promise<void> {
  await sudoWrite(
    "/etc/ssh/sshd_config.d/000-hardening.conf",
    "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n",
  );
  await $`sudo launchctl kickstart -k system/com.openssh.sshd`.quiet();
}

export async function setHostname(name: string): Promise<void> {
  for (const key of ["ComputerName", "LocalHostName", "HostName"]) {
    await $`sudo scutil --set ${key} ${name}`;
  }
  // bootstrap.sh only appends PATH entries to profiles that already exist
  await $`touch ~/.profile ~/.zshrc ~/.bash_profile`;
}

export async function brewInstall(formula: string): Promise<void> {
  const name = formula.split("/").pop()!;
  if (await succeeds($`${brew} list ${name}`)) return;
  // Third-party taps must be trusted as a whole: trusting only the formula
  // still fails on its dependencies from the same tap.
  const tap = formula.includes("/") ? formula.split("/").slice(0, 2).join("/") : undefined;
  if (tap) await $`${brew} trust ${tap}`.quiet();
  await $`${brew} install ${formula}`;
}

export async function joinTailnet(hostname: string, tags: string | undefined): Promise<void> {
  await brewInstall("tailscale");
  await $`sudo ${brewPrefix}/bin/tailscaled install-system-daemon`.quiet().nothrow();
  await sleep(3000);
  if (await succeeds($`sudo ${tailscale} status`)) return;

  const tagArgs = tags ? [`--advertise-tags=${tags}`] : [];
  Bun.spawn(["sudo", tailscale, "up", "--ssh", ...tagArgs, `--hostname=${hostname}`], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();

  const url = await poll(15, 2000, async () => {
    const status = JSON.parse((await output($`sudo ${tailscale} status --json`)) || "{}");
    return typeof status.AuthURL === "string" && status.AuthURL ? (status.AuthURL as string) : undefined;
  });
  console.log(
    url
      ? `    approve this host in the tailnet admin console: ${url}`
      : "    tailscale up started; run `tailscale status` for the login URL",
  );
}

export async function tailnetSummary(): Promise<string> {
  const line = await output($`sudo ${tailscale} status --self --peers=false`);
  return line.split("\n")[0] || "not connected";
}

export async function installBuildkiteAgent(): Promise<void> {
  const { version, bin } = config.buildkiteAgent;
  if ((await output($`${bin} --version`)).includes(version)) return;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://github.com/buildkite/agent/releases/download/v${version}/buildkite-agent-darwin-${arch}-${version}.tar.gz`;
  const tmp = mkdtempSync(join(tmpdir(), "buildkite-agent-"));
  await $`curl -fsSL ${url} | tar -xz -C ${tmp}`;
  await $`sudo mkdir -p /usr/local/bin && sudo install -m 755 ${join(tmp, "buildkite-agent")} ${bin}`;
  await $`rm -rf ${tmp}`;
}

export async function installSelf(): Promise<void> {
  const source = join(import.meta.dir, "..");
  await $`sudo mkdir -p ${config.installDir}`;
  await $`sudo rsync -a --delete --chmod=Fa+r,Da+rx ${source}/ ${config.installDir}/`;
}

export async function bootstrapToolchain(): Promise<void> {
  const checkout = join(process.env.HOME!, "bun-bootstrap");
  await $`rm -rf ${checkout}`;
  await $`git clone -q --depth=1 --branch ${config.bun.ref} ${config.bun.repo} ${checkout}`;
  await $`./scripts/bootstrap.sh`.cwd(checkout).nothrow();
  await verifyToolchain();
}

export async function verifyToolchain(): Promise<void> {
  const missing: string[] = [];
  for (const tool of toolchain) {
    if (!(await succeeds($`bash -lc ${`command -v ${tool}`}`))) missing.push(tool);
  }
  if (missing.length) fail(`toolchain incomplete after bootstrap: ${missing.join(", ")}`);
}
