// Contains utility functions for various scripts, including:
// CI, running tests, and code generation.

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { hostname, homedir as nodeHomedir, tmpdir as nodeTmpdir, release, userInfo } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isPosix = isMacOS || isLinux;

export const isArm64 = process.arch === "arm64";
export const isX64 = process.arch === "x64";

/**
 * @param {string} name
 * @param {boolean} [required]
 * @returns {string}
 */
export function getEnv(name, required = true) {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(`Environment variable is missing: ${name}`);
  }

  return value;
}

export const isBuildkite = getEnv("BUILDKITE", false) === "true";
export const isGithubAction = getEnv("GITHUB_ACTIONS", false) === "true";
export const isCI = getEnv("CI", false) === "true" || isBuildkite || isGithubAction;
export const isDebug = getEnv("DEBUG", false) === "1";

/**
 * @param {string} name
 * @param {object} [options]
 * @param {boolean} [options.required]
 * @param {boolean} [options.redact]
 * @returns {string}
 */
export function getSecret(name, options = { required: true, redact: true }) {
  const value = getEnv(name, false);
  if (value) {
    return value;
  }

  if (isBuildkite) {
    const command = ["buildkite-agent", "secret", "get", name];
    if (options["redact"] === false) {
      command.push("--skip-redaction");
    }

    const { error, stdout } = spawnSync(command);
    const secret = stdout.trim();
    if (error || !secret) {
      const orgId = getEnv("BUILDKITE_ORGANIZATION_SLUG", false);
      const clusterId = getEnv("BUILDKITE_CLUSTER_ID", false);

      let hint;
      if (orgId && clusterId) {
        hint = `https://buildkite.com/organizations/${orgId}/clusters/${clusterId}/secrets`;
      } else {
        hint = "https://buildkite.com/docs/pipelines/buildkite-secrets";
      }

      throw new Error(`Secret not found: ${name} (hint: go to ${hint} and create a secret)`, { cause: error });
    }

    setEnv(name, secret);
    return secret;
  }

  return getEnv(name, options["required"]);
}

/**
 * @param  {...unknown} args
 */
export function debugLog(...args) {
  if (isDebug) {
    console.log(...args);
  }
}

/**
 * @param {string} name
 * @param {string | undefined} value
 */
export function setEnv(name, value) {
  process.env[name] = value;

  if (isGithubAction && !/^GITHUB_/i.test(name)) {
    const envFilePath = process.env["GITHUB_ENV"];
    if (envFilePath) {
      const delimeter = Math.random().toString(36).substring(2, 15);
      const content = `${name}<<${delimeter}\n${value}\n${delimeter}\n`;
      appendFileSync(outputPath, content);
    }
  }
}

/**
 * @typedef {object} SpawnOptions
 * @property {string} [cwd]
 * @property {number} [timeout]
 * @property {Record<string, string | undefined>} [env]
 * @property {boolean | ((error: Error) => boolean)} [throwOnError]
 * @property {(error: Error) => boolean} [retryOnError]
 * @property {string} [stdin]
 * @property {boolean} [privileged]
 */

/**
 * @typedef {object} SpawnResult
 * @property {number} exitCode
 * @property {number} [signalCode]
 * @property {string} stdout
 * @property {string} stderr
 * @property {Error} [error]
 */

/**
 * @param {TemplateStringsArray} strings
 * @param {...any} values
 * @returns {string[]}
 */
export function $(strings, ...values) {
  const result = [];
  for (let i = 0; i < strings.length; i++) {
    result.push(...strings[i].trim().split(/\s+/).filter(Boolean));
    if (i < values.length) {
      const value = values[i];
      if (Array.isArray(value)) {
        result.push(...value);
      } else if (typeof value === "string") {
        if (result.at(-1)?.endsWith("=")) {
          result[result.length - 1] += value;
        } else {
          result.push(value);
        }
      }
    }
  }
  return result;
}

/**
 * @param {string[]} command
 * @param {SpawnOptions} options
 */
function parseCommand(command, options) {
  if (options?.privileged) {
    return [...getPrivilegedCommand(), ...command];
  }
  return command;
}

/** @type {string[] | undefined} */
let priviledgedCommand;

/**
 * @returns {string[]}
 */
function getPrivilegedCommand() {
  if (typeof priviledgedCommand !== "undefined") {
    return priviledgedCommand;
  }

  if (isWindows) {
    return (priviledgedCommand = []);
  }

  const sudo = ["sudo", "-n"];
  const { error: sudoError } = spawnSync([...sudo, "true"]);
  if (!sudoError) {
    return (priviledgedCommand = sudo);
  }

  const su = ["su", "-s", "sh", "root", "-c"];
  const { error: suError } = spawnSync([...su, "true"]);
  if (!suError) {
    return (priviledgedCommand = su);
  }

  const doas = ["doas", "-u", "root"];
  const { error: doasError } = spawnSync([...doas, "true"]);
  if (!doasError) {
    return (priviledgedCommand = doas);
  }

  return (priviledgedCommand = []);
}

/** @type {boolean | undefined} */
let privileged;

/**
 * @returns {boolean}
 */
export function isPrivileged() {
  if (typeof privileged !== "undefined") {
    return privileged;
  }

  const command = getPrivilegedCommand();
  if (command.length) {
    const { error } = spawnSync(command);
    privileged = !error;
  } else {
    privileged = false;
  }

  return privileged;
}

/**
 * @param {string[]} command
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
export async function spawn(command, options = {}) {
  const [cmd, ...args] = parseCommand(command, options);
  debugLog("$", cmd, ...args);

  const stdin = options["stdin"];
  const spawnOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    timeout: options["timeout"] ?? undefined,
    env: options["env"] ?? undefined,
    stdio: stdin === "inherit" ? "inherit" : [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    ...options,
  };

  let exitCode = 1;
  let signalCode;
  let stdout = "";
  let stderr = "";
  let error;

  const result = new Promise((resolve, reject) => {
    const subprocess = nodeSpawn(cmd, args, spawnOptions);

    if (typeof stdin !== "undefined") {
      subprocess.stdin?.on("error", error => {
        if (error.code !== "EPIPE") {
          reject(error);
        }
      });
      subprocess.stdin?.write(stdin);
      subprocess.stdin?.end();
    }

    subprocess.stdout?.on("data", chunk => {
      stdout += chunk;
    });
    subprocess.stderr?.on("data", chunk => {
      stderr += chunk;
    });

    subprocess.on("error", error => reject(error));
    subprocess.on("exit", (code, signal) => {
      exitCode = code;
      signalCode = signal;
      resolve();
    });
  });

  try {
    await result;
  } catch (cause) {
    error = cause;
  }

  if (exitCode !== 0 && isWindows) {
    const exitReason = getWindowsExitReason(exitCode);
    if (exitReason) {
      signalCode = exitReason;
    }
  }

  if (error || signalCode || exitCode !== 0) {
    const description = command.map(arg => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
    const cause = error || stderr.trim() || stdout.trim() || undefined;

    if (signalCode) {
      error = new Error(`Command killed with ${signalCode}: ${description}`, { cause });
    } else {
      error = new Error(`Command exited with code ${exitCode}: ${description}`, { cause });
    }
  }

  if (error) {
    const retryOnError = options["retryOnError"];
    if (typeof retryOnError === "function") {
      if (retryOnError(error)) {
        return spawn(command, options);
      }
    }

    const throwOnError = options["throwOnError"];
    if (typeof throwOnError === "function") {
      if (throwOnError(error)) {
        throw error;
      }
    } else if (throwOnError) {
      throw error;
    }
  }

  return {
    exitCode,
    signalCode,
    stdout,
    stderr,
    error,
  };
}

/**
 * @param {string[]} command
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
export async function spawnSafe(command, options = {}) {
  return spawn(command, { throwOnError: true, ...options });
}

/**
 * @param {string[]} command
 * @param {SpawnOptions} options
 * @returns {SpawnResult}
 */
export function spawnSync(command, options = {}) {
  const [cmd, ...args] = parseCommand(command, options);
  debugLog("$", cmd, ...args);

  const stdin = options["stdin"];
  const spawnOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    timeout: options["timeout"] ?? undefined,
    env: options["env"] ?? undefined,
    stdio: stdin === "inherit" ? "inherit" : [typeof stdin === "undefined" ? "ignore" : "pipe", "pipe", "pipe"],
    input: stdin,
    ...options,
  };

  let exitCode = 1;
  let signalCode;
  let stdout = "";
  let stderr = "";
  let error;

  let result;
  try {
    result = nodeSpawnSync(cmd, args, spawnOptions);
  } catch (error) {
    result = { error };
  }

  const { error: spawnError, status, signal, stdout: stdoutBuffer, stderr: stderrBuffer } = result;
  if (spawnError) {
    error = spawnError;
  } else {
    exitCode = status ?? 1;
    signalCode = signal || undefined;
    stdout = stdoutBuffer?.toString?.() ?? "";
    stderr = stderrBuffer?.toString?.() ?? "";
  }

  if (exitCode !== 0 && isWindows) {
    const exitReason = getWindowsExitReason(exitCode);
    if (exitReason) {
      signalCode = exitReason;
    }
  }

  if (error || signalCode || exitCode !== 0) {
    const description = command.map(arg => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
    const cause = error || stderr?.trim() || stdout?.trim() || undefined;

    if (signalCode) {
      error = new Error(`Command killed with ${signalCode}: ${description}`, { cause });
    } else {
      error = new Error(`Command exited with code ${exitCode}: ${description}`, { cause });
    }
  }

  if (error) {
    const retryOnError = options["retryOnError"];
    if (typeof retryOnError === "function") {
      if (retryOnError(error)) {
        return spawn(command, options);
      }
    }

    const throwOnError = options["throwOnError"];
    if (typeof throwOnError === "function") {
      if (throwOnError(error)) {
        throw error;
      }
    } else if (throwOnError) {
      throw error;
    }
  }

  return {
    exitCode,
    signalCode,
    stdout,
    stderr,
    error,
  };
}

