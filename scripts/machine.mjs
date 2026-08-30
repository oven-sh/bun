#!/usr/bin/env node
// CI machine-image tooling, run from the hosted `build-image` queue by the
// steps .buildkite/ci.mjs emits for `[build images]` / `[publish images]`:
//
//   create-image | publish-image --os=windows --arch=<x64|aarch64> --release=<2019|11> [--ci]
//       Bake a Windows image on Azure with Packer (WinRM) into the compute gallery.
//
//   wait-image --name=<ami name> --build=<build number> [--timeout-minutes=110]
//       Block until the Linux AMI produced by a `…-bake-image` step (see
//       getLinuxBuildImageSteps in ci.mjs) is available. The AMI carries the
//       number of the build that baked it.

import { spawn as nodeSpawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  $,
  getBootstrapVersion,
  getBranch,
  getBuildNumber,
  getSecret,
  isCI,
  parseArch,
  parseOs,
  spawnSafe,
  which,
} from "./utils.mjs";

/**
 * `aws` CLI with the CI account's EC2 credentials (Buildkite secrets) when
 * running in CI, ambient credentials otherwise.
 * @param {string[]} args
 * @returns {Promise<any>}
 */
async function awsCli(args) {
  const aws = which("aws", { required: true });
  let env;
  if (isCI) {
    env = {
      AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID", { required: true }),
      AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY", { required: true }),
      AWS_REGION: getSecret("EC2_REGION", { required: false }) || "us-east-1",
    };
  }
  const { stdout } = await spawnSafe($`${aws} ${args} --output json`, { env });
  return JSON.parse(stdout);
}

/**
 * @param {{ name: string, build: string, timeoutMinutes: number }} options
 * @returns {Promise<string>} the AMI id
 */
async function waitImage({ name, build, timeoutMinutes }) {
  // Match on the build number too: an older image that merely shares the
  // name (the previous `-vN` being re-published) is not the one to wait for.
  const filters = [`Name=name,Values=${name}`, `Name=tag:buildkite:build-number,Values=${build}`];
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastState;
  let seen;
  console.log(`Waiting for image ${name} (build ${build})...`);
  while (Date.now() < deadline) {
    const { Images } = await awsCli($`ec2 describe-images --owners self --filters ${filters}`);
    const [image] = Images.sort((a, b) => (a.CreationDate < b.CreationDate ? 1 : -1));
    const state = image?.State ?? (seen ? "gone" : "not created yet");
    if (state !== lastState) {
      console.log(`${new Date().toISOString()} ${name}: ${state}${image ? ` (${image.ImageId})` : ""}`);
      lastState = state;
    }
    if (state === "available") {
      return image.ImageId;
    }
    // failed/invalid/error: imaging failed. gone/deregistered: it failed and
    // was already cleaned up (the build is annotated with why). Either way
    // this image is not going to appear.
    if (["failed", "invalid", "error", "deregistered", "gone"].includes(state)) {
      const reason = image?.StateReason?.Message ?? "discarded after a failed create, see the build annotation";
      throw new Error(`Image ${name} for build ${build} will not become available (${state}): ${reason}`);
    }
    seen ||= image?.ImageId;
    await new Promise(done => setTimeout(done, 30_000));
  }
  throw new Error(
    `Image ${name} for build ${build} was not available after ${timeoutMinutes} minutes (last state: ${lastState})`,
  );
}

