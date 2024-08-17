#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { spawn } from "./spawn.mjs";
import { emitWarning, fatalError, runTask } from "./util.mjs";
import { resolve } from "./fs.mjs";

export const isWindows = process.platform === "win32";
export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isBuildKite = process.env["BUILDKITE"] === "true";
export const isGithubAction = process.env["GITHUB_ACTIONS"] === "true";
export const isCI = isBuildKite || isGithubAction || process.env["CI"] === "true" || process.argv.includes("--ci");
export const isVerbose = isCI || process.env["VERBOSE"] === "1" || process.argv.includes("--verbose");
export const isQuiet = process.env["QUIET"] === "1" || process.argv.includes("--quiet");
export const isDebug = process.env["DEBUG"] === "1" || process.argv.includes("--debug");
export const isColorTerminal = isCI || process.stdout.isTTY;

/**
 * Gets the number of CPUs.
 * @returns {number}
 */
export function getCpus() {
  if ("navigator" in globalThis) {
    const { hardwareConcurrency: cpus } = navigator;
    if (typeof cpus === "number") {
      return cpus;
    }
  }
  return 1;
}

/**
 * Get a human-readable name for the operating system.
 * @returns {Promise<string | undefined>}
 */
export async function getOs() {
  if (isMacOS) {
    const [name, version, build] = await Promise.all(
      ["productName", "productVersion", "buildVersion"].map(property =>
        spawn("sw_vers", [`-${property}`], { silent: true, throwOnError: false }).then(
          ({ exitCode, stdout }) => exitCode === 0 && stdout.trim(),
        ),
      ),
    );
    if (!name) {
      return "macOS";
    }
    if (!version) {
      return name;
    }
    if (!build) {
      return `${name} ${version}`;
    }
    return `${name} ${version}+${build}`;
  }

  if (isLinux) {
    const { exitCode, stdout } = await spawn("lsb_release", ["--description", "--short"], {
      silent: true,
      throwOnError: false,
    });
    if (exitCode === 0) {
      return stdout.trim();
    }
    return "Linux";
  }

  if (isWindows) {
    const { exitCode, stdout } = spawn("cmd", ["/c", "ver"], {
      silent: true,
      throwOnError: false,
    });
    if (exitCode === 0) {
      return stdout.trim();
    }
    return "Windows";
  }
}

/**
 * Gets the Glibc version.
 * @returns {number | undefined}
 */
export function getGlibcVersion() {
  if (!isLinux) {
    return;
  }
  try {
    const { header } = process.report.getReport();
    const { glibcVersionRuntime } = header;
    const version = parseFloat(glibcVersionRuntime);
    if (isFinite(version)) {
      return version;
    }
  } catch {
    // ...
  }
}

/**
 * Gets the Linux kernel version.
 * @returns {string | undefined}
 */
export function getKernelVersion() {
  try {
    return release();
  } catch {
    // ...
  }
}

/**
 * Gets the hostname.
 * @returns {string | undefined}
 */
export function getHostname() {
  if (isBuildKite) {
    return process.env["BUILDKITE_AGENT_NAME"];
  }

  if (isGithubAction) {
    return process.env["RUNNER_NAME"];
  }

  try {
    return hostname();
  } catch {
    // ...
  }
}

/**
 * Gets the public IP address.
 * @returns {Promise<string | undefined>}
 */
export async function getPublicIp() {
  const urls = ["https://checkip.amazonaws.com", "https://ipinfo.io/ip", "https://icanhazip.com"];

  /**
   * @param {string} url
   * @returns {Promise<string | undefined>}
   */
  async function check(url) {
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }

    const body = await response.text();
    const address = body.trim();
    if (isIP(address)) {
      return address;
    }
  }

  for (const url of urls) {
    try {
      const address = await check(url);
      if (address) {
        return address;
      }
    } catch {
      continue;
    }
  }
}

/**
 * Gets the IP address of the Tailscale machine.
 * @returns {Promise<string | undefined>}
 */
export async function getTailscaleIp() {
  const { exitCode, stdout } = await spawn("tailscale", ["ip", "--1"], {
    silent: true,
    throwOnError: false,
  });

  if (exitCode === 0) {
    const address = stdout.trim();
    if (isIP(address)) {
      return address;
    }
  }
}

/**
 * Tests if the given filename is the main file.
 * @param {string} url (import.meta.url)
 * @returns {boolean}
 */
export function isMain(url) {
  const thisPath = resolve(fileURLToPath(url));
  const mainPath = resolve(process.argv[1]);
  return thisPath.includes(mainPath);
}

process.on("uncaughtException", err => fatalError(err));
process.on("unhandledRejection", err => fatalError(err));
process.on("warning", err => emitWarning(err));

if (isColorTerminal) {
  process.env["FORCE_COLOR"] = "1"; // used by Bun
  process.env["CLICOLOR_FORCE"] = "1"; // used by Ninja and Zig
}

if (isCI) {
  await runTask(`{dim}Printing environment{reset}`, () => console.log(process.env));
}
