#!/usr/bin/env bun
import { $ } from "bun";
import { parseArgs } from "node:util";
import { installBareAgent, installTartAgent } from "./lib/agent";
import { bake } from "./lib/bake";
import { ciUserExists, enableAutoLogin, ensureCiUser } from "./lib/ci-user";
import { config } from "./lib/config";
import {
  bootstrapToolchain,
  brewInstall,
  disableRemoteManagement,
  hardenSshd,
  installBuildkiteAgent,
  installSelf,
  joinTailnet,
  setHostname,
  tailnetSummary,
} from "./lib/host";
import { consoleUser, fail, step } from "./lib/shell";

const usage = `usage:
  main.ts provision <hostname> <tart|bare> [--tags <tailscale tags>]   converge a freshly imaged host
  main.ts setup-user                                                    create the auto-login ${config.ciUser} user
  main.ts bake [--base <image>] [--ref <bun ref>]                       build ${config.tart.image} (run as ${config.ciUser})
  main.ts install-agent [--release N] [--spawn N]                       write agent config and launchd jobs
  main.ts install-self                                                  refresh ${config.installDir} from this checkout

provision, setup-user, install-agent and install-self need passwordless sudo.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: config.tart.baseRemote },
    ref: { type: "string", default: config.bun.ref },
    release: { type: "string", default: String(config.tart.guestRelease) },
    spawn: { type: "string", default: String(config.tart.spawn) },
    tags: { type: "string" },
  },
});

const [subcommand, ...args] = positionals;
const agentOptions = { release: Number(values.release), spawn: Number(values.spawn) };

switch (subcommand) {
  case "provision":
    await provision(args[0] ?? fail(usage), parseMode(args[1]));
    break;
  case "setup-user":
    await setupUser();
    break;
  case "bake":
    await bake({ base: values.base!, ref: values.ref! });
    break;
  case "install-agent":
    await installTartAgent(agentOptions);
    break;
  case "install-self":
    await installSelf();
    break;
  default:
    fail(usage);
}

function parseMode(mode: string | undefined): "tart" | "bare" {
  if (mode === "tart" || mode === "bare") return mode;
  return fail(usage);
}

async function setupUser(): Promise<void> {
  await ensureCiUser();
  await enableAutoLogin();
}

async function provision(name: string, mode: "tart" | "bare"): Promise<void> {
  step("remote management off, sshd key-only");
  await disableRemoteManagement();
  await hardenSshd();

  step(`hostname ${name}`);
  await setHostname(name);

  step("tailscale");
  await joinTailnet(name, values.tags);

  step(`buildkite-agent ${config.buildkiteAgent.version}`);
  await installBuildkiteAgent();

  step(`install scripts to ${config.installDir}`);
  await installSelf();

  if (mode === "tart") await provisionTart();
  else await provisionBare();

  step("done");
  console.log(`tailscale: ${await tailnetSummary()}`);
}

async function provisionTart(): Promise<void> {
  if (process.arch !== "arm64") fail("tart mode needs Apple Silicon; use bare on Intel");
  const user = config.ciUser;
  const main = `${config.installDir}/main.ts`;

  step("tart");
  await brewInstall("cirruslabs/cli/tart");

  step(`${user} user with auto-login`);
  const existed = await ciUserExists();
  await setupUser();
  if ((await consoleUser()) !== user) {
    console.log(
      `${existed ? "" : `created ${user}; `}reboot so ${user} owns the console session, then re-run this command:`,
    );
    console.log("  sudo shutdown -r now");
    return;
  }

  step(`bake ${config.tart.image} as ${user}`);
  await $`sudo -u ${user} -H /usr/local/bin/bun ${main} bake --base ${values.base!} --ref ${values.ref!}`;

  step("agent");
  await installTartAgent(agentOptions);
}

async function provisionBare(): Promise<void> {
  step("toolchain (scripts/bootstrap.sh)");
  await bootstrapToolchain();

  step("agent (scripts/agent.mjs)");
  await installBareAgent();
}
