/**
 * Turns one image of `spec.ts` into the directory its bake runs:
 *
 *   build/ci-images/<key>/image.json                what the image is, and the exact base image it is baked from
 *   build/ci-images/<key>/bootstrap.sh or .ps1      every tool's variables and script, in order
 *   build/ci-images/<key>/<file>                    the files those scripts use (agent.mts, …)
 *   build/ci-images/<key>/image.pkr.hcl             Windows: the Packer template that runs the bake
 *
 * The image's name is `<key>-<hash of that directory>`. Nothing else decides
 * what a bake does, so nothing else is in the hash.
 *
 * A Linux bake runs `sh bootstrap.sh <checkout>` as root on the machine being
 * baked, where <checkout> is the repository at the commit being built. A
 * Windows bake is driven by Packer from outside the machine, which uploads
 * the directory and runs `bootstrap.ps1` with `REPO_COMMIT` in the environment.
 *
 * `bun run ci:images [key...]` writes the directories and prints the names.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { linuxAgentPaths, windowsAgentHome } from "../../agent.ts";
import { BuildError } from "../error.ts";
import { type Image, type Tool, imageKey } from "./image.ts";
import { renderPackerTemplate } from "./packer.ts";
import { images, pins, tools } from "./spec.ts";

const here = import.meta.dirname;
const repoRoot = resolve(here, "../../..");

/** How a script is written for one operating system. */
type Shell = {
  scriptName: string;
  library: string;
  /** Set for every tool script, before the first one. */
  variables: Readonly<Record<string, string>>;
  /** Lines that set the variables only known when the script runs: `BAKE_DIR`, and where the repository comes from. */
  runtime: readonly string[];
  runtimeVariables: readonly string[];
  /** Upper-case variables a script may read that are not ours: the shell's own. */
  shellVariables: ReadonlySet<string>;
  header: readonly string[];
  assign(name: string, value: string): string;
};

const sh: Shell = {
  scriptName: "bootstrap.sh",
  library: "lib/linux.sh",
  variables: {
    AGENT_USER: "buildkite-agent",
    AGENT_HOME: linuxAgentPaths.homePath,
    AGENT_CACHE: linuxAgentPaths.cachePath,
    AGENT_LOGS: linuxAgentPaths.logsPath,
  },
  runtime: [
    `BAKE_DIR=$(cd "$(dirname "$0")" && pwd)`,
    `[ $# -eq 1 ] || fail "usage: bootstrap.sh <checkout>"`,
    `REPO_DIR=$(cd "$1" && pwd)`,
  ],
  runtimeVariables: ["BAKE_DIR", "REPO_DIR"],
  shellVariables: new Set(["PATH", "HOME", "TMPDIR", "DEBIAN_FRONTEND"]),
  header: ["#!/bin/sh", "set -eu"],
  assign: (name, value) => `${name}='${value.replace(/'/g, `'\\''`)}'`,
};

const powershell: Shell = {
  scriptName: "bootstrap.ps1",
  library: "lib/windows.ps1",
  variables: { AGENT_HOME: windowsAgentHome },
  runtime: [
    `$BAKE_DIR = $PSScriptRoot`,
    `$REPO_COMMIT = $env:REPO_COMMIT`,
    `if (-not $REPO_COMMIT) { Fail "REPO_COMMIT is not set" }`,
  ],
  runtimeVariables: ["BAKE_DIR", "REPO_COMMIT"],
  shellVariables: new Set(["LASTEXITCODE"]),
  header: [],
  assign: (name, value) => `$${name} = '${value.replace(/'/g, "''")}'`,
};

/**
 * A tool's section of the script. Reading a variable nobody set is an empty
 * string in both shells, which turns a typo into a wrong install; here it is
 * an error before anything is baked.
 */
function renderTool(tool: Tool, shell: Shell): string {
  const file = join(here, "tools", tool.script);
  const script = readFileSync(file, "utf8");
  const provided = new Set([
    ...Object.keys(tool.variables),
    ...Object.keys(shell.variables),
    ...shell.runtimeVariables,
  ]);
  for (const [, name] of script.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\b/g)) {
    if (!provided.has(name!) && !shell.shellVariables.has(name!)) {
      throw new BuildError(`tools/${tool.script} reads $${name}, which the "${tool.name}" tool does not provide`, {
        file,
        hint: `Provided: ${[...provided].join(", ")}`,
      });
    }
  }
  const variables = Object.entries(tool.variables).map(([name, value]) => shell.assign(name, value));
  return [`# ---- ${tool.name} (tools/${tool.script})`, ...variables, script.trimEnd(), ""].join("\n");
}

function renderBootstrap(image: Image, shell: Shell): string {
  return [
    ...shell.header,
    `# Generated from scripts/build/ci-images/spec.ts for ${imageKey(image)}. Do not edit.`,
    "",
    readFileSync(join(here, shell.library), "utf8").trimEnd(),
    "",
    ...Object.entries(shell.variables).map(([name, value]) => shell.assign(name, value)),
    ...shell.runtime,
    "",
    ...tools(image).map(tool => renderTool(tool, shell)),
  ].join("\n");
}

/** sha256 over every file of the directory, by sorted name. */
function hashDirectory(directory: string): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(directory).sort()) {
    hash
      .update(name)
      .update("\0")
      .update(readFileSync(join(directory, name)))
      .update("\0");
  }
  return hash.digest("hex");
}

export type GeneratedImage = {
  key: string;
  /** `<key>-<16 hex>`: the name the image is baked and booted under. */
  name: string;
  directory: string;
};

export function generateImage(image: Image, outputRoot: string): GeneratedImage {
  const key = imageKey(image);
  const directory = join(outputRoot, key);
  const shell = image.os === "windows" ? powershell : sh;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "image.json"), JSON.stringify(image, null, 2) + "\n");
  writeFileSync(join(directory, shell.scriptName), renderBootstrap(image, shell));
  for (const tool of tools(image)) {
    for (const [name, source] of Object.entries(tool.files ?? {})) {
      copyFileSync(join(repoRoot, source), join(directory, name));
    }
  }
  if (image.os === "windows") {
    writeFileSync(join(directory, "image.pkr.hcl"), renderPackerTemplate(image, pins.packer));
  }
  return { key, name: `${key}-${hashDirectory(directory).slice(0, 16)}`, directory };
}

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  const known = new Map(images.map(image => [imageKey(image), image]));
  for (const key of wanted) {
    if (!known.has(key)) {
      throw new BuildError(`No image named ${key}`, { hint: `Images: ${[...known.keys()].join(", ")}` });
    }
  }
  for (const [key, image] of known) {
    if (wanted.length && !wanted.includes(key)) continue;
    const { name, directory } = generateImage(image, join(repoRoot, "build/ci-images"));
    console.log(`${name}  ${directory}`);
  }
}
