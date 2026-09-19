// Contains utility functions for various scripts, including:
// CI, running tests, and code generation.

import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions as NodeSpawnOptions,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type StdioOptions,
} from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname, homedir as nodeHomedir, tmpdir as nodeTmpdir, release, userInfo } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";
import { inspect } from "node:util";

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
// Node built for Termux/bionic reports "android"; CI models that as linux + abi=android.
export const isAndroid = process.platform === "android";
export const isLinux = process.platform === "linux" || isAndroid;
const isFreeBSD = process.platform === "freebsd";
export const isPosix = isMacOS || isLinux || isFreeBSD;

export const isX64 = process.arch === "x64";

export function getEnv(name: string, required?: true): string;
export function getEnv(name: string, required: boolean | undefined): string | undefined;
export function getEnv(name: string, required = true): string | undefined {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(`Environment variable is missing: ${name}`);
  }

  return value;
}

export const isBuildkite = getEnv("BUILDKITE", false) === "true";
export const isGithubAction = getEnv("GITHUB_ACTIONS", false) === "true";
export const isCI = getEnv("CI", false) === "true" || isBuildkite || isGithubAction;
const isDebug = getEnv("DEBUG", false) === "1";

export type SecretOptions = {
  required?: boolean;
  redact?: boolean;
};

