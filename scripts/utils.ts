// Contains utility functions for various scripts, including:
// CI, running tests, and code generation.

import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions as NodeSpawnOptions,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type StdioOptions,
} from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir as nodeTmpdir, release, userInfo } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
// Node built for Termux/bionic reports "android"; CI models that as linux + abi=android.
export const isAndroid = process.platform === "android";
export const isLinux = process.platform === "linux" || isAndroid;
const isFreeBSD = process.platform === "freebsd";
export const isPosix = isMacOS || isLinux || isFreeBSD;

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
};

export type SpawnResult = {
  exitCode: number | null;
  signalCode: string | null | undefined;
  stdout: string;
  stderr: string;
  error: Error | undefined;
};

export async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const [cmd, ...args] = command;
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
  const [cmd, ...args] = command;
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

  const nthStatus = readFileSync(ntStatusPath, "utf8");
  const match = nthStatus.match(new RegExp(`(STATUS_\\w+).*0x${exitCode?.toString(16)}`, "i"));
  if (match) {
    const [, exitReason] = match;
    return exitReason;
  }

  return undefined;
}

export function parseGitUrl(url: string | URL): URL | undefined {
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

export function getRepositoryUrl(cwd?: string): URL | undefined {
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

export function isPullRequest(): boolean {
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
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as GithubEvent;
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
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as GithubEvent;
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
        mkdirSync(dirname(filename), { recursive: true });
        writeFileSync(filename, new Uint8Array(buffer));
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

export function getFileUrl(filename?: string, line?: number | string): URL | string | undefined {
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

/** The fields of Buildkite's build JSON (`<build url>.json`) that are read here and in .buildkite/ci.ts. */
export type BuildkiteBuild = {
  id: string;
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
      const releaseFile = readFileSync(releasePath, "utf8");
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
      const release = readFileSync(alpinePath, "utf8").trim();
      if (release.includes("_")) {
        const [version] = release.split("_");
        return `${version}-edge`;
      }
      return release;
    }

    const releasePath = "/etc/os-release";
    if (existsSync(releasePath)) {
      const releaseFile = readFileSync(releasePath, "utf8");
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
