import { isBuildkite } from "../../machine/executor/buildkite.ts";
import { getWindowsExitReason } from "../../../scripts/utils.mjs";

export function unescapeGitHubAction(string: string) {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

/**
 * @param {string} color
 * @returns {string}
 */
export function getAnsi(color: string) {
  switch (color) {
    case "red":
      return "\x1b[31m";
    case "green":
      return "\x1b[32m";
    case "yellow":
      return "\x1b[33m";
    case "blue":
      return "\x1b[34m";
    case "reset":
      return "\x1b[0m";
    case "gray":
      return "\x1b[90m";
    default:
      return "";
  }
}

/**
 * @param {string} string
 * @returns {string}
 */
export function stripAnsi(string: string) {
  return string.replace(/\u001b\[\d+m/g, "");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapeHtml(string: string) {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapeCodeBlock(string: string) {
  return string.replace(/`/g, "\\`");
}

/**
 * @param {string} string
 * @returns {number | undefined}
 */
export function parseDuration(duration: string): number | undefined {
  const match = /(\d+\.\d+)(m?s)/.exec(duration);
  if (!match) {
    return undefined;
  }
  const [, value, unit] = match;
  return parseFloat(value) * (unit === "ms" ? 1 : 1000);
}

/**
 * @param {"pass" | "fail" | "cancel"} [outcome]
 */
export function getExitCode(outcome: string) {
  if (outcome === "pass") {
    return 0;
  }
  if (!isBuildkite) {
    return 1;
  }
  // On Buildkite, you can define a `soft_fail` property to differentiate
  // from failing tests and the runner itself failing.
  if (outcome === "fail") {
    return 2;
  }
  if (outcome === "cancel") {
    return 3;
  }
  return 1;
}

export { getWindowsExitReason };
