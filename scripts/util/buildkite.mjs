#!/usr/bin/env node

import { isDebug } from "./env.mjs";
import { relative, dirname, mkdir } from "./fs.mjs";
import { spawn, spawnSync } from "./spawn.mjs";
import { emitWarning, isBusy } from "./util.mjs";

/**
 * Uploads an artifact to buildkite.
 * @param {string} path
 * @param {string} [cwd]
 */
export async function uploadArtifact(path, cwd = dirname(path)) {
  const filename = relative(cwd, path);
  const args = ["artifact", "upload", filename];
  if (isDebug) {
    args.push("--log-level", "debug");
  }

  await spawn("buildkite-agent", args, { cwd });
}

/**
 * @typedef {Object} BuildkiteDownloadArtifactOptions
 * @property {string} step
 * @property {string} [filename]
 * @property {string} [cwd]
 * @property {number} [retries]
 */

/**
 * Downloads an artifact from buildkite.
 * @param {BuildkiteDownloadArtifactOptions} options
 */
export async function downloadArtifact(options) {
  const { step, filename, cwd, retries = 5 } = options;

  const args = ["artifact", "download", "--step", step, filename || "**", "."];
  if (isDebug) {
    args.push("--log-level", "debug");
  }

  mkdir(cwd);
  for (let i = retries; i > 0; i--) {
    try {
      await spawn("buildkite-agent", args, { cwd });
      return;
    } catch (cause) {
      if (i === 0) {
        throw cause;
      }
      emitWarning(cause);
      if (isBusy(cause)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
    }
  }
}

/**
 * @typedef {Object} BuildkiteSecretOptions
 * @param {boolean} [redact]
 */

/**
 * Gets a secret from Buildkite.
 * @param {string} name
 * @param {BuildkiteSecretOptions} [options]
 * @returns {string | undefined}
 */
export function getSecret(name, options = {}) {
  const { redact } = options;
  const args = ["secret", "get", name];
  if (redact === false) {
    args.push("--skip-redaction");
  }

  const { exitCode, stdout } = spawnSync("buildkite-agent", args, { throwOnError: false });
  if (exitCode === 0) {
    return stdout.trim() || undefined;
  }
}

/**
 * Gets metadata from Buildkite.
 * @param {string} name
 * @returns {string | undefined}
 */
export function getMetadata(name) {
  const { exitCode, stdout } = spawnSync("buildkite-agent", ["meta-data", "get", name], {
    throwOnError: false,
  });

  if (exitCode === 0) {
    return stdout.trim() || undefined;
  }
}

/**
 * Sets metadata in Buildkite.
 * @param {string} name
 * @param {string} value
 */
export function setMetadata(name, value) {
  spawnSync("buildkite-agent", ["meta-data", "set", name], {
    input: value,
  });
}

/**
 * @typedef {Object} BuildkiteAnnotateOptions
 * @property {string} context
 * @property {"success" | "info" | "warning" | "error"} [style]
 * @property {boolean} [append]
 * @property {number} [priority]
 */

/**
 * Annotates a build in Buildkite.
 * @param {string} content
 * @param {BuildkiteAnnotateOptions} options
 * @returns {Promise<void>}
 */
export async function addAnnotation(content, options = {}) {
  const { context, style, append, priority } = options;
  const args = [
    "annotate",
    context && `--context=${context}`,
    style && `--style=${style}`,
    append && "--append",
    priority && `--priority=${priority}`,
  ];

  await spawn("buildkite-agent", args.filter(Boolean), {
    input: content || "An error occurred",
  });
}

/**
 * Removes an annotation from a build in Buildkite.
 * @param {string} context
 */
export async function removeAnnotation(context) {
  await spawn("buildkite-agent", ["annotate", "remove", context]);
}
