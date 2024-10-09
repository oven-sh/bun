import {
  constants as fs,
  readFileSync,
  mkdtempSync,
  existsSync,
  statSync,
  mkdirSync,
  accessSync,
  appendFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir, hostname, userInfo, homedir } from "node:os";
import { join, basename, dirname, relative, sep } from "node:path";
import { normalize as normalizeWindows } from "node:path/win32";
import { isIP } from "node:net";
import { parseArgs } from "node:util";

const cwd = dirname(import.meta.dirname);
const spawnTimeout = 5_000;
const isWindows = process.platform === "win32";

/**
 * @param {string} target
 * @returns {Promise<string>}
 */
export async function getExecPathFromBuildKite(target) {
  if (existsSync(target) || target.includes("/")) {
    return getExecPath(target);
  }

  const releasePath = join(cwd, "release");
  mkdirSync(releasePath, { recursive: true });
  await spawnSafe({
    command: "buildkite-agent",
    args: ["artifact", "download", "**", releasePath, "--step", target],
  });

  let zipPath;
  for (const entry of readdirSync(releasePath, { recursive: true, encoding: "utf-8" })) {
    if (/^bun.*\.zip$/i.test(entry) && !entry.includes("-profile.zip")) {
      zipPath = join(releasePath, entry);
      break;
    }
  }

  if (!zipPath) {
    throw new Error(`Could not find ${target}.zip from Buildkite: ${releasePath}`);
  }

  if (isWindows) {
    await spawnSafe({
      command: "powershell",
      args: ["-Command", `Expand-Archive -Path ${zipPath} -DestinationPath ${releasePath} -Force`],
    });
  } else {
    await spawnSafe({
      command: "unzip",
      args: ["-o", zipPath, "-d", releasePath],
    });
  }

  for (const entry of readdirSync(releasePath, { recursive: true, encoding: "utf-8" })) {
    const execPath = join(releasePath, entry);
    if (/bun(?:\.exe)?$/i.test(entry) && isExecutable(execPath)) {
      return execPath;
    }
  }

  throw new Error(`Could not find executable from BuildKite: ${releasePath}`);
}

/**
 * @typedef {object} SpawnOptions
 * @property {string} command
 * @property {string[]} [args]
 * @property {string} [cwd]
 * @property {number} [timeout]
 * @property {object} [env]
 * @property {function} [stdout]
 * @property {function} [stderr]
 */

/**
 * @typedef {object} SpawnResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {Error} [spawnError]
 * @property {number} [exitCode]
 * @property {number} [signalCode]
 * @property {number} timestamp
 * @property {number} duration
 * @property {string} stdout
 */

/**
 * @param {SpawnOptions} options
 * @returns {Promise<SpawnResult>}
 */
