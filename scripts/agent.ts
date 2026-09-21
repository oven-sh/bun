#!/usr/bin/env node

// Installs and starts the Buildkite agent service on a CI machine.
//
// This is the one file of Bun's that runs on a CI machine outside a checkout:
// `install` copies it into the agent's home, and the machine's service runs the
// copy. So it imports nothing but Node. The rest of the CI scripts import what
// it knows about the machine (os, arch, abi, distro, ...) from here.

import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir as osTmpdir, release } from "node:os";
import { dirname, join } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";
import { fileURLToPath } from "node:url";
import { inspect, parseArgs } from "node:util";

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
// Node built for Termux/bionic reports "android"; CI models that as linux + abi=android.
export const isAndroid = process.platform === "android";
export const isLinux = process.platform === "linux" || isAndroid;
export const isPosix = isMacOS || isLinux || process.platform === "freebsd";

/** The path of the first of `names` found on PATH. */
export function which(names: string[]): string | undefined {
  const executables = isWindows ? names.flatMap(name => [name, `${name}.exe`, `${name}.cmd`]) : names;
  for (const directory of (process.env.PATH || "").split(isWindows ? ";" : ":")) {
    for (const executable of executables) {
      const path = join(directory, executable);
      if (existsSync(path)) {
        return path;
      }
    }
  }
  return undefined;
}

/** The path of `name` on PATH; it has to be there. */
export function requireCommand(name: string): string {
  const path = which([name]);
  if (path === undefined) {
    throw new Error(`Command not found: ${name}`);
  }
  return path;
}

function describeCommand(command: Command): string {
  return command.map(arg => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
}

/** A program and its arguments. */
export type Command = [string, ...string[]];

/** What `command` prints, or undefined if it cannot be run or fails. */
export function output(command: Command, options: { cwd?: string | undefined } = {}): string | undefined {
  const [file, ...args] = command;
  const { error, status, stdout } = spawnSync(file, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return error || status !== 0 ? undefined : stdout;
}

/** Runs `command` on this process's stdio, and throws unless it exits with 0. */
export async function run(command: Command, options: { cwd?: string } = {}): Promise<void> {
  const [file, ...args] = command;
  const child = spawn(file, args, { ...options, stdio: "inherit" });
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.on("error", cause => reject(new Error(`Command failed to start: ${describeCommand(command)}`, { cause })));
    child.on("close", (code, signal) => resolve([code, signal]));
  });
  if (signal) {
    throw new Error(`Command killed with ${signal}: ${describeCommand(command)}`);
  }
  if (code !== 0) {
    throw new Error(`Command exited with code ${code}: ${describeCommand(command)}`);
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string> | undefined;
  body?: string;
  /** Parse the body of a successful response as JSON. */
  json?: boolean;
  /** How many times to try. */
  attempts: number;
}

/**
 * A request to the cloud's metadata or secret service. Those are not always up
 * yet when the agent starts at boot, so a failed attempt is repeated, a little
 * later each time. A 400, 404 or 422 is an answer, not a failure to repeat.
 */
export async function request(
  url: string,
  options: RequestOptions,
): Promise<{ error: Error | undefined; body: unknown }> {
  const { method = "GET", headers = {}, body: input, json, attempts } = options;
  let error: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    let body: unknown;
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: input ?? null });
      body = json && response.ok ? await response.json() : await response.text();
    } catch (cause) {
      error = new Error(`Fetch failed: ${method} ${url}`, { cause });
      continue;
    }
    if (response.ok) {
      return { error: undefined, body };
    }
    error = new Error(`Fetch failed: ${method} ${url}: ${response.status} ${response.statusText}`, { cause: body });
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      return { error, body };
    }
  }
  return { error, body: undefined };
}