/**
 * @param {string[]} command
 * @param {SpawnOptions} options
 * @returns {SpawnResult}
 */
export function spawnSyncSafe(command, options = {}) {
  return spawnSync(command, { throwOnError: true, ...options });
}

/**
 * @param {number} exitCode
 * @returns {string | undefined}
 */
export function getWindowsExitReason(exitCode) {
  const windowsKitPath = "C:\\Program Files (x86)\\Windows Kits";
  if (!existsSync(windowsKitPath)) {
    return;
  }

  const windowsKitPaths = readdirSync(windowsKitPath)
    .filter(filename => isFinite(parseInt(filename)))
    .sort((a, b) => parseInt(b) - parseInt(a));

  let ntStatusPath;
  for (const windowsKitPath of windowsKitPaths) {
    const includePath = `${windowsKitPath}\\Include`;
    if (!existsSync(includePath)) {
      continue;
    }

    const windowsSdkPaths = readdirSync(includePath).sort();
    for (const windowsSdkPath of windowsSdkPaths) {
      const statusPath = `${includePath}\\${windowsSdkPath}\\shared\\ntstatus.h`;
      if (existsSync(statusPath)) {
        ntStatusPath = statusPath;
        break;
      }
    }
  }

  if (!ntStatusPath) {
    return;
  }

  const nthStatus = readFile(ntStatusPath, { cache: true });
  const match = nthStatus.match(new RegExp(`(STATUS_\\w+).*0x${exitCode?.toString(16)}`, "i"));
  if (match) {
    const [, exitReason] = match;
    return exitReason;
  }
}

/**
 * @param {string | URL} url
 * @returns {URL | undefined}
 */
export function parseGitUrl(url) {
  const string = typeof url === "string" ? url : url.toString();

  const githubUrl = getEnv("GITHUB_SERVER_URL", false) || "https://github.com";
  if (/^git@github\.com:/.test(string)) {
    return new URL(string.slice(15).replace(/\.git$/, ""), githubUrl);
  }
  if (/^https:\/\/github\.com\//.test(string)) {
    return new URL(string.slice(19).replace(/\.git$/, ""), githubUrl);
  }
}

/**
 * @param {string | URL} url
 * @returns {string | undefined}
 */
export function parseGitRepository(url) {
  const parsed = parseGitUrl(url);
  if (parsed) {
    const { hostname, pathname } = parsed;
    if (hostname == "github.com") {
      return pathname.slice(1);
    }
  }
}

/**
 * @param {string} [cwd]
 * @returns {URL | undefined}
 */
