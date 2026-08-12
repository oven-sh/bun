import { join } from "node:path";
import { ciUserHome, ciUserId } from "./ci-user";
import { config } from "./config";
import { bootstrapCheckout } from "./host";
import { plist } from "./launchd";
import { darwinReleaseTier } from "./release-tier.mjs";
import {
  consoleUser,
  fail,
  poll,
  probe,
  run,
  runInheritOrThrow,
  sleep,
  spawn,
  succeeds,
  sudoRead,
  sudoWrite,
} from "./shell";

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

export type TartAgentOptions = { release: number; spawn: number };

export async function installTartAgent({ release, spawn: workers }: TartAgentOptions): Promise<void> {
  const user = config.ciUser;
  if ((await consoleUser()) !== user)
    fail(`${user} is not logged in at the console; run setup-user, reboot, then retry`);
  const asCiUser = ["sudo", "-u", user, "-H"];
  const baked = await succeeds([...asCiUser, config.tart.bin, "get", config.tart.image]);
  if (!baked) fail(`no ${config.tart.image} image for ${user}; run bake as ${user} first`);

  const home = await ciUserHome();
  const uid = await ciUserId();
  const configPath = join(home, ".buildkite-agent", "buildkite-agent.cfg");
  const builds = join(home, "tart-builds");
  const logs = join(home, "Library", "Logs", "buildkite-agent");
  const hooks = join(config.installDir, "hooks");
  const owner = `${user}:staff`;

  await run(["sudo", "install", "-d", "-o", user, "-g", "staff", builds, logs, join(home, ".buildkite-agent")]);

  await sudoWrite(
    configPath,
    [
      `token="${await agentToken()}"`,
      `name="%hostname-tart-${release}-%spawn"`,
      `tags="queue=${config.queue},os=darwin,arch=aarch64,distro=macOS,release=${release},release-tier=${darwinReleaseTier(release)},tart=true"`,
      `hooks-path="${hooks}"`,
      `build-path="${builds}"`,
      `spawn=${workers}`,
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

  const tartAsCiUser = `${asCiUser.join(" ")} ${config.tart.bin}`;
  const nightly = [
    `PATH=${path}`,
    `launchctl bootout gui/${uid}/${agentLabel}`,
    "sleep 40",
    `for vm in $(${tartAsCiUser} list --source local --quiet | grep '^bk-'); do ${tartAsCiUser} delete $vm; done`,
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

  await spawn(["sudo", "launchctl", "bootout", "system/buildkite-agent"]);
  await spawn(["sudo", "launchctl", "bootout", `system/${cleanupLabel}`]);
  await unload(`gui/${uid}/${agentLabel}`);
  await run(["sudo", "launchctl", "bootstrap", `gui/${uid}`, `/Library/LaunchAgents/${agentLabel}.plist`]);
  await run(["sudo", "launchctl", "bootstrap", "system", `/Library/LaunchDaemons/${cleanupLabel}.plist`]);

  await sleep(4000);
  console.log(
    (await probe(["sudo", "tail", "-4", join(logs, "buildkite-agent.log")])) ?? "(agent log not written yet)",
  );
}

export async function installBareAgent(): Promise<void> {
  const token = await agentToken();
  await runInheritOrThrow(
    ["sudo", "env", `PATH=${path}`, `BUILDKITE_AGENT_TOKEN=${token}`, "node", "scripts/agent.mjs", "install"],
    {
      cwd: bootstrapCheckout,
    },
  );
  await sleep(4000);
  const log = join(process.env.HOME!, "Library", "Logs", "buildkite-agent", "buildkite-agent.log");
  console.log((await probe(["tail", "-4", log])) ?? "(agent log not written yet)");
}

// bootout returns before a busy agent has finished its cancel grace period, and bootstrap fails with EIO until it has
async function unload(target: string): Promise<void> {
  await spawn(["sudo", "launchctl", "bootout", target]);
  await poll(30, 2000, async () => ((await succeeds(["sudo", "launchctl", "print", target])) ? undefined : true));
}
