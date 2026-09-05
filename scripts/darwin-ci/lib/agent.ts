import { $ } from "bun";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ciUserHome, ciUserId } from "./ci-user";
import { config, guestImage, releaseTier } from "./config";
import { installSelf } from "./host";
import { plist } from "./launchd";
import { consoleUser, fail, output, poll, sleep, succeeds, sudoRead, sudoWrite } from "./shell";

const path = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const launchAgents = "/Library/LaunchAgents";
// One launchd job per guest release, `<prefix>.<release>`. Hosts set up when there
// was one image per host have a single job named just `<prefix>`; the prefix match
// in retireAgents() covers it too.
const agentLabelPrefix = "com.buildkite.buildkite-agent";
const cleanupLabel = "com.buildkite.cleanup";
// what scripts/agent.mjs installs on a bare host (label `buildkite-agent`)
const bareAgentPlist = "/Library/LaunchDaemons/buildkite-agent.plist";

export type TartAgentOptions = { releases: readonly number[]; spawn: number };
type AgentConfig = { release: number; spawn: number; token: string; home: string };

/** Guests a host runs at once with these agents installed: every agent boots one. */
export function concurrentGuests({ releases, spawn }: TartAgentOptions): number {
  return releases.length * spawn;
}

export function checkTartAgentOptions(options: TartAgentOptions): void {
  const { releases, spawn } = options;
  if (!releases.length) fail("no guest releases to serve");
  const guests = concurrentGuests(options);
  if (guests > config.tart.maxGuests) {
    fail(
      `${releases.length} image(s) x --spawn ${spawn} = ${guests} guests, but macOS runs at most ${config.tart.maxGuests} at once per host`,
    );
  }
}

/** buildkite-agent.cfg for the agents that boot the macOS `release` guest image. */
export function tartAgentConfig({ release, spawn, token, home }: AgentConfig): string {
  return [
    `token="${token}"`,
    `name="%hostname-tart-${release}-%spawn"`,
    `tags="queue=${config.queue},os=darwin,arch=aarch64,distro=macOS,release=${release},release-tier=${releaseTier(release)},tart=true"`,
    `hooks-path="${join(config.installDir, "hooks")}"`,
    `build-path="${join(home, "tart-builds")}"`,
    `spawn=${spawn}`,
    `cancel-grace-period=30`,
    "",
  ].join("\n");
}

async function agentToken(): Promise<string> {
  return (
    process.env.BUILDKITE_AGENT_TOKEN ||
    (await sudoRead(config.tokenFile)) ||
    fail(`no agent token: put it in ${config.tokenFile}`)
  );
}

export async function installTartAgent(options: TartAgentOptions): Promise<void> {
  const { releases, spawn } = options;
  const user = config.ciUser;
  checkTartAgentOptions(options);
  if ((await consoleUser()) !== user)
    fail(`${user} is not logged in at the console; run setup-user, reboot, then retry`);
  for (const release of releases) {
    const image = guestImage(release);
    const baked = await succeeds($`sudo -u ${user} -H ${config.tart.bin} get ${image}`);
    if (!baked) fail(`no ${image} image for ${user}; run bake --release ${release} as ${user} first`);
  }

  const home = await ciUserHome();
  const uid = await ciUserId();
  const token = await agentToken();
  const configDir = join(home, ".buildkite-agent");
  const builds = join(home, "tart-builds");
  const logs = join(home, "Library", "Logs", "buildkite-agent");
  const owner = `${user}:staff`;

  await $`sudo install -d -o ${user} -g staff ${builds} ${logs} ${configDir}`;

  await retireAgents();
  await $`sudo find ${configDir} -name ${"buildkite-agent*.cfg"} -delete`;
  // the configs below point at installDir's hooks, which look images up the same way these agents are tagged
  await installSelf();

  const nightly = [
    `PATH=${path}`,
    `for plist in ${launchAgents}/${agentLabelPrefix}*.plist; do launchctl bootout gui/${uid}/$(basename $plist .plist); done`,
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
  await $`sudo launchctl bootstrap system /Library/LaunchDaemons/${cleanupLabel}.plist`;

  for (const release of releases) {
    const label = `${agentLabelPrefix}.${release}`;
    const configPath = join(configDir, `buildkite-agent-${release}.cfg`);
    const log = join(logs, `buildkite-agent-${release}.log`);

    await sudoWrite(configPath, tartAgentConfig({ release, spawn, token, home }), "600", owner);

    // a LaunchAgent in the auto-login user's GUI session, because Virtualization.framework will not start guests outside one
    await sudoWrite(
      join(launchAgents, `${label}.plist`),
      plist({
        Label: label,
        UserName: user,
        LimitLoadToSessionType: "Aqua",
        ProcessType: "Interactive",
        EnvironmentVariables: { PATH: path },
        ProgramArguments: [config.buildkiteAgent.bin, "start", "--config", configPath],
        WorkingDirectory: home,
        RunAtLoad: true,
        KeepAlive: true,
        ThrottleInterval: 10,
        StandardOutPath: log,
        StandardErrorPath: log,
      }),
    );
    await $`sudo launchctl bootstrap gui/${uid} ${join(launchAgents, `${label}.plist`)}`;
  }

  await sleep(4000);
  for (const release of releases) {
    console.log(`--- macOS ${release} (${releaseTier(release)})`);
    console.log(await output($`sudo tail -4 ${join(logs, `buildkite-agent-${release}.log`)}`));
  }
}

/**
 * Stop and remove every agent job on this host, whichever layout installed it
 * (per-image or single-image tart jobs, or scripts/agent.mjs's bare daemon), and
 * the nightly reboot that would otherwise fire while they are being replaced.
 * installTartAgent() puts the tart jobs and the reboot back.
 */
async function retireAgents(): Promise<void> {
  await $`sudo launchctl bootout system/${cleanupLabel}`.quiet().nothrow();
  await $`sudo launchctl bootout system/buildkite-agent`.quiet().nothrow();
  await $`sudo rm -f ${bareAgentPlist}`;
  const labels = installedAgentLabels();
  if (!labels.length) return;
  const uid = await ciUserId();
  for (const label of labels) {
    await unload(`gui/${uid}/${label}`);
    await $`sudo rm -f ${join(launchAgents, `${label}.plist`)}`;
  }
}

function installedAgentLabels(): string[] {
  return readdirSync(launchAgents)
    .filter(name => name.startsWith(agentLabelPrefix) && name.endsWith(".plist"))
    .map(name => basename(name, ".plist"));
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