export function getRepositoryUrl(cwd) {
  if (!cwd) {
    if (isBuildkite) {
      const repository = getEnv("BUILDKITE_REPO", false);
      if (repository) {
        return parseGitUrl(repository);
      }
    }

    if (isGithubAction) {
      const serverUrl = getEnv("GITHUB_SERVER_URL", false) || "https://github.com";
      const repository = getEnv("GITHUB_REPOSITORY", false);
      if (serverUrl && repository) {
        return parseGitUrl(new URL(repository, serverUrl));
      }
    }
  }

  const { error, stdout } = spawnSync(["git", "remote", "get-url", "origin"], { cwd });
  if (!error) {
    return parseGitUrl(stdout.trim());
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getRepository(cwd) {
  if (!cwd) {
    if (isGithubAction) {
      const repository = getEnv("GITHUB_REPOSITORY", false);
      if (repository) {
        return repository;
      }
    }
  }

  const url = getRepositoryUrl(cwd);
  if (url) {
    return parseGitRepository(url);
  }
}

/**
 * @returns {string | undefined}
 */
export function getPullRequestRepository() {
  if (isBuildkite) {
    const repository = getEnv("BUILDKITE_PULL_REQUEST_REPO", false);
    if (repository) {
      return parseGitRepository(repository);
    }
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getRepositoryOwner(cwd) {
  const repository = getRepository(cwd);
  if (repository) {
    const [owner] = repository.split("/");
    if (owner) {
      return owner;
    }
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getCommit(cwd) {
  if (!cwd) {
    if (isBuildkite) {
      const commit = getEnv("BUILDKITE_COMMIT", false);
      if (commit) {
        return commit;
      }
    }

    if (isGithubAction) {
      const commit = getEnv("GITHUB_SHA", false);
      if (commit) {
        return commit;
      }
    }
  }

  const { error, stdout } = spawnSync(["git", "rev-parse", "HEAD"], { cwd });
  if (!error) {
    return stdout.trim();
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getCommitMessage(cwd) {
  if (!cwd) {
    if (isBuildkite) {
      const message = getEnv("BUILDKITE_MESSAGE", false);
      if (message) {
        return message;
      }
    }
  }

  const { error, stdout } = spawnSync(["git", "log", "-1", "--pretty=%B"], { cwd });
  if (!error) {
    return stdout.trim();
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getBranch(cwd) {
  if (!cwd) {
    if (isBuildkite) {
      const branch = getEnv("BUILDKITE_BRANCH", false);
      if (branch) {
        return branch;
      }
    }

    if (isGithubAction) {
      const ref = getEnv("GITHUB_REF_NAME", false);
      if (ref) {
        return ref;
      }
    }
  }

  const { error, stdout } = spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (!error) {
    return stdout.trim();
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined}
 */
export function getMainBranch(cwd) {
  if (!cwd) {
    if (isBuildkite) {
      const branch = getEnv("BUILDKITE_PIPELINE_DEFAULT_BRANCH", false);
      if (branch) {
        return branch;
      }
    }

    if (isGithubAction) {
      const headRef = getEnv("GITHUB_HEAD_REF", false);
      if (headRef) {
        return headRef;
      }
    }
  }

  const { error, stdout } = spawnSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd });
  if (!error) {
    return stdout.trim().replace("refs/remotes/origin/", "");
  }
}

/**
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function isMainBranch(cwd) {
  return !isFork(cwd) && getBranch(cwd) === getMainBranch(cwd);
}

/**
 * @returns {boolean}
 */
export function isPullRequest() {
  if (isBuildkite) {
    return !isNaN(parseInt(getEnv("BUILDKITE_PULL_REQUEST", false)));
  }

  if (isGithubAction) {
    return /pull_request|merge_group/.test(getEnv("GITHUB_EVENT_NAME", false));
  }

  return false;
}

/**
 * @returns {number | undefined}
 */
export function getPullRequest() {
  if (isBuildkite) {
    const pullRequest = getEnv("BUILDKITE_PULL_REQUEST", false);
    if (pullRequest) {
      return parseInt(pullRequest);
    }
  }

  if (isGithubAction) {
    const eventPath = getEnv("GITHUB_EVENT_PATH", false);
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFile(eventPath, { cache: true }));
      const pullRequest = event["pull_request"];
      if (pullRequest) {
        return parseInt(pullRequest["number"]);
      }
    }
  }
}

/**
 * @returns {string | undefined}
 */
export function getTargetBranch() {
  if (isPullRequest()) {
    if (isBuildkite) {
      return getEnv("BUILDKITE_PULL_REQUEST_BASE_BRANCH", false);
    }

    if (isGithubAction) {
      return getEnv("GITHUB_BASE_REF", false);
    }
  }
}

/**
 * @returns {boolean}
 */
export function isFork() {
  if (isBuildkite) {
    const repository = getEnv("BUILDKITE_PULL_REQUEST_REPO", false);
    return !!repository && repository !== getEnv("BUILDKITE_REPO", false);
  }

  if (isGithubAction) {
    const eventPath = getEnv("GITHUB_EVENT_PATH", false);
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFile(eventPath, { cache: true }));
      const pullRequest = event["pull_request"];
      if (pullRequest) {
        return !!pullRequest["head"]["repo"]["fork"];
      }
    }
  }

  return false;
}

/**
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function isMergeQueue(cwd) {
  return /^gh-readonly-queue/.test(getBranch(cwd));
}

/**
 * @returns {string | undefined}
 */
export function getGithubToken() {
  const cachedToken = getSecret("GITHUB_TOKEN", { required: false });

  if (typeof cachedToken === "string" || !which("gh")) {
    return cachedToken || undefined;
  }

  const { error, stdout } = spawnSync(["gh", "auth", "token"]);
  const token = error ? "" : stdout.trim();

  setEnv("GITHUB_TOKEN", token);
  return token || undefined;
}

/**
 * @typedef {object} CurlOptions
 * @property {string} [method]
 * @property {string} [body]
 * @property {Record<string, string | undefined>} [headers]
 * @property {number} [timeout]
 * @property {boolean} [cache]
 * @property {number} [retries]
 * @property {boolean} [json]
 * @property {boolean} [arrayBuffer]
 * @property {string} [filename]
 */

/**
 * @typedef {object} CurlResult
 * @property {number} status
 * @property {string} statusText
 * @property {Error | undefined} error
 * @property {any} body
 */

/** @type {Record<string, CurlResult | undefined>} */
let cachedResults;

/**
 * @param {string} url
 * @param {CurlOptions} [options]
 * @returns {Promise<CurlResult>}
 */
export async function curl(url, options = {}) {
  let { hostname, href } = new URL(url);
  let method = options["method"] || "GET";
  let input = options["body"];
  let headers = options["headers"] || {};
  let retries = options["retries"] || 3;
  let json = options["json"];
  let arrayBuffer = options["arrayBuffer"];
  let filename = options["filename"];

  let cacheKey;
  let cache = options["cache"];
  if (cache) {
    cacheKey = `${method} ${href}`;
    if (cachedResults?.[cacheKey]) {
      return cachedResults[cacheKey];
    }
  }

  if (typeof headers["Authorization"] === "undefined") {
    if (hostname === "api.github.com" || hostname === "uploads.github.com") {
      const githubToken = getGithubToken();
      if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
      }
    }
  }

  let status;
  let statusText;
  let body;
  let error;
  for (let i = 0; i < retries; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }

    let response;
    try {
      response = await fetch(href, { method, headers, body: input });
    } catch (cause) {
      debugLog("$", "curl", href, "-> error");
      error = new Error(`Fetch failed: ${method} ${url}`, { cause });
      continue;
    }

    status = response["status"];
    statusText = response["statusText"];
    debugLog("$", "curl", href, "->", status, statusText);

    const ok = response["ok"];
    try {
      if (filename && ok) {
        const buffer = await response.arrayBuffer();
        writeFile(filename, new Uint8Array(buffer));
      } else if (arrayBuffer && ok) {
        body = await response.arrayBuffer();
      } else if (json && ok) {
        body = await response.json();
      } else {
        body = await response.text();
      }
    } catch (cause) {
      error = new Error(`Fetch failed: ${method} ${url}`, { cause });
      continue;
    }

    if (response["ok"]) {
      break;
    }

    error = new Error(`Fetch failed: ${method} ${url}: ${status} ${statusText}`, { cause: body });

    if (status === 400 || status === 404 || status === 422) {
      break;
    }
  }

  if (cacheKey) {
    cachedResults ||= {};
    cachedResults[cacheKey] = { status, statusText, error, body };
  }

  return {
    status,
    statusText,
    error,
    body,
  };
}

/**
 * @param {string} url
 * @param {CurlOptions} options
 * @returns {Promise<any>}
 */
export async function curlSafe(url, options) {
  const result = await curl(url, options);

  const { error, body } = result;
  if (error) {
    throw error;
  }

  return body;
}

/** @type {Record<string, string> | undefined} */
let cachedFiles;

/**
 * @param {string} filename
 * @param {object} [options]
 * @param {boolean} [options.cache]
 * @returns {string}
 */
export function readFile(filename, options = {}) {
  const absolutePath = resolve(filename);
  if (options["cache"]) {
    if (cachedFiles?.[absolutePath]) {
      return cachedFiles[absolutePath];
    }
  }

  debugLog("$", "cat", absolutePath);

  let content;
  try {
    content = readFileSync(absolutePath, "utf-8");
  } catch (cause) {
    throw new Error(`Read failed: ${absolutePath}`, { cause });
  }

  if (options["cache"]) {
    cachedFiles ||= {};
    cachedFiles[absolutePath] = content;
  }

  return content;
}

/**
 * @param {string} path
 * @param {number} mode
 */
export function chmod(path, mode) {
  debugLog("$", "chmod", path, mode);
  chmodSync(path, mode);
}

/**
 * @param {string} filename
 * @param {string | Buffer} content
 * @param {object} [options]
 * @param {number} [options.mode]
 */
export function writeFile(filename, content, options) {
  mkdir(dirname(filename));

  debugLog("$", "touch", filename);
  writeFileSync(filename, content);

  if (options?.mode) {
    chmod(filename, options.mode);
  }
}

/**
 * @param {string} source
 * @param {string} destination
 * @param {object} [options]
 * @param {number} [options.mode]
 */
export function copyFile(source, destination, options) {
  mkdir(dirname(destination));

  debugLog("$", "cp", source, destination);
  copyFileSync(source, destination);

  if (options?.mode) {
    chmod(destination, options.mode);
  }
}

/**
 * @param {string} path
 * @param {object} [options]
 * @param {number} [options.mode]
 */
export function mkdir(path, options = {}) {
  if (existsSync(path)) {
    return;
  }

  debugLog("$", "mkdir", path);
  mkdirSync(path, { ...options, recursive: true });
}

/**
 * @param {string} path
 */
export function rm(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return;
  }

  if (stats?.isDirectory()) {
    debugLog("$", "rm", "-rf", path);
    rmSync(path, { recursive: true, force: true });
  } else {
    debugLog("$", "rm", "-f", path);
    rmSync(path, { force: true });
  }
}

/**
 * @param {string | string[]} command
 * @param {object} [options]
 * @param {boolean} [options.required]
 * @returns {string | undefined}
 */
export function which(command, options = {}) {
  const commands = Array.isArray(command) ? command : [command];
  const executables = isWindows ? commands.flatMap(name => [name, `${name}.exe`, `${name}.cmd`]) : commands;

  const path = getEnv("PATH", false) || "";
  const binPaths = path.split(isWindows ? ";" : ":");

  for (const binPath of binPaths) {
    for (const executable of executables) {
      const executablePath = join(binPath, executable);
      if (existsSync(executablePath)) {
        return executablePath;
      }
    }
  }

  if (options["required"]) {
    const description = commands.join(" or ");
    throw new Error(`Command not found: ${description}`);
  }
}

/**
 * @typedef {object} GitRef
 * @property {string} [repository]
 * @property {string} [commit]
 */

/**
 * @param {string} [cwd]
 * @param {string | GitRef} [base]
 * @param {string | GitRef} [head]
 * @returns {Promise<string[] | undefined>}
 */
export async function getChangedFiles(cwd, base, head) {
  const repository = getRepository(cwd);
  head ||= getCommit(cwd);
  base ||= `${head}^1`;

  const url = new URL(`repos/${repository}/compare/${base}...${head}`, getGithubApiUrl());
  const { error, body } = await curl(url, { json: true });

  if (error) {
    console.warn("Failed to list changed files:", error);
    return;
  }

  const { files } = body;
  return files.filter(({ status }) => !/removed|unchanged/i.test(status)).map(({ filename }) => filename);
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isDocumentation(filename) {
  if (/^(docs|bench|examples|misctools|\.vscode)/.test(filename)) {
    return true;
  }

  if (!/^(src|test|vendor)/.test(filename) && /\.(md|txt)$/.test(filename)) {
    return true;
  }

  return false;
}

/**
 * @returns {string | undefined}
 */
export function getBuildId() {
  if (isBuildkite) {
    return getEnv("BUILDKITE_BUILD_ID");
  }

  if (isGithubAction) {
    return getEnv("GITHUB_RUN_ID");
  }
}

/**
 * @returns {number | undefined}
 */
export function getBuildNumber() {
  if (isBuildkite) {
    return parseInt(getEnv("BUILDKITE_BUILD_NUMBER"));
  }

  if (isGithubAction) {
    return parseInt(getEnv("GITHUB_RUN_ID"));
  }
}

/**
 * @returns {URL | undefined}
 */
export function getBuildUrl() {
  if (isBuildkite) {
    const buildUrl = getEnv("BUILDKITE_BUILD_URL");
    const jobId = getEnv("BUILDKITE_JOB_ID");
    return new URL(`#${jobId}`, buildUrl);
  }

  if (isGithubAction) {
    const baseUrl = getEnv("GITHUB_SERVER_URL", false) || "https://github.com";
    const repository = getEnv("GITHUB_REPOSITORY");
    const runId = getEnv("GITHUB_RUN_ID");
    return new URL(`${repository}/actions/runs/${runId}`, baseUrl);
  }
}

/**
 * @returns {string | undefined}
 */
export function getBuildLabel() {
  if (isBuildkite) {
    const label = getEnv("BUILDKITE_LABEL", false) || getEnv("BUILDKITE_GROUP_LABEL", false);
    if (label) {
      return label;
    }
  }

  if (isGithubAction) {
    const label = getEnv("GITHUB_WORKFLOW", false);
    if (label) {
      return label;
    }
  }
}

/**
 * @returns {boolean | undefined}
 */
export function isBuildManual() {
  if (isBuildkite) {
    const buildSource = getEnv("BUILDKITE_SOURCE", false);
    if (buildSource) {
      const buildId = getEnv("BUILDKITE_REBUILT_FROM_BUILD_ID", false);
      return buildSource === "ui" && !buildId;
    }
  }
}

/**
 * @param {string} [os]
 * @returns {number}
 */
export function getBootstrapVersion(os) {
  const scriptPath = join(
    import.meta.dirname,
    os === "windows" || (!os && isWindows) ? "bootstrap.ps1" : "bootstrap.sh",
  );
  const scriptContent = readFile(scriptPath, { cache: true });
  const match = /# Version: (\d+)/.exec(scriptContent);
  if (match) {
    const [, version] = match;
    return parseInt(version);
  }
  return 0;
}

/**
 * @typedef {object} BuildArtifact
 * @property {string} [job]
 * @property {string} filename
 * @property {string} url
 */

/**
 * @returns {Promise<BuildArtifact[] | undefined>}
 */
export async function getBuildArtifacts() {
  const buildId = await getBuildkiteBuildNumber();
  if (buildId) {
    return getBuildkiteArtifacts(buildId);
  }
}

/**
 * @returns {Promise<number | undefined>}
 */
export async function getBuildkiteBuildNumber() {
  if (isBuildkite) {
    const number = parseInt(getEnv("BUILDKITE_BUILD_NUMBER", false));
    if (!isNaN(number)) {
      return number;
    }
  }

  const repository = getRepository();
  const commit = getCommit();
  if (!repository || !commit) {
    return;
  }

  const url = new URL(`repos/${repository}/commits/${commit}/statuses`, getGithubApiUrl());
  const { status, error, body } = await curl(url, { json: true });
  if (status === 404) {
    return;
  }
  if (error) {
    throw error;
  }

  for (const { target_url: url } of body) {
    const { hostname, pathname } = new URL(url);
    if (hostname === "buildkite.com") {
      const buildId = parseInt(pathname.split("/").pop());
      if (!isNaN(buildId)) {
        return buildId;
      }
    }
  }
}

/**
 * @param {string} buildId
 * @returns {Promise<BuildArtifact[]>}
 */
export async function getBuildkiteArtifacts(buildId) {
  const orgId = getEnv("BUILDKITE_ORGANIZATION_SLUG", false) || "bun";
  const pipelineId = getEnv("BUILDKITE_PIPELINE_SLUG", false) || "bun";
  const { jobs } = await curlSafe(`https://buildkite.com/${orgId}/${pipelineId}/builds/${buildId}.json`, {
    json: true,
  });

  const artifacts = await Promise.all(
    jobs.map(async ({ id: jobId, step_key: jobKey }) => {
      const artifacts = await curlSafe(
        `https://buildkite.com/organizations/${orgId}/pipelines/${pipelineId}/builds/${buildId}/jobs/${jobId}/artifacts`,
        { json: true },
      );

      return artifacts.map(({ path, url }) => {
        return {
          job: jobKey,
          filename: path,
          url: new URL(url, "https://buildkite.com/").toString(),
        };
      });
    }),
  );

  return artifacts.flat();
}

/**
 * @param {string} [filename]
 * @param {number} [line]
 * @returns {URL | undefined}
 */
export function getFileUrl(filename, line) {
  let cwd;
  if (filename?.startsWith("vendor")) {
    const parentPath = resolve(dirname(filename));
    const { error, stdout } = spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: parentPath });
    if (error) {
      return;
    }
    cwd = stdout.trim();
  }

  const baseUrl = getRepositoryUrl(cwd);
  if (!filename) {
    return baseUrl;
  }

  const filePath = (cwd ? relative(cwd, filename) : filename).replace(/\\/g, "/");
  const commit = getCommit(cwd);
  const url = new URL(`blob/${commit}/${filePath}`, `${baseUrl}/`).toString();
  if (typeof line !== "undefined") {
    return new URL(`#L${line}`, url);
  }
  return url;
}

/**
 * @typedef {object} BuildkiteBuild
 * @property {string} id
 * @property {string} commit_id
 * @property {string} branch_name
 */

/**
 * @returns {Promise<BuildkiteBuild | undefined>}
 */
export async function getLastSuccessfulBuild() {
  if (isBuildkite) {
    let depth = 0;
    let url = getBuildUrl();
    if (url) {
      url.hash = "";
    }

    while (url) {
      const { error, body } = await curl(`${url}.json`, { json: true, cache: true });
      if (error) {
        return;
      }

      const { state, prev_branch_build: previousBuild, steps } = body;
      if (depth++) {
        if (state === "failed" || state === "passed" || state === "canceled") {
          const buildSteps = steps.filter(({ label }) => label.endsWith("build-bun"));
          if (buildSteps.length) {
            if (buildSteps.every(({ outcome }) => outcome === "passed")) {
              return body;
            }
            return;
          }
        }
      }

      if (!previousBuild) {
        return;
      }

      url = new URL(previousBuild["url"], url);
    }
  }
}

/**
 * @param {string} filename
 * @param {string} [cwd]
 */
export async function uploadArtifact(filename, cwd) {
  if (isBuildkite) {
    const relativePath = relative(cwd ?? process.cwd(), filename);
    await spawnSafe(["buildkite-agent", "artifact", "upload", relativePath], { cwd, stdio: "inherit" });
  }
}

/**
 * @param {string} string
 * @returns {string}
 */
export function stripAnsi(string) {
  return string.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapeYaml(string) {
  if (/[:"{}[\],&*#?|\-<>=!%@`]/.test(string)) {
    return `"${string.replace(/"/g, '\\"')}"`;
  }
  return string;
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapeGitHubAction(string) {
  return string.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function unescapeGitHubAction(string) {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapeHtml(string) {
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
export function escapeCodeBlock(string) {
  return string.replace(/`/g, "\\`");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function escapePowershell(string) {
  return string.replace(/'/g, "''").replace(/`/g, "``");
}

/**
 * @returns {string}
 */
export function homedir() {
  return nodeHomedir();
}

/**
 * @returns {string}
 */
export function tmpdir() {
  if (isWindows) {
    for (const key of ["TMPDIR", "TEMP", "TEMPDIR", "TMP", "RUNNER_TEMP"]) {
      const tmpdir = getEnv(key, false);
      if (!tmpdir || /cygwin|cygdrive/i.test(tmpdir) || !/^[a-z]/i.test(tmpdir)) {
        continue;
      }
      return normalizeWindows(tmpdir);
    }

    const appData = process.env["LOCALAPPDATA"];
    if (appData) {
      const appDataTemp = join(appData, "Temp");
      if (existsSync(appDataTemp)) {
        return appDataTemp;
      }
    }
  }

  if (isMacOS || isLinux) {
    if (existsSync("/tmp")) {
      return "/tmp";
    }
  }

  return nodeTmpdir();
}

/**
 * @param {string} [prefix]
 * @param {string} [filename]
 * @returns {string}
 */
export function mkdtemp(prefix, filename) {
  const tmpPath = mkdtempSync(join(tmpdir(), prefix || "bun-"));
  return filename ? join(tmpPath, filename) : tmpPath;
}

/**
 * @param {string} filename
 * @param {string} [output]
 * @returns {Promise<string>}
 */
export async function unzip(filename, output) {
  const destination = output || mkdtempSync(join(tmpdir(), "unzip-"));
  if (isWindows) {
    const command = `Expand-Archive -Force -LiteralPath "${escapePowershell(filename)}" -DestinationPath "${escapePowershell(destination)}"`;
    await spawnSafe(["powershell", "-Command", command]);
  } else {
    await spawnSafe(["unzip", "-o", filename, "-d", destination]);
  }
  return destination;
}

/**
 * @param {string} value
 * @returns {boolean | undefined}
 */
export function parseBoolean(value) {
  if (/^(true|yes|1|on)$/i.test(value)) {
    return true;
  }
  if (/^(false|no|0|off)$/i.test(value)) {
    return false;
  }
}

/**
 * @param {string} value
 * @returns {number | undefined}
 */
export function parseNumber(value) {
  const number = Number(value);
  if (!isNaN(number)) {
    return number;
  }
}

/**
 * @param {string} string
 * @returns {"darwin" | "linux" | "windows"}
 */
export function parseOs(string) {
  if (/darwin|apple|mac/i.test(string)) {
    return "darwin";
  }
  if (/linux/i.test(string)) {
    return "linux";
  }
  if (/win/i.test(string)) {
    return "windows";
  }
  throw new Error(`Unsupported operating system: ${string}`);
}

/**
 * @returns {"darwin" | "linux" | "windows"}
 */
export function getOs() {
  return parseOs(process.platform);
}

/**
 * @param {string} string
 * @returns {"x64" | "aarch64"}
 */
export function parseArch(string) {
  if (/x64|amd64|x86_64/i.test(string)) {
    return "x64";
  }
  if (/arm64|aarch64/i.test(string)) {
    return "aarch64";
  }
  throw new Error(`Unsupported architecture: ${string}`);
}

/**
 * @returns {"x64" | "aarch64"}
 */
export function getArch() {
  return parseArch(process.arch);
}

/**
 * @returns {string | undefined}
 */
export function getKernel() {
  if (isWindows) {
    return;
  }

  const kernel = release();
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(kernel);

  if (match) {
    const [, major, minor, patch] = match;
    if (patch) {
      return `${major}.${minor}.${patch}`;
    }
    return `${major}.${minor}`;
  }

  return kernel;
}

/**
 * @returns {"musl" | "gnu" | undefined}
 */
export function getAbi() {
  if (!isLinux) {
    return;
  }

  if (existsSync("/etc/alpine-release")) {
    return "musl";
  }

  const arch = getArch() === "x64" ? "x86_64" : "aarch64";
  const muslLibPath = `/lib/ld-musl-${arch}.so.1`;
  if (existsSync(muslLibPath)) {
    return "musl";
  }

  const gnuLibPath = `/lib/ld-linux-${arch}.so.2`;
  if (existsSync(gnuLibPath)) {
    return "gnu";
  }

  const { error, stdout } = spawnSync(["ldd", "--version"]);
  if (!error) {
    if (/musl/i.test(stdout)) {
      return "musl";
    }
    if (/gnu|glibc/i.test(stdout)) {
      return "gnu";
    }
  }
}

/**
 * @returns {string | undefined}
 */
export function getAbiVersion() {
  if (!isLinux) {
    return;
  }

  const { error, stdout } = spawnSync(["ldd", "--version"]);
  if (!error) {
    const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
    if (match) {
      const [, major, minor, patch] = match;
      if (patch) {
        return `${major}.${minor}.${patch}`;
      }
      return `${major}.${minor}`;
    }
  }
}

/**
 * @typedef {object} Target
 * @property {"darwin" | "linux" | "windows"} os
 * @property {"x64" | "aarch64"} arch
 * @property {"musl"} [abi]
 * @property {boolean} [baseline]
 * @property {boolean} profile
 * @property {string} label
 */

/**
 * @param {string} string
 * @returns {Target}
 */
export function parseTarget(string) {
  const os = parseOs(string);
  const arch = parseArch(string);
  const abi = os === "linux" && string.includes("-musl") ? "musl" : undefined;
  const baseline = arch === "x64" ? string.includes("-baseline") : undefined;
  const profile = string.includes("-profile");

  let label = `${os}-${arch}`;
  if (abi) {
    label += `-${abi}`;
  }
  if (baseline) {
    label += "-baseline";
  }
  if (profile) {
    label += "-profile";
  }

  return { label, os, arch, abi, baseline, profile };
}

/**
 * @param {string} target
 * @param {string} [release]
 * @returns {Promise<URL>}
 */
export async function getTargetDownloadUrl(target, release) {
  const { label, os, arch, abi, baseline } = parseTarget(target);
  const baseUrl = "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/";
  const filename = `bun-${label}.zip`;

  const exists = async url => {
    const { status } = await curl(url, { method: "HEAD" });
    return status !== 404;
  };

  if (!release || /^(stable|latest|canary)$/i.test(release)) {
    const tag = release === "canary" ? "canary" : "latest";
    const url = new URL(`${tag}/${filename}`, baseUrl);
    if (await exists(url)) {
      return url;
    }
  }

  if (/^(bun-v|v)?(\d+\.\d+\.\d+)$/i.test(release)) {
    const [, major, minor, patch] = /(\d+)\.(\d+)\.(\d+)/i.exec(release);
    const url = new URL(`bun-v${major}.${minor}.${patch}/${filename}`, baseUrl);
    if (await exists(url)) {
      return url;
    }
  }

  if (/^https?:\/\//i.test(release) && (await exists(release))) {
    return new URL(release);
  }

  if (release.length === 40 && /^[0-9a-f]{40}$/i.test(release)) {
    const releaseUrl = new URL(`${release}/${filename}`, baseUrl);
    if (await exists(releaseUrl)) {
      return releaseUrl;
    }

    const canaryUrl = new URL(`${release}-canary/${filename}`, baseUrl);
    if (await exists(canaryUrl)) {
      return canaryUrl;
    }

    const statusUrl = new URL(`repos/oven-sh/bun/commits/${release}/status`, getGithubApiUrl());
    const { error, body } = await curl(statusUrl, { json: true });
    if (error) {
      throw new Error(`Failed to fetch commit status: ${release}`, { cause: error });
    }

    const { statuses } = body;
    const buildUrls = new Set();
    for (const { target_url: url } of statuses) {
      const { hostname, origin, pathname } = new URL(url);
      if (hostname === "buildkite.com") {
        buildUrls.add(`${origin}${pathname}.json`);
      }
    }

    const buildkiteUrl = new URL("https://buildkite.com/");
    for (const url of buildUrls) {
      const { status, error, body } = await curl(url, { json: true });
      if (status === 404) {
        continue;
      }
      if (error) {
        throw new Error(`Failed to fetch build: ${url}`, { cause: error });
      }

      const { jobs } = body;
      const job = jobs.find(
        ({ step_key: key }) =>
          key &&
          key.includes("build-bun") &&
          key.includes(os) &&
          key.includes(arch) &&
          (!baseline || key.includes("baseline")) &&
          (!abi || key.includes(abi)),
      );
      if (!job) {
        continue;
      }

      const { base_path: jobPath } = job;
      const artifactsUrl = new URL(`${jobPath}/artifacts`, buildkiteUrl);
      {
        const { error, body } = await curl(artifactsUrl, { json: true });
        if (error) {
          continue;
        }

        for (const { url, file_name: name } of body) {
          if (name === filename) {
            return new URL(url, artifactsUrl);
          }
        }
      }
    }
  }

  throw new Error(`Failed to find release: ${release}`);
}

/**
 * @param {string} target
 * @param {string} [release]
 * @returns {Promise<string>}
 */
export async function downloadTarget(target, release) {
  const url = await getTargetDownloadUrl(target, release);
  const { error, body } = await curl(url, { arrayBuffer: true });
  if (error) {
    throw new Error(`Failed to download target: ${target} at ${release}`, { cause: error });
  }

  const tmpPath = mkdtempSync(join(tmpdir(), "bun-download-"));
  const zipPath = join(tmpPath, "bun.zip");

  writeFileSync(zipPath, new Uint8Array(body));
  const unzipPath = await unzip(zipPath, tmpPath);

  for (const entry of readdirSync(unzipPath, { recursive: true, encoding: "utf-8" })) {
    const exePath = join(unzipPath, entry);
    if (/bun(?:\.exe)?$/i.test(entry)) {
      return exePath;
    }
  }

  throw new Error(`Failed to find bun executable: ${unzipPath}`);
}

/**
 * @returns {string}
 */
export function getTailscale() {
  if (isMacOS) {
    const tailscaleApp = "/Applications/Tailscale.app/Contents/MacOS/tailscale";
    if (existsSync(tailscaleApp)) {
      return tailscaleApp;
    }
  }

  return "tailscale";
}

/**
 * @returns {string | undefined}
 */
export function getTailscaleIp() {
  const tailscale = getTailscale();
  const { error, stdout } = spawnSync([tailscale, "ip", "--1"]);
  if (!error) {
    return stdout.trim();
  }
}

/**
 * @returns {string | undefined}
 */
export function getPublicIp() {
  for (const url of ["https://checkip.amazonaws.com", "https://ipinfo.io/ip"]) {
    const { error, stdout } = spawnSync(["curl", url]);
    if (!error) {
      return stdout.trim();
    }
  }
}

/**
 * @returns {string}
 */
export function getHostname() {
  if (isBuildkite) {
    const agent = getEnv("BUILDKITE_AGENT_NAME", false);
    if (agent) {
      return agent;
    }
  }

  if (isGithubAction) {
    const runner = getEnv("RUNNER_NAME", false);
    if (runner) {
      return runner;
    }
  }

  return hostname();
}

/**
 * @returns {string}
 */
export function getUsername() {
  const { username } = userInfo();
  return username;
}

/**
 * @param {string} distro
 * @returns {string}
 */
export function getUsernameForDistro(distro) {
  if (/windows/i.test(distro)) {
    return "administrator";
  }

  if (/alpine|centos/i.test(distro)) {
    return "root";
  }

  if (/debian/i.test(distro)) {
    return "admin";
  }

  if (/ubuntu/i.test(distro)) {
    return "ubuntu";
  }

  if (/amazon|amzn|al\d+|rhel/i.test(distro)) {
    return "ec2-user";
  }

  throw new Error(`Unsupported distro: ${distro}`);
}

/**
 * @typedef {object} User
 * @property {string} username
 * @property {number} uid
 * @property {number} gid
 */

/**
 * @param {string} username
 * @returns {Promise<User>}
 */
export async function getUser(username) {
  if (isWindows) {
    throw new Error("TODO: Windows");
  }

  const [uid, gid] = await Promise.all([
    spawnSafe(["id", "-u", username]).then(({ stdout }) => parseInt(stdout.trim())),
    spawnSafe(["id", "-g", username]).then(({ stdout }) => parseInt(stdout.trim())),
  ]);

  return { username, uid, gid };
}

/**
 * @returns {string | undefined}
 */
export function getDistro() {
  if (isMacOS) {
    return "macOS";
  }

  if (isLinux) {
    const alpinePath = "/etc/alpine-release";
    if (existsSync(alpinePath)) {
      return "alpine";
    }

    const releasePath = "/etc/os-release";
    if (existsSync(releasePath)) {
      const releaseFile = readFile(releasePath, { cache: true });
      const match = releaseFile.match(/^ID=(.*)/m);
      if (match) {
        const [, id] = match;
        return id.includes('"') ? JSON.parse(id) : id;
      }
    }

    const { error, stdout } = spawnSync(["lsb_release", "-is"]);
    if (!error) {
      return stdout.trim().toLowerCase();
    }
  }

  if (isWindows) {
    const { error, stdout } = spawnSync(["cmd", "/c", "ver"]);
    if (!error) {
      return stdout.trim();
    }
  }
}

/**
 * @returns {string | undefined}
 */
export function getDistroVersion() {
  if (isMacOS) {
    const { error, stdout } = spawnSync(["sw_vers", "-productVersion"]);
    if (!error) {
      return stdout.trim();
    }
  }

  if (isLinux) {
    const alpinePath = "/etc/alpine-release";
    if (existsSync(alpinePath)) {
      const release = readFile(alpinePath, { cache: true }).trim();
      if (release.includes("_")) {
        const [version] = release.split("_");
        return `${version}-edge`;
      }
      return release;
    }

    const releasePath = "/etc/os-release";
    if (existsSync(releasePath)) {
      const releaseFile = readFile(releasePath, { cache: true });
      const match = releaseFile.match(/^VERSION_ID=(.*)/m);
      if (match) {
        const [, release] = match;
        return release.includes('"') ? JSON.parse(release) : release;
      }
    }

    const { error, stdout } = spawnSync(["lsb_release", "-rs"]);
    if (!error) {
      return stdout.trim();
    }
  }

  if (isWindows) {
    const { error, stdout } = spawnSync(["cmd", "/c", "ver"]);
    if (!error) {
      return stdout.trim();
    }
  }
}

/**
 * @returns {string | undefined}
 */
export function getShell() {
  if (isWindows) {
    const pwsh = which(["pwsh", "powershell"]);
    if (pwsh) {
      return pwsh;
    }
  }

  const sh = which(["bash", "sh"]);
  if (sh) {
    return sh;
  }

  return getEnv("SHELL", false);
}

/**
 * @typedef {"aws" | "google"} Cloud
 */

/** @type {Cloud | undefined} */
let detectedCloud;

/**
 * @returns {Promise<boolean | undefined>}
 */
export async function isAws() {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "aws";
  }

  async function checkAws() {
    if (isLinux) {
      const kernel = release();
      if (kernel.endsWith("-aws")) {
        return true;
      }

      const { error: systemdError, stdout } = await spawn(["systemd-detect-virt"]);
      if (!systemdError) {
        if (stdout.includes("amazon")) {
          return true;
        }
      }

      const dmiPath = "/sys/devices/virtual/dmi/id/board_asset_tag";
      if (existsSync(dmiPath)) {
        const dmiFile = readFileSync(dmiPath, { encoding: "utf-8" });
        if (dmiFile.startsWith("i-")) {
          return true;
        }
      }
    }

    if (isWindows) {
      const executionEnv = getEnv("AWS_EXECUTION_ENV", false);
      if (executionEnv === "EC2") {
        return true;
      }

      const { error: powershellError, stdout } = await spawn([
        "powershell",
        "-Command",
        "Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object Manufacturer",
      ]);
      if (!powershellError) {
        return stdout.includes("Amazon");
      }
    }
  }

  if (await checkAws()) {
    detectedCloud = "aws";
    return true;
  }
}

/**
 * @returns {Promise<boolean | undefined>}
 */
export async function isGoogleCloud() {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "google";
  }

  async function detectGoogleCloud() {
    if (isLinux) {
      const vendorPaths = [
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/bios_vendor",
        "/sys/class/dmi/id/product_name",
      ];

      for (const vendorPath of vendorPaths) {
        if (existsSync(vendorPath)) {
          const vendorFile = readFileSync(vendorPath, { encoding: "utf-8" });
          if (vendorFile.includes("Google")) {
            return true;
          }
        }
      }
    }
  }

  if (await detectGoogleCloud()) {
    detectedCloud = "google";
    return true;
  }
}

/**
 * @returns {Promise<Cloud | undefined>}
 */
export async function getCloud() {
  if (typeof detectedCloud === "string") {
    return detectedCloud;
  }

  if (await isAws()) {
    return "aws";
  }

  if (await isGoogleCloud()) {
    return "google";
  }
}

/**
 * @param {string | Record<Cloud, string>} name
 * @param {Cloud} [cloud]
 * @returns {Promise<string | undefined>}
 */
export async function getCloudMetadata(name, cloud) {
  cloud ??= await getCloud();
  if (!cloud) {
    return;
  }

  if (typeof name === "object") {
    name = name[cloud];
  }

  let url;
  let headers;
  if (cloud === "aws") {
    url = new URL(name, "http://169.254.169.254/latest/meta-data/");
  } else if (cloud === "google") {
    url = new URL(name, "http://metadata.google.internal/computeMetadata/v1/instance/");
    headers = { "Metadata-Flavor": "Google" };
  } else {
    throw new Error(`Unsupported cloud: ${inspect(cloud)}`);
  }

  const { error, body } = await curl(url, { headers, retries: 10 });
  if (error) {
    console.warn("Failed to get cloud metadata:", error);
    return;
  }

  return body.trim();
}

/**
 * @param {string} tag
 * @param {Cloud} [cloud]
 * @returns {Promise<string | undefined>}
 */
export function getCloudMetadataTag(tag, cloud) {
  const metadata = {
    "aws": `tags/instance/${tag}`,
    "google": `labels/${tag.replace(":", "-")}`,
  };

  return getCloudMetadata(metadata, cloud);
}

/**
 * @param {string} name
 * @returns {Promise<string | undefined>}
 */
export async function getBuildMetadata(name) {
  if (isBuildkite) {
    const { error, stdout } = await spawn(["buildkite-agent", "meta-data", "get", name]);
    if (!error) {
      const value = stdout.trim();
      if (value) {
        return value;
      }
    }
  }
}

/**
 * @typedef ConnectOptions
 * @property {string} hostname
 * @property {number} port
 * @property {number} [retries]
 */

/**
 * @param {ConnectOptions} options
 * @returns {Promise<Error | undefined>}
 */
export async function waitForPort(options) {
  const { hostname, port, retries = 10 } = options;
  console.log("Connecting...", `${hostname}:${port}`);

  let cause;
  for (let i = 0; i < retries; i++) {
    if (cause) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }

    const connected = new Promise((resolve, reject) => {
      const socket = connect({ host: hostname, port });
      socket.on("connect", () => {
        socket.destroy();
        console.log("Connected:", `${hostname}:${port}`);
        resolve();
      });
      socket.on("error", error => {
        socket.destroy();
        reject(error);
      });
    });

    try {
      return await connected;
    } catch (error) {
      cause = error;
    }
  }

  console.error("Connection failed:", `${hostname}:${port}`);
  return cause;
}
/**
 * @returns {Promise<number>}
 */
export async function getCanaryRevision() {
  if (isPullRequest() || isFork()) {
    return 1;
  }

  const repository = getRepository() || "oven-sh/bun";
  const { error: releaseError, body: release } = await curl(
    new URL(`repos/${repository}/releases/latest`, getGithubApiUrl()),
    { json: true },
  );
  if (releaseError) {
    return 1;
  }

  const commit = getCommit();
  const { tag_name: latest } = release;
  const { error: compareError, body: compare } = await curl(
    new URL(`repos/${repository}/compare/${latest}...${commit}`, getGithubApiUrl()),
    { json: true },
  );
  if (compareError) {
    return 1;
  }

  const { ahead_by: revision } = compare;
  if (typeof revision === "number") {
    return revision;
  }

  return 1;
}

/**
 * @returns {URL}
 */
export function getGithubApiUrl() {
  return new URL(getEnv("GITHUB_API_URL", false) || "https://api.github.com");
}

/**
 * @returns {URL}
 */
export function getGithubUrl() {
  return new URL(getEnv("GITHUB_SERVER_URL", false) || "https://github.com");
}

/**
 * @param {string} string
 * @returns {string}
 */
export function sha256(string) {
  return createHash("sha256").update(Buffer.from(string)).digest("hex");
}

/**
 * @param {string} [level]
 * @returns {"info" | "warning" | "error"}
 */
function parseLevel(level) {
  if (/error|fatal|fail/i.test(level)) {
    return "error";
  }
  if (/warn|caution/i.test(level)) {
    return "warning";
  }
  return "notice";
}

/**
 * @typedef {Object} Annotation
 * @property {string} title
 * @property {string} [content]
 * @property {string} [source]
 * @property {"notice" | "warning" | "error"} [level]
 * @property {string} [url]
 * @property {string} [filename]
 * @property {number} [line]
 * @property {number} [column]
 * @property {Record<string, string>} [metadata]
 */

/**
 * @typedef {Object} AnnotationContext
 * @property {string} [cwd]
 * @property {string[]} [command]
 */

/**
 * @param {Record<keyof Annotation, unknown>} options
 * @param {AnnotationContext} [context]
 * @returns {Annotation}
 */
export function parseAnnotation(options, context) {
  const cwd = (context?.["cwd"] || process.cwd()).replace(/\\/g, "/");
  const source = options["source"];
  const level = parseLevel(options["level"]);
  const title = options["title"] || (source ? `${source} ${level}` : level);
  const path = options["filename"]?.replace(/\\/g, "/");
  const line = parseInt(options["line"]) || undefined;
  const column = parseInt(options["column"]) || undefined;
  const content = options["content"];
  const lines = Array.isArray(content) ? content : content?.split(/(\r?\n)/) || [];
  const metadata = Object.fromEntries(
    Object.entries(options["metadata"] || {}).filter(([, value]) => value !== undefined),
  );

  const relevantLines = [];
  let lastLine;
  for (const line of lines) {
    if (!lastLine && !line.trim()) {
      continue;
    }
    lastLine = line.trim();
    relevantLines.push(line);
  }

  let filename;
  if (path?.startsWith(cwd)) {
    filename = path.slice(cwd.length + 1);
  } else {
    filename = path;
  }

  return {
    source,
    title,
    level,
    filename,
    line,
    column,
    content: relevantLines.join("\n"),
    metadata,
  };
}

/**
 * @typedef {Object} AnnotationFormatOptions
 * @property {boolean} [concise]
 * @property {boolean} [buildkite]
 */

/**
 * @param {Annotation} annotation
 * @param {AnnotationFormatOptions} [options]
 * @returns {string}
 */
export function formatAnnotationToHtml(annotation, options = {}) {
  const { title, content, source, level, filename, line } = annotation;
  const { concise, buildkite = isBuildkite } = options;

  let html;
  if (concise) {
    html = "<li>";
  } else {
    html = "<details><summary>";
  }

  if (filename) {
    const filePath = filename.replace(/\\/g, "/");
    const fileUrl = getFileUrl(filePath, line);
    if (fileUrl) {
      html += `<a href="${fileUrl}"><code>${filePath}</code></a>`;
    } else {
      html += `<code>${filePath}</code>`;
    }
    html += " - ";
  }

  if (title) {
    html += title;
  } else if (source) {
    if (level) {
      html += `${source} ${level}`;
    } else {
      html += source;
    }
  } else if (level) {
    html += level;
  } else {
    html += "unknown error";
  }

  const buildLabel = getBuildLabel();
  if (buildLabel) {
    html += " on ";
    const buildUrl = getBuildUrl();
    if (buildUrl) {
      html += `<a href="${buildUrl}">${buildLabel}</a>`;
    } else {
      html += buildLabel;
    }
  }

  if (concise) {
    html += "</li>\n";
  } else {
    html += "</summary>\n\n";
    if (buildkite) {
      const preview = escapeCodeBlock(content);
      html += `\`\`\`terminal\n${preview}\n\`\`\`\n`;
    } else {
      const preview = escapeHtml(stripAnsi(content));
      html += `<pre><code>${preview}</code></pre>\n`;
    }
    html += "\n\n</details>\n\n";
  }

  return html;
}

/**
 * @typedef {Object} AnnotationResult
 * @property {Annotation[]} annotations
 * @property {string} content
 * @property {string} preview
 */

/**
 * @param {string} content
 * @param {AnnotationOptions} [options]
 * @returns {AnnotationResult}
 */
export function parseAnnotations(content, options = {}) {
  /** @type {Annotation[]} */
  const annotations = [];

  const originalLines = content.split(/(\r?\n)/);
  const lines = [];

  for (let i = 0; i < originalLines.length; i++) {
    const originalLine = originalLines[i];
    const line = stripAnsi(originalLine).trim();
    const bufferedLines = [originalLine];

    /**
     * @param {RegExp} pattern
     * @param {number} [maxLength]
     * @returns {{lines: string[], match: string[] | undefined}}
     */
    const readUntil = (pattern, maxLength = 100) => {
      let length = 0;
      let match;

      while (i + length < originalLines.length && length < maxLength) {
        const originalLine = originalLines[i + length++];
        const line = stripAnsi(originalLine).trim();
        const patternMatch = pattern.exec(line);
        if (patternMatch) {
          match = patternMatch;
          break;
        }
      }

      const lines = originalLines.slice(i + 1, (i += length));
      bufferedLines.push(...lines);
      return { lines, match };
    };

    // Github Actions
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
    const githubAnnotation = line.match(/^::(error|warning|notice|debug)(?: (.*))?::(.*)$/);
    if (githubAnnotation) {
      const [, level, attributes, content] = githubAnnotation;
      const { file, line, col, title } = Object.fromEntries(
        attributes?.split(",")?.map(entry => entry.split("=")) || {},
      );

      const annotation = parseAnnotation({
        level,
        filename: file,
        line,
        column: col,
        content: unescapeGitHubAction(title) + unescapeGitHubAction(content),
      });
      annotations.push(annotation);
      continue;
    }

    const githubCommand = line.match(/^::(group|endgroup|add-mask|stop-commands)::$/);
    if (githubCommand) {
      continue;
    }

    // CMake error format
    // e.g. CMake Error at /path/to/thing.cmake:123 (message): ...
    const cmakeMessage = line.match(/CMake (Error|Warning|Deprecation Warning) at (.*):(\d+)/i);
    if (cmakeMessage) {
      let [, level, filename, line] = cmakeMessage;

      const { match: callStackMatch } = readUntil(/Call Stack \(most recent call first\)/i);
      if (callStackMatch) {
        const { match: callFrameMatch } = readUntil(/(CMakeLists\.txt|[^\s]+\.cmake):(\d+)/i, 5);
        if (callFrameMatch) {
          const [, frame, location] = callFrameMatch;
          filename = frame;
          line = location;
        }
      }

      const annotation = parseAnnotation({
        source: "cmake",
        level,
        filename,
        line,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    // Zig compiler error
    // e.g. /path/to/build.zig:8:19: error: ...
    const zigMessage = line.match(/^(.+\.zig):(\d+):(\d+): (error|warning): (.+)$/);
    if (zigMessage) {
      const [, filename, line, column, level] = zigMessage;

      const { match: callStackMatch } = readUntil(/referenced by:/i);
      if (callStackMatch) {
        readUntil(/(.+\.zig):(\d+):(\d+)/i, 5);
      }

      const annotation = parseAnnotation({
        source: "zig",
        level,
        filename,
        line,
        column,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    const nodeJsError = line.match(/^file:\/\/(.+\.(?:c|m)js):(\d+)/i);
    if (nodeJsError) {
      const [, filename, line] = nodeJsError;

      let metadata;
      const { match: nodeJsVersionMatch } = readUntil(/^Node\.js v(\d+\.\d+\.\d+)/i);
      if (nodeJsVersionMatch) {
        const [, version] = nodeJsVersionMatch;
        metadata = {
          "node-version": version,
        };
      }

      const annotation = parseAnnotation({
        source: "node",
        level: "error",
        filename,
        line,
        content: bufferedLines,
        metadata,
      });
      annotations.push(annotation);
    }

    const clangError = line.match(/^(.+\.(?:cpp|c|m|h)):(\d+):(\d+): (error|warning): (.+)/i);
    if (clangError) {
      const [, filename, line, column, level] = clangError;
      readUntil(/^\d+ (?:error|warning)s? generated/);
      const annotation = parseAnnotation({
        source: "clang",
        level,
        filename,
        line,
        column,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    const shellMessage = line.match(/(.+\.sh): line (\d+): (.+)/i);
    if (shellMessage) {
      const [, filename, line] = shellMessage;
      const annotation = parseAnnotation({
        source: "shell",
        level: "error",
        filename,
        line,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    lines.push(originalLine);
  }

  return {
    annotations,
    content: lines.join("\n"),
  };
}

/**
 * @typedef {object} BuildkiteAnnotation
 * @property {string} [context]
 * @property {string} label
 * @property {string} content
 * @property {"error" | "warning" | "info"} [style]
 * @property {number} [priority]
 * @property {number} [attempt]
 */

/**
 * @param {BuildkiteAnnotation} annotation
 */
export function reportAnnotationToBuildKite({ context, label, content, style = "error", priority = 3, attempt = 0 }) {
  if (!isBuildkite) {
    return;
  }
  const { error, status, signal, stderr } = nodeSpawnSync(
    "buildkite-agent",
    ["annotate", "--append", "--style", `${style}`, "--context", `${context || label}`, "--priority", `${priority}`],
    {
      input: content,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
      timeout: 5_000,
    },
  );
  if (status === 0) {
    return;
  }
  if (attempt > 0) {
    const cause = error ?? signal ?? `code ${status}`;
    throw new Error(`Failed to create annotation: ${label}`, { cause });
  }
  const errorContent = formatAnnotationToHtml({
    title: "annotation error",
    content: stderr || "",
    source: "buildkite",
    level: "error",
  });
  reportAnnotationToBuildKite({ label: `${label}-error`, content: errorContent, attempt: attempt + 1 });
}

/**
 * @param {object} obj
 * @param {number} indent
 * @returns {string}
 */
export function toYaml(obj, indent = 0) {
  const spaces = " ".repeat(indent);
  let result = "";
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      result += `${spaces}${key}: null\n`;
      continue;
    }
    if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      value.forEach(item => {
        if (typeof item === "object" && item !== null) {
          result += `${spaces}- \n${toYaml(item, indent + 2)
            .split("\n")
            .map(line => `${spaces}  ${line}`)
            .join("\n")}\n`;
        } else {
          result += `${spaces}- ${item}\n`;
        }
      });
      continue;
    }
    if (typeof value === "object") {
      result += `${spaces}${key}:\n${toYaml(value, indent + 2)}`;
      continue;
    }
    if (
      typeof value === "string" &&
      (value.includes(":") ||
        value.includes("#") ||
        value.includes("'") ||
        value.includes('"') ||
        value.includes("\n") ||
        value.includes("*"))
    ) {
      result += `${spaces}${key}: "${value.replace(/"/g, '\\"')}"\n`;
      continue;
    }
    result += `${spaces}${key}: ${value}\n`;
  }
  return result;
}

/** @type {string | undefined} */
let lastGroup;

/**
 * @param {string} title
 * @param {function} [fn]
 */
export function startGroup(title, fn) {
  if (lastGroup && lastGroup !== title) {
    lastGroup = title;
    endGroup();
  }

  if (isGithubAction) {
    console.log(`::group::${stripAnsi(title)}`);
  } else if (isBuildkite) {
    console.log(`--- ${title}`);
  } else {
    console.group(title);
  }

  if (typeof fn === "function") {
    let result;
    try {
      result = fn();
    } finally {
      if (result instanceof Promise) {
        return result.finally(() => endGroup());
      } else {
        endGroup();
      }
    }
  }
}

export function endGroup() {
  if (lastGroup) {
    lastGroup = undefined;
  }

  if (isGithubAction) {
    console.log("::endgroup::");
  } else {
    console.groupEnd();
  }
}

export function printEnvironment() {
  startGroup("Machine", () => {
    console.log("Operating System:", getOs());
    console.log("Architecture:", getArch());
    console.log("Kernel:", getKernel());
    if (isLinux) {
      console.log("ABI:", getAbi());
      console.log("ABI Version:", getAbiVersion());
    }
    console.log("Distro:", getDistro());
    console.log("Distro Version:", getDistroVersion());
    console.log("Hostname:", getHostname());
    if (isCI) {
      console.log("Tailscale IP:", getTailscaleIp());
      console.log("Public IP:", getPublicIp());
    }
    console.log("Username:", getUsername());
    console.log("Working Directory:", process.cwd());
    console.log("Temporary Directory:", tmpdir());
    if (process.isBun) {
      console.log("Bun Version:", Bun.version, Bun.revision);
    } else {
      console.log("Node Version:", process.version);
    }
  });

  if (isCI) {
    startGroup("Environment", () => {
      for (const [key, value] of Object.entries(process.env)) {
        console.log(`${key}:`, value);
      }
    });

    if (isPosix) {
      startGroup("Limits", () => {
        const shell = which(["sh", "bash"]);
        if (shell) {
          spawnSync([shell, "-c", "ulimit -a"], { stdio: "inherit" });
        }
      });
    }
  }

  startGroup("Repository", () => {
    console.log("Commit:", getCommit());
    console.log("Message:", getCommitMessage());
    console.log("Branch:", getBranch());
    console.log("Main Branch:", getMainBranch());
    console.log("Is Fork:", isFork());
    console.log("Is Merge Queue:", isMergeQueue());
    console.log("Is Main Branch:", isMainBranch());
    console.log("Is Pull Request:", isPullRequest());
    if (isPullRequest()) {
      console.log("Pull Request:", getPullRequest());
      console.log("Target Branch:", getTargetBranch());
    }
  });

  if (isCI) {
    startGroup("CI", () => {
      console.log("Build ID:", getBuildId());
      console.log("Build Label:", getBuildLabel());
      console.log("Build URL:", getBuildUrl()?.toString());
    });
  }
}

/**
 * @returns {number | undefined}
 */
export function getLoggedInUserCountOrDetails() {
  if (isWindows) {
    const pwsh = which(["pwsh", "powershell"]);
    if (pwsh) {
      const { error, stdout } = spawnSync([
        pwsh,
        "-Command",
        `Get-CimInstance -ClassName Win32_Process -Filter "Name = 'sshd.exe'" | Get-CimAssociatedInstance -Association Win32_SessionProcess | Get-CimAssociatedInstance -Association Win32_LoggedOnUser | Where-Object {$_.Name -ne 'SYSTEM'} | Measure-Object | Select-Object -ExpandProperty Count`,
      ]);
      if (!error) {
        return parseInt(stdout) || undefined;
      }
    }
  }

  const { error, stdout } = spawnSync(["who"]);
  if (!error) {
    const users = stdout
      .split("\n")
      .filter(line => /tty|pts/i.test(line))
      .map(line => {
        // who output format: username terminal date/time (ip)
        const [username, terminal, datetime, ip] = line.split(/\s+/);
        return {
          username,
          terminal,
          datetime,
          ip: (ip || "").replace(/[()]/g, ""), // Remove parentheses from IP
        };
      });

    if (users.length === 0) {
      return 0;
    }

    let message = `${users.length} currently logged in users:`;

    for (const user of users) {
      message += `\n- ${user.username} on ${user.terminal} since ${user.datetime}${user.ip ? ` from ${user.ip}` : ""}`;
    }

    return message;
  }
}

/** @typedef {keyof typeof emojiMap} Emoji */

const emojiMap = {
  darwin: ["🍎", "darwin"],
  linux: ["🐧", "linux"],
  debian: ["🐧", "debian"],
  ubuntu: ["🐧", "ubuntu"],
  alpine: ["🐧", "alpine"],
  aws: ["☁️", "aws"],
  amazonlinux: ["🐧", "aws"],
  nix: ["🐧", "nix"],
  windows: ["🪟", "windows"],
  true: ["✅", "white_check_mark"],
  false: ["❌", "x"],
  debug: ["🐞", "bug"],
  asan: ["🐛", "bug"],
  assert: ["🔍", "mag"],
  release: ["🏆", "trophy"],
  gear: ["⚙️", "gear"],
  clipboard: ["📋", "clipboard"],
  rocket: ["🚀", "rocket"],
};

/**
 * @param {Emoji} emoji
 * @returns {string}
 */
export function getEmoji(emoji) {
  const [unicode] = emojiMap[emoji] || [];
  return unicode || "";
}

/**
 * @param {Emoji} emoji
 * @returns {string}
 * @link https://github.com/buildkite/emojis#emoji-reference
 */
export function getBuildkiteEmoji(emoji) {
  const [, name] = emojiMap[emoji] || [];
  return name ? `:${name}:` : "";
}

/**
 * @param {SshOptions} options
 * @param {import("./utils.mjs").SpawnOptions} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
export async function spawnSshSafe(options, spawnOptions = {}) {
  return spawnSsh(options, { throwOnError: true, ...spawnOptions });
}

/**
 * @param {SshOptions} options
 * @param {import("./utils.mjs").SpawnOptions} [spawnOptions]
 * @returns {Promise<import("./utils.mjs").SpawnResult>}
 */
export async function spawnSsh(options, spawnOptions = {}) {
  const { hostname, port, username, identityPaths, password, retries = 10, command: spawnCommand } = options;

  if (!hostname.includes("@")) {
    await waitForPort({
      hostname,
      port: port || 22,
    });
  }

  const logPath = mkdtemp("ssh-", "ssh.log");
  const command = ["ssh", hostname, "-v", "-C", "-E", logPath, "-o", "StrictHostKeyChecking=no"];
  if (!password) {
    command.push("-o", "BatchMode=yes");
  }
  if (port) {
    command.push("-p", port);
  }
  if (username) {
    command.push("-l", username);
  }
  if (password) {
    const sshPass = which("sshpass", { required: true });
    command.unshift(sshPass, "-p", password);
  } else if (identityPaths) {
    command.push(...identityPaths.flatMap(path => ["-i", path]));
  }
  const stdio = spawnCommand ? "pipe" : "inherit";
  if (spawnCommand) {
    command.push(...spawnCommand);
  }

  /** @type {import("./utils.mjs").SpawnResult} */
  let result;
  for (let i = 0; i < retries; i++) {
    result = await spawn(command, { stdio, ...spawnOptions, throwOnError: undefined });

    const { exitCode } = result;
    if (exitCode !== 255) {
      break;
    }

    const sshLogs = readFile(logPath, { encoding: "utf-8" });
    if (sshLogs.includes("Authenticated")) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, (i + 1) * 15000));
  }

  if (spawnOptions?.throwOnError) {
    const { error } = result;
    if (error) {
      throw error;
    }
  }

  return result;
}

/**
 * @param {MachineOptions} options
 * @returns {Promise<Machine>}
 */
export async function setupUserData(machine, options) {
  const { os, userData } = options;
  if (!userData) {
    return;
  }

  // Write user data to a temporary file
  const tmpFile = mkdtemp("user-data-", os === "windows" ? "setup.ps1" : "setup.sh");
  await writeFile(tmpFile, userData);

  try {
    // Upload the script
    const remotePath = os === "windows" ? "C:\\Windows\\Temp\\setup.ps1" : "/tmp/setup.sh";
    await machine.upload(tmpFile, remotePath);

    // Execute the script
    if (os === "windows") {
      await machine.spawnSafe(["powershell", remotePath], { stdio: "inherit" });
    } else {
      await machine.spawnSafe(["bash", remotePath], { stdio: "inherit" });
    }
  } finally {
    // Clean up the temporary file
    rm(tmpFile);
  }
}
