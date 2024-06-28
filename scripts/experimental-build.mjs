#! /usr/bin/env node

import {} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const projectPath = dirname(import.meta.dirname);
const vendorPath = process.env.BUN_VENDOR_PATH || join(projectPath, "vendor");

const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";
const isLinux = process.platform === "linux";

const spawnSyncTimeout = 1000 * 60;
const spawnTimeout = 1000 * 60 * 3;

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

function getZigTarget(os = process.platform, arch = process.arch) {
  if (arch === "x64") {
    if (os === "linux") return "linux-x86_64";
    if (os === "darwin") return "macos-x86_64";
    if (os === "win32") return "windows-x86_64";
  }
  if (arch === "arm64") {
    if (os === "linux") return "linux-aarch64";
    if (os === "darwin") return "macos-aarch64";
  }
  throw new Error(`Unsupported zig target: os=${os}, arch=${arch}`);
}

function getRecommendedZigVersion() {
  const scriptPath = join(projectPath, "build.zig");
  try {
    const scriptContent = readFileSync(scriptPath, "utf-8");
    const match = scriptContent.match(/recommended_zig_version = "([^"]+)"/);
    if (!match) {
      throw new Error("File does not contain string: 'recommended_zig_version'");
    }
    return match[1];
  } catch (cause) {
    throw new Error("Failed to find recommended Zig version", { cause });
  }
}

/**
 * @returns {Promise<string>}
 */
async function getLatestZigVersion() {
  try {
    const response = await fetchSafe("https://ziglang.org/download/index.json", { format: "json" });
    const { master } = response;
    const { version } = master;
    return version;
  } catch (cause) {
    throw new Error("Failed to get latest Zig version", { cause });
  }
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

/**
 * @returns {string}
 */
function getTmpdir() {
  if (isMacOS && existsSync("/tmp")) {
    return "/tmp";
  }
  return tmpdir();
}

/**
 * @returns {string}
 */
function mkTmpdir() {
  return mkdtempSync(join(getTmpdir(), "bun-"));
}

/**
 * @param {string} url
 * @param {string} [path]
 * @returns {Promise<string>}
 */
async function downloadFile(url, path) {
  const outPath = path || join(mkTmpdir(), basename(url));
  const bytes = await fetchSafe(url, { format: "bytes" });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
  return outPath;
}

/**
 * @param {string} tarPath
 * @param {string} [path]
 * @returns {Promise<string>}
 */
async function extractFile(tarPath, path) {
  const outPath = path || join(mkTmpdir(), basename(tarPath));
  mkdirSync(outPath, { recursive: true });
  await spawnSafe("tar", ["-xf", tarPath, "-C", outPath, "--strip-components=1"]);
  return outPath;
}

const dependencies = [
  {
    name: "zig",
    version: getRecommendedZigVersion(),
    download: downloadZig,
  },
];

async function getDependencyPath(name) {
  let dependency;
  for (const entry of dependencies) {
    if (name === entry.name) {
      dependency = entry;
      break;
    }
  }
  if (!dependency) {
    throw new Error(`Unknown dependency: ${name}`);
  }
  const { version, download } = dependency;
  mkdirSync(vendorPath, { recursive: true });
  for (const path of readdirSync(vendorPath)) {
    if (!path.startsWith(name)) {
      continue;
    }
    const dependencyPath = join(vendorPath, path);
    const dependencyVersion = getVersion(dependencyPath);
    if (dependencyVersion === version) {
      return dependencyPath;
    }
  }
  if (!download) {
    throw new Error(`Dependency not found: ${name}`);
  }
  return await download(version);
}

/**
 * @param {string} [version]
 */
async function downloadZig(version) {
  const target = getZigTarget();
  const expectedVersion = version || getRecommendedZigVersion();
  const url = `https://ziglang.org/builds/zig-${target}-${expectedVersion}.tar.xz`;
  const tarPath = await downloadFile(url);
  const extractedPath = await extractFile(tarPath);
  const zigPath = join(extractedPath, exePath("zig"));
  const actualVersion = getVersion(zigPath);
  const outPath = join(vendorPath, exePath(`zig-${actualVersion}`));
  mkdirSync(dirname(outPath), { recursive: true });
  copyFileSync(zigPath, outPath);
  return outPath;
}

/**
 * @param {string} path
 * @returns {string}
 */
function exePath(path) {
  return isWindows ? `${path}.exe` : path;
}

const execPath = await getDependencyPath("zig");
console.log(execPath);
