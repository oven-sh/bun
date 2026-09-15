#!/usr/bin/env bun
import { $ } from "bun";
import { parseArgs } from "node:util";
import { checkTartAgentOptions, installBareAgent, installTartAgent } from "./lib/agent";
import { bake } from "./lib/bake";
import { ciUserExists, enableAutoLogin, ensureCiUser } from "./lib/ci-user";
import { config, guestBase, guestImage, releaseTier } from "./lib/config";
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

type GuestImages = [release: number, base: string][];

const configuredReleases = config.tart.guests.map(({ release }) => release);

const usage = `usage:
  main.ts provision <hostname> <tart|bare> [--tags <tailscale tags>] [tart: --release N --spawn N --base <image> --ref <bun ref>]
                                                   converge a freshly imaged (or previously provisioned) host
  main.ts setup-user                               create the auto-login ${config.ciUser} user
  main.ts bake [--release N [--base <image>]] [--ref <bun ref>]
                                                   build the guest images (run as ${config.ciUser})
  main.ts install-agent [--release N] [--spawn N]  install the hooks, then one agent launchd job per image

A tart host bakes one image per configured guest release (${configuredReleases.join(", ")}) and runs
one agent, i.e. one concurrent guest, per image, so it serves every darwin lane.
--spawn N runs N agents per image (default ${config.tart.spawn}); images x N may not exceed the
${config.tart.maxGuests} guests macOS allows per host. --release N limits the host to one release
(add --spawn ${config.tart.maxGuests} to keep it full); --base overrides that release's base image.

provision, setup-user and install-agent need passwordless sudo.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    ref: { type: "string", default: config.bun.ref },
    release: { type: "string" },
    spawn: { type: "string", default: String(config.tart.spawn) },
    tags: { type: "string" },
  },
});

const [subcommand, ...args] = positionals;
const releases = values.release === undefined ? configuredReleases : [positiveInteger("release")];
if (values.base !== undefined && values.release === undefined) fail(`--base needs --release\n\n${usage}`);
const agentOptions = { releases, spawn: positiveInteger("spawn") };

switch (subcommand) {
  case "provision":
    await provision(args[0] ?? fail(usage), parseMode(args[1]));
    break;
  case "setup-user":
    await setupUser();
    break;
  case "bake":
    for (const [release, base] of guestImages()) {
      step(`bake ${guestImage(release)} (${releaseTier(release)}) from ${base}`);
      await bake({ release, base, ref: values.ref! });
    }
    break;
  case "install-agent":
    await installTartAgent(agentOptions);
    break;
  default:
    fail(usage);
}

function positiveInteger(name: "release" | "spawn"): number {
  const value = values[name]!;
  if (!/^[1-9]\d*$/.test(value)) fail(`--${name} must be a positive integer, got ${JSON.stringify(value)}`);
  return Number(value);
}

/** [release, base image] for every image this host will bake; fails before anything is touched if one has no base. */
function guestImages(): GuestImages {
  return releases.map(release => [
    release,
    values.base ?? guestBase(release) ?? fail(`no base image is configured for macOS ${release}; pass --base`),
  ]);
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
  let images: GuestImages = [];
  if (mode === "tart") {
    if (process.arch !== "arm64") fail("tart mode needs Apple Silicon; use bare on Intel");
    checkTartAgentOptions(agentOptions);
    images = guestImages();
  }

  step("remote management off, sshd key-only");
  await disableRemoteManagement();
  await hardenSshd();

  step(`hostname ${name}`);
  await setHostname(name);

  step("tailscale");
  await joinTailnet(name, values.tags);

  step(`buildkite-agent ${config.buildkiteAgent.version}`);
  await installBuildkiteAgent();

  if (mode === "tart") await provisionTart(images);
  else await provisionBare();

  step("done");
  console.log(`tailscale: ${await tailnetSummary()}`);
}

/**
 * Safe to re-run on a host that is already serving: the images are baked by a
 * staged copy of these scripts while the existing agents keep using installDir's
 * hooks (each bake swaps its own image in once it verifies), and install-agent
 * replaces hooks and agents together at the end. A failed bake leaves the
 * agents and hooks as they were.
 */
async function provisionTart(images: GuestImages): Promise<void> {
  const user = config.ciUser;
  const staging = `${config.installDir}.next`;

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

  step(`stage scripts in ${staging}`);
  await installSelf(staging);
  for (const [release, base] of images) {
    step(`bake ${guestImage(release)} (${releaseTier(release)}) from ${base} as ${user}`);
    await $`sudo -u ${user} -H /usr/local/bin/bun ${staging}/main.ts bake --release ${release} --base ${base} --ref ${values.ref!}`;
  }

  step(`scripts to ${config.installDir}, agents for macOS ${releases.join(", ")}`);
  await installTartAgent(agentOptions);
  await $`sudo rm -rf ${staging}`;
}

async function provisionBare(): Promise<void> {
  step(`install scripts to ${config.installDir}`);
  await installSelf();

  step("toolchain (scripts/bootstrap.sh)");
  await bootstrapToolchain();

  step("agent (scripts/agent.mjs)");
  await installBareAgent();
}