/** The temp directory to use on this machine. */
export function tmpdir(): string {
  if (isWindows) {
    for (const key of ["TMPDIR", "TEMP", "TEMPDIR", "TMP", "RUNNER_TEMP"]) {
      const tmpdir = process.env[key];
      if (!tmpdir || /cygwin|cygdrive/i.test(tmpdir) || !/^[a-z]/i.test(tmpdir)) {
        continue;
      }
      return normalizeWindows(tmpdir);
    }

    const appData = process.env.LOCALAPPDATA;
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

  return osTmpdir();
}

export type Os = "darwin" | "linux" | "windows" | "freebsd";

export type Arch = "x64" | "aarch64";

export type Abi = "musl" | "gnu" | "android";

export function getOs(): Os {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
    case "android":
      return "linux";
    case "freebsd":
      return "freebsd";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported operating system: ${process.platform}`);
  }
}

export function getArch(): Arch {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "aarch64";
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
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

  const stdout = output(["ldd", "--version"]);
  if (stdout !== undefined) {
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

  const stdout = output(["ldd", "--version"]);
  if (stdout !== undefined) {
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

export function getHostname(): string {
  if (process.env.BUILDKITE === "true") {
    const agent = process.env.BUILDKITE_AGENT_NAME;
    if (agent) {
      return agent;
    }
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const runner = process.env.RUNNER_NAME;
    if (runner) {
      return runner;
    }
  }

  return hostname();
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

    const stdout = output(["lsb_release", "-is"]);
    if (stdout !== undefined) {
      return stdout.trim().toLowerCase();
    }
  }

  if (isWindows) {
    const stdout = output(["cmd", "/c", "ver"]);
    if (stdout !== undefined) {
      return stdout.trim();
    }
  }

  return undefined;
}

export function getDistroVersion(): string | undefined {
  if (isMacOS) {
    const stdout = output(["sw_vers", "-productVersion"]);
    if (stdout !== undefined) {
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

    const stdout = output(["lsb_release", "-rs"]);
    if (stdout !== undefined) {
      return stdout.trim();
    }
  }

  if (isWindows) {
    const stdout = output(["cmd", "/c", "ver"]);
    if (stdout !== undefined) {
      return stdout.trim();
    }
  }

  return undefined;
}

type Cloud = "aws" | "google" | "azure";

function isAws(): boolean {
  if (isLinux) {
    if (release().endsWith("-aws")) {
      return true;
    }

    if (output(["systemd-detect-virt"])?.includes("amazon")) {
      return true;
    }

    const dmiPath = "/sys/devices/virtual/dmi/id/board_asset_tag";
    if (existsSync(dmiPath) && readFileSync(dmiPath, "utf8").startsWith("i-")) {
      return true;
    }
  }

  if (isWindows) {
    if (process.env.AWS_EXECUTION_ENV === "EC2") {
      return true;
    }

    const manufacturer = output([
      "powershell",
      "-Command",
      "Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object Manufacturer",
    ]);
    return manufacturer?.includes("Amazon") ?? false;
  }

  return false;
}

function isGoogleCloud(): boolean {
  if (!isLinux) {
    return false;
  }
  const vendorPaths = [
    "/sys/class/dmi/id/sys_vendor",
    "/sys/class/dmi/id/bios_vendor",
    "/sys/class/dmi/id/product_name",
  ];
  return vendorPaths.some(path => existsSync(path) && readFileSync(path, "utf8").includes("Google"));
}

/** The fields of the Azure IMDS instance document that are read here. */
type AzureInstanceMetadata = {
  compute?: {
    azEnvironment?: string;
    tagsList?: { name: string; value: string }[];
  };
} | null;

async function isAzure(): Promise<boolean> {
  // Azure IMDS (Instance Metadata Service) — the official way to detect Azure VMs.
  // https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service
  const { error, body } = await request("http://169.254.169.254/metadata/instance?api-version=2021-02-01", {
    headers: { "Metadata": "true" },
    attempts: 1,
  });
  if (error || typeof body !== "string") {
    return false;
  }
  try {
    const metadata = JSON.parse(body) as AzureInstanceMetadata;
    return Boolean(metadata?.compute?.azEnvironment);
  } catch {
    return false;
  }
}

/** The cloud this machine is in, if any. */
async function getCloud(): Promise<Cloud | undefined> {
  if (isAws()) {
    return "aws";
  }
  if (isGoogleCloud()) {
    return "google";
  }
  if (await isAzure()) {
    return "azure";
  }
  return undefined;
}

/**
 * The metadata entry at `name`. Azure has no entries: it serves one JSON
 * document, which is what this returns whatever the name.
 */
async function getCloudMetadata(name: string, cloud: Cloud): Promise<string | undefined> {
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

  const { error, body } = await request(url.href, { headers, attempts: 10 });
  if (error) {
    console.warn("Failed to get cloud metadata:", error);
    return;
  }

  // Without the json option, the body of a response is its text.
  return typeof body === "string" ? body.trim() : undefined;
}

async function getCloudMetadataTag(tag: string, cloud: Cloud): Promise<string | undefined> {
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

  return getCloudMetadata(cloud === "aws" ? `tags/instance/${tag}` : `labels/${tag.replace(":", "-")}`, cloud);
}

interface AwsCredentials {
  AccessKeyId: string;
  SecretAccessKey: string;
  Token?: string;
}

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

interface AwsRequest {
  method: string;
  host: string;
  path: string;
  body: string;
  service: string;
  region: string;
  headers: Record<string, string>;
  credentials: AwsCredentials;
  date?: Date;
}

/**
 * Signs an AWS API request (SigV4). Only this script is installed on a CI
 * machine, so there is no SDK to call.
 * @returns headers, including Authorization
 */
function signAwsRequest({
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

interface AwsSecretOptions {
  /** defaults to the instance's region */
  region?: string;
  /** defaults to IMDS credentials */
  credentials?: AwsCredentials;
}

/** The field of the Secrets Manager GetSecretValue response that is read here. */
type AwsSecretValue = { SecretString?: string } | null | undefined;

/**
 * Reads a secret from AWS Secrets Manager using the instance role.
 */
async function getAwsSecret(secretId: string, options: AwsSecretOptions = {}): Promise<string | undefined> {
  const region = options.region || (await getCloudMetadata("placement/region", "aws")) || "us-east-1";
  const credentials = options.credentials || (await getAwsInstanceCredentials());
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

  const { error, body: response } = await request(`https://${host}/`, {
    method: "POST",
    headers,
    body,
    json: true,
    attempts: 5,
  });
  if (error) {
    console.warn("Failed to get AWS secret:", error);
    return;
  }

  return (response as AwsSecretValue)?.SecretString;
}