export async function spawnSafe(options) {
  const {
    command,
    args,
    cwd,
    env,
    timeout = spawnTimeout,
    stdout = process.stdout.write.bind(process.stdout),
    stderr = process.stderr.write.bind(process.stderr),
    retries = 0,
  } = options;
  let exitCode;
  let signalCode;
  let spawnError;
  let timestamp;
  let duration;
  let subprocess;
  let timer;
  let buffer = "";
  let doneCalls = 0;
  const beforeDone = resolve => {
    // TODO: wait for stderr as well, spawn.test currently causes it to hang
    if (doneCalls++ === 1) {
      done(resolve);
    }
  };
  const done = resolve => {
    if (timer) {
      clearTimeout(timer);
    }
    subprocess.stderr.unref();
    subprocess.stdout.unref();
    subprocess.unref();
    if (!signalCode && exitCode === undefined) {
      subprocess.stdout.destroy();
      subprocess.stderr.destroy();
      if (!subprocess.killed) {
        subprocess.kill(9);
      }
    }
    resolve();
  };
  await new Promise(resolve => {
    try {
      subprocess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        cwd,
        env,
      });
      subprocess.on("spawn", () => {
        timestamp = Date.now();
        timer = setTimeout(() => done(resolve), timeout);
      });
      subprocess.on("error", error => {
        spawnError = error;
        done(resolve);
      });
      subprocess.on("exit", (code, signal) => {
        duration = Date.now() - timestamp;
        exitCode = code;
        signalCode = signal;
        if (signalCode || exitCode !== 0) {
          beforeDone(resolve);
        } else {
          done(resolve);
        }
      });
      subprocess.stdout.on("end", () => {
        beforeDone(resolve);
      });
      subprocess.stdout.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stdout?.(text);
        buffer += text;
      });
      subprocess.stderr.on("data", chunk => {
        const text = chunk.toString("utf-8");
        stderr?.(text);
        buffer += text;
      });
    } catch (error) {
      spawnError = error;
      resolve();
    }
  });
  if (spawnError && retries < 5) {
    const { code } = spawnError;
    if (code === "EBUSY" || code === "UNKNOWN") {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
      return spawnSafe({
        ...options,
        retries: retries + 1,
      });
    }
  }
  let error;
  if (exitCode === 0) {
    // ...
  } else if (spawnError) {
    const { stack, message } = spawnError;
    if (/timed? ?out/.test(message)) {
      error = "timeout";
    } else {
      error = "spawn error";
      buffer = stack || message;
    }
  } else if (
    (error = /thread \d+ panic: (.*)(?:\r\n|\r|\n|\\n)/i.exec(buffer)) ||
    (error = /panic\(.*\): (.*)(?:\r\n|\r|\n|\\n)/i.exec(buffer)) ||
    (error = /(Segmentation fault) at address/i.exec(buffer)) ||
    (error = /(Internal assertion failure)/i.exec(buffer)) ||
    (error = /(Illegal instruction) at address/i.exec(buffer)) ||
    (error = /panic: (.*) at address/i.exec(buffer)) ||
    (error = /oh no: Bun has crashed/i.exec(buffer))
  ) {
    const [, message] = error || [];
    error = message ? message.split("\n")[0].toLowerCase() : "crash";
    error = error.indexOf("\\n") !== -1 ? error.substring(0, error.indexOf("\\n")) : error;
  } else if (signalCode) {
    if (signalCode === "SIGTERM" && duration >= timeout) {
      error = "timeout";
    } else {
      error = signalCode;
    }
  } else if (exitCode === 1) {
    const match = buffer.match(/\x1b\[31m\s(\d+) fail/);
    if (match) {
      error = `${match[1]} failing`;
    } else {
      error = "code 1";
    }
  } else if (exitCode === undefined) {
    error = "timeout";
  } else if (exitCode !== 0) {
    if (isWindows) {
      const winCode = getWindowsExitCode(exitCode);
      if (winCode) {
        exitCode = winCode;
      }
    }
    error = `code ${exitCode}`;
  }
  return {
    ok: exitCode === 0 && !signalCode && !spawnError,
    error,
    exitCode,
    signalCode,
    spawnError,
    stdout: buffer,
    timestamp: timestamp || Date.now(),
    duration: duration || 0,
  };
}

/**
 * @param {string} execPath
 * @returns {boolean}
 */
export function isExecutable(execPath) {
  if (!existsSync(execPath) || !statSync(execPath).isFile()) {
    return false;
  }
  try {
    accessSync(execPath, fs.X_OK);
  } catch {
    return false;
  }
  return true;
}

let ntStatus;

/**
 * @param {number} exitCode
 * @returns {string}
 */
export function getWindowsExitCode(exitCode) {
  if (ntStatus === undefined) {
    const ntStatusPath = "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared\\ntstatus.h";
    try {
      ntStatus = readFileSync(ntStatusPath, "utf-8");
    } catch (error) {
      console.warn(error);
      ntStatus = "";
    }
  }

  const match = ntStatus.match(new RegExp(`(STATUS_\\w+).*0x${exitCode?.toString(16)}`, "i"));
  return match?.[1];
}
