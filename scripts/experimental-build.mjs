#! /usr/bin/env node

import {} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";
const isLinux = process.platform === "linux";

const cwd = dirname(import.meta.dirname);
const spawnSyncTimeout = 1000 * 60;
const spawnTimeout = 1000 * 60 * 3;

/**
 * @typedef {Object} S3UploadOptions
 * @property {string} [bucket]
 * @property {string} filename
 * @property {string} content
 * @property {Record<string, string>} [headers]
 */

/**
 * @param {S3UploadOptions} options
 */
async function uploadFileToS3(options) {
  const { AwsV4Signer } = await import("aws4fetch");

  const { bucket, filename, content, ...extra } = options;
  const baseUrl = getEnv(["S3_ENDPOINT", "S3_BASE_URL", "AWS_ENDPOINT"], "https://s3.amazonaws.com");
  const bucketUrl = new URL(bucket || getEnv(["S3_BUCKET", "AWS_BUCKET"]), baseUrl);

  const signer = new AwsV4Signer({
    accessKeyId: getSecret(["S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]),
    secretAccessKey: getSecret(["S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"]),
    url: new URL(filename, bucketUrl),
    method: "PUT",
    body: content,
    ...extra,
  });

  const { url, method, headers, body } = signer.sign();
  await fetchSafe(url, {
    method,
    headers,
    body,
  });

  console.log("Uploaded file to S3:", {
    url: `${bucketUrl}`,
    filename,
  });
}

/**
 * @typedef {Object} SentryRelease
 * @property {string} organizationId
 * @property {string} projectId
 * @property {string} version
 * @property {string} [url]
 * @property {string} [ref]
 * @property {string} [dateReleased]
 */

/**
 * @param {SentryRelease} options
 * @returns {Promise<void>}
 */
async function createSentryRelease(options) {
  const { organizationId, projectId, ...body } = options;

  const baseUrl = getEnv("SENTRY_BASE_URL", "https://sentry.io");
  const url = new URL(`api/0/organizations/${organizationId}/releases`, baseUrl);
  const accessToken = getSecret(["SENTRY_AUTH_TOKEN", "SENTRY_TOKEN"]);

  const release = await fetchSafe(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    format: "json",
  });

  console.log("Created Sentry release:", release);
}

/**
 * @return {string}
 */
function getGithubToken() {
  const token = getEnv("GITHUB_TOKEN", null);
  if (token) {
    return token;
  }

  const gh = which("gh");
  if (gh) {
    const { exitCode, stdout } = spawnSyncSafe(gh, ["auth", "token"]);
    if (exitCode === 0) {
      return stdout.trim();
    }
  }

  throw new Error("Failed to get GitHub token (set GITHUB_TOKEN or run `gh auth login`)");
}

/**
 * @param {string | string[]} name
 * @return {string}
 */
function getSecret(name) {
  return getEnv(name);
}

/**
 * @param {string | string[]} name
 * @param {string | null} [defaultValue]
 * @returns {string | undefined}
 */
function getEnv(name, defaultValue) {
  let result = defaultValue;

  for (const key of typeof name === "string" ? [name] : name) {
    const value = process.env[key];
    if (value) {
      result = value;
      break;
    }
  }

  if (result || result === null) {
    return result;
  }

  throw new Error(`Environment variable is required: ${name}`);
}

/**
 * @typedef {Object} SpawnOptions
 * @property {boolean} [throwOnError]
 * @property {string} [cwd]
 * @property {string} [env]
 * @property {string} [encoding]
 * @property {number} [timeout]
 */

/**
 * @typedef {Object} SpawnResult
 * @property {number | null} exitCode
 * @property {number | null} signalCode
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {SpawnOptions} [options]
 * @returns {Promise<SpawnResult>}
 */
async function spawnSafe(command, args, options = {}) {
  const result = new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let subprocess;
    try {
      subprocess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: spawnTimeout,
        ...options,
      });
      subprocess.on("error", reject);
      subprocess.on("exit", (exitCode, signalCode) => {
        if (exitCode !== 0 || signalCode) {
          const reason = signalCode || `code ${exitCode}`;
          const cause = stderr || stdout;
          reject(new Error(`Process exited with ${reason}`, { cause }));
        } else {
          resolve({ exitCode, signalCode, stdout, stderr });
        }
      });
      subprocess?.stdout?.on("data", chunk => {
        process.stdout.write(chunk);
        stdout += chunk.toString("utf-8");
      });
      subprocess?.stderr?.on("data", chunk => {
        process.stderr.write(chunk);
        stderr += chunk.toString("utf-8");
      });
    } catch (cause) {
      reject(cause);
    }
  });
  try {
    return await result;
  } catch (cause) {
    if (options.throwOnError === false) {
      return;
    }
    const description = `${command} ${args.join(" ")}`;
    throw new Error(`Command failed: ${description}`, { cause });
  }
}

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {SpawnOptions} [options]
 * @returns {SpawnResult}
 */
function spawnSyncSafe(command, args, options = {}) {
  try {
    const { error, status, signal, stdout, stderr } = spawnSync(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: spawnSyncTimeout,
      ...options,
    });
    if (error) {
      throw error;
    }
    if (signal || status !== 0) {
      const reason = signal || `code ${status}`;
      const cause = stderr || stdout;
      throw new Error(`Process exited with ${reason}`, { cause });
    }
    return stdout;
  } catch (cause) {
    if (options.throwOnError === false) {
      return;
    }
    const description = `${command} ${args.join(" ")}`;
    throw new Error(`Command failed: ${description}`, { cause });
  }
}

/**
 * @typedef {Object} FetchOptions
 * @property {string} [method]
 * @property {Record<string, string>} [headers]
 * @property {string | Uint8Array} [body]
 * @property {"json" | "text" | "bytes"} [format]
 * @property {boolean} [throwOnError]
 */

/**
 * @param {string | URL} url
 * @param {FetchOptions} [options]
 * @returns {Promise<Response | string | Uint8Array>}
 */
async function fetchSafe(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
    if (!response.ok) {
      const { status, statusText } = response;
      const body = await response.text();
      throw new Error(`${status} ${statusText}`, { cause: body });
    }
    switch (options.format) {
      case "json":
        return await response.json();
      case "text":
        return await response.text();
      case "bytes":
        return new Uint8Array(await response.arrayBuffer());
      default:
        return response;
    }
  } catch (cause) {
    if (options.throwOnError === false) {
      return response;
    }
    throw new Error(`Fetch failed: ${url}`, { cause });
  }
}

/**
 * @param {string} command
 * @param {string} [path]
 * @returns {string | undefined}
 */
function which(command, path) {
  const cmd = isWindows ? "where" : "which";
  const result = spawnSyncSafe(cmd, [command], {
    throwOnError: false,
    env: {
      PATH: path || process.env.PATH,
    },
  });
  if (!result) {
    return;
  }
  if (isWindows) {
    // On Windows, multiple paths can be returned from `where`.
    for (const line of result.split("\r\n")) {
      return line;
    }
  }
  return result.trimEnd();
}

/**
 * @param {string} execPath
 * @returns {string | undefined}
 */
function getVersion(execPath) {
  const args = /(?:zig)(?:\.exe)?/i.test(execPath) ? ["version"] : ["--version"];
  const result = spawnSyncSafe(execPath, args, { throwOnError: false });
  if (!result) {
    return;
  }
  return result.trim();
}
