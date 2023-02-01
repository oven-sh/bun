import { join, copy, exists, chmod, write, writeJson } from "../src/fs";
import { fetch } from "../src/fetch";
import { spawn } from "../src/spawn";
import type { Platform } from "../src/platform";
import { platforms } from "../src/platform";
import { getSemver } from "../src/github";
import { getRelease } from "../src/github";
import type { BuildOptions } from "esbuild";
import { buildSync, formatMessagesSync } from "esbuild";
import type { JSZipObject } from "jszip";
import { loadAsync } from "jszip";
import { debug, log, error } from "../src/console";

const module = "bun";
const owner = "@oven";
let version: string;

const [tag, action] = process.argv.slice(2);

await build(tag);
if (action === "publish") {
  await publish();
} else if (action === "dry-run") {
  await publish(true);
} else if (action) {
  throw new Error(`Unknown action: ${action}`);
}
process.exit(0); // HACK

async function build(tag?: string): Promise<void> {
  const release = await getRelease(tag);
  version = await getSemver(release.tag_name);
  await buildRootModule();
  for (const platform of platforms) {
    await buildModule(release, platform);
  }
}

async function publish(dryRun?: boolean): Promise<void> {
  const modules = platforms.map(({ bin }) => `${owner}/${bin}`);
  modules.push(module);
  for (const module of modules) {
    publishModule(module, dryRun);
  }
}

async function buildRootModule() {
  log("Building:", `${module}@${version}`);
  const cwd = join("npm", module);
  const define = {
    version: `"${version}"`,
    module: `"${module}"`,
    owner: `"${owner}"`,
  };
  bundle(join("scripts", "npm-postinstall.ts"), join(cwd, "install.js"), {
    define,
  });
  bundle(join("scripts", "npm-exec.ts"), join(cwd, "bin", "bun"), {
    define,
    banner: {
      js: "#!/usr/bin/env node",
    },
  });
  const os = [...new Set(platforms.map(({ os }) => os))];
  const cpu = [...new Set(platforms.map(({ arch }) => arch))];
  writeJson(join(cwd, "package.json"), {
    name: module,
    version: version,
    scripts: {
      postinstall: "node install.js",
    },
    optionalDependencies: Object.fromEntries(platforms.map(({ bin }) => [`${owner}/${bin}`, version])),
    bin: {
      bun: "bin/bun",
      bunx: "bin/bun",
    },
    os,
    cpu,
  });
  if (exists(".npmrc")) {
    copy(".npmrc", join(cwd, ".npmrc"));
  }
}

async function buildModule(
  release: Awaited<ReturnType<typeof getRelease>>,
  { bin, exe, os, arch }: Platform,
): Promise<void> {
  const module = `${owner}/${bin}`;
  log("Building:", `${module}@${version}`);
  const asset = release.assets.find(({ name }) => name === `${bin}.zip`);
  if (!asset) {
    error(`No asset found: ${bin}`);
    return;
  }
  const bun = await extractFromZip(asset.browser_download_url, `${bin}/bun`);
  const cwd = join("npm", module);
  write(join(cwd, exe), await bun.async("arraybuffer"));
  chmod(join(cwd, exe), 0o755);
  writeJson(join(cwd, "package.json"), {
    name: module,
    version: version,
    preferUnplugged: true,
    os: [os],
    cpu: [arch],
  });
  if (exists(".npmrc")) {
    copy(".npmrc", join(cwd, ".npmrc"));
  }
}

function publishModule(name: string, dryRun?: boolean): void {
  log(dryRun ? "Dry-run Publishing:" : "Publishing:", `${name}@${version}`);
  const { exitCode, stdout, stderr } = spawn(
    "npm",
    [
      "publish",
      "--access",
      "public",
      "--tag",
      version.includes("canary") ? "canary" : "latest",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    {
      cwd: join("npm", name),
    },
  );
  if (exitCode === 0) {
    error(stderr || stdout);
  }
}

async function extractFromZip(url: string, filename: string): Promise<JSZipObject> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const zip = await loadAsync(buffer);
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && name.startsWith(filename)) {
      return file;
    }
  }
  debug("Found files:", Object.keys(zip.files));
  throw new Error(`File not found: ${filename}`);
}

function bundle(src: string, dst: string, options: BuildOptions = {}): void {
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
