#!/usr/bin/env node

import * as cp from "node:child_process";
import { readFile } from "./fs.mjs";
import { emitWarning, emitAnnotation, printCommand } from "./util.mjs";
import { parseAnnotations } from "./format.mjs";
import { isMain } from "./env.mjs";

/**
 * @typedef {Object} SpawnOptions
 * @property {string} [cwd]
 * @property {string} [env]
 * @property {number} [timeout]
 * @property {boolean} [silent]
 * @property {string} [input]
 * @property {boolean} [throwOnError]
 * @property {number} [retries]
 */

/**
 * @typedef {Object} SpawnResult
 * @property {number | null} exitCode
 * @property {number | null} signalCode
 * @property {Error} [spawnError]
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Spawns a command.
 * @param {string} command
 * @param {string[]} [args]
 * @param {SpawnOptions} [options]
 * @returns {Promise<SpawnResult>}
 */
export async function spawn(command, args, options = {}) {
  printCommand(command, args, options);

  let stdout = "";
  let stderr = "";
  let exitCode = 1;
  let signalCode = null;
  let spawnError = null;

  const done = new Promise((resolve, reject) => {
    let subprocess;
    try {
      subprocess = cp.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        ...options,
      });
      if (typeof options.input !== "undefined") {
        subprocess.stdin.write(Buffer.from(options.input));
        subprocess.stdin.end();
      }
      subprocess.on("error", reject);
      subprocess.on("exit", (status, signal) => {
        exitCode = status;
        signalCode = signal;
        resolve();
      });
      subprocess.stdout?.on("data", chunk => {
        if (!options.silent) {
          process.stdout.write(chunk);
        }
        stdout += chunk.toString("utf-8");
      });
      subprocess.stderr?.on("data", chunk => {
        if (!options.silent) {
          process.stderr.write(chunk);
        }
        stderr += chunk.toString("utf-8");
      });
    } catch (cause) {
      reject(cause);
    }
  });

  try {
    await done;
  } catch (cause) {
    spawnError = cause;
    const { stack, message } = cause;
    stderr += stack || message;
  }

  const label = `${command} ${args.map(arg => (arg?.includes(" ") ? `"${arg}"` : arg)).join(" ")}`;
  const result = { exitCode, signalCode, spawnError, stdout, stderr };
  try {
    const messages = parseAnnotations(stdout + stderr, options);
    if (messages.length) {
      await Promise.all(messages.map(emitAnnotation));
    }
  } catch (cause) {
    emitWarning(cause);
  }

  if (exitCode === 0) {
    return result;
  }

  const retries = options.retries ?? 0;
  if (retries > 0) {
    return spawn(command, args, {
      ...options,
      retries: retries - 1,
    });
  }

  if (options.throwOnError !== false) {
    const cause = spawnError || new Error(`Process exited: ${signalCode || `code ${exitCode}`}`);
    throw new Error(`Command failed: ${label}`, { cause });
  }

  return result;
}

/**
 * Spawns a command, synchronously.
 * @param {string} command
 * @param {string[]} [args]
 * @param {SpawnOptions} [options]
 * @returns {SpawnResult}
 */
export function spawnSync(command, args, options = {}) {
  printCommand(command, args, options);

  try {
    const { error, status, signal, stdout, stderr } = cp.spawnSync(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      env: process.env,
      ...options,
    });
    if (error) {
      throw error;
    }
    if (options.throwOnError !== false && (signal || status !== 0)) {
      const reason = signal || `code ${status}`;
      const cause = stderr || stdout;
      throw new Error(`Process exited: ${reason}`, { cause });
    }
    return { exitCode: status, signalCode: signal, stdout, stderr };
  } catch (cause) {
    if (options.throwOnError === false) {
      return { exitCode: 1, signalCode: null, spawnError: cause, stdout: "", stderr: "" };
    }
    const description = `${command} ${args.join(" ")}`;
    throw new Error(`Command failed: ${description}`, { cause });
  }
}

/**
 * @type {string | undefined}
 */
let ntStatus;

/**
 * Gets the exit code for the given Windows exit code.
 * @param {number} exitCode
 * @returns {string}
 */
export function getWindowsExitCode(exitCode) {
  if (ntStatus === undefined) {
    const ntStatusPath = "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared\\ntstatus.h";
    try {
      ntStatus = readFile(ntStatusPath, "utf-8");
    } catch (error) {
      emitWarning(error);
      ntStatus = "";
    }
  }

  const match = ntStatus.match(new RegExp(`(STATUS_\\w+).*0x${exitCode?.toString(16)}`, "i"));
  return match?.[1];
}

if (isMain(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const { exitCode } = await spawn(command, args);
  process.exit(exitCode);
}
