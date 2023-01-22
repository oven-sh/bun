import type { Endpoints } from "@octokit/types";
import { fetch, spawn } from "../src/util";
import type { JSZipObject } from "jszip";
import { loadAsync } from "jszip";
import { join } from "node:path";
import { chmod, read, write } from "../src/util";
import type { BuildOptions } from "esbuild";
import { buildSync, formatMessagesSync } from "esbuild";
import type { Platform } from "../src/platform";
import { platforms } from "../src/platform";

const tag = process.argv[2];
const release = await getRelease(tag);
const version = release.tag_name.replace("bun-v", "");
const npmPackage = "bun";
const npmOwner = "@oven";

await buildBasePackage();
for (const platform of platforms) {
  await buildPackage(platform);
}
const publish = process.argv[3] === "publish";
const dryRun = process.argv[3] === "dry-run";
if (publish || dryRun) {
  const npmPackages = platforms.map(({ bin }) => `${npmOwner}/${bin}`);
  npmPackages.push(npmPackage);
  for (const npmPackage of npmPackages) {
    publishPackage(npmPackage, dryRun);
  }
}

async function buildBasePackage() {
  const done = log("Building:", `${npmPackage}@${version}`);
  const cwd = join("npm", npmPackage);
  const define = {
    npmVersion: `"${version}"`,
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
    version,
    scripts: {
      postinstall: "node install.js",
    },
    optionalDependencies: Object.fromEntries(
      platforms.map(({ bin }) => [`${npmOwner}/${bin}`, version]),
    ),
    bin: {
      bun: "bin/bun",
    },
    os,
    cpu,
  });
  done();
}

async function buildPackage({ bin, exe, os, arch }: Platform): Promise<void> {
  const npmPackage = `${npmOwner}/${bin}`;
  const done = log("Building:", `${npmPackage}@${version}`);
  const asset = release.assets.find(({ name }) => name === `${bin}.zip`);
  if (!asset) {
    throw new Error(`No asset found: ${bin}`);
  }
  const bun = await extractFromZip(asset.browser_download_url, `${bin}/bun`);
  const cwd = join("npm", npmPackage);
  write(join(cwd, exe), await bun.async("arraybuffer"));
  chmod(join(cwd, exe), 0o755);
  patchJson(join(cwd, "package.json"), {
    name: npmPackage,
    version,
    preferUnplugged: true,
    os: [os],
    cpu: [arch],
  });
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
      version === "canary" ? "canary" : "latest",
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
  throw new Error(stdout || stderr);
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

async function getRelease(
  version?: string | null,
): Promise<
  Endpoints["GET /repos/{owner}/{repo}/releases/latest"]["response"]["data"]
> {
  const tag = version
    ? version === "canary" || version.startsWith("bun-v")
      ? version
      : `bun-v${version}`
    : null;
  const response = await fetch(
    tag
      ? `https://api.github.com/repos/oven-sh/bun/releases/tags/${tag}`
      : `https://api.github.com/repos/oven-sh/bun/releases/latest`,
  );
  return response.json();
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
