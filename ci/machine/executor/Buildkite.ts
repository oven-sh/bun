import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  getCanaryRevision as getCanaryRevision_,
  getLastSuccessfulBuild as getLastSuccessfulBuild_,
} from "../../../scripts/utils.mjs";
import { type BuildkiteBuild } from "../../cd/pipeline/buildkite/BuildkitePipeline.ts";
import { getTestLabel } from "../../cd/runner/output.ts";
import { escapeCodeBlock } from "../../cd/runner/parse.ts";
import { getExecPath } from "../../cd/runner/path.ts";
import { getRunnerOptions } from "../../cd/runner/RunnerOptions.ts";
import { Spawn, type SpawnOptions } from "../../cd/runner/Spawn.ts";
import { Test } from "../../cd/runner/Test.ts";
import { getBuildUrl, unzip } from "../context/process.ts";

let __lastSuccessfulBuild: BuildkiteBuild | undefined;
export const getLastSuccessfulBuild: () => Promise<BuildkiteBuild | undefined> = async () => {
  if (__lastSuccessfulBuild === undefined) {
    __lastSuccessfulBuild = await getLastSuccessfulBuild_();
  }
  return __lastSuccessfulBuild;
};

let __canaryRevision: number | undefined;
export const getCanaryRevision: () => Promise<number> = async () => {
  if (__canaryRevision === undefined) {
    __canaryRevision = await getCanaryRevision_();
  }
  return __canaryRevision!;
};

/**
 * @param {string} target
 * @returns {Promise<string>}
 */
export const getExecPathFromBuildKite = async target => {
  if (existsSync(target) || target.includes("/")) {
    return getExecPath(target);
  }
  const {
    cwd,
    timeouts: { spawnTimeout },
  } = getRunnerOptions();

  const releasePath = join(cwd, "release");
  mkdirSync(releasePath, { recursive: true });

  const args = ["artifact", "download", "**", releasePath, "--step", target];
  const buildId = process.env["BUILDKITE_ARTIFACT_BUILD_ID"];
  if (buildId) {
    args.push("--build", buildId);
  }

  await Spawn.spawnSafe({
    command: "buildkite-agent",
    args,
  } as unknown as SpawnOptions);

  let zipPath;
  for (const entry of readdirSync(releasePath, { recursive: true, encoding: "utf-8" })) {
    if (/^bun.*\.zip$/i.test(entry) && !entry.includes("-profile.zip")) {
      zipPath = join(releasePath, entry);
      break;
    }
  }

  if (!zipPath) {
    throw new Error(`Could not find ${target}.zip from Buildkite: ${releasePath}`);
  }

  await unzip(zipPath, releasePath);

  for (const entry of readdirSync(releasePath, { recursive: true, encoding: "utf-8" })) {
    const execPath = join(releasePath, entry);
    if (/bun(?:\.exe)?$/i.test(entry) && Test.isExecutable(execPath)) {
      return execPath;
    }
  }

  throw new Error(`Could not find executable from BuildKite: ${releasePath}`);
};

/**
 * @param {string} glob
 */
export function uploadArtifactsToBuildKite(glob) {
  const {
    cwd,
    timeouts: { spawnTimeout },
  } = getRunnerOptions();

  spawn("buildkite-agent", ["artifact", "upload", glob], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: spawnTimeout,
    cwd,
  });
}

/**
 * @param {string} [glob]
 * @param {string} [step]
 */
export function listArtifactsFromBuildKite(glob, step) {
  const {
    cwd,
    timeouts: { spawnTimeout },
  } = getRunnerOptions();

  const args = [
    "artifact",
    "search",
    "--no-color",
    "--allow-empty-results",
    "--include-retried-jobs",
    "--format",
    "%p\n",
    glob || "*",
  ];
  if (step) {
    args.push("--step", step);
  }
  const { error, status, signal, stdout, stderr } = spawnSync("buildkite-agent", args, {
    stdio: ["ignore", "ignore", "ignore"],
    encoding: "utf-8",
    timeout: spawnTimeout,
    cwd,
  });
  if (status === 0) {
    return stdout?.split("\n").map(line => line.trim()) || [];
  }
  const cause = error ?? signal ?? `code ${status}`;
  console.warn("Failed to list artifacts from BuildKite:", cause, stderr);
  return [];
}

/**
 * @typedef {object} BuildkiteAnnotation
 * @property {string} label
 * @property {string} content
 * @property {"error" | "warning" | "info"} [style]
 * @property {number} [priority]
 * @property {number} [attempt]
 */

/**
 * @param {BuildkiteAnnotation} annotation
 */
export function reportAnnotationToBuildKite({ label, content, style = "error", priority = 3, attempt = 0 }) {
  const {
    cwd,
    timeouts: { spawnTimeout },
  } = getRunnerOptions();
  const { error, status, signal, stderr } = spawnSync(
    "buildkite-agent",
    ["annotate", "--append", "--style", `${style}`, "--context", `${label}`, "--priority", `${priority}`],
    {
      input: content,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
      timeout: spawnTimeout,
      cwd,
    },
  );
  if (status === 0) {
    return;
  }
  if (attempt > 0) {
    const cause = error ?? signal ?? `code ${status}`;
    throw new Error(`Failed to create annotation: ${label}`, { cause });
  }
  const buildLabel = getTestLabel();
  const buildUrl = getBuildUrl();
  const platform = buildUrl ? `<a href="${buildUrl}">${buildLabel}</a>` : buildLabel;
  let errorMessage = `<details><summary><a><code>${label}</code></a> - annotation error on ${platform}</summary>`;
  if (stderr) {
    errorMessage += `\n\n\`\`\`terminal\n${escapeCodeBlock(stderr)}\n\`\`\`\n\n</details>\n\n`;
  }
  reportAnnotationToBuildKite({ label: `${label}-error`, content: errorMessage, attempt: attempt + 1 });
}

export { isBuildkite } from "../../../scripts/utils.mjs";
