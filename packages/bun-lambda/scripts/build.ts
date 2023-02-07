import type { Endpoints } from "@octokit/types";
import type { Errorlike } from "bun";
import { spawnSync } from "bun";
import type { JSZipObject } from "jszip";
import { loadAsync } from "jszip";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

type Release =
  Endpoints["GET /repos/{owner}/{repo}/releases/latest"]["response"]["data"];

async function getRelease(repo: string, tag?: string | null): Promise<Release> {
  const response = await fetch(
    tag
      ? `https://api.github.com/repos/${repo}/releases/tag/${tag}`
      : `https://api.github.com/repos/${repo}/releases/latest`
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function getFile(url: string, filename: string): Promise<JSZipObject | null> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const buffer = await response.arrayBuffer();
  const zip = await loadAsync(buffer);
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && filename === name) {
      return file;
    }
  }
  return null;
}

const repo = process.argv[3] ?? "oven-sh/bun";
const release = await getRelease(repo, process.argv[2]);
const latest = await getRelease(repo);
const layers = [
  {
    name: "bun-linux-x64",
    asset: "bun-linux-x64-baseline",
    arch: "x86_64",
  },
  {
    name: "bun-linux-aarch64",
    arch: "arm64",
  },
];

for (const { name, asset: assetName, arch } of layers) {
  const assetId = assetName ?? name;
  const asset = release.assets.find((asset) => asset.name === `${assetId}.zip`);
  if (!asset) {
    throw new Error(`Release does not contain an asset named '${assetId}.zip'`);
  }
  const file = await getFile(asset.browser_download_url, `${assetId}/bun`);
  if (!file) {
    throw new Error(`Release does not contain a file named '${assetId}/bun'`);
  }
  try {
    mkdirSync(name);
  } catch (cause) {
    const error = cause as Errorlike;
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  writeFileSync(join(name, "bun"), await file.async("uint8array"));
  for (const file of ["runtime.ts", "bootstrap"]) {
    copyFileSync(file, join(name, file));
  }
  const tags = [
    `${name}-${release.tag_name.replace("bun-v", "").replaceAll(".", "_")}`,
  ];
  if (latest.id === release.id) {
    // TODO: tags.push(name);
  }
  for (const tag of tags) {
    const cmd = [
      "bunx",
      "serverless",
      "deploy",
      "--config",
      "runtime.yml",
      "--param",
      `path=${name}`,
      "--param",
      `arch=${arch}`,
      "--param",
      `name=${tag}`,
    ];
    console.log("$", ...cmd);
    spawnSync({
      // @ts-ignore
      cmd,
      stdout: "inherit",
      stderr: "inherit",
    });
  }
}
