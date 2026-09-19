#!/usr/bin/env node

// The image commands CI runs from the hosted `build-image` queue on a
// `[build images]` / `[publish images]` build (see "CI image lifecycle" in
// .buildkite/ci.ts). They only work in CI: the cloud credentials are Buildkite
// cluster secrets.
//
//   create-image | publish-image --arch=<x64|aarch64>
//     Bake the Windows image on Azure with Packer (scripts/packer/).
//   wait-image --name=<ami name> --build=<build number> [--timeout-minutes=N]
//     Block until the Linux AMI a `…-bake-image` step produced is available.

import { spawn as nodeSpawn } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getBootstrapVersion, getBranch, getBuildNumber, getSecret, spawnSafe, which } from "./utils.ts";

type Arch = "x64" | "aarch64";
type ImageCommand = "create-image" | "publish-image";

const PACKER_VERSION = "1.15.0";

async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://management.azure.com/.default`,
  });
  if (!response.ok) throw new Error(`Azure auth failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Packer handles VM creation, bootstrap, sysprep and gallery capture over
 * WinRM.
 */
async function buildWindowsImage(command: ImageCommand, arch: Arch): Promise<void> {
  const templateName = arch === "aarch64" ? "windows-arm64" : "windows-x64";
  const templateDir = resolve(import.meta.dirname, "packer");

  const clientId = getSecret("AZURE_CLIENT_ID");
  const clientSecret = getSecret("AZURE_CLIENT_SECRET");
  const subscriptionId = getSecret("AZURE_SUBSCRIPTION_ID");
  const tenantId = getSecret("AZURE_TENANT_ID");
  const resourceGroup = getSecret("AZURE_RESOURCE_GROUP");
  const location = getSecret("AZURE_LOCATION", { required: false }) || "eastus2";
  const galleryName = getSecret("AZURE_GALLERY_NAME", { required: false }) || "bunCIGallery2";

  // Image naming must match getImageName() in ci.ts:
  //   [publish images] / normal CI: "windows-x64-2019-v13"
  //   [build images]:               "windows-x64-2019-build-37194"
  const imageKey = arch === "aarch64" ? "windows-aarch64-11" : "windows-x64-2019";
  const imageDefName =
    command === "publish-image"
      ? `${imageKey}-v${getBootstrapVersion("windows")}`
      : `${imageKey}-build-${getBuildNumber()}`;
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
        identifier: { publisher: "bun", offer: `windows-${arch}-ci`, sku: imageDefName },
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
  // succeeded.
  // CAUTION: this deletes the live version BEFORE Packer has produced a
  // replacement. If this job is canceled or dies mid-bake, CI is left with
  // no Windows image until a publish run completes.
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
        const body = (await poll.json().catch(() => ({}))) as { status?: string };
        if (body.status === "Succeeded") break;
        if (body.status === "Failed") throw new Error(`Delete of ${versionPath} failed: ${JSON.stringify(body)}`);
      }
    } else if (!del.ok && del.status !== 404) {
      throw new Error(`Failed to delete existing gallery image version: ${del.status} ${await del.text()}`);
    }
  }

  const packerBin = await ensurePacker();

  console.log("[packer] Initializing plugins...");
  await spawnSafe([packerBin, "init", templateDir], { stdio: "inherit" });

  const branch = getBranch() ?? "";
  console.log(`[packer] Building ${templateName} image: ${imageDefName}`);
  const packerArgs = [
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
    // contend with CI runners for the eastus2 Ddsv6/Dpdsv6 quota.
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
    `bootstrap_script=${resolve(import.meta.dirname, "bootstrap.ps1")}`,
    // The image's agent service: agent.ts and the utils.ts it imports, from
    // this checkout.
    "-var",
    `agent_script=${resolve(import.meta.dirname, "agent.ts")}`,
    "-var",
    `utils_script=${resolve(import.meta.dirname, "utils.ts")}`,
    "-var",
    `repo_ref=${/^[\w./-]+$/.test(branch) ? branch : "main"}`,
    templateDir,
  ];

  // Packer's azure-arm builder cleans up its temp pkr* resources on SIGINT/SIGTERM, but only
  // if the signal actually reaches the packer process and it is given time to finish the Azure
  // deletes. spawnSafe() does not forward signals, so a Buildkite cancel would orphan the whole
  // VM/NIC/IP/disk/vnet/NSG/keyvault stack in the build RG. Spawn directly and forward.
  const child = nodeSpawn(packerBin, packerArgs, {
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
  const forward = (signal: NodeJS.Signals) => {
    cancelled = true;
    console.log(`[packer] received ${signal}, forwarding to packer for Azure cleanup...`);
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(done =>
    child.on("close", (c, s) => done([c, s])),
  );
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

/** Packer from PATH, else downloaded into the temp dir. */
async function ensurePacker(): Promise<string> {
  const packerPath = which("packer");
  if (packerPath) {
    console.log("[packer] Found:", packerPath);
    return packerPath;
  }

  const localPacker = join(tmpdir(), "packer");
  if (existsSync(localPacker)) {
    return localPacker;
  }

  const platform = process.platform === "win32" ? "windows" : process.platform;
  const packerArch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://releases.hashicorp.com/packer/${PACKER_VERSION}/packer_${PACKER_VERSION}_${platform}_${packerArch}.zip`;

  console.log(`[packer] Downloading Packer ${PACKER_VERSION}...`);
  const zipPath = join(tmpdir(), "packer.zip");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download Packer: ${response.status}`);
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));

  await spawnSafe(["unzip", "-o", zipPath, "-d", tmpdir()], { stdio: "inherit" });
  chmodSync(localPacker, 0o755);

  console.log(`[packer] Installed Packer ${PACKER_VERSION}`);
  return localPacker;
}

type AwsImage = {
  ImageId: string;
  State: string;
  CreationDate: string;
  StateReason?: { Message?: string };
};

async function describeImages(filters: string[]): Promise<AwsImage[]> {
  const aws = which("aws", { required: true });
  const { stdout } = await spawnSafe(
    [aws, "ec2", "describe-images", "--owners", "self", "--filters", ...filters, "--output", "json"],
    {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID"),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY"),
        AWS_REGION: getSecret("EC2_REGION", { required: false }) || "us-east-1",
      },
    },
  );
  const { Images } = JSON.parse(stdout) as { Images: AwsImage[] };
  return Images;
}

/**
 * Block until the Linux AMI produced by a `…-bake-image` step (see
 * getLinuxBuildImageSteps in .buildkite/ci.ts) is available. The AMI carries
 * the number of the build that baked it.
 * @returns the AMI id
 */
async function waitImage(name: string, build: string, timeoutMinutes: number): Promise<string> {
  // Match on the build number too: an older image that merely shares the
  // name (the previous `-vN` being re-published) is not the one to wait for.
  const filters = [`Name=name,Values=${name}`, `Name=tag:buildkite:build-number,Values=${build}`];
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastState: string | undefined;
  let seen: string | undefined;
  console.log(`Waiting for image ${name} (build ${build})...`);
  while (Date.now() < deadline) {
    const images = await describeImages(filters);
    const [image] = images.sort((a, b) => (a.CreationDate < b.CreationDate ? 1 : -1));
    const state = image?.State ?? (seen ? "gone" : "not created yet");
    if (state !== lastState) {
      console.log(`${new Date().toISOString()} ${name}: ${state}${image ? ` (${image.ImageId})` : ""}`);
      lastState = state;
    }
    if (image && state === "available") {
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

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "arch": { type: "string" },
      "name": { type: "string" },
      "build": { type: "string" },
      "timeout-minutes": { type: "string", default: "110" },
    },
  });
  const [command] = positionals;

  if (command === "wait-image") {
    const { name, build } = values;
    if (!name || !build) {
      throw new Error("wait-image needs --name=<ami name> --build=<build number>");
    }
    const imageId = await waitImage(name, build, parseInt(values["timeout-minutes"]));
    console.log(`Image available: ${name} -> ${imageId}`);
    return;
  }

  if (command === "create-image" || command === "publish-image") {
    const { arch } = values;
    if (arch !== "x64" && arch !== "aarch64") {
      throw new Error(`${command} needs --arch=<x64|aarch64>`);
    }
    await buildWindowsImage(command, arch);
    return;
  }

  const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
  throw new Error(
    `Usage: ./${scriptPath} <create-image|publish-image> --arch=<x64|aarch64>\n` +
      `       ./${scriptPath} wait-image --name=<ami name> --build=<build number> [--timeout-minutes=N]`,
  );
}

await main();
