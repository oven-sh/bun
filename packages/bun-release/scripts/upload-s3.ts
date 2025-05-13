import { AwsClient } from "aws4fetch";
import { join, tmp } from "../src/fs";
import { getBuild, getRelease, getSemver, getSha } from "../src/github";

// The source of truth for the git sha is what's in the local build, extracted from features.json
// NOT the git tag revision.
// Ideally, these are always the same, but mistakes can happen.
const local =
  "bun-" +
  (
    {
      darwin: "darwin",
      win32: "windows",
      linux: "linux",
    } as any
  )[process.platform] +
  "-" +
  (
    {
      arm64: "aarch64",
      x64: "x64",
    } as any
  )[process.arch] +
  ".zip";

const dryRun = process.argv.includes("--dry-run");

const [tag] = process.argv.slice(2);
let bucketUrl;
let aws: AwsClient;
try {
  bucketUrl = new URL(`${env("AWS_BUCKET")}/`, env("AWS_ENDPOINT"));
  aws = new AwsClient({
    accessKeyId: env("AWS_ACCESS_KEY_ID"),
    secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  });
} catch (error) {
  bucketUrl = new URL(`bun/`, "https://s3.amazonaws.com");
  console.error("Failed to create S3 client:", error);
  if (!dryRun) {
    process.exit(1);
  }
  console.log("Continuing with a dry run using a fake client.\n");
}

const latest = await getRelease();
const release = await getRelease(tag);
const full_commit_hash = await getSha(tag, "long");
console.log("Found release:", release.tag_name, "with commit hash:", full_commit_hash);

console.log("Found build:", full_commit_hash);
const isCanary = release.tag_name === "canary";

let paths: string[] = [];
async function setPaths(revision: string, isCanary: boolean) {
  const releaseSha = `releases/${revision + (isCanary ? "-canary" : "")}`;
  if (latest.tag_name === release.tag_name) {
    paths = ["releases/latest", `releases/${release.tag_name}`, releaseSha];
  } else if (isCanary) {
    try {
      const build = await getSemver("canary", await getBuild());
      paths = ["releases/canary", `releases/${build}`, releaseSha];
    } catch (error) {
      console.warn(error);
      paths = ["releases/canary", releaseSha];
    }
  } else {
    paths = [`releases/${release.tag_name}`, releaseSha];
  }

  console.log("Found paths:", paths);
}

async function getFeaturesJSON(body: ArrayBuffer) {
  // extract feature data using the local build
  const temp = tmp();
  await Bun.write(join(temp, "bun.zip"), body);
  let unzip = Bun.spawnSync({
    cmd: ["unzip", join(temp, "bun.zip")],
    cwd: temp,
  });
  if (!unzip.success) throw new Error("Failed to unzip");
  let data = Bun.spawnSync({
    cmd: [
      join(temp, local.replace(".zip", ""), "bun"),
      "--print",
      'JSON.stringify(require("bun:internal-for-testing").crash_handler.getFeatureData())',
    ],
    cwd: temp,
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return data.stdout.toString("utf8").trim();
}

// Make the first asset the local build
for (let i = 0; i < release.assets.length; i++) {
  const asset = release.assets[i];
  if (asset.name === local) {
    release.assets.splice(i, 1);
    release.assets.unshift(asset);
    break;
  }
}

if (release?.assets?.[0]?.name !== local) {
  throw new Error("Expected local build to be the first asset");
}

for (const asset of release.assets) {
  const url = asset.browser_download_url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download asset: ${response.status} ${url}`);
  }
  const name = asset.name;
  let contentType: string;
  switch (name.split(".").pop()) {
    case "zip":
      contentType = "application/zip";
      break;
    case "txt":
    case "asc":
      contentType = "text/plain";
      break;
    default:
      contentType = response.headers.get("Content-Type") || "";
  }

  console.log("Downloading asset:", name);
  const body = await response.arrayBuffer();

  if (name == local) {
    const text = await getFeaturesJSON(body);
    const features = JSON.parse(text);
    const sha = features.revision;
    if (features.is_canary && !isCanary) {
      console.warn("Local build is a canary but release is not tagged as canary.");
    }
    await setPaths(sha, features.is_canary);
    console.log("features.json:", JSON.stringify(features, null, 2));

    for (const path of paths) {
      const key = `${path}/features.json`;
      console.log("Uploading:", key);
      await uploadToS3({
        key,
        body: new TextEncoder().encode(text).buffer,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }
  }

  for (const path of paths) {
    const key = `${path}/${name}`;
    console.log("Uploading:", key);
    await uploadToS3({
      key,
      body,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }
}

if (!dryRun && process.env.BUN_REPORT_TOKEN) {
  await fetch(`https://bun.report/purge-cache/${full_commit_hash}`, {
    method: "POST",
    headers: {
      Authorization: process.env.BUN_REPORT_TOKEN,
    },
  });
}

console.log("Done");

async function uploadToS3({
  key,
  body,
  headers,
}: {
  key: string;
  body: BodyInit;
  headers?: {
    "Content-Type": string;
    "Content-Disposition"?: string;
    "Cache-Control"?: string;
  };
}): Promise<void> {
  const { href } = new URL(key, bucketUrl);
  if (dryRun) {
    console.log("Would upload:", key, "to", href);
    return;
  }
  const response = await aws.fetch(href, {
    method: "PUT",
    body,
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload to S3: ${response.status} ${response.statusText}`);
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable not found: "${name}"`);
  }
  return value;
}
