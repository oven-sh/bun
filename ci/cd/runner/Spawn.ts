import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, relative } from "node:path";
import { isWindows, tmpdir } from "../../machine/context/process.ts";
import { parseTestStdout, pipeTestStdout } from "./output.ts";
import { getWindowsExitReason, parseDuration } from "./parse.ts";
import { addPath } from "./path.ts";
import { getRunnerOptions, type RunnerOptions } from "./RunnerOptions.ts";
import { Test, type TestResult } from "./Test.ts";

export interface SpawnResult {
  ok: boolean;
  error?: string | null;
  errors?: string;
  spawnError?: Error | null;
  exitCode?: number | null;
  signalCode?: number | null;
  timestamp: number;
  duration: string;
  stdout: string;
  testPath?: string;
  status?: any;
}

export interface SpawnOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  env?: Record<string, any>;
  stdout?: (...props: any) => any;
  stderr?: (...props: any) => any;
  retries?: number;
}

export class Spawn {
  static spawnBun = async (
    execPath,
    { args, cwd, timeout, env, stdout, stderr }: SpawnOptions,
  ): Promise<SpawnResult> => {
    // @ts-ignore
    const path = addPath(dirname(execPath), process.env.PATH);
    const tmpdirPath = mkdtempSync(join(tmpdir(), "buntmp-"));
    const { username, homedir } = userInfo();
    const bunEnv = {
      ...process.env,
      PATH: path,
      TMPDIR: tmpdirPath,
      USER: username,
      HOME: homedir,
      FORCE_COLOR: "1",
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_GARBAGE_COLLECTOR_LEVEL: "1",
      BUN_JSC_randomIntegrityAuditRate: "1.0",
      BUN_ENABLE_CRASH_REPORTING: "0", // change this to '1' if https://github.com/oven-sh/bun/issues/13012 is implemented
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      BUN_INSTALL_CACHE_DIR: tmpdirPath,
      SHELLOPTS: isWindows ? "igncr" : undefined, // ignore "\r" on Windows
      // Used in Node.js tests.
      TEST_TMPDIR: tmpdirPath,
    };
    if (env) {
      Object.assign(bunEnv, env);
    }
    if (isWindows) {
      // @ts-ignore
      delete bunEnv["PATH"];
      bunEnv["Path"] = path;
      for (const tmpdir of ["TMPDIR", "TEMP", "TEMPDIR", "TMP"]) {
        delete bunEnv[tmpdir];
      }
      bunEnv["TEMP"] = tmpdirPath;
    }
    try {
      return await Spawn.spawnSafe({
        command: execPath,
        args,
        cwd,
        timeout,
        env: bunEnv,
        stdout,
        stderr,
      });
    } finally {
      // try {
      //   rmSync(tmpdirPath, { recursive: true, force: true });
      // } catch (error) {
      //   console.warn(error);
      // }
    }
  };
  static spawnBunInstall = async (execPath, options: Pick<RunnerOptions, "cwd" | "timeouts">): Promise<TestResult> => {
    const {
      timeouts: { testTimeout },
      cwd,
    } = options;
    const { ok, error, stdout, duration } = await Spawn.spawnBun(execPath, {
      args: ["install"],
      timeout: testTimeout,
      cwd,
    });
    const relativePath = relative(cwd, options.cwd);
    const testPath = join(relativePath, "package.json");
    const status = ok ? "pass" : "fail";
    return {
      testPath,
      ok,
      status,
      error: error ?? "",
      tests: [
        {
          file: testPath,
          test: "bun install",
          status,
          duration: parseDuration(duration),
        },
      ],
      stdout,
      stdoutPreview: stdout,
    };
  };
  static spawnBunTest = async (
    execPath: string,
    testPath: string,
    options: Pick<RunnerOptions, "cwd"> & { args?: string[] },
  ) => {
    const timeout = Test.getTestTimeout(testPath);
    const perTestTimeout = Math.ceil(timeout / 2);
    const absPath = join(options["cwd"], testPath);
    const isReallyTest = Test.isTestStrict(testPath) || absPath.includes("vendor");
    const args = options["args"] ?? [];
    const { ok, error, stdout } = await Spawn.spawnBun(execPath, {
      args: isReallyTest ? ["test", ...args, `--timeout=${perTestTimeout}`, absPath] : [...args, absPath],
      cwd: options["cwd"],
      timeout: isReallyTest ? timeout : 30_000,
      env: {
        GITHUB_ACTIONS: "true", // always true so annotations are parsed
      },

      // @ts-ignore
      stdout: chunk => pipeTestStdout(process.stdout, chunk),
      // @ts-ignore
      stderr: chunk => pipeTestStdout(process.stderr, chunk),
      command: "",
    });
    const { tests, errors, stdout: stdoutPreview } = parseTestStdout(stdout, testPath);
    return {
      testPath,
      ok,
      status: ok ? "pass" : "fail",
      error,
      errors,
      tests,
      stdout,
      stdoutPreview,
    };
  };