async function getAzureToken(tenantId, clientId, clientSecret) {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://management.azure.com/.default`,
  });
  if (!response.ok) throw new Error(`Azure auth failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

/**
 * Build a Windows image using Packer (Azure only).
 * Packer handles VM creation, bootstrap, sysprep, and gallery capture via WinRM.
 * This eliminates all the Azure Run Command issues (output truncation, x64 emulation,
 * PATH not refreshing, stderr false positives, quote escaping).
 */
async function buildWindowsImageWithPacker({ os, arch, release, command, ci, agentPath, bootstrapPath }) {
  const { getSecret } = await import("./utils.mjs");

  // Determine Packer template
  const templateName = arch === "aarch64" ? "windows-arm64" : "windows-x64";
  const templateDir = resolve(import.meta.dirname, "packer");
  const templateFile = join(templateDir, `${templateName}.pkr.hcl`);

  if (!existsSync(templateFile)) {
    throw new Error(`Packer template not found: ${templateFile}`);
  }

  // Get Azure credentials from Buildkite secrets
  const clientId = await getSecret("AZURE_CLIENT_ID");
  const clientSecret = await getSecret("AZURE_CLIENT_SECRET");
  const subscriptionId = await getSecret("AZURE_SUBSCRIPTION_ID");
  const tenantId = await getSecret("AZURE_TENANT_ID");
  const resourceGroup = await getSecret("AZURE_RESOURCE_GROUP");
  const location = (await getSecret("AZURE_LOCATION")) || "eastus2";
  const galleryName = (await getSecret("AZURE_GALLERY_NAME")) || "bunCIGallery2";

  // Image naming must match getImageName() in ci.mjs:
  //   [publish images] / normal CI: "windows-x64-2019-v13"
  //   [build images]:               "windows-x64-2019-build-37194"
  const imageKey = arch === "aarch64" ? "windows-aarch64-11" : "windows-x64-2019";
  const imageDefName =
    command === "publish-image"
      ? `${imageKey}-v${getBootstrapVersion(os)}`
      : ci
        ? `${imageKey}-build-${getBuildNumber()}`
        : `${imageKey}-build-draft-${Date.now()}`;
  const galleryArch = arch === "aarch64" ? "Arm64" : "x64";
  console.log(`[packer] Ensuring gallery image definition: ${imageDefName}`);
  const galleryPath = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefName}`;
  const token = await getAzureToken(tenantId, clientId, clientSecret);
  const defResponse = await fetch(`https://management.azure.com${galleryPath}?api-version=2024-03-03`, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      location: location,
      properties: {
        osType: "Windows",
        osState: "Generalized",
        hyperVGeneration: "V2",
        architecture: galleryArch,
        identifier: { publisher: "bun", offer: `${os}-${arch}-ci`, sku: imageDefName },
        features: [
          { name: "DiskControllerTypes", value: "SCSI, NVMe" },
          { name: "SecurityType", value: "TrustedLaunch" },
        ],
      },
    }),
  });
  if (!defResponse.ok && defResponse.status !== 409) {
    throw new Error(`Failed to create gallery image definition: ${defResponse.status} ${await defResponse.text()}`);
  }

  // Packer's azure-arm shared_image_gallery_destination always writes
  // image_version 1.0.0 and 409s if it already exists, so a re-run of
  // [publish images] would fail on every Windows variant that already
  // succeeded. Match the AWS path's deregister-then-recreate.
  // CAUTION: unlike the AWS path (which only deregisters after the new
  // create-image collides), this deletes the live version BEFORE Packer
  // has produced a replacement. If this job is canceled or dies mid-bake,
  // CI is left with no Windows image until a publish run completes.
  const versionPath = `${galleryPath}/versions/1.0.0`;
  const existing = await fetch(`https://management.azure.com${versionPath}?api-version=2024-03-03`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (existing.ok) {
    console.log(`[packer] Deleting existing gallery image version 1.0.0 of ${imageDefName} before re-publish`);
    const del = await fetch(`https://management.azure.com${versionPath}?api-version=2024-03-03`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.status === 202) {
      const op = del.headers.get("Azure-AsyncOperation") ?? del.headers.get("Location");
      for (let i = 0; op && i < 120; i++) {
        await new Promise(r => setTimeout(r, 10_000));
        const poll = await fetch(op, { headers: { Authorization: `Bearer ${token}` } });
        const body = await poll.json().catch(() => ({}));
        if (body.status === "Succeeded") break;
        if (body.status === "Failed") throw new Error(`Delete of ${versionPath} failed: ${JSON.stringify(body)}`);
      }
    } else if (!del.ok && del.status !== 404) {
      throw new Error(`Failed to delete existing gallery image version: ${del.status} ${await del.text()}`);
    }
  }

  // Install Packer if not available
  const packerBin = await ensurePacker();

  // Initialize plugins
  console.log("[packer] Initializing plugins...");
  await spawnSafe([packerBin, "init", templateDir], { stdio: "inherit" });

  // Build the image
  console.log(`[packer] Building ${templateName} image: ${imageDefName}`);
  const packerArgs = [
    packerBin,
    "build",
    "-only",
    `azure-arm.${templateName}`,
    "-var",
    `client_id=${clientId}`,
    "-var",
    `client_secret=${clientSecret}`,
    "-var",
    `subscription_id=${subscriptionId}`,
    "-var",
    `tenant_id=${tenantId}`,
    "-var",
    // Dedicated build RG in southcentralus so Packer's 4-core bake VMs don't
    // contend with robobun CI runners for the eastus2 Ddsv6/Dpdsv6 quota.
    `resource_group=${resourceGroup}-PACKER`,
    "-var",
    `gallery_resource_group=${resourceGroup}`,
    "-var",
    `location=${location}`,
    "-var",
    `gallery_name=${galleryName}`,
    "-var",
    `image_name=${imageDefName}`,
    "-var",
    `bootstrap_script=${bootstrapPath}`,
    "-var",
    `agent_script=${agentPath}`,
    "-var",
    `repo_ref=${/^[\w./-]+$/.test(getBranch() ?? "") ? getBranch() : "main"}`,
    templateDir,
  ];

  // Packer's azure-arm builder cleans up its temp pkr* resources on SIGINT/SIGTERM, but only
  // if the signal actually reaches the packer process and it is given time to finish the Azure
  // deletes. spawnSafe() does not forward signals, so a Buildkite cancel would orphan the whole
  // VM/NIC/IP/disk/vnet/NSG/keyvault stack in the build RG. Spawn directly and forward.
  const child = nodeSpawn(packerArgs[0], packerArgs.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ARM_CLIENT_ID: clientId,
      ARM_CLIENT_SECRET: clientSecret,
      ARM_SUBSCRIPTION_ID: subscriptionId,
      ARM_TENANT_ID: tenantId,
    },
  });
  let cancelled = false;
  const forward = signal => {
    cancelled = true;
    console.log(`[packer] received ${signal}, forwarding to packer for Azure cleanup...`);
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const [code, signal] = await new Promise(done => child.on("close", (c, s) => done([c, s])));
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  if (cancelled) {
    console.log("[packer] cleanup after cancel finished");
    process.exit(1);
  }
  if (code !== 0) {
    throw new Error(`packer build exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
  }

  console.log(`[packer] Image built successfully: ${imageDefName}`);
}

/**
 * Download and install Packer if not already available.
 */
async function ensurePacker() {
  // Check if packer is already in PATH
  const packerPath = which("packer");
  if (packerPath) {
    console.log("[packer] Found:", packerPath);
    return packerPath;
  }

  // Check if we have a local copy
  const localPacker = join(tmpdir(), "packer");
  if (existsSync(localPacker)) {
    return localPacker;
  }

  // Download Packer
  const version = "1.15.0";
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const packerArch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://releases.hashicorp.com/packer/${version}/packer_${version}_${platform}_${packerArch}.zip`;

  console.log(`[packer] Downloading Packer ${version}...`);
  const zipPath = join(tmpdir(), "packer.zip");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download Packer: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(zipPath, buffer);

  // Extract
  await spawnSafe(["unzip", "-o", zipPath, "-d", tmpdir()], { stdio: "inherit" });
  chmodSync(localPacker, 0o755);

  console.log(`[packer] Installed Packer ${version}`);
  return localPacker;
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true, strict: false });
  const [command] = positionals;
  const usage = () => {
    const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
    return new Error(
      `Usage: ./${scriptPath} create-image|publish-image --os=windows --arch=<arch> --release=<release> [--ci]\n` +
        `       ./${scriptPath} wait-image --name=<ami name> --build=<build number> [--timeout-minutes=N]`,
    );
  };

  if (command === "wait-image") {
    const { values: args } = parseArgs({
      allowPositionals: true,
      options: {
        "name": { type: "string" },
        "build": { type: "string" },
        "timeout-minutes": { type: "string", default: "110" },
      },
    });
    if (!args["name"] || !args["build"]) {
      throw usage();
    }
    const imageId = await waitImage({
      name: args["name"],
      build: args["build"],
      timeoutMinutes: parseInt(args["timeout-minutes"]),
    });
    console.log(`Image available: ${args["name"]} -> ${imageId}`);
    return;
  }

  if (command !== "create-image" && command !== "publish-image") {
    throw usage();
  }

  const { values: args } = parseArgs({
    allowPositionals: true,
    options: {
      "os": { type: "string" },
      "arch": { type: "string", default: "x64" },
      "release": { type: "string" },
      "ci": { type: "boolean" },
    },
  });
  if (args["os"] !== "windows" || !args["release"]) {
    throw usage();
  }
  const os = parseOs(args["os"]);
  const arch = parseArch(args["arch"]);
  const release = args["release"];
  const ci = !!args["ci"];

  const bootstrapPath = resolve(import.meta.dirname, "bootstrap.ps1");
  let agentPath;
  if (ci) {
    // The image carries a single-file agent.mjs (utils.mjs bundled in) that
    // bootstrap.ps1's service definition points at.
    const npx = which("bunx") || which("npx");
    if (!npx) {
      throw new Error("Executable not found: bunx or npx");
    }
    const entryPath = resolve(import.meta.dirname, "agent.mjs");
    agentPath = join(mkdtempSync(join(tmpdir(), "agent-")), "agent.mjs");
    await spawnSafe($`${npx} esbuild ${entryPath} --bundle --platform=node --format=esm --outfile=${agentPath}`);
  }

  await buildWindowsImageWithPacker({ os, arch, release, command, ci, agentPath, bootstrapPath });
}

await main();
