#!/usr/bin/env node

// The cloud side of CI's machine images (scripts/build/ci-images): whether an
// image exists, waiting for one, and baking a Windows one. These only work in
// CI: the cloud credentials are Buildkite cluster secrets.
//
//   bake-image --key=<image key> --name=<image name>
//     Bake a Windows image on Azure with Packer, from the bake directory
//     build/ci-images/<key>/ that the pipeline step generated and uploaded,
//     and publish the record the bake wrote. This has to be the
//     step's only command: see bakeWindowsImage.
//   wait-image --os=<linux|windows> --name=<image name> [--timeout-minutes=N]
//     Block until the image of that name can be booted.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getArch, request, requireCommand, run } from "./agent.ts";
import {
  type WindowsImage,
  bakeDirectory,
  imageRecordName,
  packerVariables,
  pins,
  windowsBake,
} from "./build/ci-images/spec.ts";
import { getEnv, getSecret } from "./buildkite.ts";

/**
 * `failed` is an image that holds its name and will never boot. A failed
 * Linux image is replaced when the next bake of the name finishes; a failed
 * Windows version is deleted by the next bake.
 */
export type ImageState = "available" | "pending" | "failed" | "missing";

interface AwsImage {
  ImageId: string;
  State: string;
}

function getLinuxImageState(name: string): ImageState {
  const { error, status, stdout, stderr } = spawnSync(
    requireCommand("aws"),
    ["ec2", "describe-images", "--owners", "self", "--filters", `Name=name,Values=${name}`, "--output", "json"],
    {
      encoding: "utf8",
      // The aws CLI gets these and nothing else of this job's environment.
      env: {
        AWS_ACCESS_KEY_ID: getSecret("EC2_ACCESS_KEY_ID"),
        AWS_SECRET_ACCESS_KEY: getSecret("EC2_SECRET_ACCESS_KEY"),
        AWS_REGION: getSecret("EC2_REGION"),
      },
    },
  );
  if (error || status !== 0) {
    // stderr is undefined when aws could not be started; `error` says why.
    throw new Error(`aws ec2 describe-images failed: ${stderr?.trim() ?? error?.message}`, { cause: error });
  }
  const { Images } = JSON.parse(stdout) as { Images: AwsImage[] };
  const states = new Set(Images.map(({ State }) => State));
  if (states.has("available")) return "available";
  if (states.has("pending")) return "pending";
  return states.size ? "failed" : "missing";
}

const azureAttempts = 5;

/**
 * `request()` names the URL in its error, and Azure's name the tenant or the
 * subscription. This has the status and what came with it: the body of the
 * response, or why there was none.
 */
function azureError(what: string, { error, status }: Awaited<ReturnType<typeof request>>): Error {
  return new Error(`${what}: ${status ?? "no response"}`, { cause: error?.cause });
}

type Azure = {
  token: string;
  subscriptionId: string;
  resourceGroup: string;
  galleryName: string;
  location: string;
};

async function getAzure(): Promise<Azure> {
  const tenantId = getSecret("AZURE_TENANT_ID");
  const response = await request(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: getSecret("AZURE_CLIENT_ID"),
      client_secret: getSecret("AZURE_CLIENT_SECRET"),
      scope: "https://management.azure.com/.default",
    }).toString(),
    json: true,
    attempts: azureAttempts,
  });
  if (response.error) {
    // Without the body of a response, which can name the client.
    throw response.status
      ? new Error(`Azure auth failed: ${response.status}`)
      : azureError("Azure auth failed", response);
  }
  const { access_token: token } = response.body as { access_token: string };
  return {
    token,
    subscriptionId: getSecret("AZURE_SUBSCRIPTION_ID"),
    resourceGroup: getSecret("AZURE_RESOURCE_GROUP"),
    galleryName: getSecret("AZURE_GALLERY_NAME"),
    location: getSecret("AZURE_LOCATION"),
  };
}

