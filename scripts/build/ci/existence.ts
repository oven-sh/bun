// "Does this content-addressed image already exist?" — one implementation for
// pipeline generation.
//
// .buildkite/ci.mjs runs this for all 8 images at the very start of every
// build (on queue=build-image, which holds the cloud credentials) and emits a
// bake step ONLY for the images whose name is missing. So the pipeline
// itself shows which images a push builds; existing images cost nothing.
// machine.mjs still re-checks by name before launching (a race between two
// simultaneous builds of the same new hash) — that is the guard, this is the
// plan.
//
// AWS: describe-images by exact name. Azure: gallery version GET, treating
// only a Succeeded version as existing (Failed/Creating are re-baked by
// machine.mjs, which owns that state handling). Credentials come from the
// same buildkite secrets machine.mjs uses; there is no separate identity.

import { spawnSync } from "node:child_process";
import { imageName } from "./naming.ts";
import type { Image } from "./types.ts";

export type Existence = {
  image: Image;
  name: string;
  exists: boolean;
  /** Where it lives when it exists (AMI id / gallery version state). */
  detail: string;
};

type Secrets = { get(name: string): string };

/** Check all images, in parallel. */
export async function checkImages(images: readonly Image[], secrets: Secrets): Promise<Existence[]> {
  return Promise.all(images.map(image => checkImage(image, secrets)));
}

export async function checkImage(image: Image, secrets: Secrets): Promise<Existence> {
  const name = imageName(image);
  if (image.os === "linux") return checkAwsAmi(image, name, secrets);
  return checkAzureGalleryVersion(image, name, secrets);
}

async function checkAwsAmi(image: Image, name: string, secrets: Secrets): Promise<Existence> {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: secrets.get("EC2_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: secrets.get("EC2_SECRET_ACCESS_KEY"),
    AWS_REGION: secrets.get("EC2_REGION"),
  };
  // state=available only: an AMI that is still pending, or that failed,
  // is NOT usable and must not suppress its own re-bake (mirrors the Azure
  // path, which counts only a Succeeded version).
  const result = spawnSync(
    "aws",
    [
      "ec2",
      "describe-images",
      "--owners",
      "self",
      "--filters",
      `Name=name,Values=${name}`,
      "Name=state,Values=available",
      "--output",
      "json",
    ],
    { encoding: "utf8", env },
  );
  if (result.error) {
    // The command could not start (aws CLI missing / not executable).
    throw new Error(`could not run the aws CLI to check ${name}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`aws describe-images failed for ${name} (exit ${result.status}): ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout);
  const [found] = parsed.Images;
  if (found) return { image, name, exists: true, detail: `${found.ImageId} (available)` };
  return { image, name, exists: false, detail: "no available AMI with this name" };
}

async function checkAzureGalleryVersion(image: Image, name: string, secrets: Secrets): Promise<Existence> {
  if (image.os !== "windows") throw new Error(`checkAzureGalleryVersion: ${image.key} is not a windows image`);
  const tenant = secrets.get("AZURE_TENANT_ID");
  const clientId = secrets.get("AZURE_CLIENT_ID");
  const clientSecret = secrets.get("AZURE_CLIENT_SECRET");
  const subscription = secrets.get("AZURE_SUBSCRIPTION_ID");
  const token = await azureToken(tenant, clientId, clientSecret);
  const { gallery } = image;
  const path =
    `/subscriptions/${subscription}/resourceGroups/${gallery.resourceGroup}` +
    `/providers/Microsoft.Compute/galleries/${gallery.name}/images/${name}/versions/${gallery.imageVersion}`;
  // Generous ceiling: this is a single metadata GET that Azure answers in
  // under a second when healthy. The bound exists only to turn a genuinely
  // dead endpoint (a hung TLS handshake never rejects on its own) into a
  // visible failure — it fails loudly into the existence-check banner, it
  // never silently skips a bake. Slow-but-alive Azure has 2 minutes.
  const response = await fetch(`https://management.azure.com${path}?api-version=2024-03-03`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 404) {
    return { image, name, exists: false, detail: "no gallery version with this name" };
  }
  if (!response.ok) {
    throw new Error(`azure gallery probe failed for ${name}: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  const state = body?.properties?.provisioningState;
  // Only a finished bake counts as existing; anything else gets re-baked
  // (machine.mjs handles the Failed/Creating states).
  if (state === "Succeeded") return { image, name, exists: true, detail: `version ${gallery.imageVersion} Succeeded` };
  return { image, name, exists: false, detail: `version present but ${state}; will re-bake` };
}

async function azureToken(tenant: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=client_credentials&client_id=${clientId}` +
      `&client_secret=${encodeURIComponent(clientSecret)}&scope=https://management.azure.com/.default`,
  });
  if (!response.ok) throw new Error(`azure auth failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return data.access_token;
}