export function getSecret(name: string, options?: SecretOptions & { required?: true }): string;
export function getSecret(name: string, options: SecretOptions): string | undefined;
export function getSecret(name: string, options: SecretOptions = { required: true, redact: true }): string | undefined {
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

function debugLog(...args: unknown[]): void {
  if (isDebug) {
    console.log(...args);
  }
}

function setEnv(name: string, value: string | undefined): void {
  process.env[name] = value;

  if (isGithubAction && !/^GITHUB_/i.test(name)) {
    const envFilePath = process.env["GITHUB_ENV"];
    if (envFilePath) {
      const delimeter = Math.random().toString(36).substring(2, 15);
      const content = `${name}<<${delimeter}\n${value}\n${delimeter}\n`;
      appendFileSync(envFilePath, content);
    }
  }
}

export type SpawnOptions = {
  cwd?: string | undefined;
  timeout?: number;
  env?: Record<string, string | undefined>;
  throwOnError?: boolean | ((error: Error) => boolean);
  retryOnError?: (error: Error) => boolean;
  stdin?: string;
  stdio?: StdioOptions;
  privileged?: boolean;
};

export type SpawnResult = {
  exitCode: number | null;
  signalCode: string | null | undefined;
  stdout: string;
  stderr: string;
  error: Error | undefined;
};

export function $(strings: TemplateStringsArray, ...values: unknown[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < strings.length; i++) {
    result.push(...strings[i]!.trim().split(/\s+/).filter(Boolean));
    if (i < values.length) {
      const value = values[i];
      if (Array.isArray(value)) {
        result.push(...value);
      } else if (typeof value === "string") {
        if (result.at(-1)?.endsWith("=")) {
          result[result.length - 1]! += value;
        } else {
          result.push(value);
        }
      }
    }
  }
  return result;
}

function parseCommand(command: string[], options: SpawnOptions): string[] {
  if (options?.privileged) {
    return [...getPrivilegedCommand(), ...command];
  }
  return command;
}

let priviledgedCommand: string[] | undefined;

function getPrivilegedCommand(): string[] {
  if (typeof priviledgedCommand !== "undefined") {
    return priviledgedCommand;
  }

  // Already root (the image bake step runs bootstrap and `agent.ts install`
  // as root on a fresh machine): no wrapper. In particular not
  // `su -s sh root -c`, which takes ONE command string — prefixing it to an
  // argv drops every argument after the first (`rc-update add …` became a
  // bare `rc-update`).
  if (isWindows || process.getuid?.() === 0) {
    return (priviledgedCommand = []);
  }

  const sudo = ["sudo", "-n"];
  const { error: sudoError } = spawnSync([...sudo, "true"]);
  if (!sudoError) {
    return (priviledgedCommand = sudo);
  }

  const doas = ["doas", "-u", "root"];
  const { error: doasError } = spawnSync([...doas, "true"]);
  if (!doasError) {
    return (priviledgedCommand = doas);
  }

  return (priviledgedCommand = []);
}

export async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const [cmd, ...args] = parseCommand(command, options);
  debugLog("$", cmd, ...args);

  const stdin = options["stdin"];
  const spawnOptions: NodeSpawnOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    timeout: options["timeout"] ?? undefined,
    env: options["env"] ?? undefined,
    stdio: stdin === "inherit" ? "inherit" : [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    ...options,
  };

  let exitCode: number | null = 1;
  let signalCode: string | null | undefined;
  let stdout = "";
  let stderr = "";
  let spawnError: unknown;
  let error: Error | undefined;

  const result = new Promise<void>((resolve, reject) => {
    if (cmd === undefined) {
      throw new TypeError("The command is empty");
    }
    const subprocess = nodeSpawn(cmd, args, spawnOptions);

    if (typeof stdin !== "undefined") {
      subprocess.stdin?.on("error", error => {
        if (!("code" in error) || error.code !== "EPIPE") {
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
    spawnError = cause;
  }

  if (exitCode !== 0 && isWindows) {
    const exitReason = getWindowsExitReason(exitCode);
    if (exitReason) {
      signalCode = exitReason;
    }
  }

  if (spawnError || signalCode || exitCode !== 0) {
    const description = command.map(arg => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
    const cause = spawnError || stderr.trim() || stdout.trim() || undefined;

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

export async function spawnSafe(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  return spawn(command, { throwOnError: true, ...options });
}

// With `retryOnError`, a retry goes through the asynchronous spawn(), so the result is a promise.
export function spawnSync(command: string[], options?: SpawnOptions & { retryOnError?: never }): SpawnResult;
export function spawnSync(command: string[], options: SpawnOptions): SpawnResult | Promise<SpawnResult>;
export function spawnSync(command: string[], options: SpawnOptions = {}): SpawnResult | Promise<SpawnResult> {
  const [cmd, ...args] = parseCommand(command, options);
  debugLog("$", cmd, ...args);

  const stdin = options["stdin"];
  const spawnOptions: NodeSpawnSyncOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    timeout: options["timeout"] ?? undefined,
    env: options["env"] ?? undefined,
    stdio: stdin === "inherit" ? "inherit" : [typeof stdin === "undefined" ? "ignore" : "pipe", "pipe", "pipe"],
    input: stdin,
    ...options,
  };

  let exitCode = 1;
  let signalCode: string | undefined;
  let stdout = "";
  let stderr = "";
  let error: Error | undefined;

  let result: {
    error?: unknown;
    status?: number | null;
    signal?: NodeJS.Signals | null;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  try {
    if (cmd === undefined) {
      throw new TypeError("The command is empty");
    }
    result = nodeSpawnSync(cmd, args, spawnOptions);
  } catch (error) {
    result = { error };
  }

  const { error: spawnError, status, signal, stdout: stdoutBuffer, stderr: stderrBuffer } = result;
  if (!spawnError) {
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

  if (spawnError || signalCode || exitCode !== 0) {
    const description = command.map(arg => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
    const cause = spawnError || stderr?.trim() || stdout?.trim() || undefined;

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

export function getWindowsExitReason(exitCode: number | null): string | undefined {
  const windowsKitPath = "C:\\Program Files (x86)\\Windows Kits";
  if (!existsSync(windowsKitPath)) {
    return;
  }

  const windowsKitPaths = readdirSync(windowsKitPath)
    .filter(filename => isFinite(parseInt(filename)))
    .sort((a, b) => parseInt(b) - parseInt(a));

  let ntStatusPath: string | undefined;
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

  return undefined;
}

function parseGitUrl(url: string | URL): URL | undefined {
  const string = typeof url === "string" ? url : url.toString();

  const githubUrl = getEnv("GITHUB_SERVER_URL", false) || "https://github.com";
  if (/^git@github\.com:/.test(string)) {
    return new URL(string.slice(15).replace(/\.git$/, ""), githubUrl);
  }
  if (/^https:\/\/github\.com\//.test(string)) {
    return new URL(string.slice(19).replace(/\.git$/, ""), githubUrl);
  }

  return undefined;
}

function parseGitRepository(url: string | URL): string | undefined {
  const parsed = parseGitUrl(url);
  if (parsed) {
    const { hostname, pathname } = parsed;
    if (hostname == "github.com") {
      return pathname.slice(1);
    }
  }

  return undefined;
}

function getRepositoryUrl(cwd?: string): URL | undefined {
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

  return undefined;
}

function getRepository(cwd?: string): string | undefined {
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

  return undefined;
}

export function getCommit(cwd?: string): string | undefined {
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

  return undefined;
}

export function getCommitMessage(cwd?: string): string | undefined {
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

  return undefined;
}

export function getBranch(cwd?: string): string | undefined {
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

  return undefined;
}

function getMainBranch(cwd?: string): string | undefined {
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

  return undefined;
}

export function isMainBranch(cwd?: string): boolean {
  return !isFork() && getBranch(cwd) === getMainBranch(cwd);
}

/** The fields of the GitHub Actions event payload (`GITHUB_EVENT_PATH`) that are read here. */
type GithubEvent = {
  pull_request?: {
    number: number;
    head: { repo: { fork: boolean } };
  };
};

function isPullRequest(): boolean {
  if (isBuildkite) {
    return !isNaN(parseInt(getEnv("BUILDKITE_PULL_REQUEST", false) ?? ""));
  }

  if (isGithubAction) {
    return /pull_request|merge_group/.test(getEnv("GITHUB_EVENT_NAME", false) ?? "");
  }

  return false;
}

function getPullRequest(): number | undefined {
  if (isBuildkite) {
    const pullRequest = getEnv("BUILDKITE_PULL_REQUEST", false);
    if (pullRequest) {
      return parseInt(pullRequest);
    }
  }

  if (isGithubAction) {
    const eventPath = getEnv("GITHUB_EVENT_PATH", false);
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFile(eventPath, { cache: true })) as GithubEvent;
      const pullRequest = event["pull_request"];
      if (pullRequest) {
        return parseInt(`${pullRequest["number"]}`);
      }
    }
  }

  return undefined;
}

function getTargetBranch(): string | undefined {
  if (isPullRequest()) {
    if (isBuildkite) {
      return getEnv("BUILDKITE_PULL_REQUEST_BASE_BRANCH", false);
    }

    if (isGithubAction) {
      return getEnv("GITHUB_BASE_REF", false);
    }
  }

  return undefined;
}

export function isFork(): boolean {
  if (isBuildkite) {
    const repository = getEnv("BUILDKITE_PULL_REQUEST_REPO", false);
    return !!repository && repository !== getEnv("BUILDKITE_REPO", false);
  }

  if (isGithubAction) {
    const eventPath = getEnv("GITHUB_EVENT_PATH", false);
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFile(eventPath, { cache: true })) as GithubEvent;
      const pullRequest = event["pull_request"];
      if (pullRequest) {
        return !!pullRequest["head"]["repo"]["fork"];
      }
    }
  }

  return false;
}

export function isMergeQueue(cwd?: string): boolean {
  return /^gh-readonly-queue/.test(getBranch(cwd) ?? "");
}

function getGithubToken(): string | undefined {
  const cachedToken = getSecret("GITHUB_TOKEN", { required: false });

  if (typeof cachedToken === "string" || !which("gh")) {
    return cachedToken || undefined;
  }

  const { error, stdout } = spawnSync(["gh", "auth", "token"]);
  const token = error ? "" : stdout.trim();

  setEnv("GITHUB_TOKEN", token);
  return token || undefined;
}

export type CurlOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string> | undefined;
  timeout?: number;
  cache?: boolean;
  retries?: number;
  json?: boolean;
  arrayBuffer?: boolean;
  filename?: string;
};

export type CurlResult = {
  status: number | undefined;
  statusText: string | undefined;
  error: Error | undefined;
  body: unknown;
};

let cachedResults: Record<string, CurlResult | undefined> | undefined;

export async function curl(url: string | URL, options: CurlOptions = {}): Promise<CurlResult> {
  let { hostname, href } = new URL(url);
  let method = options["method"] || "GET";
  let input = options["body"];
  let headers = options["headers"] || {};
  let retries = options["retries"] || 3;
  let json = options["json"];
  let arrayBuffer = options["arrayBuffer"];
  let filename = options["filename"];

  let cacheKey: string | undefined;
  let cache = options["cache"];
  if (cache) {
    cacheKey = `${method} ${href}`;
    const cachedResult = cachedResults?.[cacheKey];
    if (cachedResult) {
      return cachedResult;
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

  let status: number | undefined;
  let statusText: string | undefined;
  let body: unknown;
  let error: Error | undefined;
  for (let i = 0; i < retries; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }

    let response;
    try {
      response = await fetch(href, { method, headers, body: input ?? null });
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

let cachedFiles: Record<string, string> | undefined;

export function readFile(filename: string, options: { cache?: boolean } = {}): string {
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

export function chmod(path: string, mode: number): void {
  debugLog("$", "chmod", path, mode);
  chmodSync(path, mode);
}

export function writeFile(filename: string, content: string | Uint8Array, options?: { mode?: number }): void {
  mkdir(dirname(filename));

  debugLog("$", "touch", filename);
  writeFileSync(filename, content);

  if (options?.mode) {
    chmod(filename, options.mode);
  }
}

export function mkdir(path: string, options: { mode?: number } = {}): void {
  if (existsSync(path)) {
    return;
  }

  debugLog("$", "mkdir", path);
  mkdirSync(path, { ...options, recursive: true });
}

export type WhichOptions = {
  required?: boolean;
};

export function which(command: string | string[], options: WhichOptions & { required: true }): string;
export function which(command: string | string[], options?: WhichOptions): string | undefined;
export function which(command: string | string[], options: WhichOptions = {}): string | undefined {
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

  return undefined;
}

function getBuildId(): string | undefined {
  if (isBuildkite) {
    return getEnv("BUILDKITE_BUILD_ID");
  }

  if (isGithubAction) {
    return getEnv("GITHUB_RUN_ID");
  }

  return undefined;
}

export function getBuildNumber(): number | undefined {
  if (isBuildkite) {
    return parseInt(getEnv("BUILDKITE_BUILD_NUMBER"));
  }

  if (isGithubAction) {
    return parseInt(getEnv("GITHUB_RUN_ID"));
  }

  return undefined;
}

export function getBuildUrl(): URL | undefined {
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

  return undefined;
}

export function getBuildLabel(): string | undefined {
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

  return undefined;
}

export function isBuildManual(): boolean | undefined {
  if (isBuildkite) {
    const buildSource = getEnv("BUILDKITE_SOURCE", false);
    if (buildSource) {
      const buildId = getEnv("BUILDKITE_REBUILT_FROM_BUILD_ID", false);
      return buildSource === "ui" && !buildId;
    }
  }

  return undefined;
}

export function getBootstrapVersion(os?: string): number {
  const scriptPath = join(
    import.meta.dirname,
    os === "windows" || (!os && isWindows) ? "bootstrap.ps1" : "bootstrap.sh",
  );
  const scriptContent = readFile(scriptPath, { cache: true });
  const match = /# Version: (\d+)/.exec(scriptContent);
  if (match) {
    const version = match[1]!;
    return parseInt(version);
  }
  return 0;
}

export function getFileUrl(filename?: string, line?: number): URL | string | undefined {
  let cwd: string | undefined;
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

/** The fields of Buildkite's build JSON (`<build url>.json`) that are read here. */
export type BuildkiteBuild = {
  id: string;
  commit_id: string;
  branch_name: string;
  state: string;
  prev_branch_build?: { url: string } | null;
  steps: { label: string; outcome: string }[];
};

export async function getLastSuccessfulBuild(): Promise<BuildkiteBuild | undefined> {
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

      const build = body as BuildkiteBuild;
      const { state, prev_branch_build: previousBuild, steps } = build;
      if (depth++) {
        if (state === "failed" || state === "passed" || state === "canceled") {
          const buildSteps = steps.filter(({ label }) => label.endsWith("build-bun"));
          if (buildSteps.length) {
            if (buildSteps.every(({ outcome }) => outcome === "passed")) {
              return build;
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

  return undefined;
}

/**
 * `filename` is the absolute path to the file to upload.
 */
export async function uploadArtifact(filename: string): Promise<void> {
  if (isBuildkite) {
    await spawnSafe(["buildkite-agent", "artifact", "upload", basename(filename)], {
      cwd: dirname(filename),
      stdio: "inherit",
    });
  } else {
    console.warn(`not in buildkite. artifact ${filename} not uploaded.`);
  }
}

export function stripAnsi(string: string): string {
  return string.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

export function unescapeGitHubAction(string: string): string {
  return string.replace(/%25/g, "%").replace(/%0D/g, "\r").replace(/%0A/g, "\n");
}

export function escapeHtml(string: string): string {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

export function escapeCodeBlock(string: string): string {
  return string.replace(/`/g, "\\`");
}

function escapePowershell(string: string): string {
  return string.replace(/'/g, "''").replace(/`/g, "``");
}

function unescapeXml(string: string): string {
  return string
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export type JunitFileSuite = {
  /** failed tests in the whole file, describe blocks included */
  failures: number;
  /** wall clock of the whole file, loading it included */
  seconds: number;
  /** the failed tests, in report order */
  cases: { name: string; message: string }[];
};

/**
 * Reads the report written by `bun test --reporter=junit` into one entry per test file,
 * keyed by the path the reporter printed (relative to the directory `bun test` ran in)
 * with `/` separators.
 *
 * The reporter writes one `<testsuite>` named after each file and, nested inside it, one
 * more `<testsuite>` per describe block. All of them carry the same `file` attribute, but
 * only the file's own suite counts the failures of the whole file (the describe blocks'
 * counts roll up into it) and times the file as a whole (a describe block's `time` is the
 * sum of its tests, which over-counts `describe.concurrent`), so the nested suites are
 * skipped.
 */
export function parseJunitFileSuites(xml: string): Map<string, JunitFileSuite> {
  const attribute = (attributes: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1];
  const keyOf = (file: string) => unescapeXml(file).replaceAll("\\", "/");
  const files = new Map<string, JunitFileSuite>();
  for (const match of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    // The group of the pattern is not optional.
    const attributes = match[1]!;
    const file = attribute(attributes, "file");
    if (!file || attribute(attributes, "name") !== file) continue;
    files.set(keyOf(file), {
      failures: Number(attribute(attributes, "failures") ?? 0),
      seconds: Number(attribute(attributes, "time") ?? 0),
      cases: [],
    });
  }
  for (const match of xml.matchAll(/<testcase\b([^>]*)>\s*<failure\b([^>]*)>/g)) {
    // Neither group of the pattern is optional.
    const caseAttributes = match[1]!;
    const failureAttributes = match[2]!;
    const file = attribute(caseAttributes, "file");
    const entry = file && files.get(keyOf(file));
    if (!entry) continue;
    entry.cases.push({
      name: unescapeXml(attribute(caseAttributes, "name") ?? "(unnamed)"),
      message: unescapeXml(attribute(failureAttributes, "message") ?? ""),
    });
  }
  return files;
}

export type Os = "darwin" | "linux" | "windows" | "freebsd";
export type Arch = "x64" | "aarch64";
export type Abi = "musl" | "gnu" | "android";

export function homedir(): string {
  return nodeHomedir();
}

export function tmpdir(): string {
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

export async function unzip(filename: string, output?: string): Promise<string> {
  const destination = output || mkdtempSync(join(tmpdir(), "unzip-"));
  if (isWindows) {
    const command = `Expand-Archive -Force -LiteralPath "${escapePowershell(filename)}" -DestinationPath "${escapePowershell(destination)}"`;
    await spawnSafe(["powershell", "-Command", command]);
  } else {
    await spawnSafe(["unzip", "-o", filename, "-d", destination]);
  }
  return destination;
}

export function parseBoolean(value: string): boolean | undefined {
  if (/^(true|yes|1|on)$/i.test(value)) {
    return true;
  }
  if (/^(false|no|0|off)$/i.test(value)) {
    return false;
  }

  return undefined;
}

function parseOs(string: string): Os {
  if (/darwin|apple|mac/i.test(string)) {
    return "darwin";
  }
  if (/linux|android/i.test(string)) {
    return "linux";
  }
  if (/freebsd/i.test(string)) {
    return "freebsd";
  }
  if (/win/i.test(string)) {
    return "windows";
  }
  throw new Error(`Unsupported operating system: ${string}`);
}

export function getOs(): Os {
  return parseOs(process.platform);
}

function parseArch(string: string): Arch {
  if (/x64|amd64|x86_64/i.test(string)) {
    return "x64";
  }
  if (/arm64|aarch64/i.test(string)) {
    return "aarch64";
  }
  throw new Error(`Unsupported architecture: ${string}`);
}

export function getArch(): Arch {
  return parseArch(process.arch);
}

export function getKernel(): string | undefined {
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

export function getAbi(): Abi | undefined {
  if (!isLinux) {
    return;
  }

  if (isAndroid || existsSync("/system/bin/linker64")) {
    return "android";
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

  return undefined;
}

export function getAbiVersion(): string | undefined {
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

  return undefined;
}

function getTailscale(): string {
  if (isMacOS) {
    const tailscaleApp = "/Applications/Tailscale.app/Contents/MacOS/tailscale";
    if (existsSync(tailscaleApp)) {
      return tailscaleApp;
    }
  }

  if (isWindows) {
    const tailscaleExe = "C:\\Program Files\\Tailscale\\tailscale.exe";
    if (existsSync(tailscaleExe)) {
      return tailscaleExe;
    }
  }

  return "tailscale";
}

function getTailscaleIp(): string | undefined {
  const tailscale = getTailscale();
  const { error, stdout } = spawnSync([tailscale, "ip", "--1"]);
  if (!error) {
    return stdout.trim();
  }

  return undefined;
}

function getPublicIp(): string | undefined {
  for (const url of ["https://checkip.amazonaws.com", "https://ipinfo.io/ip"]) {
    const { error, stdout } = spawnSync(["curl", url]);
    if (!error) {
      return stdout.trim();
    }
  }

  return undefined;
}

export function getHostname(): string {
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

function getUsername(): string {
  const { username } = userInfo();
  return username;
}

export function getDistro(): string | undefined {
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
        const id = match[1]!;
        return id.includes('"') ? (JSON.parse(id) as string) : id;
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

  return undefined;
}

export function getDistroVersion(): string | undefined {
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
        const release = match[1]!;
        return release.includes('"') ? (JSON.parse(release) as string) : release;
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

  return undefined;
}

export function getShell(): string | undefined {
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

export type Cloud = "aws" | "google" | "azure";

let detectedCloud: Cloud | undefined;

async function isAws(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "aws";
  }

  async function checkAws(): Promise<boolean | undefined> {
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

    return undefined;
  }

  if (await checkAws()) {
    detectedCloud = "aws";
    return true;
  }

  return undefined;
}

async function isGoogleCloud(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "google";
  }

  async function detectGoogleCloud(): Promise<boolean | undefined> {
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

    return undefined;
  }

  if (await detectGoogleCloud()) {
    detectedCloud = "google";
    return true;
  }

  return undefined;
}

/** The fields of the Azure IMDS instance document that are read here. */
type AzureInstanceMetadata = {
  compute?: {
    azEnvironment?: string;
    tagsList?: { name: string; value: string }[];
  };
} | null;

async function isAzure(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "azure";
  }

  async function detectAzure(): Promise<boolean | undefined> {
    // Azure IMDS (Instance Metadata Service) — the official way to detect Azure VMs.
    // https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service
    const { error, body } = await curl("http://169.254.169.254/metadata/instance?api-version=2021-02-01", {
      headers: { "Metadata": "true" },
      retries: 1,
    });
    if (!error && typeof body === "string" && body) {
      try {
        const metadata = JSON.parse(body) as AzureInstanceMetadata;
        if (metadata?.compute?.azEnvironment) {
          return true;
        }
      } catch {}
    }

    return undefined;
  }

  if (await detectAzure()) {
    detectedCloud = "azure";
    return true;
  }

  return undefined;
}

export async function getCloud(): Promise<Cloud | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud;
  }

  if (await isAws()) {
    return "aws";
  }

  if (await isGoogleCloud()) {
    return "google";
  }

  if (await isAzure()) {
    return "azure";
  }

  return undefined;
}

/**
 * `name` is the path of the metadata entry, or one path per cloud. The azure
 * entry can be left out: that branch does not use it.
 */
async function getCloudMetadata(
  name: string | Partial<Record<Cloud, string>>,
  cloud?: Cloud,
): Promise<string | undefined> {
  cloud ??= await getCloud();
  if (!cloud) {
    return;
  }

  if (typeof name === "object") {
    name = name[cloud] ?? "";
  }

  let url;
  let headers;
  if (cloud === "aws") {
    url = new URL(name, "http://169.254.169.254/latest/meta-data/");
  } else if (cloud === "google") {
    url = new URL(name, "http://metadata.google.internal/computeMetadata/v1/instance/");
    headers = { "Metadata-Flavor": "Google" };
  } else if (cloud === "azure") {
    // Azure IMDS uses a single JSON endpoint; individual fields are extracted by the caller.
    url = new URL("http://169.254.169.254/metadata/instance?api-version=2021-02-01");
    headers = { "Metadata": "true" };
  } else {
    throw new Error(`Unsupported cloud: ${inspect(cloud)}`);
  }

  const { error, body } = await curl(url, { headers, retries: 10 });
  if (error) {
    console.warn("Failed to get cloud metadata:", error);
    return;
  }

  // Without the json, arrayBuffer or filename option, the body of a response is its text.
  return typeof body === "string" ? body.trim() : undefined;
}

export async function getCloudMetadataTag(tag: string, cloud?: Cloud): Promise<string | undefined> {
  cloud ??= await getCloud();

  if (cloud === "azure") {
    // Azure IMDS returns all tags in a single JSON response.
    // Tags are in compute.tagsList as [{name, value}, ...].
    const body = await getCloudMetadata("", cloud);
    if (!body) return;
    try {
      const metadata = JSON.parse(body) as AzureInstanceMetadata;
      const tags = metadata?.compute?.tagsList;
      if (Array.isArray(tags)) {
        const entry = tags.find(t => t.name === tag);
        return entry?.value;
      }
    } catch {}
    return;
  }

  const metadata = {
    "aws": `tags/instance/${tag}`,
    "google": `labels/${tag.replace(":", "-")}`,
  };

  return getCloudMetadata(metadata, cloud);
}

export type AwsCredentials = {
  AccessKeyId: string;
  SecretAccessKey: string;
  Token?: string;
};

/**
 * Instance-role credentials from IMDS.
 */
async function getAwsInstanceCredentials(): Promise<AwsCredentials | undefined> {
  const role = await getCloudMetadata("iam/security-credentials/", "aws");
  if (!role) {
    return;
  }
  const body = await getCloudMetadata(`iam/security-credentials/${role.trim()}`, "aws");
  if (!body) {
    return;
  }
  try {
    return JSON.parse(body) as AwsCredentials;
  } catch {
    return;
  }
}

export type AwsRequest = {
  method: string;
  host: string;
  path: string;
  body: string;
  service: string;
  region: string;
  headers: Record<string, string>;
  credentials: AwsCredentials;
  date?: Date;
};

/**
 * Signs an AWS API request (SigV4). agent.ts ships to the AMI as a single
 * bundled file, so this avoids pulling in the SDK.
 * @returns headers, including Authorization
 */
export function signAwsRequest({
  method,
  host,
  path,
  body,
  service,
  region,
  headers,
  credentials,
  date,
}: AwsRequest): Record<string, string> {
  const { AccessKeyId, SecretAccessKey, Token } = credentials;
  const amzDate = (date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const bodyHash = sha256(body);

  const signed: Record<string, string> = {
    ...headers,
    "host": host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": bodyHash,
  };
  if (Token) {
    signed["x-amz-security-token"] = Token;
  }

  const canonical = Object.entries(signed)
    .map(([key, value]): [string, string] => [key.toLowerCase(), `${value}`.trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = canonical.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = canonical.map(([key]) => key).join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SecretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...signed,
    "Authorization": `AWS4-HMAC-SHA256 Credential=${AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export type AwsSecretOptions = {
  /** defaults to the instance's region */
  region?: string;
  /** defaults to IMDS credentials */
  credentials?: AwsCredentials;
};

/** The field of the Secrets Manager GetSecretValue response that is read here. */
type AwsSecretValue = { SecretString?: string } | null | undefined;

/**
 * Reads a secret from AWS Secrets Manager using the instance role.
 */
export async function getAwsSecret(secretId: string, options: AwsSecretOptions = {}): Promise<string | undefined> {
  const region = options["region"] || (await getCloudMetadata("placement/region", "aws")) || "us-east-1";
  const credentials = options["credentials"] || (await getAwsInstanceCredentials());
  if (!credentials) {
    console.warn("Failed to get AWS secret: no instance credentials");
    return;
  }

  const host = `secretsmanager.${region}.amazonaws.com`;
  const body = JSON.stringify({ SecretId: secretId });
  const headers = signAwsRequest({
    method: "POST",
    host,
    path: "/",
    body,
    service: "secretsmanager",
    region,
    credentials,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "secretsmanager.GetSecretValue",
    },
  });

  const { error, body: response } = await curl(`https://${host}/`, {
    method: "POST",
    headers,
    body,
    json: true,
    retries: 5,
  });
  if (error) {
    console.warn("Failed to get AWS secret:", error);
    return;
  }

  return (response as AwsSecretValue)?.["SecretString"];
}

/** The field of the managed identity token response that is read here. */
type AzureIdentityToken = { access_token?: string } | null | undefined;

/** The field of the Key Vault "get secret" response that is read here. */
type AzureSecretValue = { value?: string } | null | undefined;

/**
 * Reads a secret from Azure Key Vault using the VM's managed identity.
 */
export async function getAzureSecret(vaultName: string, secretName: string): Promise<string | undefined> {
  const identityUrl =
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net";
  const { error: identityError, body: identity } = await curl(identityUrl, {
    headers: { "Metadata": "true" },
    json: true,
    retries: 10,
  });
  const accessToken = (identity as AzureIdentityToken)?.["access_token"];
  if (identityError || !accessToken) {
    console.warn("Failed to get Azure managed identity token:", identityError);
    return;
  }

  const secretUrl = `https://${vaultName}.vault.azure.net/secrets/${secretName}?api-version=7.4`;
  const { error, body } = await curl(secretUrl, {
    headers: { "Authorization": `Bearer ${accessToken}` },
    json: true,
    retries: 5,
  });
  if (error) {
    console.warn("Failed to get Azure secret:", error);
    return;
  }

  return (body as AzureSecretValue)?.["value"];
}

export async function getBuildMetadata(name: string): Promise<string | undefined> {
  if (isBuildkite) {
    const { error, stdout } = await spawn(["buildkite-agent", "meta-data", "get", name]);
    if (!error) {
      const value = stdout.trim();
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

export async function setBuildMetadata(name: string, value: string): Promise<void> {
  if (isBuildkite) {
    const { error } = await spawn(["buildkite-agent", "meta-data", "set", name, value]);
    if (error) {
      console.error(`Failed to set build meta-data '${name}':`, error);
    }
  }
}

/** The fields of GitHub's "get the latest release" response that are read here. */
type GithubRelease = { tag_name: string };

/** The fields of GitHub's "compare two commits" response that are read here. */
type GithubComparison = { ahead_by?: unknown };

export async function getCanaryRevision(): Promise<number> {
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
  const { tag_name: latest } = release as GithubRelease;
  const { error: compareError, body: compare } = await curl(
    new URL(`repos/${repository}/compare/${latest}...${commit}`, getGithubApiUrl()),
    { json: true },
  );
  if (compareError) {
    return 1;
  }

  const { ahead_by: revision } = compare as GithubComparison;
  if (typeof revision === "number") {
    return revision;
  }

  return 1;
}

function getGithubApiUrl(): URL {
  return new URL(getEnv("GITHUB_API_URL", false) || "https://api.github.com");
}

export function sha256(string: string): string {
  return createHash("sha256").update(Buffer.from(string)).digest("hex");
}

function parseLevel(level?: string): "notice" | "warning" | "error" {
  if (/error|fatal|fail/i.test(level ?? "")) {
    return "error";
  }
  if (/warn|caution/i.test(level ?? "")) {
    return "warning";
  }
  return "notice";
}

export type Annotation = {
  title: string;
  content: string;
  source?: string | undefined;
  level?: "notice" | "warning" | "error" | undefined;
  url?: string | undefined;
  filename?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  metadata?: Record<string, string> | undefined;
};

/** What a log line was matched into, before parseAnnotation() normalizes it. */
export type AnnotationInput = {
  title?: string | undefined;
  content?: string | string[] | undefined;
  source?: string | undefined;
  level?: string | undefined;
  filename?: string | undefined;
  line?: string | undefined;
  column?: string | undefined;
  metadata?: Record<string, string | undefined> | undefined;
};

export type AnnotationContext = {
  cwd?: string;
  command?: string[];
};

export function parseAnnotation(options: AnnotationInput, context?: AnnotationContext): Annotation {
  const cwd = (context?.["cwd"] || process.cwd()).replace(/\\/g, "/");
  const source = options["source"];
  const level = parseLevel(options["level"]);
  const title = options["title"] || (source ? `${source} ${level}` : level);
  const path = options["filename"]?.replace(/\\/g, "/");
  const line = parseInt(options["line"] ?? "") || undefined;
  const column = parseInt(options["column"] ?? "") || undefined;
  const content = options["content"];
  const lines = Array.isArray(content) ? content : content?.split(/\r?\n/) || [];
  const metadata = Object.fromEntries(
    Object.entries(options["metadata"] || {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  // Drop leading blank lines, collapse runs of blank lines, and drop the
  // trailing blank line(s) a readUntil() in parseAnnotations() may have
  // consumed as a block terminator.
  const relevantLines: string[] = [];
  let lastLine: string | undefined;
  for (const line of lines) {
    if (!lastLine && !line.trim()) {
      continue;
    }
    lastLine = line.trim();
    relevantLines.push(line);
  }
  while (relevantLines.length > 0 && !relevantLines[relevantLines.length - 1]?.trim()) {
    relevantLines.pop();
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

export type AnnotationFormatOptions = {
  concise?: boolean;
  buildkite?: boolean;
};

export function formatAnnotationToHtml(annotation: Annotation, options: AnnotationFormatOptions = {}): string {
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

export type AnnotationResult = {
  annotations: Annotation[];
  content: string;
};

export function parseAnnotations(content: string): AnnotationResult {
  const annotations: Annotation[] = [];

  const originalLines = content.split(/\r?\n/);
  const lines: string[] = [];

  for (let i = 0; i < originalLines.length; i++) {
    const originalLine = originalLines[i]!;
    const line = stripAnsi(originalLine).trim();
    const bufferedLines = [originalLine];

    /**
     * Consume the lines after the current one into `bufferedLines`, through
     * the first line matching `pattern` (inclusive) or `maxLines` lines if
     * none matches. Leaves `i` on the last consumed line, so the outer loop
     * resumes after it; can be called again to consume further.
     */
    const readUntil = (pattern: RegExp, maxLines = 100): { lines: string[]; match: RegExpExecArray | undefined } => {
      const start = i + 1;
      let match: RegExpExecArray | undefined;

      while (i + 1 < originalLines.length && i + 1 - start < maxLines) {
        i++;
        const patternMatch = pattern.exec(stripAnsi(originalLines[i]!).trim());
        if (patternMatch) {
          match = patternMatch;
          break;
        }
      }

      const lines = originalLines.slice(start, i + 1);
      bufferedLines.push(...lines);
      return { lines, match };
    };

    // Github Actions
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
    const githubAnnotation = line.match(/^::(error|warning|notice|debug)(?: (.*))?::(.*)$/);
    if (githubAnnotation) {
      const [, level, attributes, content] = githubAnnotation;
      const { file, line, col, title } = Object.fromEntries(
        attributes?.split(",")?.map((entry): [string, string | undefined] => {
          // split() returns at least one element.
          const [key, value] = entry.split("=");
          return [key!, value];
        }) || [],
      );
      if (title === undefined) {
        // Kept from the JavaScript, where unescapeGitHubAction(undefined) threw a TypeError.
        throw new TypeError("The workflow command has no title");
      }

      const annotation = parseAnnotation({
        level,
        filename: file,
        line,
        column: col,
        // Group 3 of the pattern is not optional.
        content: unescapeGitHubAction(title) + unescapeGitHubAction(content!),
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

    // rustc / cargo error
    // e.g. error[E0308]: mismatched types
    //        --> src/http/lib.rs:553:5
    // The header line carries the level + (optional) code; the location
    // arrives on the following `-->` line (absent for diagnostics without a
    // span, e.g. "error: linking with `cc` failed"). The body runs until the
    // blank line rustc emits after every diagnostic, so the annotation
    // contains the rendered span + help/note lines; the cap is only a guard
    // against output that never has one.
    const rustHeader = line.match(/^(error|warning)(\[[A-Z0-9]+\])?: (.+)$/);
    if (rustHeader && !/\b(generated|emitted)\b/.test(line) /* "warning: 3 warnings emitted" */) {
      const [, level, code, title] = rustHeader;
      const { lines: body } = readUntil(/^$/, 30);
      const locMatch = stripAnsi(body[0] ?? "").match(/-->\s+(.+?):(\d+):(\d+)/);
      const annotation = parseAnnotation({
        source: "rustc",
        level,
        filename: locMatch?.[1],
        line: locMatch?.[2],
        column: locMatch?.[3],
        title: code ? `${code} ${title}` : title,
        content: bufferedLines,
      });
      annotations.push(annotation);
      continue;
    }

    const nodeJsError = line.match(/^file:\/\/(.+\.(?:c|m)js):(\d+)/i);
    if (nodeJsError) {
      const [, filename, line] = nodeJsError;

      let metadata: Record<string, string | undefined> | undefined;
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

export type BuildkiteAnnotation = {
  context?: string | undefined;
  label: string;
  content: string;
  style?: "error" | "warning" | "info";
  priority?: number;
  attempt?: number;
};

export function reportAnnotationToBuildKite({
  context,
  label,
  content,
  style = "error",
  priority = 3,
  attempt = 0,
}: BuildkiteAnnotation): void {
  if (!isBuildkite) {
    return;
  }
  // BuildKite rejects annotation contexts > 100 chars (`400 Bad Request: This
  // context is too long`). rustc diagnostic titles routinely exceed that and
  // were silently dropped, leaving only short warnings visible in the UI.
  const ctx = `${context || label}`.slice(0, 100);
  const { error, status, signal, stderr } = nodeSpawnSync(
    "buildkite-agent",
    ["annotate", "--append", "--style", `${style}`, "--context", ctx, "--priority", `${priority}`],
    {
      input: content,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
      timeout: 30_000,
    },
  );
  if (status === 0) {
    return;
  }
  const cause = error?.message || signal || (status == null ? "timed out" : `exit code ${status}`);
  if (attempt === 0) {
    console.error(`buildkite-agent annotate failed for '${label}' (${cause}), retrying...`);
    return reportAnnotationToBuildKite({ context, label, content, style, priority, attempt: attempt + 1 });
  }
  // Annotations are best-effort: log and move on rather than throwing, which
  // would abort the test runner mid-suite over a cosmetic failure.
  console.error(`buildkite-agent annotate failed for '${label}' after retry (${cause}), giving up`);
  if (stderr) console.error(stderr);
}

/**
 * Mark this Buildkite job as having handled its own failure reporting.
 *
 * The repository `.buildkite/hooks/pre-exit` hook posts a generic fallback
 * annotation for any step that exits non-zero without this marker set, so
 * infra failures that happen before (or crash) the runner/build scripts are
 * still surfaced in the build's annotation list instead of being visible only
 * in the raw job log. Call this from every controlled exit path that has
 * already posted (or had nothing to post) so the fallback stays quiet. The
 * marker is build meta-data, which is server-side and so remains visible to
 * the host pre-exit hook even when the reporter ran inside an ephemeral VM.
 */
export function markBuildkiteStepReported(): void {
  if (!isBuildkite) return;
  const jobId = getEnv("BUILDKITE_JOB_ID", false);
  if (!jobId) return;
  const { status } = nodeSpawnSync("buildkite-agent", ["meta-data", "set", `reported-${jobId}`, "1"], {
    stdio: "ignore",
    timeout: 30_000,
  });
  if (status !== 0) {
    console.error(`buildkite-agent meta-data set reported-${jobId} failed (non-fatal)`);
  }
}

export function toYaml(obj: object, indent = 0): string {
  const spaces = " ".repeat(indent);
  let result = "";
  const entries: [string, unknown][] = Object.entries(obj);
  for (const [key, value] of entries) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      result += `${spaces}${key}: null\n`;
      continue;
    }
    if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      value.forEach((item: unknown) => {
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
        value.includes("\\") ||
        value.includes("\n") ||
        value.includes("*") ||
        value.includes("&") ||
        value.includes("!") ||
        value.includes("|") ||
        value.includes(">") ||
        value.includes("%") ||
        value.includes("@") ||
        value.includes("`") ||
        value.includes("{") ||
        value.includes("}") ||
        value.includes("[") ||
        value.includes("]") ||
        value.includes(",") ||
        value.includes(";"))
    ) {
      result += `${spaces}${key}: "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
      continue;
    }
    result += `${spaces}${key}: ${value}\n`;
  }
  return result;
}

let lastGroup: string | undefined;

export function startGroup<T>(title: string, fn: () => Promise<T>): Promise<T>;
export function startGroup(title: string, fn?: () => unknown): void;
export function startGroup(title: string, fn?: () => unknown): Promise<unknown> | void {
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

export function endGroup(): void {
  if (lastGroup) {
    lastGroup = undefined;
  }

  if (isGithubAction) {
    console.log("::endgroup::");
  } else {
    console.groupEnd();
  }
  // when a file exits with an ASAN error, there is no trailing newline so we add one here to make sure `console.group()` detection doesn't get broken in CI.
  console.log();
}

export type LiveOutputFilterOptions = {
  /** the runner itself runs in GitHub Actions */
  github?: boolean;
  /** the runner itself runs in Buildkite */
  buildkite?: boolean;
};

export type LiveOutputFilter = ((chunk: string) => string) & { end: () => string };

/**
 * Creates a filter for the live output of one child process stream, for the CI log.
 *
 * The runner spawns every `bun test` with GITHUB_ACTIONS=true so that bun prints each
 * failure as a `::error` workflow command it can parse, and the file headers as
 * `::group::` commands. Those lines are for the parser, not for the log: GitHub renders
 * them as annotations, Buildkite prints them verbatim. So outside GitHub Actions every
 * line that starts with `::` is dropped. In GitHub Actions the group commands are dropped
 * (the runner groups the log itself) and the rest is kept for GitHub to render. In
 * Buildkite a line that starts with one of its group markers (`--- `) is defused too.
 *
 * The output arrives in pipe-sized chunks, and bun writes a `::error` line as many small
 * writes, so a chunk usually ends in the middle of one. An incomplete last line that
 * starts with `::`, or that is so far only the start of a marker, is held back until
 * the rest of it arrives. `end()` returns what is still held back when the stream ends.
 *
 * @returns the text to write for each chunk
 */
export function createLiveOutputFilter({
  github = isGithubAction,
  buildkite = isBuildkite,
}: LiveOutputFilterOptions = {}): LiveOutputFilter {
  const ansi = /(?:\u001b\[[0-9;]*[a-zA-Z])*/.source;
  const command = `^${ansi}::${github ? "(?:end)?group::" : ""}.*`;
  const commands = new RegExp(`${command}(?:\r\n|\r|\n)`, "gm");
  const lastCommand = new RegExp(`${command}\r?$`);
  const groupMarkers = /^(?:---|\+\+\+|~~~|\^\^\^) /gm;
  const markers = buildkite ? ["::", "--- ", "+++ ", "~~~ ", "^^^ "] : ["::"];

  /** `line` is an incomplete line. */
  const holdBack = (line: string) => {
    const visible = stripAnsi(line);
    return (
      visible.startsWith("::") || markers.some(marker => marker.length > visible.length && marker.startsWith(visible))
    );
  };

  let pending = "";
  let atLineStart = true;
  const filter = (chunk: string) => {
    let text = pending + chunk;
    const startsLine = atLineStart;

    // A trailing \r may be the first half of a \r\n, so the line it ends is not complete yet.
    // Once written, the next chunk starts a line either way: the \n of a \r\n is an empty one.
    const endsWithCR = text.endsWith("\r");
    const searchEnd = endsWithCR ? text.length - 2 : text.length - 1;
    const lastLineStart = Math.max(text.lastIndexOf("\n", searchEnd), text.lastIndexOf("\r", searchEnd)) + 1;
    const lastLine = text.slice(lastLineStart);
    if (lastLine && (lastLineStart > 0 || startsLine) && holdBack(lastLine)) {
      pending = lastLine;
      text = text.slice(0, lastLineStart);
      atLineStart = true;
    } else {
      pending = "";
      if (text) atLineStart = endsWithCR || lastLineStart === text.length;
    }

    // A chunk that starts in the middle of a line continues a line that was already written.
    let head = "";
    if (!startsLine) {
      const end = /\r\n|\r|\n/.exec(text);
      const split = end ? end.index + end[0].length : text.length;
      head = text.slice(0, split);
      text = text.slice(split);
    }

    text = text.replace(commands, "");
    if (buildkite) text = text.replace(groupMarkers, " ");
    return head + text;
  };
  filter.end = () => {
    const text = pending;
    pending = "";
    atLineStart = true;
    return text.replace(lastCommand, "");
  };
  return filter;
}

export function printEnvironment(): void {
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
      for (const [key, value] of Object.entries(process.env).sort()) {
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
      startGroup("Disk (df)", () => {
        const shell = which(["sh", "bash"]);
        if (shell) {
          spawnSync([shell, "-c", "df"], { stdio: "inherit" });
        }
      });
    }
    if (isLinux) {
      startGroup("Memory", () => {
        const shell = which(["sh", "bash"]);
        if (shell) {
          spawnSync([shell, "-c", "free -m -w"], { stdio: "inherit" });
        }
      });
      startGroup("Docker", () => {
        const shell = which(["sh", "bash"]);
        if (shell) {
          spawnSync([shell, "-c", "docker ps"], { stdio: "inherit" });
        }
      });
    }
    if (isWindows) {
      startGroup("Disk (win)", () => {
        const shell = which(["pwsh"]);
        if (shell) {
          spawnSync([shell, "-c", "get-psdrive"], { stdio: "inherit" });
        }
      });
      startGroup("Memory", () => {
        const shell = which(["pwsh"]);
        if (shell) {
          spawnSync([shell, "-c", "Get-Counter '\\Memory\\Available MBytes'"], { stdio: "inherit" });
          console.log();
          spawnSync([shell, "-c", "Get-CimInstance Win32_PhysicalMemory"], { stdio: "inherit" });
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

export function getLoggedInUserCountOrDetails(): number | string | undefined {
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
      // Only count REMOTE logins (have an `(ip)` suffix from sshd). A local
      // console/auto-login (e.g. cirruslabs CI VM images log the admin user in
      // on ttys000 at boot) has no source host and isn't a human debugging the
      // job — waiting for it would hang the runner forever.
      .filter(line => /\([^)]+\)\s*$/.test(line))
      .map(line => {
        // `who` output: `username terminal date time (host)`. The date/time
        // field has spaces, so a plain split() can't slice it cleanly — take
        // the first two tokens and pull the host from the trailing `(...)`.
        const [username, terminal] = line.split(/\s+/);
        const ip = line.match(/\(([^)]+)\)\s*$/)?.[1] || "";
        return { username, terminal, ip };
      });

    if (users.length === 0) {
      return 0;
    }

    let message = `${users.length} currently logged in users:`;

    for (const user of users) {
      message += `\n- ${user.username} on ${user.terminal}${user.ip ? ` from ${user.ip}` : ""}`;
    }

    return message;
  }

  return undefined;
}

export type Emoji = keyof typeof emojiMap;

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
  package: ["📦", "package"],
  rocket: ["🚀", "rocket"],
  openbsd: ["🐡", "openbsd"],
  netbsd: ["🚩", "netbsd"],
  freebsd: ["😈", "freebsd"],
};

export function getEmoji(emoji: Emoji): string {
  const [unicode] = emojiMap[emoji] || [];
  return unicode || "";
}

/**
 * @link https://github.com/buildkite/emojis#emoji-reference
 */
export function getBuildkiteEmoji(emoji: Emoji): string {
  const [, name] = emojiMap[emoji] || [];
  return name ? `:${name}:` : "";
}
