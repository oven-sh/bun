import { join, copy, exists, chmod, write, writeJson } from "../src/fs";
import { mkdtemp } from "fs/promises";
import { rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { dirname } from "path";
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
import { expect } from "bun:test";

const module = "bun";
const owner = "@oven";

const [tag, action] = process.argv.slice(2);

const release = await getRelease(tag);
const version = await getSemver(release.tag_name);

if (action !== "test-only") await build();

if (action === "publish") {
  await publish();
} else if (action === "dry-run") {
  await publish(true);
} else if (action === "test") {
  await publish(true);
  await test();
} else if (action === "test-only") {
  await test();
} else if (action) {
  throw new Error(`Unknown action: ${action}`);
}
process.exit(0); // HACK

async function build(): Promise<void> {
  await buildRootModule();
  for (const platform of platforms) {
    if (action !== "publish" && (platform.os !== process.platform || platform.arch !== process.arch)) continue;
    await buildModule(release, platform);
  }
}

async function publish(dryRun?: boolean): Promise<void> {
  const modules = platforms
    .filter(({ os, arch }) => action === "publish" || (os === process.platform && arch === process.arch))
    .map(({ bin }) => `${owner}/${bin}`);
  modules.push(module);
  for (const module of modules) {
    publishModule(module, dryRun);
  }
}

async function buildRootModule(dryRun?: boolean) {
  log("Building:", `${module}@${version}`);
  const cwd = join("npm", module);
  const define = {
    version: `"${version}"`,
    module: `"${module}"`,
    owner: `"${owner}"`,
  };
  bundle(join("scripts", "npm-postinstall.ts"), join(cwd, "install.js"), {
    define,
    banner: {
      js: "// Source code: https://github.com/oven-sh/bun/blob/main/packages/bun-release/scripts/npm-postinstall.ts",
    },
  });
  write(join(cwd, "bin", "bun.exe"), "");
  write(
    join(cwd, "bin", "README.txt"),
    `The 'bun.exe' file is a placeholder for the binary file, which
is replaced by Bun's 'postinstall' script. For this to work, make
sure that you do not use --ignore-scripts while installing.

The postinstall script is responsible for linking the binary file
directly into 'node_modules/.bin' and avoiding a Node.js wrapper
script being called on every invocation of 'bun'. If this wasn't
done, Bun would seem to be slower than Node.js, because it would
be executing a copy of Node.js every time!

Unfortunately, it is not possible to fix all cases on all platforms
without *requiring* a postinstall script.
`,
  );
  const os = [...new Set(platforms.map(({ os }) => os))];
  const cpu = [...new Set(platforms.map(({ arch }) => arch))];
  writeJson(join(cwd, "package.json"), {
    name: module,
    description: "Bun is a fast all-in-one JavaScript runtime.",
    version: version,
    scripts: {
      postinstall: "node install.js",
    },
    optionalDependencies: Object.fromEntries(
      platforms.map(({ bin }) => [
        `${owner}/${bin}`,
        dryRun ? `file:./oven-${bin.replaceAll("/", "-") + "-" + version + ".tgz"}` : version,
      ]),
    ),
    bin: {
      bun: "bin/bun.exe",
      bunx: "bin/bun.exe",
    },
    os,
    cpu,
    keywords: ["bun", "bun.js", "node", "node.js", "runtime", "bundler", "transpiler", "typescript"],
    homepage: "https://bun.sh",
    bugs: "https://github.com/oven-sh/issues",
    license: "MIT",
    repository: "https://github.com/oven-sh/bun",
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
  mkdirSync(dirname(join(cwd, exe)), { recursive: true });
  write(join(cwd, exe), await bun.async("arraybuffer"));
  chmod(join(cwd, exe), 0o755);
  writeJson(join(cwd, "package.json"), {
    name: module,
    version: version,
    description: "This is the macOS arm64 binary for Bun, a fast all-in-one JavaScript runtime.",
    homepage: "https://bun.sh",
    bugs: "https://github.com/oven-sh/issues",
    license: "MIT",
    repository: "https://github.com/oven-sh/bun",
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
  if (!dryRun) {
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
    error(stderr || stdout);
    if (exitCode !== 0) {
      if (
        stdout.includes("You cannot publish over the previously published version") ||
        stderr.includes("You cannot publish over the previously published version")
      ) {
        console.warn("Ignoring npm publish error:", stdout, stderr);
        return;
      }

      throw new Error("npm publish failed with code " + exitCode);
    }
  } else {
    const { exitCode, stdout, stderr } = spawn("npm", ["pack"], {
      cwd: join("npm", name),
    });
    error(stderr || stdout);
    if (exitCode !== 0) {
      throw new Error("npm pack failed with code " + exitCode);
    }
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

async function test() {
  const root = await mkdtemp(join(tmpdir(), "bun-release-test-"));
  const $ = new Bun.$.Shell().cwd(root);

  for (const platform of platforms) {
    if (platform.os !== process.platform) continue;
    if (platform.arch !== process.arch) continue;
    copy(
      join(
        import.meta.dir,
        "../npm/@oven/",
        platform.bin,
        "oven-" + platform.bin.replaceAll("/", "-") + `-${version}.tgz`,
      ),
      join(root, `${platform.bin}-${version}.tgz`),
    );
  }

  copy(join(import.meta.dir, "../npm", "bun", "bun-" + version + ".tgz"), join(root, "bun-" + version + ".tgz"));

  console.log(root);
  for (const [install, exec] of [
    ["npm i", "npm exec"],
    ["yarn set version berry; yarn add", "yarn"],
    ["yarn set version latest; yarn add", "yarn"],
    ["pnpm i", "pnpm"],
    ["bun i", "bun run"],
  ]) {
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    rmSync(join(root, "package-lock.json"), { recursive: true, force: true });
    rmSync(join(root, "package.json"), { recursive: true, force: true });
    rmSync(join(root, "pnpm-lock.yaml"), { recursive: true, force: true });
    rmSync(join(root, "yarn.lock"), { recursive: true, force: true });
    writeJson(join(root, "package.json"), {
      name: "bun-release-test",
    });

    console.log("Testing", install + " bun");
    await $`${{ raw: install }} ./bun-${version}.tgz`;

    console.log("Running " + exec + " bun");

    // let output = await $`${{
    //   raw: exec,
    // }} bun -- -e "console.log(JSON.stringify([Bun.version, process.platform, process.arch, process.execPath]))"`.text();
    const split = exec.split(" ");
    let {
      stdout: output,
      stderr,
      exitCode,
    } = spawn(
      split[0],
      [
        ...split.slice(1),
        "--",
        "bun",
        "-e",
        "console.log(JSON.stringify([Bun.version, process.platform, process.arch, process.execPath]))",
      ],
      {
        cwd: root,
      },
    );
    if (exitCode !== 0) {
      console.error(stderr);
      throw new Error("Failed to run " + exec + " bun, exit code: " + exitCode);
    }

    try {
      output = JSON.parse(output);
    } catch (e) {
      console.log({ output });
      throw e;
    }

    expect(output[0]).toBe(version);
    expect(output[1]).toBe(process.platform);
    expect(output[2]).toBe(process.arch);
    expect(output[3]).toStartWith(root);
    expect(output[3]).toInclude("bun");
  }
}
