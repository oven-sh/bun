#!/usr/bin/env bun
// Runs the yarn berry -> bun.lock migration over real projects and reports,
// for each one, whether it migrated and how bun.lock compares with yarn.lock.
//
//   bun scripts/yarn-berry-corpus.ts [--bun <binary>] [--dir <work dir>] [--only <name>] [--keep-home]
//
// It clones each project sparsely (package.json, yarn.lock, .yarnrc.yml and
// patch files only), runs `<binary> pm migrate` in it and never installs
// packages or runs a script from the project. The registry is contacted for
// package manifests. Results go to stdout and to <work dir>/results.json.

import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// name, GitHub repository, branch or tag, folder of the yarn project
const projects: [string, string, string, string][] = [
  ["berry-master", "yarnpkg/berry", "master", "."],
  ["babel-main", "babel/babel", "main", "."],
  ["jest-main", "jestjs/jest", "main", "."],
  ["storybook-next", "storybookjs/storybook", "next", "."],
  ["storybook-next-code", "storybookjs/storybook", "next", "code"],
  ["tseslint-main", "typescript-eslint/typescript-eslint", "main", "."],
  ["prettier-main", "prettier/prettier", "main", "."],
  ["backstage-master", "backstage/backstage", "master", "."],
  ["metamask-ext-main", "MetaMask/metamask-extension", "main", "."],
  ["grafana-main", "grafana/grafana", "main", "."],
  ["mastodon-main", "mastodon/mastodon", "main", "."],
  ["rtk-master", "reduxjs/redux-toolkit", "master", "."],
  ["ha-frontend-dev", "home-assistant/frontend", "dev", "."],
  ["strapi-develop", "strapi/strapi", "develop", "."],
  ["tldraw-main", "tldraw/tldraw", "main", "."],
  ["rocketchat-develop", "RocketChat/Rocket.Chat", "develop", "."],
  ["calcom-main", "calcom/cal.com", "main", "."],
  ["twenty-main", "twentyhq/twenty", "main", "."],
  ["affine-canary", "toeverything/AFFiNE", "canary", "."],
  ["forge-main", "electron/forge", "main", "."],
  ["reactnav-main", "react-navigation/react-navigation", "main", "."],
  ["jupyterlab-main", "jupyterlab/jupyterlab", "main", "."],
  ["webpack-main", "webpack/webpack", "main", "."],
  ["reanimated-main", "software-mansion/react-native-reanimated", "main", "."],
  ["metamask-core-main", "MetaMask/core", "main", "."],
  // older lockfile formats (yarn 2 and 3)
  ["babel-v7.14.0", "babel/babel", "v7.14.0", "."],
  ["babel-v7.20.0", "babel/babel", "v7.20.0", "."],
  ["jest-v27.0.0", "jestjs/jest", "v27.0.0", "."],
  ["jest-v29.0.0", "jestjs/jest", "v29.0.0", "."],
  ["berry-cli-2.4.0", "yarnpkg/berry", "@yarnpkg/cli/2.4.0", "."],
  ["berry-cli-3.6.0", "yarnpkg/berry", "@yarnpkg/cli/3.6.0", "."],
  ["storybook-v6.5.0", "storybookjs/storybook", "v6.5.0", "."],
  ["tseslint-v6.0.0", "typescript-eslint/typescript-eslint", "v6.0.0", "."],
  ["prettier-3.0.0", "prettier/prettier", "3.0.0", "."],
  ["backstage-v1.10.0", "backstage/backstage", "v1.10.0", "."],
  ["grafana-v9.0.0", "grafana/grafana", "v9.0.0", "."],
  ["jupyterlab-v4.0.0", "jupyterlab/jupyterlab", "v4.0.0", "."],
  ["rtk-v1.9.0", "reduxjs/redux-toolkit", "v1.9.0", "."],
];

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const repoRoot = resolve(import.meta.dir, "..");
const bun = resolve(
  flag("--bun") ??
    [join(repoRoot, "build/release/bun"), join(repoRoot, "build/debug/bun-debug")].find(existsSync) ??
    "bun",
);
const workDir = resolve(flag("--dir") ?? join(repoRoot, "tmp/yarn-berry-corpus"));
const only = flag("--only");
// Without --keep-home the migration sees no ~/.yarnrc.yml, ~/.npmrc or ~/.bunfig.toml.
const keepHome = process.argv.includes("--keep-home");