/** A request to the gallery image definition `name`, or to a path under it. */
function galleryRequest(azure: Azure, name: string, path: string, init?: { method: string; body?: string }) {
  const { subscriptionId, resourceGroup, galleryName, token } = azure;
  const definition = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}/images/${name}`;
  return request(`https://management.azure.com${definition}${path}?api-version=2024-03-03`, {
    ...init,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    attempts: azureAttempts,
  });
}

/** Packer publishes a Windows image as one fixed version of the gallery image definition named after it. */
const galleryVersion = `/versions/${windowsBake.galleryVersion}`;

async function getWindowsImageState(azure: Azure, name: string): Promise<ImageState> {
  const response = await galleryRequest(azure, name, galleryVersion);
  if (response.status === 404) {
    return "missing";
  }
  if (response.error) {
    throw azureError(`Azure gallery lookup of ${name} failed`, response);
  }
  const { properties } = JSON.parse(response.body as string) as { properties: { provisioningState: string } };
  switch (properties.provisioningState) {
    case "Succeeded":
      return "available";
    case "Failed":
      return "failed";
    default:
      return "pending";
  }
}

export async function getImageState(os: "linux" | "windows", name: string): Promise<ImageState> {
  return os === "windows" ? getWindowsImageState(await getAzure(), name) : getLinuxImageState(name);
}

async function waitImage(os: "linux" | "windows", name: string, timeoutMinutes: number): Promise<void> {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastState: ImageState | undefined;
  console.log(`Waiting for image ${name}...`);
  while (Date.now() < deadline) {
    const state = await getImageState(os, name);
    if (state !== lastState) {
      console.log(`${new Date().toISOString()} ${name}: ${state}`);
    }
    if (state === "available") {
      return;
    }
    // A bake that was started and then failed or was discarded; the build is annotated with why.
    if (state === "failed" || (state === "missing" && lastState === "pending")) {
      throw new Error(`Image ${name} will not become available (${state})`);
    }
    lastState = state;
    await new Promise(done => setTimeout(done, 30_000));
  }
  throw new Error(`Image ${name} was not available after ${timeoutMinutes} minutes (last state: ${lastState})`);
}

