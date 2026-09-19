// This process and the ones it starts: environment variables, the platform,
// spawning commands and finding them on PATH. Shared by the CI scripts.

import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions as NodeSpawnOptions,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type StdioOptions,
} from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir as nodeTmpdir } from "node:os";
import { join } from "node:path";
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

export function debugLog(...args: unknown[]): void {
  if (isDebug) {
    console.log(...args);
  }
}

type SpawnOptions = {
  cwd?: string | undefined;
  env?: Record<string, string | undefined>;
  stdio?: StdioOptions;
};

type SpawnResult = {
  exitCode: number | null;
  signalCode: string | null | undefined;
  stdout: string;
  stderr: string;
  error: Error | undefined;
};

export async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const [cmd, ...args] = command;
  debugLog("$", cmd, ...args);

  const spawnOptions: NodeSpawnOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    env: options["env"] ?? undefined,
    stdio: ["ignore", "pipe", "pipe"],
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

    subprocess.stdout?.on("data", chunk => {
      stdout += chunk;
    });
    subprocess.stderr?.on("data", chunk => {
      stderr += chunk;
    });

    subprocess.on("error", error => reject(error));
    subprocess.on("close", (code, signal) => {
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

  return {
    exitCode,
    signalCode,
    stdout,
    stderr,
    error,
  };
}

/** spawn(), but a command that cannot be run, is killed or exits with non-zero is thrown. */
export async function spawnSafe(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const result = await spawn(command, options);
  if (result.error) {
    throw result.error;
  }
  return result;
}

export function spawnSync(command: string[], options: SpawnOptions = {}): SpawnResult {
  const [cmd, ...args] = command;
  debugLog("$", cmd, ...args);

  const spawnOptions: NodeSpawnSyncOptions = {
    cwd: options["cwd"] ?? process.cwd(),
    env: options["env"] ?? undefined,
    stdio: ["ignore", "pipe", "pipe"],
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

type WhichOptions = {
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
