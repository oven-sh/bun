import type { Endpoints } from "@octokit/types";
import { copy, exists, fetch, spawn } from "../src/util";
import type { JSZipObject } from "jszip";
import { loadAsync } from "jszip";
import { join } from "node:path";
import { chmod, read, write } from "../src/util";
import type { BuildOptions } from "esbuild";
import { buildSync, formatMessagesSync } from "esbuild";
import type { Platform } from "../src/platform";
import { platforms } from "../src/platform";

type Release =
  Endpoints["GET /repos/{owner}/{repo}/releases/latest"]["response"]["data"];

const npmPackage = "bun";
const npmOwner = "@oven";
let npmVersion: string;

const [tag, action] = process.argv.slice(2);

await build(tag);
if (action === "publish") {
  await publish();
} else if (action === "dry-run") {
  await publish(true);
} else if (action) {
  throw new Error(`Unknown action: ${action}`);
}

async function build(version: string): Promise<void> {
  const release = await getRelease(version);
  if (release.tag_name === "canary") {
    const { tag_name } = await getRelease();
    const sha = await getSha(tag_name);
    // Note: this needs to be run using canary
    npmVersion = `${Bun.version}-canary+${sha}`;
  } else {
    npmVersion = release.tag_name.replace("bun-v", "");
  }
  await buildBasePackage();
  for (const platform of platforms) {
    await buildPackage(release, platform);
  }
}

async function publish(dryRun?: boolean): Promise<void> {
  const npmPackages = platforms.map(({ bin }) => `${npmOwner}/${bin}`);
  npmPackages.push(npmPackage);
  for (const npmPackage of npmPackages) {
    publishPackage(npmPackage, dryRun);
  }
}

async function buildBasePackage() {
  const done = log("Building:", `${npmPackage}@${npmVersion}`);
  const cwd = join("npm", npmPackage);
  const define = {
    npmVersion: `"${npmVersion}"`,
    npmPackage: `"${npmPackage}"`,
    npmOwner: `"${npmOwner}"`,
  };
  buildJs(join("scripts", "npm-postinstall.ts"), join(cwd, "install.js"), {
    define,
  });
  buildJs(join("scripts", "npm-exec.ts"), join(cwd, "bin", "bun"), {
    define,
    banner: {
      js: "#!/usr/bin/env node",
    },
  });
  const os = [...new Set(platforms.map(({ os }) => os))];
  const cpu = [...new Set(platforms.map(({ arch }) => arch))];
  patchJson(join(cwd, "package.json"), {
    name: npmPackage,
    version: npmVersion,
    scripts: {
      postinstall: "node install.js",
    },
    optionalDependencies: Object.fromEntries(
      platforms.map(({ bin }) => [`${npmOwner}/${bin}`, npmVersion]),
    ),
    bin: {
      bun: "bin/bun",
    },
    os,
    cpu,
  });
  if (exists(".npmrc")) {
    copy(".npmrc", join(cwd, ".npmrc"));
  }
  done();
}

async function buildPackage(
  release: Release,
  { bin, exe, os, arch }: Platform,
): Promise<void> {
  const npmPackage = `${npmOwner}/${bin}`;
  const done = log("Building:", `${npmPackage}@${npmVersion}`);
  const asset = release.assets.find(({ name }) => name === `${bin}.zip`);
  if (!asset) {
    console.warn(`No asset found: ${bin}`);
    return;
  }
  const bun = await extractFromZip(asset.browser_download_url, `${bin}/bun`);
  const cwd = join("npm", npmPackage);
  write(join(cwd, exe), await bun.async("arraybuffer"));
  chmod(join(cwd, exe), 0o755);
  patchJson(join(cwd, "package.json"), {
    name: npmPackage,
    version: npmVersion,
    preferUnplugged: true,
    os: [os],
    cpu: [arch],
  });
  if (exists(".npmrc")) {
    copy(".npmrc", join(cwd, ".npmrc"));
  }
  done();
}

function publishPackage(name: string, dryRun?: boolean): void {
  const done = log(dryRun ? "Dry-run Publishing:" : "Publishing:", name);
  const { exitCode, stdout, stderr } = spawn(
    "npm",
    [
      "publish",
      "--access",
      "public",
      "--tag",
      npmVersion.startsWith("canary") ? "canary" : "latest",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    {
      cwd: join("npm", name),
    },
  );
  if (exitCode === 0) {
    done();
    return;
  }
  console.warn(stdout || stderr);
}

async function extractFromZip(
  url: string,
  filename: string,
): Promise<JSZipObject> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const zip = await loadAsync(buffer);
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && name.startsWith(filename)) {
      return file;
    }
  }
  console.warn("Found files:", Object.keys(zip.files));
  throw new Error(`File not found: ${filename}`);
}

async function getRelease(version?: string | null): Promise<Release> {
  const response = await fetchGithub(
    version ? `releases/tags/${formatTag(version)}` : `releases/latest`,
  );
  return response.json();
}

async function getSha(version: string): Promise<string> {
  const response = await fetchGithub(`git/ref/tags/${formatTag(version)}`);
  const {
    object,
  }: Endpoints["GET /repos/{owner}/{repo}/git/ref/{ref}"]["response"]["data"] =
    await response.json();
  return object.sha.substring(0, 7);
}

async function fetchGithub(path: string) {
  const headers = new Headers();
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const url = new URL(path, "https://api.github.com/repos/oven-sh/bun/");
  return fetch(url.toString());
}

function formatTag(version: string): string {
  if (version.startsWith("canary") || version.startsWith("bun-v")) {
    return version;
  }
  return `bun-v${version}`;
}

function patchJson(path: string, patch: object): void {
  let value;
  try {
    const existing = JSON.parse(read(path));
    value = {
      ...existing,
      ...patch,
    };
  } catch {
    value = patch;
  }
  write(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

function buildJs(src: string, dst: string, options: BuildOptions = {}): void {
  const { errors } = buildSync({
    bundle: true,
    treeShaking: true,
    keepNames: true,
    minifySyntax: true,
    pure: ["console.debug"],
    platform: "node",
    target: "es6",
    format: "cjs",
    entryPoints: [src],
    outfile: dst,
    ...options,
  });
  if (errors?.length) {
    const messages = formatMessagesSync(errors, { kind: "error" });
    throw new Error(messages.join("\n"));
  }
}

function log(...args: any[]): () => void {
  console.write(Bun.inspect(...args));
  const start = Date.now();
  return () => {
    console.write(` [${(Date.now() - start).toFixed()} ms]\n`);
  };
}
