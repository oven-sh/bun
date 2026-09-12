import { $ } from "bun";
import { join } from "node:path";
import { ciUserHome, ciUserId } from "./ci-user";
import { config, releaseTier } from "./config";
import { plist } from "./launchd";
import { consoleUser, fail, output, poll, sleep, succeeds, sudoRead, sudoWrite } from "./shell";

const path = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const agentLabel = "com.buildkite.buildkite-agent";
const cleanupLabel = "com.buildkite.cleanup";

async function agentToken(): Promise<string> {
  return (
    process.env.BUILDKITE_AGENT_TOKEN ||
    (await sudoRead(config.tokenFile)) ||
    fail(`no agent token: put it in ${config.tokenFile}`)
  );
}

type TartAgentOptions = { release: number; spawn: number };

export async function installTartAgent({ release, spawn }: TartAgentOptions): Promise<void> {
  const user = config.ciUser;
  if ((await consoleUser()) !== user)
    fail(`${user} is not logged in at the console; run setup-user, reboot, then retry`);
  const baked = await succeeds($`sudo -u ${user} -H ${config.tart.bin} get ${config.tart.image}`);
  if (!baked) fail(`no ${config.tart.image} image for ${user}; run bake as ${user} first`);

  const home = await ciUserHome();
  const uid = await ciUserId();
  const configPath = join(home, ".buildkite-agent", "buildkite-agent.cfg");
  const builds = join(home, "tart-builds");
  const logs = join(home, "Library", "Logs", "buildkite-agent");
  const hooks = join(config.installDir, "hooks");
  const owner = `${user}:staff`;

  await $`sudo install -d -o ${user} -g staff ${builds} ${logs} ${join(home, ".buildkite-agent")}`;

  await sudoWrite(
    configPath,
    [
      `token="${await agentToken()}"`,
      `name="%hostname-tart-${release}-%spawn"`,
      `tags="queue=${config.queue},os=darwin,arch=aarch64,distro=macOS,release=${release},release-tier=${releaseTier(release)},tart=true"`,
      `hooks-path="${hooks}"`,
      `build-path="${builds}"`,
      `spawn=${spawn}`,
      `cancel-grace-period=30`,
      "",
    ].join("\n"),
    "600",
    owner,
  );

  // a LaunchAgent in the auto-login user's GUI session, because Virtualization.framework will not start guests outside one
  await sudoWrite(
    `/Library/LaunchAgents/${agentLabel}.plist`,
    plist({
      Label: agentLabel,
      UserName: user,
      LimitLoadToSessionType: "Aqua",
      ProcessType: "Interactive",
      EnvironmentVariables: { PATH: path },
      ProgramArguments: [config.buildkiteAgent.bin, "start", "--config", configPath],
      WorkingDirectory: home,
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 10,
      StandardOutPath: join(logs, "buildkite-agent.log"),
      StandardErrorPath: join(logs, "buildkite-agent.log"),
    }),
  );

  const nightly = [
    `PATH=${path}`,
    `launchctl bootout gui/${uid}/${agentLabel}`,
    "sleep 40",
    `for vm in $(sudo -u ${user} tart list --source local --quiet | grep '^bk-'); do sudo -u ${user} tart delete $vm; done`,
    `rm -rf ${builds}/* /tmp/bk-*.log`,
    "shutdown -r now",
  ].join("; ");

  await sudoWrite(
    `/Library/LaunchDaemons/${cleanupLabel}.plist`,
    plist({
      Label: cleanupLabel,
      ProgramArguments: ["/bin/sh", "-c", nightly],
      StartCalendarInterval: { Hour: 5, Minute: 0 },
    }),
  );

  await $`sudo launchctl bootout system/buildkite-agent`.quiet().nothrow();
  await $`sudo launchctl bootout system/${cleanupLabel}`.quiet().nothrow();
  await unload(`gui/${uid}/${agentLabel}`);
  await $`sudo launchctl bootstrap gui/${uid} /Library/LaunchAgents/${agentLabel}.plist`;
  await $`sudo launchctl bootstrap system /Library/LaunchDaemons/${cleanupLabel}.plist`;

  await sleep(4000);
  console.log(await output($`sudo tail -4 ${join(logs, "buildkite-agent.log")}`));
}

export async function installBareAgent(): Promise<void> {
  const checkout = join(process.env.HOME!, "bun-bootstrap");
  const token = await agentToken();
  await $`sudo env BUILDKITE_AGENT_TOKEN=${token} PATH=${path} node scripts/agent.mjs install`.cwd(checkout);
  await sleep(4000);
  console.log(
    await output($`tail -4 ${join(process.env.HOME!, "Library", "Logs", "buildkite-agent", "buildkite-agent.log")}`),
  );
}

// bootout returns before a busy agent has finished its cancel grace period, and bootstrap fails with EIO until it has
async function unload(target: string): Promise<void> {
  await $`sudo launchctl bootout ${target}`.quiet().nothrow();
  await poll(30, 2000, async () => ((await succeeds($`sudo launchctl print ${target}`)) ? undefined : true));
}

// a host runs at most two guests, so the agent and its job guests have to be gone before a bake can boot one
export async function drainTartAgent(): Promise<void> {
  const user = config.ciUser;
  await unload(`gui/${await ciUserId()}/${agentLabel}`);
  const guests = (await output($`sudo -u ${user} -H ${config.tart.bin} list --source local --quiet`))
    .split("\n")
    .filter(name => name.startsWith("bk-"));
  for (const guest of guests) {
    await $`sudo -u ${user} -H ${config.tart.bin} stop ${guest} --timeout 5`.quiet().nothrow();
    await $`sudo -u ${user} -H ${config.tart.bin} delete ${guest}`.quiet().nothrow();
  }
}

// after a failed bake the previous image and config are still in place, so the old agent can simply come back
export async function resumeTartAgent(): Promise<void> {
  const plist = `/Library/LaunchAgents/${agentLabel}.plist`;
  if (!(await Bun.file(plist).exists())) return;
  await $`sudo launchctl bootstrap gui/${await ciUserId()} ${plist}`.quiet().nothrow();
}