/** The field of the managed identity token response that is read here. */
type AzureIdentityToken = { access_token?: string } | null | undefined;

/** The field of the Key Vault "get secret" response that is read here. */
type AzureSecretValue = { value?: string } | null | undefined;

/**
 * Reads a secret from Azure Key Vault using the VM's managed identity.
 */
async function getAzureSecret(vaultName: string, secretName: string): Promise<string | undefined> {
  const identityUrl =
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net";
  const { error: identityError, body: identity } = await request(identityUrl, {
    headers: { "Metadata": "true" },
    json: true,
    attempts: 10,
  });
  const accessToken = (identity as AzureIdentityToken)?.access_token;
  if (identityError || !accessToken) {
    console.warn("Failed to get Azure managed identity token:", identityError);
    return;
  }

  const secretUrl = `https://${vaultName}.vault.azure.net/secrets/${secretName}?api-version=7.4`;
  const { error, body } = await request(secretUrl, {
    headers: { "Authorization": `Bearer ${accessToken}` },
    json: true,
    attempts: 5,
  });
  if (error) {
    console.warn("Failed to get Azure secret:", error);
    return;
  }

  return (body as AzureSecretValue)?.value;
}

function sha256(string: string): string {
  return createHash("sha256").update(Buffer.from(string)).digest("hex");
}

// The buildkite-agent registration token, per cloud. AWS builders read
// Secrets Manager with their instance role; Azure builders read Key Vault
// with their managed identity. It is not in launch parameters or tags.
const BUILDKITE_TOKEN_SECRET = "buildkite/agent-token";
const AZURE_KEYVAULT = "bun-ci";
const AZURE_TOKEN_SECRET = "buildkite-agent-token";