type Result = {
  name: string;
  lockfileVersion: string;
  outcome: "migrated" | "not migrated" | "crashed" | "no yarn.lock" | "clone failed";
  /** the first `error:` line */
  reason: string;
  seconds: number;
  /** npm `name@version` pairs yarn.lock holds */
  yarnPackages: number;
  /** pairs bun.lock holds that yarn.lock does not: bun chose a version yarn had not locked */
  onlyInBun: string[];
  /** pairs yarn.lock holds that bun.lock does not: no edge reaches them after migration */
  onlyInYarn: string[];
  /** files the migration changed, from `git status` */
  filesChanged: string[];
};

/** `name@version` of every `resolution: "name@npm:version"` */
function yarnNpmPackages(yarnLock: string): Set<string> {
  const found = new Set<string>();
  for (const [, name, version] of yarnLock.matchAll(/^  resolution: "?((?:@[^@/"]+\/)?[^@/"]+)@npm:([^":]+)/gm)) {
    found.add(`${name}@${version}`);
  }
  return found;
}

/** `name@version` of every npm package row in the `packages` section */
function bunNpmPackages(bunLock: string): Set<string> {
  const found = new Set<string>();
  const packages = bunLock.slice(bunLock.indexOf(`"packages": {`));
  for (const [, id] of packages.matchAll(/^    "[^"]+": \["([^"]+)", "/gm)) {
    const at = id.lastIndexOf("@");
    // rows for workspaces, folders, git and tarball URLs have no plain version
    if (at > 0 && /^\d+\.\d+\.\d+/.test(id.slice(at + 1))) found.add(id);
  }
  return found;
}

function bucket(reason: string): string {
  return reason
    .replace(/^error: /, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\d+/g, "N");
}

async function run(name: string, repo: string, ref: string, subdir: string): Promise<Result> {
  const result: Result = {
    name,
    lockfileVersion: "?",
    outcome: "clone failed",
    reason: "",
    seconds: 0,
    yarnPackages: 0,
    onlyInBun: [],
    onlyInYarn: [],
    filesChanged: [],
  };
  const checkout = join(workDir, "projects", name);
  await rm(checkout, { recursive: true, force: true });
  const clone =
    await $`git clone --quiet --depth 1 --filter=blob:none --no-checkout --branch ${ref} https://github.com/${repo}.git ${checkout}`
      .nothrow()
      .quiet();
  if (clone.exitCode !== 0) {
    result.reason = clone.stderr.toString().trim().split("\n").at(-1) ?? "";
    return result;
  }
  await $`git -C ${checkout} sparse-checkout set --no-cone package.json yarn.lock .yarnrc.yml "*.patch" "*.diff"`.quiet();
  await $`git -C ${checkout} checkout --quiet`.quiet();

  const cwd = join(checkout, subdir);
  if (!existsSync(join(cwd, "yarn.lock"))) {
    result.outcome = "no yarn.lock";
    return result;
  }
  const yarnLock = await readFile(join(cwd, "yarn.lock"), "utf8");
  result.lockfileVersion = yarnLock.match(/^__metadata:\n  version: (\S+)/m)?.[1] ?? "v1";
  const inYarn = yarnNpmPackages(yarnLock);
  result.yarnPackages = inYarn.size;
  // a project that already has a bun lockfile is migrated from yarn.lock all the same
  for (const lock of ["bun.lock", "bun.lockb"]) await rm(join(cwd, lock), { force: true });

  const home = join(workDir, "home");
  await mkdir(home, { recursive: true });
  const started = performance.now();
  const proc = Bun.spawn({
    cmd: [bun, "pm", "migrate"],
    cwd,
    env: {
      ...process.env,
      ...(keepHome ? {} : { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home }),
      BUN_INSTALL_CACHE_DIR: join(workDir, "cache"),
      BUN_DEBUG_QUIET_LOGS: "1",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20 * 60 * 1000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  result.seconds = Math.round((performance.now() - started) / 1000);
  await writeFile(join(workDir, `${name}.log`), `exit ${exitCode} signal ${proc.signalCode}\n${stdout}\n${stderr}`);

  result.reason = stderr.split("\n").find(line => line.startsWith("error: ")) ?? "";
  result.filesChanged = (await $`git -C ${checkout} status --porcelain`.text())
    .split("\n")
    .map(line => line.slice(3))
    .filter(file => file && !file.endsWith("bun.lock"));

  const migrated = exitCode === 0 && stderr.includes("migrated lockfile from yarn.lock");
  if (migrated && existsSync(join(cwd, "bun.lock"))) {
    result.outcome = "migrated";
    const inBun = bunNpmPackages(await readFile(join(cwd, "bun.lock"), "utf8"));
    result.onlyInBun = [...inBun].filter(id => !inYarn.has(id)).sort();
    result.onlyInYarn = [...inYarn].filter(id => !inBun.has(id)).sort();
  } else if (exitCode === 1 && result.reason) {
    result.outcome = "not migrated";
  } else {
    result.outcome = "crashed";
    result.reason ||= `exit ${exitCode} signal ${proc.signalCode}; see ${name}.log`;
  }
  return result;
}

await mkdir(workDir, { recursive: true });
console.log(`bun: ${bun} (${(await $`${bun} --revision`.text()).trim()})`);
console.log(`work dir: ${workDir}\n`);

const results: Result[] = [];
for (const [name, repo, ref, subdir] of projects) {
  if (only && name !== only) continue;
  const result = await run(name, repo, ref, subdir);
  results.push(result);
  console.log(
    `${result.name.padEnd(22)} v${result.lockfileVersion.padEnd(3)} ${result.outcome.padEnd(13)} ${String(result.seconds).padStart(4)}s  ` +
      (result.outcome === "migrated"
        ? `yarn ${result.yarnPackages}, only in bun ${result.onlyInBun.length}, only in yarn ${result.onlyInYarn.length}, files changed ${result.filesChanged.length}`
        : result.reason.slice(0, 160)),
  );
  await writeFile(join(workDir, "results.json"), JSON.stringify(results, null, 2));
}

const count = (outcome: Result["outcome"]) => results.filter(r => r.outcome === outcome).length;
console.log(
  `\n${results.length} projects: ${count("migrated")} migrated, ${count("not migrated")} not migrated, ${count("crashed")} crashed, ` +
    `${count("clone failed") + count("no yarn.lock")} not run`,
);

const reasons = new Map<string, string[]>();
for (const r of results.filter(r => r.outcome === "not migrated")) {
  const key = bucket(r.reason);
  reasons.set(key, [...(reasons.get(key) ?? []), r.name]);
}
if (reasons.size > 0) console.log("\nWhy a lockfile was not migrated:");
for (const [reason, names] of [...reasons].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(names.length).padStart(2)}  ${reason.slice(0, 150)}\n      ${names.join(", ")}`);
}

// The check that matters: a migrated bun.lock must not hold a version yarn.lock did not.
const drifted = results.filter(r => r.onlyInBun.length > 0);
console.log(
  drifted.length === 0
    ? "\nNo migrated bun.lock holds an npm version that its yarn.lock does not."
    : "\nMigrated, but bun.lock holds versions yarn.lock does not (first 10 each):",
);
for (const r of drifted) console.log(`  ${r.name}: ${r.onlyInBun.slice(0, 10).join(", ")}`);

const unreached = results.filter(r => r.onlyInYarn.length > 0);
if (unreached.length > 0) console.log("\nMigrated, and yarn.lock holds versions bun.lock does not (first 10 each):");
for (const r of unreached) console.log(`  ${r.name} (${r.onlyInYarn.length}): ${r.onlyInYarn.slice(0, 10).join(", ")}`);

if (count("crashed") > 0) process.exit(1);
