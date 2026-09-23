// The CI environment the scripts run in: what Buildkite and GitHub say about
// the build (branch, commit, pull request, fork), cluster secrets, build
// meta-data, artifacts, annotations and log groups.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import {
  getAbi,
  getAbiVersion,
  getArch,
  getDistro,
  getDistroVersion,
  getHostname,
  getKernel,
  getOs,
  isLinux,
  isMacOS,
  isPosix,
  isWindows,
  output,
  request,
  run,
  tmpdir,
  which,
} from "./agent.ts";

export const isBuildkite = process.env.BUILDKITE === "true";
export const isGithubAction = process.env.GITHUB_ACTIONS === "true";
export const isCI = process.env.CI === "true" || isBuildkite || isGithubAction;

/** An environment variable that has to be set. */
export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable is missing: ${name}`);
  }
  return value;
}

interface SecretOptions {
  required?: boolean;
}

export function getSecret(name: string, options?: SecretOptions & { required?: true }): string;

export function getSecret(name: string, options: SecretOptions): string | undefined;

export function getSecret(name: string, { required = true }: SecretOptions = {}): string | undefined {
  const value = process.env[name];
  if (value) {
    return value;
  }

  if (isBuildkite) {
    const secret = output(["buildkite-agent", "secret", "get", name])?.trim();
    if (!secret) {
      const orgId = process.env.BUILDKITE_ORGANIZATION_SLUG;
      const clusterId = process.env.BUILDKITE_CLUSTER_ID;

      let hint;
      if (orgId && clusterId) {
        hint = `https://buildkite.com/organizations/${orgId}/clusters/${clusterId}/secrets`;
      } else {
        hint = "https://buildkite.com/docs/pipelines/buildkite-secrets";
      }

      throw new Error(`Secret not found: ${name} (hint: go to ${hint} and create a secret)`);
    }

    process.env[name] = secret;
    return secret;
  }

  return required ? getEnv(name) : undefined;
}

export function parseGitUrl(url: string | URL): URL | undefined {
  const string = typeof url === "string" ? url : url.toString();

  const githubUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
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
      const repository = process.env.BUILDKITE_REPO;
      if (repository) {
        return parseGitUrl(repository);
      }
    }

    if (isGithubAction) {
      const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
      const repository = process.env.GITHUB_REPOSITORY;
      if (serverUrl && repository) {
        return parseGitUrl(new URL(repository, serverUrl));
      }
    }
  }

  const stdout = output(["git", "remote", "get-url", "origin"], { cwd });
  if (stdout !== undefined) {
    return parseGitUrl(stdout.trim());
  }

  return undefined;
}

export function getCommit(cwd?: string): string | undefined {
  if (!cwd) {
    if (isBuildkite) {
      const commit = process.env.BUILDKITE_COMMIT;
      if (commit) {
        return commit;
      }
    }

    if (isGithubAction) {
      const commit = process.env.GITHUB_SHA;
      if (commit) {
        return commit;
      }
    }
  }

  const stdout = output(["git", "rev-parse", "HEAD"], { cwd });
  if (stdout !== undefined) {
    return stdout.trim();
  }

  return undefined;
}

export function getCommitMessage(): string | undefined {
  if (isBuildkite) {
    const message = process.env.BUILDKITE_MESSAGE;
    if (message) {
      return message;
    }
  }

  const stdout = output(["git", "log", "-1", "--pretty=%B"]);
  if (stdout !== undefined) {
    return stdout.trim();
  }

  return undefined;
}

export function getBranch(): string | undefined {
  if (isBuildkite) {
    const branch = process.env.BUILDKITE_BRANCH;
    if (branch) {
      return branch;
    }
  }

  if (isGithubAction) {
    const ref = process.env.GITHUB_REF_NAME;
    if (ref) {
      return ref;
    }
  }

  const stdout = output(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  if (stdout !== undefined) {
    return stdout.trim();
  }

  return undefined;
}

function getMainBranch(): string | undefined {
  if (isBuildkite) {
    const branch = process.env.BUILDKITE_PIPELINE_DEFAULT_BRANCH;
    if (branch) {
      return branch;
    }
  }

  if (isGithubAction) {
    const headRef = process.env.GITHUB_HEAD_REF;
    if (headRef) {
      return headRef;
    }
  }

  const stdout = output(["git", "symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (stdout !== undefined) {
    return stdout.trim().replace("refs/remotes/origin/", "");
  }

  return undefined;
}

export function isMainBranch(): boolean {
  return !isFork() && getBranch() === getMainBranch();
}

/** The fields of the GitHub Actions event payload (`GITHUB_EVENT_PATH`) that are read here. */
interface GithubEvent {
  pull_request?: {
    number: number;
    head: { repo: { fork: boolean } };
  };
}

export function isPullRequest(): boolean {
  if (isBuildkite) {
    return !isNaN(parseInt(process.env.BUILDKITE_PULL_REQUEST ?? ""));
  }

  if (isGithubAction) {
    return /pull_request|merge_group/.test(process.env.GITHUB_EVENT_NAME ?? "");
  }

  return false;
}

function getPullRequest(): number | undefined {
  if (isBuildkite) {
    const pullRequest = process.env.BUILDKITE_PULL_REQUEST;
    if (pullRequest) {
      return parseInt(pullRequest);
    }
  }

  if (isGithubAction) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as GithubEvent;
      const pullRequest = event.pull_request;
      if (pullRequest) {
        return parseInt(`${pullRequest.number}`);
      }
    }
  }

  return undefined;
}

