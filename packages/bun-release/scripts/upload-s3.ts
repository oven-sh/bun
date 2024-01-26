import { AwsClient } from "aws4fetch";
import { getBuild, getRelease, getSemver } from "../src/github";

const [tag] = process.argv.slice(2);
const bucketUrl = new URL(`${env("AWS_BUCKET")}/`, env("AWS_ENDPOINT"));
const aws = new AwsClient({
  accessKeyId: env("AWS_ACCESS_KEY_ID"),
  secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
});

const latest = await getRelease();
const release = await getRelease(tag);
console.log("Found release:", release.tag_name);

let paths: string[];
if (latest.tag_name === release.tag_name) {
  paths = ["releases/latest", `releases/${release.tag_name}`];
} else if (release.tag_name === "canary") {
  try {
    const build = await getSemver("canary", await getBuild());
    paths = ["releases/canary", `releases/${build}`];
  } catch (error) {
    console.warn(error);
    paths = ["releases/canary"];
  }
} else {
  paths = [`releases/${release.tag_name}`];
}
console.log("Found paths:", paths);

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
  const body = await response.arrayBuffer();
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