  static spawnSafe = async (options: SpawnOptions): Promise<SpawnResult> => {
    const {
      timeouts: { spawnTimeout },
    } = getRunnerOptions();

    const {
      command,
      args,
      cwd,
      env,
      timeout = spawnTimeout,
      // @ts-ignore
      stdout = process.stdout.write.bind(process.stdout),
      // @ts-ignore
      stderr = process.stderr.write.bind(process.stderr),
      retries = 0,
    } = options;
    let exitCode: string | number | undefined = undefined;
    let signalCode: string | undefined = undefined;
    let spawnError: { code: string; stack: string[]; message: string } | undefined = undefined;
    let timestamp: number = 0;
    let duration: number | undefined;
    let subprocess: {
      stderr: { unref: () => void; destroy: () => void; on: (arg0: string, arg1: (chunk: any) => void) => void };
      stdout: {
        unref: () => void;
        destroy: () => void;
        on: (arg0: string, arg1: { (): void; (chunk: any): void }) => void;
      };
      unref: () => void;
      killed: any;
      kill: (arg0: number) => void;
      on: (arg0: string, arg1: { (): void; (error: any): void; (code: any, signal: any): void }) => void;
    };
    let timer: number | Timer | undefined;
    let buffer = "";
    let doneCalls = 0;
    const beforeDone = (resolve: { (value: unknown): void; (value: unknown): void }) => {
      // TODO: wait for stderr as well, spawn.test currently causes it to hang
      if (doneCalls++ === 1) {
        // @ts-ignore
        done(resolve);
      }
    };
    const done = (resolve: { (value: unknown): void; (value: unknown): void; (value: unknown): void; (): void }) => {
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
        // @ts-ignore
        subprocess = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          timeout,
          cwd,
          env,
        });
        subprocess.on("spawn", () => {
          timestamp = Date.now();
          // @ts-ignore
          timer = setTimeout(() => done(resolve), timeout);
        });
        // @ts-ignore
        subprocess.on("error", (error: any) => {
          spawnError = error;
          // @ts-ignore
          done(resolve);
        });
        // @ts-ignore
        subprocess.on("exit", (code: any, signal: any) => {
          duration = Date.now() - timestamp;
          exitCode = code;
          signalCode = signal;
          if (signalCode || exitCode !== 0) {
            beforeDone(resolve);
          } else {
            // @ts-ignore
            done(resolve);
          }
        });
        subprocess.stdout.on("end", () => {
          beforeDone(resolve);
        });
        // @ts-ignore
        subprocess.stdout.on("data", (chunk: { toString: (arg0: string) => any }) => {
          const text = chunk.toString("utf-8");
          stdout?.(text);
          buffer += text;
        });
        subprocess.stderr.on("data", (chunk: { toString: (arg0: string) => any }) => {
          const text = chunk.toString("utf-8");
          stderr?.(text);
          buffer += text;
        });
      } catch (error) {
        spawnError = error as unknown as typeof spawnError;
        // @ts-ignore
        resolve();
      }
    });
    if (spawnError && retries < 5) {
      const { code } = spawnError;
      if (code === "EBUSY" || code === "UNKNOWN") {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
        return Spawn.spawnSafe({
          ...options,
          retries: retries + 1,
        });
      }
    }
    let error: string | RegExpExecArray | never[] | null = null;
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
      if (signalCode === "SIGTERM" && duration !== undefined && duration >= timeout) {
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
        const winCode = getWindowsExitReason(exitCode as number);
        if (winCode) {
          exitCode = winCode;
        }
      }
      error = `code ${exitCode}`;
    }
    return {
      ok: (exitCode as unknown as number) === 0 && !signalCode && !spawnError,
      error,
      exitCode: exitCode as unknown as number,
      signalCode,
      spawnError,
      stdout: buffer,
      timestamp: timestamp || Date.now(),
      duration: duration?.toString() ?? "0",
    };
  };
}