/** The pinned Packer, downloaded and checked: whatever `packer` the machine has is not what the image was hashed with. */
async function downloadPacker(): Promise<string> {
  const { version, sha256 } = pins.packer;
  const arch = getArch();
  const url = `https://releases.hashicorp.com/packer/${version}/packer_${version}_linux_${arch === "x64" ? "amd64" : "arm64"}.zip`;
  console.log(`[packer] Downloading Packer ${version}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(zip).digest("hex");
  if (actual !== sha256[arch]) {
    throw new Error(`${url} has sha256 ${actual}, expected ${sha256[arch]}`);
  }
  const zipPath = join(tmpdir(), "packer.zip");
  writeFileSync(zipPath, zip);
  await run(["unzip", "-o", "-q", zipPath, "packer", "-d", tmpdir()]);
  const packer = join(tmpdir(), "packer");
  chmodSync(packer, 0o755);
  return packer;
}

/**
 * Packer creates the VM, uploads the bake directory, runs bootstrap.ps1, runs
 * Sysprep and publishes to the gallery.
 *
 * The step runs this and nothing else. When a step has several commands the
 * agent runs them in a shell, and a cancel ends that shell without this
 * process or Packer ever seeing the signal, so Packer deletes nothing and the
 * VM it made keeps its cores until someone removes it by hand. So the download
 * before the bake and the upload after it happen in here.
 */
async function bakeWindowsImage(key: string, name: string, timeoutMinutes: number): Promise<void> {
  await run(["buildkite-agent", "artifact", "download", `${bakeDirectory(key)}/*`, "."]);
  const directory = resolve(bakeDirectory(key));
  const image = JSON.parse(readFileSync(join(directory, "image.json"), "utf8")) as WindowsImage;
  const azure = await getAzure();

  const state = await getWindowsImageState(azure, name);
  if (state === "available") {
    console.log(`[packer] ${name} already exists`);
    return;
  }
  if (state === "pending") {
    // Another build found the name missing at the same time and is baking it.
    await waitImage("windows", name, timeoutMinutes);
    return;
  }

  console.log(`[packer] Ensuring gallery image definition: ${name}`);
  const definition = await galleryRequest(azure, name, "", {
    method: "PUT",
    body: JSON.stringify({
      location: azure.location,
      properties: {
        osType: "Windows",
        osState: "Generalized",
        hyperVGeneration: "V2",
        architecture: image.arch === "aarch64" ? "Arm64" : "x64",
        identifier: { publisher: "bun", offer: `windows-${image.arch}-ci`, sku: name },
        features: [
          { name: "DiskControllerTypes", value: "SCSI, NVMe" },
          { name: "SecurityType", value: "TrustedLaunch" },
        ],
      },
    }),
  });
  if (definition.error && definition.status !== 409) {
    throw azureError("Failed to create gallery image definition", definition);
  }

  if (state === "failed") {
    // Packer refuses to publish over a version that exists, and this one never became an image.
    console.log(`[packer] Deleting the failed version of ${name}`);
    const deleted = await galleryRequest(azure, name, galleryVersion, { method: "DELETE" });
    if (deleted.error) {
      throw azureError(`Failed to delete the failed version of ${name}`, deleted);
    }
    while ((await getWindowsImageState(azure, name)) !== "missing") {
      await new Promise(done => setTimeout(done, 10_000));
    }
  }

  const packer = await downloadPacker();
  const template = join(directory, "image.pkr.hcl");
  await run([packer, "init", template]);

  const values: Record<(typeof packerVariables)[number], string> = {
    client_id: getSecret("AZURE_CLIENT_ID"),
    client_secret: getSecret("AZURE_CLIENT_SECRET"),
    subscription_id: azure.subscriptionId,
    tenant_id: getSecret("AZURE_TENANT_ID"),
    // Its own resource group, in a region where the bake's VM does not
    // compete with CI's machines for quota.
    resource_group: `${azure.resourceGroup}-PACKER`,
    gallery_resource_group: azure.resourceGroup,
    gallery_name: azure.galleryName,
    location: azure.location,
    image_name: name,
    bake_directory: directory,
    repo_commit: getEnv("BUILDKITE_COMMIT"),
  };
  const args = ["build", ...packerVariables.flatMap(variable => ["-var", `${variable}=${values[variable]}`]), template];

  // Packer deletes the VM, disk and network it created when it is
  // interrupted, but only if the signal reaches it and it is given the time:
  // run() does not forward signals, so this spawns it directly.
  console.log(`[packer] Baking ${name}`);
  const child = spawn(packer, args, { stdio: "inherit" });
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
    process.exit(1);
  }
  if (code !== 0) {
    throw new Error(`packer build exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
  }
  console.log(`[packer] Baked ${name}`);
  // What the bake installed, to read from the build's page without starting a machine from the image.
  await run(["buildkite-agent", "artifact", "upload", `${bakeDirectory(key)}/${imageRecordName}`]);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "key": { type: "string" },
      "name": { type: "string" },
      "os": { type: "string" },
      "timeout-minutes": { type: "string" },
    },
  });
  const [command] = positionals;
  const { key, name, os } = values;
  const timeoutMinutes = parseInt(values["timeout-minutes"] ?? "");

  if (command === "wait-image" && name && (os === "linux" || os === "windows") && timeoutMinutes) {
    await waitImage(os, name, timeoutMinutes);
    return;
  }
  if (command === "bake-image" && key && name && timeoutMinutes) {
    await bakeWindowsImage(key, name, timeoutMinutes);
    return;
  }

  const scriptPath = relative(process.cwd(), fileURLToPath(import.meta.url));
  throw new Error(
    `Usage: ./${scriptPath} bake-image --key=<image key> --name=<image name> --timeout-minutes=N\n` +
      `       ./${scriptPath} wait-image --os=<linux|windows> --name=<image name> --timeout-minutes=N`,
  );
}

if (import.meta.main) {
  await main();
}
