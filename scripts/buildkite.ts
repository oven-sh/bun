// The CI environment the scripts run in: what Buildkite and GitHub say about
// the build (branch, commit, pull request, fork), cluster secrets, build
// meta-data, artifacts, annotations and log groups.

import { spawnSync as nodeSpawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { getAbi, getAbiVersion, getArch, getDistro, getDistroVersion, getHostname, getKernel, getOs } from "./agent.ts";
import {
  debugLog,
  getEnv,
  isBuildkite,
  isCI,
  isGithubAction,
  isLinux,
  isMacOS,
  isPosix,
  isWindows,
  spawn,
  spawnSafe,
  spawnSync,
  tmpdir,
  which,
} from "./process.ts";

type SecretOptions = {
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

type CurlOptions = {
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

type CurlResult = {
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
      // An earlier attempt's failure is not this request's.
      error = undefined;
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
type BuildkiteBuild = {
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

function getUsername(): string {
  const { username } = userInfo();
  return username;
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

type BuildkiteAnnotation = {
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