// macOS major-version thresholds for the `release-tier` agent tag.
//   >  LATEST   -> "beta"     (next macOS, pre-release; its own queue)
//   == LATEST   -> "latest"   (current macOS; arm64-only in practice)
//   >= PREVIOUS -> "previous" (recent-but-not-current; 14/15 today)
//   else        -> "oldest"   (min-supported; 13 today)
// Bump LATEST when a new macOS ships and the first runner on it is online.
// Bump PREVIOUS when the floor of "recent" moves.
const LATEST_DARWIN_RELEASE = 26;
const PREVIOUS_DARWIN_RELEASE = 14;

type DarwinReleaseTier = "beta" | "latest" | "previous" | "oldest";

function darwinReleaseTier(distroVersion: string | undefined): DarwinReleaseTier {
  const major = parseInt(distroVersion?.split(".")[0] || "0");
  if (major > LATEST_DARWIN_RELEASE) return "beta";
  if (major >= LATEST_DARWIN_RELEASE) return "latest";
  if (major >= PREVIOUS_DARWIN_RELEASE) return "previous";
  return "oldest";
}

interface AgentPaths {
  homePath: string;
  cachePath: string;
  logsPath: string;
  agentLogPath: string;
  // Not set on Windows or macOS.
  pidPath?: string;
  // Only set on macOS.
  cfgPath?: string;
}

/** The user CI's jobs run as on Linux; the image's bake creates it. */
export const agentUser = "buildkite-agent";

/**
 * The agent's directories on a Linux image. The image's bake
 * (scripts/build/ci-images/spec.ts) creates them, owned by the agent's user.
 */
export const linuxAgentPaths = {
  homePath: "/var/lib/buildkite-agent",
  cachePath: "/var/cache/buildkite-agent",
  logsPath: "/var/log/buildkite-agent",
} as const;

/** The agent's directory on a Windows image; the image's bootstrap installs buildkite-agent and its hooks there. */
export const windowsAgentHome = "C:\\buildkite-agent";

function getAgentPaths(): AgentPaths {
  if (isWindows) {
    const homePath = windowsAgentHome;
    const logsPath = join(homePath, "logs");
    return {
      homePath,
      cachePath: join(homePath, "cache"),
      logsPath,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
    };
  } else if (isMacOS) {
    // Match what's already deployed on the macOS CI fleet so install/start are
    // idempotent against existing boxes.
    const library = join(homedir(), "Library");
    const logsPath = join(library, "Logs", "buildkite-agent");
    return {
      homePath: join(library, "Services", "buildkite-agent"),
      cachePath: join(library, "Caches", "buildkite-agent"),
      logsPath,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
      cfgPath: join(library, "Preferences", "buildkite-agent.cfg"),
    };
  } else {
    const { logsPath } = linuxAgentPaths;
    return {
      ...linuxAgentPaths,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
      pidPath: join(logsPath, "buildkite-agent.pid"),
    };
  }
}

/** Writes a service or configuration file, creating its directory; `mode` is set even when the file already exists. */
function writeFile(filename: string, content: string, mode?: number): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, content);
  if (mode !== undefined) {
    chmodSync(filename, mode);
  }
}

