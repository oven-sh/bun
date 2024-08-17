#!/usr/bin/env node

import { createHash } from "node:crypto";
import { isBuildKite, isGithubAction } from "./env.mjs";

/**
 * Gets the label for the current build.
 * @returns {string | undefined}
 */
export function getBuildLabel() {
  if (isBuildKite) {
    return process.env["BUILDKITE_GROUP_LABEL"] || process.env["BUILDKITE_LABEL"];
  }

  if (isGithubAction) {
    return process.env["GITHUB_WORKFLOW"];
  }
}

/**
 * Gets the URL for the current build.
 * @returns {string | undefined}
 */
export function getBuildUrl() {
  if (isBuildKite) {
    const buildUrl = process.env["BUILDKITE_BUILD_URL"];
    const jobId = process.env["BUILDKITE_JOB_ID"];
    if (buildUrl) {
      return jobId ? `${buildUrl}#${jobId}` : buildUrl;
    }
  }

  if (isGithubAction) {
    const baseUrl = process.env["GITHUB_SERVER_URL"];
    const repository = process.env["GITHUB_REPOSITORY"];
    const runId = process.env["GITHUB_RUN_ID"];
    if (baseUrl && repository && runId) {
      return `${baseUrl}/${repository}/actions/runs/${runId}`;
    }
  }
}

/**
 * Gets the unique build ID.
 * @returns {string | undefined}
 */
export function getBuildId() {
  if (isBuildKite) {
    return process.env["BUILDKITE_BUILD_NUMBER"];
  }

  if (isGithubAction) {
    return process.env["GITHUB_RUN_ID"];
  }
}

/**
 * Gets the name of the current build step.
 * @returns {string | undefined}
 */
export function getBuildStep() {
  if (isBuildKite) {
    return process.env["BUILDKITE_STEP_KEY"];
  }
}

/**
 * Gets the number of retries for the current build.
 * @returns {number | undefined}
 */
export function getBuildRetries() {
  if (isBuildKite) {
    return parseInt(process.env["BUILDKITE_RETRY_COUNT"]);
  }

  if (isGithubAction) {
    return parseInt(process.env["GITHUB_RUN_ATTEMPT"]);
  }
}

/**
 * Gets a source URL for the given file and line, if any.
 * @param {string} file
 * @param {number} [line]
 * @returns {string | undefined}
 */
export function getSourceUrl(file, line) {
  const filePath = file.replace(/\\/g, "/");

  let url;
  if (pullRequest) {
    const fileMd5 = createHash("md5").update(filePath).digest("hex");
    url = `${baseUrl}/${repository}/pull/${pullRequest}/files#diff-${fileMd5}`;
    if (line !== undefined) {
      url += `L${line}`;
    }
  } else if (gitSha) {
    url = `${baseUrl}/${repository}/blob/${gitSha}/${filePath}`;
    if (line !== undefined) {
      url += `#L${line}`;
    }
  }

  return url;
}
