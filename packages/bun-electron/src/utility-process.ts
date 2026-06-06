// utilityProcess — Electron-compatible child process API.
//
// Electron's utilityProcess.fork runs a Node child off the main process. Here
// it spawns a Bun child (the natural equivalent), with a newline-delimited
// JSON message channel over an extra pipe fd, exposing the Electron-shaped
// events: spawn, message, exit.

import { EventEmitter } from "node:events";

// Loader/interpreter hijack variables are stripped from caller-supplied env
// (not from the inherited process.env) so fork options can't be used to inject
// a preloaded library or interpreter into the child.
const BLOCKED_ENV_PREFIXES = [
  "LD_",
  "DYLD_",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5OPT",
  "BASH_ENV",
  "GIT_SSH_COMMAND",
  "GCONV_PATH",
];

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !BLOCKED_ENV_PREFIXES.some((p) => k.startsWith(p))),
  );
}

export interface ForkOptions {
  env?: Record<string, string>;
  cwd?: string;
  serviceName?: string;
  stdio?: string;
}

class UtilityProcess extends EventEmitter {
  private proc: Bun.Subprocess | null = null;
  pid: number | undefined;
  private _killed = false;

  constructor(modulePath: string, args: string[] = [], options: ForkOptions = {}) {
    super();
    if (typeof modulePath !== "string") {
      throw new TypeError("modulePath must be a string");
    }
    // Child gets the bun-electron utilityProcess child bootstrap via env so it
    // can wire process.parentPort.
    this.proc = Bun.spawn({
      cmd: [process.execPath, modulePath, ...args],
      cwd: options.cwd,
      env: { ...process.env, ...sanitizeEnv(options.env ?? {}), BUN_ELECTRON_UTILITY_CHILD: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      ipc: (message) => {
        this.emit("message", message);
      },
    });
    this.pid = this.proc.pid;
    // Defer "spawn" to the next tick so listeners attached after fork() fire.
    queueMicrotask(() => this.emit("spawn"));
    this.proc.exited.then((code) => {
      this._killed = true;
      this.emit("exit", code ?? 0);
    });
  }

  postMessage(message: unknown): void {
    if (this.proc && !this._killed) this.proc.send(message);
  }

  kill(): boolean {
    if (this.proc && !this._killed) {
      this.proc.kill();
      return true;
    }
    return false;
  }
}

export const utilityProcess = {
  fork(modulePath: string, args: string[] = [], options: ForkOptions = {}): UtilityProcess {
    return new UtilityProcess(modulePath, args, options);
  },
};

export { UtilityProcess };