/** Registers the agent as a service of this machine. `--queue` is for macOS, where the queue is part of the agent's configuration file. */
async function install(queueOption: string | undefined): Promise<void> {
  // The service is of no use without it.
  requireCommand("buildkite-agent");
  const { homePath, cachePath, logsPath, agentLogPath, pidPath, cfgPath } = getAgentPaths();
  const username = agentUser;
  const command = process.execPath;

  // Checked before anything is written, so a Mac that cannot be given a
  // token is left as it was.
  const token = process.env.BUILDKITE_AGENT_TOKEN;
  if (cfgPath !== undefined && !token && !existsSync(cfgPath)) {
    throw new Error("BUILDKITE_AGENT_TOKEN not set and no existing buildkite-agent.cfg to reuse");
  }

  // The service runs a copy of this script from the agent's home, so it does
  // not depend on the checkout that ran `install` sticking around. The copy
  // is an .mts: outside the repo no package.json says it is an ES module, and
  // one above the home (on macOS, the user's home directory) could say it is
  // not. When `install` is run on the copy itself (the Windows image bake
  // uploads it there first), it is already in place.
  mkdirSync(homePath, { recursive: true });
  const installedScript = join(homePath, "agent.mts");
  const thisScript = fileURLToPath(import.meta.url);
  if (!existsSync(installedScript) || realpathSync(thisScript) !== realpathSync(installedScript)) {
    copyFileSync(thisScript, installedScript);
  }
  const args = [installedScript, "start"];

  if (isWindows) {
    mkdirSync(logsPath, { recursive: true });

    const nssm = requireCommand("nssm");
    const nssmCommands: Command[] = [
      [nssm, "install", "buildkite-agent", command, ...args],
      [nssm, "set", "buildkite-agent", "Start", "SERVICE_AUTO_START"],
      [nssm, "set", "buildkite-agent", "AppDirectory", homePath],
      [nssm, "set", "buildkite-agent", "AppStdout", agentLogPath],
      [nssm, "set", "buildkite-agent", "AppStderr", agentLogPath],
    ];
    for (const command of nssmCommands) {
      await run(command);
    }
  }

  if (isOpenRc()) {
    const servicePath = "/etc/init.d/buildkite-agent";
    const service = `#!/sbin/openrc-run
        name="buildkite-agent"
        description="Buildkite Agent"
        command=${escape(command)}
        command_args=${escape(args.map(escape).join(" "))}
        command_user=${escape(username)}

        pidfile=${escape(pidPath)}
        start_stop_daemon_args=" \\
          --background \\
          --make-pidfile \\
          --stdout ${escape(agentLogPath)} \\
          --stderr ${escape(agentLogPath)}"

        depend() {
          need net
          use dns logger
        }
      `;
    writeFile(servicePath, service, 0o755);
    await run(["rc-update", "add", "buildkite-agent", "default"]);
  }

  if (cfgPath !== undefined) {
    const queue = queueOption || process.env.BUILDKITE_AGENT_QUEUE || "test-darwin";
    // `install` runs via sudo, so process.env.USER is "root". The launchd
    // service must run as the real login user (whose ~/Library the cfg and
    // build dirs live under), and the files we write here must be owned by
    // them so the service can read them.
    const runAsUser = process.env.SUDO_USER || process.env.USER || "administrator";

    for (const dir of [homePath, cachePath, logsPath]) {
      mkdirSync(dir, { recursive: true });
    }

    // Stable node path (the Homebrew/usr-local symlink, not a Cellar version
    // path that breaks on `brew upgrade node`).
    const nodePath = which(["node"]) || process.execPath;

    // Preserve an existing token line if we're re-installing on a box that
    // already has one and BUILDKITE_AGENT_TOKEN wasn't supplied this time.
    let tokenLine: string | undefined = token ? `token=${escape(token)}` : undefined;
    if (!tokenLine) {
      const existing = readFileSync(cfgPath, "utf8");
      tokenLine = existing.split("\n").find(l => l.startsWith("token="));
    }

    // Intentionally no `spawn=` line: macOS test runners run one job at a
    // time. The test suite assumes it owns the machine (shared /private/tmp
    // shims, ncpu-sized install thread pools, etc.), so multi-worker
    // configurations time out — scale with more boxes, not more workers.
    const cfg = [
      "# Generated by scripts/agent.ts",
      "# https://buildkite.com/docs/agent/v3/configuration",
      "",
      tokenLine,
      `queue=${escape(queue)}`,
      "",
    ].join("\n");
    writeFile(cfgPath, cfg, 0o600);

    const plistPath = "/Library/LaunchDaemons/buildkite-agent.plist";
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>buildkite-agent</string>
  <key>UserName</key><string>${runAsUser}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/rust/bin:${homedir()}/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${installedScript}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${agentLogPath}</string>
  <key>StandardErrorPath</key><string>${agentLogPath}</string>
  <key>WorkingDirectory</key><string>${homePath}</string>
  <key>WatchPaths</key><array><string>${cfgPath}</string></array>
</dict>
</plist>
`;
    writeFile(plistPath, plist, 0o644);

    // Matches the script already deployed on the fleet: covers both the
    // Homebrew-agent layout (older x64 boxes) and the Library layout (this
    // installer), fixes ownership, then reboots.
    const cleanupPlistPath = "/Library/LaunchDaemons/com.buildkite.cleanup.plist";
    const cleanupScript =
      `PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; ` +
      `BASE_PREFIX=$([ "$(uname -m)" = "arm64" ] && echo "/opt/homebrew" || echo "/usr/local"); ` +
      `{ rm -rf $BASE_PREFIX/{var,etc}/buildkite-agent/{builds,cache}/* ${homePath}/{builds,cache}/* /tmp/* /var/tmp/* || true; } && ` +
      `{ chown -R ${runAsUser}:admin $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; } && ` +
      `{ chmod -R 755 $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; } && ` +
      `{ shutdown -r now || reboot; }`;
    const cleanupPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.buildkite.cleanup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string><![CDATA[${cleanupScript}]]></string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>27</integer></dict>
</dict>
</plist>
`;
    writeFile(cleanupPlistPath, cleanupPlist, 0o644);

    // install runs as root, so everything above is root-owned. The service
    // runs as runAsUser and needs to read the cfg (mode 0600) and write to
    // the build/log/cache dirs.
    await run(["chown", "-R", `${runAsUser}:staff`, cfgPath, homePath, cachePath, logsPath]);

    // Best-effort: replace any previously-loaded service. bootout fails if
    // not loaded, which is fine.
    for (const p of [plistPath, cleanupPlistPath]) {
      await run(["launchctl", "bootout", "system", p]).catch(() => {});
      await run(["launchctl", "bootstrap", "system", p]);
    }
    return;
  }

  if (isSystemd()) {
    const servicePath = "/etc/systemd/system/buildkite-agent.service";
    const service = `
        [Unit]
        Description=Buildkite Agent
        After=syslog.target
        After=network-online.target

        [Service]
        Type=simple
        User=${username}
        ExecStart=${escape(command)} ${args.map(escape).join(" ")}
        RestartSec=5
        Restart=on-failure
        KillMode=process

        [Journal]
        Storage=persistent
        StateDirectory=${escape(agentLogPath)}

        [Install]
        WantedBy=multi-user.target
      `;
    writeFile(servicePath, service);
    await run(["systemctl", "daemon-reload"]);
    await run(["systemctl", "enable", "buildkite-agent"]);
  }
}

/** Runs the agent, as the service `install` registered does. */
async function start(): Promise<void> {
  const command = requireCommand("buildkite-agent");
  const { homePath, cachePath, logsPath, cfgPath } = getAgentPaths();
  const cloud = await getCloud();

  let token = process.env.BUILDKITE_AGENT_TOKEN;
  if (!token && cloud === "aws") {
    token = await getAwsSecret(BUILDKITE_TOKEN_SECRET);
  }
  if (!token && cloud === "azure") {
    token = await getAzureSecret(AZURE_KEYVAULT, AZURE_TOKEN_SECRET);
  }
  // Images baked before the secret stores existed only had the tag.
  if (!token && cloud) {
    token = await getCloudMetadataTag("buildkite:token", cloud);
  }

  const hasCfg = cfgPath !== undefined && existsSync(cfgPath);
  if (!token && !hasCfg) {
    throw new Error(
      "Buildkite token not found: set BUILDKITE_AGENT_TOKEN or grant this machine access to the buildkite agent-token secret",
    );
  }

  let shell: string;
  if (isWindows) {
    // Command Prompt has a faster startup time than PowerShell.
    // Also, it propogates the exit code of the command, which PowerShell does not.
    const cmd = requireCommand("cmd");
    shell = `"${cmd}" /S /C`;
  } else {
    const sh = requireCommand("sh");
    shell = `${sh} -elc`;
  }

  const distroVersion = getDistroVersion();
  const flags = ["enable-job-log-tmpfile", "no-feature-reporting"];
  const options: Record<string, string> = {
    // On macOS the hostname is often a meaningless asset ID (e.g. 66783.local),
    // so name the agent by what it actually is. %spawn yields the existing
    // fleet's "-1" suffix at spawn=1.
    "name": isMacOS ? `${getOs()}-${getArch()}-${distroVersion}-%spawn` : `${getHostname()}-%spawn`,
    "shell": shell,
    "job-log-path": logsPath,
    "build-path": join(homePath, "builds"),
    "hooks-path": join(homePath, "hooks"),
    "plugins-path": join(homePath, "plugins"),
    "experiment": "normalised-upload-paths,resolve-commit-after-checkout,agent-api",
  };

  // On macOS, token/queue/spawn live in the cfg file written by `install`;
  // pass it via --config so re-running `install` is the single edit point.
  // On other platforms the token is passed directly.
  if (hasCfg) {
    options.config = cfgPath;
  } else if (token) {
    options.token = token;
  }

  let ephemeral = false;
  if (cloud) {
    const jobId = await getCloudMetadataTag("buildkite:job-uuid", cloud);
    if (jobId) {
      options["acquire-job"] = jobId;
      flags.push("disconnect-after-job");
      ephemeral = true;
    }
  }

  if (ephemeral) {
    options["git-clone-flags"] = "-v --depth=1";
    options["git-fetch-flags"] = "-v --prune --depth=1";
  } else {
    options["git-mirrors-path"] = join(cachePath, "git");
  }

  const tags: Record<string, string | boolean | undefined> = {
    "os": getOs(),
    "arch": getArch(),
    "posix": isPosix,
    "windows": isWindows,
    "kernel": getKernel(),
    "abi": getAbi(),
    "abi-version": getAbiVersion(),
    "distro": getDistro(),
    "distro-version": distroVersion,
    "release": isMacOS ? distroVersion?.split(".")[0] : undefined,
    // ci.ts targets darwin test jobs by `release-tier` so each PR runs on
    // distinct OS-age pools without needing per-box config. arm64 uses
    // latest+previous; x64 uses previous+oldest (Intel can't run latest).
    "release-tier": isMacOS ? darwinReleaseTier(distroVersion) : undefined,
    "ephemeral": ephemeral,
    "cloud": cloud,
  };

  if (cloud) {
    const requiredTags = ["robobun", "robobun2"];
    for (const tag of requiredTags) {
      const value = await getCloudMetadataTag(tag, cloud);
      if (typeof value === "string") {
        tags[tag] = value;
      }
    }
  }

  options.tags = Object.entries(tags)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  await run([
    command,
    "start",
    ...flags.map(flag => `--${flag}`),
    ...Object.entries(options).map(([key, value]) => `--${key}=${value}`),
  ]);
}

function isSystemd(): boolean {
  return !!which(["systemctl"]);
}

function isOpenRc(): boolean {
  return !!which(["rc-service"]);
}

function escape(string: string | undefined): string | undefined {
  return JSON.stringify(string);
}

async function main(): Promise<void> {
  const { positionals: args, values } = parseArgs({
    allowPositionals: true,
    options: {
      queue: { type: "string" },
    },
  });

  if (!args.length || args.includes("install")) {
    console.log("Installing agent...");
    await install(values.queue);
    console.log("Agent installed.");
  }

  // `exec` is what the macOS launchd plist invokes; treat it as `start`.
  if (args.includes("start") || args.includes("exec")) {
    console.log("Starting agent...");
    await start();
    console.log("Agent started.");
  }
}

// A Node that can load this file but is older than 24.2 has no import.meta.main,
// and the check below would make the script do nothing and exit 0.
if (typeof import.meta.main !== "boolean") {
  throw new Error(`scripts/agent.ts needs Node 24.2 or newer, and this is ${process.version}`);
}

// Not when the other CI scripts import this file for what it knows about the machine.
if (import.meta.main) {
  await main();
}
