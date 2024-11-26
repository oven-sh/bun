import { constants as fs, existsSync, statSync, accessSync } from "node:fs";
import { basename, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { isWindows } from "../../machine/context/process.ts";
import { getRunnerOptions } from "./RunnerOptions.ts";

export function getExecPath(bunExe: string) {
  const {
    timeouts: { spawnTimeout },
  } = getRunnerOptions();

  let execPath: string | undefined;
  let error: unknown;
  try {
    const { error, stdout } = spawnSync(bunExe, ["--print", "process.argv[0]"], {
      encoding: "utf-8",
      timeout: spawnTimeout,
      env: {
        // @ts-ignore
        PATH: process.env.PATH,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    if (error) {
      throw error;
    }
    execPath = stdout.trim();
  } catch (cause) {
    error = cause;
  }

  if (execPath) {
    if (isExecutable(execPath)) {
      return execPath;
    }
    error = new Error(`File is not an executable: ${execPath}`);
  }

  throw new Error(`Could not find executable: ${bunExe}`, { cause: error });
}

/**
 * @param  {...string} paths
 * @returns {string}
 */
export function addPath(...paths: string[]): string {
  if (isWindows) {
    return paths.join(";");
  }
  return paths.join(":");
}

/**
 * @param {string} execPath
 * @returns {boolean}
 */
export function isExecutable(execPath: string): boolean {
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

export function isHidden(path: any) {
  return /node_modules|node.js/.test(dirname(path)) || /^\./.test(basename(path));
}