function getTargetBranch(): string | undefined {
  if (isPullRequest()) {
    if (isBuildkite) {
      return process.env.BUILDKITE_PULL_REQUEST_BASE_BRANCH;
    }

    if (isGithubAction) {
      return process.env.GITHUB_BASE_REF;
    }
  }

  return undefined;
}

export function isFork(): boolean {
  if (isBuildkite) {
    const repository = process.env.BUILDKITE_PULL_REQUEST_REPO;
    return !!repository && repository !== process.env.BUILDKITE_REPO;
  }

  if (isGithubAction) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath && existsSync(eventPath)) {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as GithubEvent;
      const pullRequest = event.pull_request;
      if (pullRequest) {
        return !!pullRequest.head.repo.fork;
      }
    }
  }

  return false;
}

export function isMergeQueue(): boolean {
  return /^gh-readonly-queue/.test(getBranch() ?? "");
}

function getGithubToken(): string | undefined {
  const cachedToken = getSecret("GITHUB_TOKEN", { required: false });

  if (typeof cachedToken === "string" || !which(["gh"])) {
    return cachedToken || undefined;
  }

  const token = output(["gh", "auth", "token"])?.trim() ?? "";

  process.env.GITHUB_TOKEN = token;
  return token || undefined;
}

/** The JSON at `url`, asked for up to three times; GitHub's API gets the token when there is one. */
export async function getJson(url: string | URL): Promise<{ error: Error | undefined; body: unknown }> {
  const { hostname, href } = new URL(url);
  const githubToken = hostname === "api.github.com" ? getGithubToken() : undefined;
  return request(href, {
    headers: githubToken ? { Authorization: `Bearer ${githubToken}` } : {},
    json: true,
    attempts: 3,
  });
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
    const baseUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
    const repository = getEnv("GITHUB_REPOSITORY");
    const runId = getEnv("GITHUB_RUN_ID");
    return new URL(`${repository}/actions/runs/${runId}`, baseUrl);
  }

  return undefined;
}

export function getBuildLabel(): string | undefined {
  if (isBuildkite) {
    const label = process.env.BUILDKITE_LABEL || process.env.BUILDKITE_GROUP_LABEL;
    if (label) {
      return label;
    }
  }

  if (isGithubAction) {
    const label = process.env.GITHUB_WORKFLOW;
    if (label) {
      return label;
    }
  }

  return undefined;
}

export function getFileUrl(filename: string, line?: number | string): string | undefined {
  let cwd: string | undefined;
  if (filename.startsWith("vendor")) {
    const parentPath = resolve(dirname(filename));
    cwd = output(["git", "rev-parse", "--show-toplevel"], { cwd: parentPath })?.trim();
    if (cwd === undefined) {
      return;
    }
  }

  const baseUrl = getRepositoryUrl(cwd);
  const filePath = (cwd ? relative(cwd, filename) : filename).replace(/\\/g, "/");
  const commit = getCommit(cwd);
  const url = new URL(`blob/${commit}/${filePath}`, `${baseUrl}/`).toString();
  return line === undefined ? url : `${url}#L${line}`;
}

/** The fields of Buildkite's build JSON (`<build url>.json`) that are read here and in .buildkite/ci.ts. */
interface BuildkiteBuild {
  id: string;
  state: string;
  prev_branch_build?: { url: string } | null;
  steps: { label: string; outcome: string }[];
}

export async function getLastSuccessfulBuild(): Promise<BuildkiteBuild | undefined> {
  if (isBuildkite) {
    let depth = 0;
    let url = getBuildUrl();
    if (url) {
      url.hash = "";
    }

    while (url) {
      const { error, body } = await getJson(`${url}.json`);
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

      url = new URL(previousBuild.url, url);
    }
  }

  return undefined;
}

/** The fields of GitHub's "list pull request files" response that are read here. */
interface GithubPullRequestFile {
  filename: string;
  status: string;
}

/**
 * The files of the pull request this Buildkite build is for, and the ones
 * among them that it adds; none when the build is not for a pull request.
 */
