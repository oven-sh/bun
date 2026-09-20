/**
 * Turns one image of `spec.ts` into the directory its bake runs:
 *
 *   build/ci-images/<key>/bootstrap.sh   every tool's variables and script, in order
 *   build/ci-images/<key>/agent.ts       the agent the image boots into
 *
 * The image's name is `<key>-<hash of that directory>`. Nothing else decides
 * what a bake does, so nothing else is in the hash.
 *
 * `bun run ci:images [key...]` writes the directories and prints the names.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { linuxAgentPaths } from "../../agent.ts";
import { BuildError } from "../error.ts";
import { type LinuxImage, type Tool, imageKey } from "./image.ts";
import { images, linuxTools } from "./spec.ts";

const here = import.meta.dirname;
const repoRoot = resolve(here, "../../..");

/** Set for every tool script, before the first one. */
const imageVariables = {
  AGENT_USER: "buildkite-agent",
  AGENT_HOME: linuxAgentPaths.homePath,
  AGENT_CACHE: linuxAgentPaths.cachePath,
  AGENT_LOGS: linuxAgentPaths.logsPath,
} as const;

/** Upper-case variables a script may read that are not ours: the shell's own. */
const shellVariables = new Set(["PATH", "HOME", "TMPDIR", "DEBIAN_FRONTEND"]);

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A tool's section of the script. Reading a variable nobody set is an empty
 * string in sh, which turns a typo into a wrong install; here it is an error
 * before anything is baked.
 */
function renderTool(tool: Tool): string {
  const script = readFileSync(join(here, "tools", tool.script), "utf8");
  const provided = new Set([...Object.keys(tool.variables), ...Object.keys(imageVariables)]);
  for (const [, name] of script.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)) {
    if (!provided.has(name!) && !shellVariables.has(name!)) {
      throw new BuildError(`tools/${tool.script} reads $${name}, which the "${tool.name}" tool does not provide`, {
        file: join(here, "tools", tool.script),
        hint: `Provided: ${[...provided].join(", ")}`,
      });
    }
  }
  const variables = Object.entries(tool.variables).map(([name, value]) => `${name}=${quote(value)}`);
  return [`# ---- ${tool.name} (tools/${tool.script})`, ...variables, script.trimEnd(), ""].join("\n");
}

function renderBootstrap(image: LinuxImage): string {
  return [
    "#!/bin/sh",
    `# Generated from scripts/build/ci-images/spec.ts for ${imageKey(image)}. Do not edit.`,
    "set -eu",
    "",
    readFileSync(join(here, "lib/linux.sh"), "utf8").trimEnd(),
    "",
    ...Object.entries(imageVariables).map(([name, value]) => `${name}=${quote(value)}`),
    "",
    ...linuxTools(image).map(renderTool),
  ].join("\n");
}

/** sha256 over every file of the directory, by sorted relative path. */
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

export function generateImage(image: LinuxImage, outputRoot: string): GeneratedImage {
  const key = imageKey(image);
  const directory = join(outputRoot, key);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "bootstrap.sh"), renderBootstrap(image));
  writeFileSync(join(directory, "agent.ts"), readFileSync(join(repoRoot, "scripts/agent.ts")));
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
