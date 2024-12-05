import type { Endpoints, RequestParameters, Route } from "@octokit/types";
import { Octokit } from "octokit";
import { fetch } from "./fetch";
import { debug, log, warn, error } from "./console";

const [owner, repo] = process.env["GITHUB_REPOSITORY"]?.split("/") ?? ["oven-sh", "bun"];

const octokit = new Octokit({
  auth: process.env["GITHUB_TOKEN"],
  request: {
    fetch,
  },
  log: {
    debug,
    info: log,
    warn,
    error,
  },
});

export async function github<R extends Route>(
  url: R | keyof Endpoints,
  options?: Omit<
    R extends keyof Endpoints ? Endpoints[R]["parameters"] & RequestParameters : RequestParameters,
    "owner" | "repo"
  >,
): Promise<R extends keyof Endpoints ? Endpoints[R]["response"]["data"] : unknown> {
  // @ts-ignore
  const { data } = await octokit.request(url, {
    owner,
    repo,
    ...options,
  });
  return data;
}

export async function getRelease(tag?: string) {
  if (!tag) {
    return github("GET /repos/{owner}/{repo}/releases/latest");
  }
  return github("GET /repos/{owner}/{repo}/releases/tags/{tag}", {
    tag: formatTag(tag),
  });
}

export async function uploadAsset(tag: string, name: string, blob: Blob) {
  const release = await getRelease(tag);
  const asset = release.assets.find(asset => asset.name === name);
  // Github requires that existing assets are deleted before uploading
  // a new asset, but does not provide a rename or re-upload API?!?
  if (asset) {
    await github("DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}", {
      asset_id: asset.id,
    });
  }
  return github("POST {origin}/repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}", {
    baseUrl: "https://uploads.github.com",
    release_id: release.id,
    name,
    headers: {
      "content-type": blob.type,
      "content-length": blob.size,
    },
    data: Buffer.from(await blob.arrayBuffer()),
  });
}

export async function downloadAsset(tag: string, name: string): Promise<Blob> {
  const release = await getRelease(tag);
  const asset = release.assets.find(asset => asset.name === name);
  if (!asset) {
    throw new Error(`Asset not found: ${name}`);
  }
  const response = await fetch(asset.browser_download_url);
  return response.blob();
}

export async function getSha(tag: string, format?: "short" | "long") {
  const ref = formatTag(tag);
  const {
    object: { sha },
  } = await github("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    ref: ref === "canary" ? "heads/main" : `tags/${ref}`,
  });
  return format === "short" ? sha.substring(0, 7) : sha;
}

export async function getBuild(): Promise<number> {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const response = await fetch("https://registry.npmjs.org/-/package/bun/dist-tags");
  const { canary }: { canary: string } = await response.json();
  if (!canary.includes(date)) {
    return 1;
  }
  const match = /canary.[0-9]{8}\.([0-9]+)+?/.exec(canary);
  return match ? 1 + parseInt(match[1]) : 1;
}

export async function getSemver(tag?: string, build?: number): Promise<string> {
  const { tag_name: latest_tag_name } = await getRelease();
  const version = latest_tag_name.replace("bun-v", "");
  const { tag_name } = await getRelease(tag);
  if (tag_name !== "canary") {
    return tag_name.replace("bun-v", "");
  }
  if (build === undefined) {
    build = await getBuild();
  }
  const sha = await getSha(tag_name, "short");
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  return `${version}-canary.${date}.${build}+${sha}`;
}

export function formatTag(tag: string): string {
  if (tag === "canary" || tag.startsWith("bun-v")) {
    return tag;
  }
  if (tag.startsWith("v")) {
    return tag.slice(1);
  }
  return `bun-v${tag}`;
}