export async function getPullRequestFiles(): Promise<{ allFiles: string[]; newFiles: string[] }> {
  const allFiles: string[] = [];
  const newFiles: string[] = [];
  if (!isPullRequest()) {
    return { allFiles, newFiles };
  }
  const perPage = 50;
  const pullRequest = process.env.BUILDKITE_PULL_REQUEST;
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://api.github.com/repos/oven-sh/bun/pulls/${pullRequest}/files?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${getSecret("GITHUB_TOKEN")}` } },
    );
    const files = (await response.json()) as GithubPullRequestFile[] | Record<string, unknown>;
    if (!response.ok || !Array.isArray(files)) {
      throw new Error(`GitHub API ${response.status} ${response.statusText} on page ${page}: ${JSON.stringify(files)}`);
    }
    console.log(`-> page ${page}, found ${files.length} items`);
    for (const { filename, status } of files) {
      allFiles.push(filename);
      if (status === "added") {
        newFiles.push(filename);
      }
    }
    if (files.length < perPage) {
      break;
    }
  }
  console.log(`- PR ${pullRequest}, ${allFiles.length} files, ${newFiles.length} new files`);
  return { allFiles, newFiles };
}

/**
 * `filename` is the absolute path to the file to upload.
 */
export async function uploadArtifact(filename: string): Promise<void> {
  if (isBuildkite) {
    await run(["buildkite-agent", "artifact", "upload", basename(filename)], { cwd: dirname(filename) });
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

export interface JunitFileSuite {
  /** failed tests in the whole file, describe blocks included */
  failures: number;
  /** wall clock of the whole file, loading it included */
  seconds: number;
  /** the failed tests, in report order */
  cases: { name: string; message: string }[];
}

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
  const stdout = output([tailscale, "ip", "--1"]);
  if (stdout !== undefined) {
    return stdout.trim();
  }

  return undefined;
}

function getPublicIp(): string | undefined {
  for (const url of ["https://checkip.amazonaws.com", "https://ipinfo.io/ip"]) {
    const stdout = output(["curl", url]);
    if (stdout !== undefined) {
      return stdout.trim();
    }
  }

  return undefined;
}

export function getBuildMetadata(name: string): string | undefined {
  if (isBuildkite) {
    return output(["buildkite-agent", "meta-data", "get", name])?.trim() || undefined;
  }

  return undefined;
}

interface BuildkiteAnnotation {
  context?: string | undefined;
  label: string;
  content: string;
  style?: "error" | "warning" | "info";
  priority?: number;
  /** Add to what the context already says (the default), or say this instead of it. */
  append?: boolean;
}

export function reportAnnotationToBuildkite({
  context,
  label,
  content,
  style = "error",
  priority = 3,
  append = true,
}: BuildkiteAnnotation): void {
  if (!isBuildkite) {
    return;
  }
  // BuildKite rejects annotation contexts > 100 chars (`400 Bad Request: This
  // context is too long`). rustc diagnostic titles routinely exceed that and
  // were silently dropped, leaving only short warnings visible in the UI.
  const ctx = `${context || label}`.slice(0, 100);
  for (const attempt of [1, 2]) {
    const { error, status, signal, stderr } = spawnSync(
      "buildkite-agent",
      [
        "annotate",
        ...(append ? ["--append"] : []),
        "--style",
        `${style}`,
        "--context",
        ctx,
        "--priority",
        `${priority}`,
      ],
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
    if (attempt === 1) {
      console.error(`buildkite-agent annotate failed for '${label}' (${cause}), retrying...`);
      continue;
    }
    // Annotations are best-effort: log and move on rather than throwing, which
    // would abort the test runner mid-suite over a cosmetic failure.
    console.error(`buildkite-agent annotate failed for '${label}' after retry (${cause}), giving up`);
    if (stderr) console.error(stderr);
  }
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
  const jobId = process.env.BUILDKITE_JOB_ID;
  if (!jobId) return;
  const { status } = spawnSync("buildkite-agent", ["meta-data", "set", `reported-${jobId}`, "1"], {
    stdio: "ignore",
    timeout: 30_000,
  });
  if (status !== 0) {
    console.error(`buildkite-agent meta-data set reported-${jobId} failed (non-fatal)`);
  }
}

export function startGroup<T>(title: string, fn: () => Promise<T>): Promise<T>;

export function startGroup(title: string, fn?: () => unknown): void;

export function startGroup(title: string, fn?: () => unknown): Promise<unknown> | void {
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

function endGroup(): void {
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
    console.log("Username:", userInfo().username);
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

    const show = (title: string, shells: string[], ...scripts: string[]) =>
      startGroup(title, () => {
        const shell = which(shells);
        for (const script of shell ? scripts : []) {
          spawnSync(shell!, ["-c", script], { stdio: "inherit" });
        }
      });
    if (isPosix) {
      show("Limits", ["sh", "bash"], "ulimit -a");
      show("Disk (df)", ["sh", "bash"], "df");
    }
    if (isLinux) {
      show("Memory", ["sh", "bash"], "free -m -w");
      show("Docker", ["sh", "bash"], "docker ps");
    }
    if (isWindows) {
      show("Disk (win)", ["pwsh"], "get-psdrive");
      show("Memory", ["pwsh"], "Get-Counter '\\Memory\\Available MBytes'", "Get-CimInstance Win32_PhysicalMemory");
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
