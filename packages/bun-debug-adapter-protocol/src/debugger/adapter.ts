import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { AddressInfo, createServer, Socket } from "node:net";
import * as path from "node:path";
import { remoteObjectToString, WebSocketInspector } from "../../../bun-inspector-protocol/index.ts";
import type { Inspector, InspectorEventMap } from "../../../bun-inspector-protocol/src/inspector/index.d.ts";
import { NodeSocketInspector } from "../../../bun-inspector-protocol/src/inspector/node-socket.ts";
import type { JSC } from "../../../bun-inspector-protocol/src/protocol/index.d.ts";
import type { DAP } from "../protocol/index.d.ts";
import { randomUnixPath, TCPSocketSignal, UnixSignal } from "./signal.ts";
import { Location, SourceMap } from "./sourcemap.ts";

export async function getAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0);
  return new Promise(resolve => {
    server.on("listening", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Resolve a command for `child_process.spawn` on Windows. Returns the path to
 * hand to `spawn`, plus whether a `cmd.exe` shell invocation is required.
 *
 * Two Windows-specific gotchas need handling together:
 *
 * 1. Node's `spawn` does not walk `PATHEXT`, so a bare name like `"bun"` is
 *    never auto-resolved to `bun.exe`/`bun.cmd`. When Bun is installed via
 *    the npm wrapper, `bun.exe` lives in `node_modules\bun\bin\` (not on
 *    `PATH`) and only `bun.cmd` is discoverable — so `spawn("bun", ...)`
 *    fails with `ENOENT`.
 *
 * 2. Post–CVE-2024-27980 (Node 18.20.2 / 20.12.2 / 21.7.3+), Node's C++
 *    `ProcessWrap::Spawn` unconditionally rejects any `options.file` whose
 *    extension is `.bat`/`.cmd` with `EINVAL`. The check is suffix-based,
 *    so an absolute `.cmd` path fails the same way as a bare one. See
 *    `node:src/util-inl.h IsWindowsBatchFile`.
 *
 * Resolving PATH+PATHEXT handles (1). For (2), the caller must invoke
 * `cmd.exe /d /s /c "..."` so that `options.file` Node sees is `cmd.exe`
 * rather than the `.cmd` file. `useShell: true` flags that requirement —
 * `buildShellCommand` constructs the properly quoted `/d /s /c` argument.
 *
 * We deliberately DO NOT use Node's built-in `shell: true`, because its
 * Windows implementation joins `[file, ...args]` with a naive space and no
 * per-argument quoting — so any space in the resolved path (e.g. the
 * common `C:\\Users\\Name With Space\\AppData\\Roaming\\npm\\bun.cmd`) or
 * in an argument breaks tokenization and cmd.exe fails with
 * `'C:\\Users\\Name' is not recognized as an internal or external command`.
 * See lib/child_process.js normalizeSpawnArguments in Node.
 *
 * On POSIX the helper returns `{ command, useShell: false }` and defers to
 * `spawn`'s native PATH lookup. `platform` is an explicit parameter so
 * tests can exercise the Windows path on any host.
 */
export function resolveCommand(
  command: string,
  env: Record<string, string | undefined> | NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { command: string; useShell: boolean } {
  if (platform !== "win32") return { command, useShell: false };

  // Absolute or relative paths skip PATH lookup, but still need the
  // batch-file check below so `spawn("C:\\...\\bun.cmd", ...)` works.
  const hasSeparator = command.includes("/") || command.includes("\\");
  const hasExtension = path.extname(command) !== "";

  let resolved = command;
  if (!hasSeparator && !hasExtension) {
    // Windows env vars are case-insensitive at the OS layer but JS exposes
    // `process.env` with whatever casing the launching shell used. Scan the
    // env object for any casing variant of these two.
    const pathVar = lookupEnvCaseInsensitive(env, "PATH") ?? "";
    // PATHEXT drives extension resolution on Windows. Fall back to the
    // typical default if the environment doesn't define it.
    const pathExt = lookupEnvCaseInsensitive(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
    const extensions = pathExt.split(";").filter(Boolean);

    outer: for (const dir of pathVar.split(";")) {
      if (!dir) continue;
      for (const ext of extensions) {
        const candidate = path.join(dir, command + ext);
        if (existsSync(candidate)) {
          resolved = candidate;
          break outer;
        }
      }
    }
  }

  // Covers both `bun.cmd` and `C:\...\bun.cmd` — Node's batch-file check
  // is suffix-only, so absoluteness doesn't exempt us.
  const ext = path.extname(resolved).toLowerCase();
  const useShell = ext === ".cmd" || ext === ".bat";

  return { command: resolved, useShell };
}

/**
 * Case-insensitive lookup of `name` in `env`, matching Node's Windows
 * env-dedup rule so the resolver walks the same PATH that the spawned
 * child will actually receive.
 *
 * Windows env vars are case-insensitive at the OS layer, but JS exposes
 * `process.env` with whatever casing the launching shell used (typically
 * `Path`, not `PATH`). A merged `{...process.env, ...userEnv}` can end up
 * with BOTH casings as distinct keys. Node's spawn on Windows (see
 * lib/child_process.js normalizeSpawnArguments, sort+first branch) sorts
 * keys and keeps the first case-insensitive match; since uppercase sorts
 * before lowercase, `PATH` wins over `Path`.
 *
 * We replicate that rule so a user's launch.json `"env": {"PATH": "..."}`
 * override is honoured here too — otherwise `resolveCommand` would walk
 * the system `Path` while the child runs with the user's `PATH`, and
 * `bun` would resolve to a different binary than the one actually on the
 * child's PATH.
 */
function lookupEnvCaseInsensitive(
  env: Record<string, string | undefined> | NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const target = name.toUpperCase();
  // Sort matches Node's dedup: earliest lexicographic key wins. `PATH` <
  // `Path` < `path` by ASCII, so any uppercase variant will take priority
  // over mixed- or lowercase ones present alongside it.
  const keys = Object.keys(env)
    .filter(key => key.toUpperCase() === target)
    .sort();
  for (const key of keys) {
    const value = (env as Record<string, string | undefined>)[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

// cmd.exe metacharacters that need caret-escaping to be taken literally by
// the parser. Includes `"` and space so the caret-escape pass below can do
// "the one thing" and produce a command line that cmd.exe never enters
// quote-state for — see `buildShellCommand`.
const CMD_META_CHARS = /([()[\]%!^"`<>&|;, ])/g;

/**
 * Build the argument string for `cmd.exe /d /s /c <...>` that invokes
 * `command` with `args` safely — paths and arguments with spaces, cmd
 * metacharacters, or `%VAR%` sequences all survive to the debuggee intact.
 *
 * Usage:
 *   spawn(cmdExe, ["/d", "/s", "/c", buildShellCommand(cmd, args)], {
 *     windowsVerbatimArguments: true,
 *     ...,
 *   });
 *
 * Escaping follows cross-spawn (lib/util/escape.js) because the obvious
 * approaches all have subtle failure modes:
 *
 * 1. Simply wrapping in `"..."`. Fails because cmd.exe does `%VAR%`
 *    expansion in **phase 1** of parsing, BEFORE quote recognition in
 *    phase 2 — so `"--flag=%PATH%"` is expanded to the user's PATH
 *    regardless of quotes.
 *
 * 2. Wrapping then replacing `%` → `^%` inside the quotes. Looks right,
 *    but `^` is the escape character only when the quote-flag is OFF.
 *    Inside a `"..."` region `^` is taken literally, so the carets
 *    survive phase 2 and reach the debuggee as part of the argument.
 *    The arg becomes `--flag=^%PATH^%` — worse than doing nothing.
 *
 * 3. Caret-escaping **everything including the wrapping quotes**. What
 *    cross-spawn does. Because every `"` appears as `^"` in the final
 *    command line, cmd.exe's phase 2 never enters quote-state; all
 *    carets are consumed as escapes; and the `^"` pairs that survive
 *    through to `CommandLineToArgvW` delimit tokens for the target
 *    process. This is the only approach that handles all three of
 *    spaces-in-paths, metacharacters, and `%VAR%` at once.
 *
 * Because `useShell: true` fires only for a `.cmd`/`.bat` target, the
 * shim's body (`"%~dp0\...\bun.exe" %*` or similar) is re-parsed by cmd
 * after `%*` expands — and in that second parse `\` is NOT an escape
 * character, so the `\"` sequences produced by the qntm pass toggle
 * quote-state. A `&`/`|`/`<`/`>` sitting between two inner `"` bytes
 * would therefore land OUTSIDE quote-state in the batch re-parse and be
 * treated as a command separator (the BatBadBut pattern). The caret
 * pass is applied TWICE: one layer is consumed by the outer cmd.exe,
 * the second layer survives into the batch-line phase 2 and keeps
 * metacharacters literal there too. This mirrors cross-spawn's
 * `doubleEscapeMetaChars` flag, which is always-on for cmd-shim targets.
 *
 * Argument handling uses the qntm.org/cmd algorithm for backslash/quote
 * interaction inside the quoted region (necessary so inner `"` characters
 * survive `CommandLineToArgvW`'s unescape pass). The command itself is
 * caret-escaped (also twice, for the same batch re-parse reason) without
 * the qntm pass because it's a file path — we assume no embedded `"` in
 * the path. Matches cross-spawn exactly.
 */
export function buildShellCommand(command: string, args: readonly string[]): string {
  // The command itself goes through only the outer cmd.exe parse (cmd uses
  // it to locate the program to run; it is not re-interpreted as part of
  // the batch file's body). One caret layer is enough.
  const escapeCommand = (token: string) => token.replace(CMD_META_CHARS, "^$1");

  const escapeArgument = (token: string) => {
    // qntm algorithm: a run of backslashes abutting a `"` gets doubled
    // (and the `"` escaped with `\`) so `CommandLineToArgvW` sees the
    // right number of literal backslashes + a literal quote.
    let escaped = token.replace(/(\\*)"/g, '$1$1\\"');
    // A trailing backslash run would abut the closing wrapper `"` we are
    // about to add, so the same doubling applies.
    escaped = escaped.replace(/(\\*)$/, "$1$1");
    // Wrap, then caret-escape EVERY metachar TWICE — including the
    // wrapping quotes. The outer cmd.exe consumes one layer; the second
    // layer survives into the shim's own cmd re-parse (where `%*` expands
    // these tokens into its `"%dp0%\...\bun.exe" %*` line) and keeps
    // metachars literal there too. Without the second pass, an arg like
    // `fetch("http://a?x=1&y=2")` splits on `&` in the inner parse —
    // the BatBadBut pattern — because `\` is not an escape in cmd.
    return `"${escaped}"`.replace(CMD_META_CHARS, "^$1").replace(CMD_META_CHARS, "^$1");
  };

  const body = [escapeCommand(command), ...args.map(escapeArgument)].join(" ");
  // Outer wrap so cmd.exe `/s` has something to strip. After the outer
  // parse consumes one caret layer, `%*` inside the shim holds the
  // still-single-escaped tokens, and the shim's inner parse consumes the
  // last layer before handing the final argv to `CommandLineToArgvW`.
  return `"${body}"`;
}

/**
 * Rewrite an argv array to avoid multi-line content when we're about to
 * route it through `cmd.exe /d /s /c`. cmd.exe's phase 2 parser ends the
 * command at the first unescaped `\n` — and there is no caret sequence
 * that produces a literal LF in a cmd command line (`^<LF>` is line
 * continuation, which *removes* both bytes). So multi-line argv entries
 * silently truncate the script at the first newline.
 *
 * The only place the debug adapter generates multi-line argv content is
 * `--eval <source>` for VS Code's "Run/Debug Unsaved Code" feature. When
 * that fires, spill the source to a file and rewrite `--eval src` → the
 * file path. Bun then runs the file as a program.
 *
 * The file is written at `path.join(cwd, "[eval]")` — the exact path the
 * VS Code extension's source-mapping layer (`bun-vscode/src/features/
 * debug.ts`) derives from `cwd` and compares against Bun's reported
 * script URL. Bun uses `[eval]` as the synthetic name for `--eval` source,
 * so the file on disk and the debuggee's self-reported URL match, which
 * lets the extension round-trip breakpoints between the untitled editor
 * and the running script. Placing the file in `cwd` also keeps relative
 * imports (`import './lib'`) resolving the same way they would with
 * `--eval` (relative to `cwd`). An `os.tmpdir()` location would break both.
 *
 * Returns the (possibly rewritten) argv along with a cleanup function
 * that removes the temp file once the spawned process exits. Throws if
 * a multi-line arg appears outside the `--eval <source>` pattern — we
 * have no safe transformation for that, and silent truncation is worse
 * than a clear error.
 */
export function escapeMultilineArgsForCmd(
  args: readonly string[],
  cwd?: string,
): {
  args: string[];
  cleanup: () => void;
} {
  const hasMultiline = (s: string) => s.includes("\n") || s.includes("\r");
  if (!args.some(hasMultiline)) return { args: [...args], cleanup: () => {} };

  const tempFiles: string[] = [];
  const cleanup = () => {
    for (const file of tempFiles) {
      try {
        rmSync(file, { force: true });
      } catch {}
    }
  };

  const rewritten: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!hasMultiline(arg)) {
      rewritten.push(arg);
      continue;
    }
    // Only `--eval <multiline>` has a safe transformation: write the source
    // to a file named `[eval]` in `cwd` and run that. Any other multi-line
    // arg we have no way to losslessly forward through cmd.exe.
    if (rewritten[rewritten.length - 1] !== "--eval" && rewritten[rewritten.length - 1] !== "-e") {
      cleanup();
      throw new Error(
        "Cannot spawn Bun through cmd.exe with a multi-line argument. " +
          "The VS Code debugger resolved Bun to a `.cmd` shim (usually from `npm i -g bun`) " +
          "which routes through cmd.exe; cmd.exe's parser ends the command line at any " +
          "unescaped newline. Install Bun via the official installer so `bun.exe` lives on " +
          "PATH directly, or pass single-line arguments only.",
      );
    }
    // A cwd is required so the on-disk path matches the extension's
    // derived `bunEvalPath = join(cwd, "[eval]")`. Without one the
    // generated file would live elsewhere and breakpoints wouldn't bind.
    const effectiveCwd = cwd ?? process.cwd();
    const file = path.join(effectiveCwd, "[eval]");
    try {
      writeFileSync(file, arg);
    } catch (cause) {
      cleanup();
      throw new Error(
        `Failed to materialise multi-line --eval source for the cmd.exe path ` +
          `(could not write to ${file}). Install Bun via the official installer ` +
          `so bun.exe is on PATH directly and avoid the cmd.exe routing.`,
        { cause },
      );
    }
    tempFiles.push(file);
    // Drop the preceding `--eval`/`-e` flag and push the file path.
    rewritten.pop();
    rewritten.push(file);
  }

  return { args: rewritten, cleanup };
}

const capabilities: DAP.Capabilities = {
  supportsConfigurationDoneRequest: true,
  supportsFunctionBreakpoints: true,
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsEvaluateForHovers: true,
  exceptionBreakpointFilters: [
    {
      filter: "all",
      label: "All Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks on all throw errors, even if they're caught later.",
      conditionDescription: `error.name == "CustomError"`,
    },
    {
      filter: "uncaught",
      label: "Uncaught Exceptions",
      default: false,
      supportsCondition: true,
      description: "Breaks only on errors or promise rejections that are not handled.",
      conditionDescription: `error.name == "CustomError"`,
    },
    {
      filter: "debugger",
      label: "Debugger Statements",
      default: true,
      supportsCondition: false,
      description: "Breaks on `debugger` statements.",
    },
    {
      filter: "assert",
      label: "Assertion Failures",
      default: false,
      supportsCondition: false,
      description: "Breaks on failed assertions.",
    },
    {
      filter: "microtask",
      label: "Microtasks",
      default: false,
      supportsCondition: false,
      description: "Breaks on microtasks.",
    },
  ],
  supportsStepBack: false,
  supportsSetVariable: true,
  supportsRestartFrame: false,
  supportsGotoTargetsRequest: true,
  supportsStepInTargetsRequest: false,
  supportsCompletionsRequest: true,
  completionTriggerCharacters: [".", "[", '"', "'"],
  supportsModulesRequest: false,
  additionalModuleColumns: [],
  supportedChecksumAlgorithms: [],
  supportsRestartRequest: false, // TODO
  supportsExceptionOptions: false, // TODO
  supportsValueFormattingOptions: false,
  supportsExceptionInfoRequest: true,
  supportTerminateDebuggee: true,
  supportSuspendDebuggee: false,
  supportsDelayedStackTraceLoading: true,
  supportsLoadedSourcesRequest: true,
  supportsLogPoints: true,
  supportsTerminateThreadsRequest: false,
  supportsSetExpression: true,
  supportsTerminateRequest: true,
  supportsDataBreakpoints: false, // TODO
  supportsReadMemoryRequest: false,
  supportsWriteMemoryRequest: false,
  supportsDisassembleRequest: false,
  supportsCancelRequest: false,
  supportsBreakpointLocationsRequest: true,
  supportsClipboardContext: false,
  supportsSteppingGranularity: false,
  supportsInstructionBreakpoints: false,
  supportsExceptionFilterOptions: false,
  supportsSingleThreadExecutionRequests: false,
};

type InitializeRequest = DAP.InitializeRequest & {
  supportsConfigurationDoneRequest?: boolean;
  enableControlFlowProfiler?: boolean;
  enableDebugger?: boolean;
  enableTestReporter?: boolean;
  enableConsole?: boolean | true;
} & (
    | {
        enableLifecycleAgentReporter?: false;
        sendImmediatePreventExit?: false;
      }
    | {
        enableLifecycleAgentReporter: true;
        sendImmediatePreventExit?: boolean;
      }
  );

type LaunchRequest = DAP.LaunchRequest & {
  runtime?: string;
  runtimeArgs?: string[];
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  strictEnv?: boolean;
  stopOnEntry?: boolean;
  noDebug?: boolean;
  watchMode?: boolean | "hot";
  __skipValidation?: boolean;
  stdin?: string;
};

type AttachRequest = DAP.AttachRequest & {
  url?: string;
  noDebug?: boolean;
  stopOnEntry?: boolean;
};

type DebuggerOptions = (LaunchRequest & { type: "launch" }) | (AttachRequest & { type: "attach" });

type Source = DAP.Source & {
  scriptId: string;
  sourceMap: SourceMap;
} & (
    | {
        sourceId: string;
        path: string;
        sourceReference?: undefined;
      }
    | {
        sourceId: number;
        path?: undefined;
        sourceReference: number;
      }
  );

type Breakpoint = DAP.Breakpoint & {
  id: number;
  breakpointId: string;
  request?: DAP.SourceBreakpoint;
  source?: Source;
};

type FutureBreakpoint = {
  url: string;
  breakpoint: DAP.SourceBreakpoint;
};

type Target = (DAP.GotoTarget | DAP.StepInTarget) & {
  source: Source;
};

type FunctionBreakpoint = DAP.Breakpoint & {
  id: number;
  name: string;
};

type StackFrame = DAP.StackFrame & {
  scriptId: string;
  callFrameId: string;
  source?: Source;
  scopes?: Scope[];
};

type Scope = DAP.Scope & {
  source?: Source;
};

type Variable = DAP.Variable & {
  objectId?: string;
  objectGroup?: string;
  type: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"];
};

type IDebugAdapter = {
  [E in keyof DAP.EventMap]?: (event: DAP.EventMap[E]) => void | Promise<void>;
} & {
  [R in keyof DAP.RequestMap]?: (
    request: DAP.RequestMap[R],
  ) => void | DAP.ResponseMap[R] | Promise<DAP.ResponseMap[R]> | Promise<void>;
};

export type DebugAdapterEventMap = InspectorEventMap & {
  [E in keyof DAP.EventMap as E extends string ? `Adapter.${E}` : never]: [DAP.EventMap[E]];
} & {
  "Adapter.request": [DAP.Request];
  "Adapter.response": [DAP.Response];
  "Adapter.event": [DAP.Event];
  "Adapter.error": [Error];
  "Adapter.reverseRequest": [DAP.Request];
} & {
  "Process.requested": [unknown];
  "Process.spawned": [ChildProcess];
  "Process.exited": [number | Error | null, string | null];
  "Process.stdout": [string];
  "Process.stderr": [string];
};

const isDebug = process.env.NODE_ENV === "development";
const debugSilentEvents = new Set(["Adapter.event", "Inspector.event"]);

let threadId = 1;

// Add these helper functions at the top level
function normalizeSourcePath(sourcePath: string, untitledDocPath?: string, bunEvalPath?: string): string {
  if (!sourcePath) return sourcePath;

  // Handle eval source paths
  if (sourcePath === bunEvalPath) {
    return bunEvalPath!;
  }

  // Handle untitled documents
  if (sourcePath === untitledDocPath) {
    return bunEvalPath!;
  }

  // Handle normal file paths
  return path.normalize(sourcePath);
}

export abstract class BaseDebugAdapter<T extends Inspector = Inspector>
  extends EventEmitter<DebugAdapterEventMap>
  implements IDebugAdapter
{
  protected readonly inspector: T;
  protected options?: DebuggerOptions;

  #threadId: number;
  #sourceId: number;
  #pendingSources: Map<string, ((source: Source) => void)[]>;
  #sources: Map<string | number, Source>;
  #stackFrames: StackFrame[];
  #stopped?: DAP.StoppedEvent["reason"];
  #exception?: Variable;
  #breakpoints: Map<string, Breakpoint[]>;
  #futureBreakpoints: Map<string, FutureBreakpoint[]>;
  #functionBreakpoints: Map<string, FunctionBreakpoint>;
  #targets: Map<number, Target>;
  #variableId: number;
  #variables: Map<number, Variable>;
  #untitledDocPath?: string;
  #bunEvalPath?: string;
  #initialized?: InitializeRequest;

  protected constructor(inspector: T, untitledDocPath?: string, bunEvalPath?: string) {
    super();
    this.#untitledDocPath = untitledDocPath;
    this.#bunEvalPath = bunEvalPath;
    this.#threadId = threadId++;
    this.inspector = inspector;
    const emit = this.inspector.emit.bind(this.inspector);
    this.inspector.emit = (event, ...args) => {
      let sent = false;
      sent ||= emit(event, ...args);
      sent ||= this.emit(event as keyof JSC.EventMap, ...(args as any));
      return sent;
    };
    this.#sourceId = 1;
    this.#pendingSources = new Map();
    this.#sources = new Map();
    this.#stackFrames = [];
    this.#stopped = undefined;
    this.#breakpoints = new Map();
    this.#futureBreakpoints = new Map();
    this.#functionBreakpoints = new Map();
    this.#targets = new Map();
    this.#variableId = 1;
    this.#variables = new Map();
  }

  /**
   * Gets the inspector url. This is deprecated and exists for compat.
   * @deprecated You should get the inspector directly (with .getInspector()), and if it's a WebSocketInspector you can access `.url` direclty.
   */
  get url(): string {
    // This code has been migrated from a time when the inspector was always a WebSocketInspector.
    if (this.inspector instanceof WebSocketInspector) {
      return this.inspector.url;
    }

    throw new Error("Inspector does not offer a URL");
  }

  public getInspector() {
    return this.inspector;
  }

  abstract start(...args: unknown[]): Promise<boolean>;

  /**
   * Sends a request to the JavaScript inspector.
   * @param method the method name
   * @param params the method parameters
   * @returns the response
   * @example
   * const { result, wasThrown } = await adapter.send("Runtime.evaluate", {
   *   expression: "1 + 1",
   * });
   * console.log(result.value); // 2
   */
  async send<M extends keyof JSC.ResponseMap>(method: M, params?: JSC.RequestMap[M]): Promise<JSC.ResponseMap[M]> {
    return this.inspector.send(method, params);
  }

  /**
   * Emits an event. For the adapter to work, you must:
   * - emit `Adapter.request` when the client sends a request to the adapter.
   * - listen to `Adapter.response` to receive responses from the adapter.
   * - listen to `Adapter.event` to receive events from the adapter.
   * @param event the event name
   * @param args the event arguments
   * @returns if the event was sent to a listener
   */
  emit<E extends keyof DebugAdapterEventMap>(event: E, ...args: DebugAdapterEventMap[E] | []): boolean {
    if (isDebug && !debugSilentEvents.has(event)) {
      console.log(this.#threadId, event, ...args);
    }

    let sent = super.emit(event, ...(args as any));

    if (!(event in this)) {
      return sent;
    }

    let result: unknown;
    try {
      // @ts-ignore
      result = this[event](...args);
    } catch (cause) {
      sent ||= this.emit("Adapter.error", unknownToError(cause));
      return sent;
    }

    if (result instanceof Promise) {
      result.catch(cause => {
        this.emit("Adapter.error", unknownToError(cause));
      });
    }

    return sent;
  }

  protected emitAdapterEvent<E extends keyof DAP.EventMap>(event: E, body?: DAP.EventMap[E]): void {
    this.emit("Adapter.event", {
      type: "event",
      seq: 0,
      event,
      body,
    });
  }

  #emitAfterResponse<E extends keyof DAP.EventMap>(event: E, body?: DAP.EventMap[E]): void {
    this.once("Adapter.response", () => {
      process.nextTick(() => {
        this.emitAdapterEvent(event, body);
      });
    });
  }

  #reverseRequest<T extends keyof DAP.RequestMap>(command: T, args?: DAP.RequestMap[T]): void {
    this.emit("Adapter.reverseRequest", {
      type: "request",
      seq: 0,
      command,
      arguments: args,
    });
  }

  async ["Adapter.request"](request: DAP.Request): Promise<void> {
    const { command, arguments: args } = request;

    if (!(command in this)) {
      return;
    }

    let timerId: number | undefined;
    let result: unknown;
    try {
      result = await Promise.race([
        // @ts-ignore
        this[command](args),
        new Promise((_, reject) => {
          timerId = +setTimeout(() => reject(new Error(`Timed out: ${command}`)), 15_000);
        }),
      ]);
    } catch (cause) {
      if (cause === Cancel) {
        this.emit("Adapter.response", {
          type: "response",
          command,
          success: false,
          message: "cancelled",
          request_seq: request.seq,
          seq: 0,
        });
        return;
      }

      const error = unknownToError(cause);
      this.emit("Adapter.error", error);

      const { message } = error;
      this.emit("Adapter.response", {
        type: "response",
        command,
        success: false,
        message,
        request_seq: request.seq,
        seq: 0,
      });
      return;
    } finally {
      if (timerId) {
        clearTimeout(timerId);
      }
    }

    this.emit("Adapter.response", {
      type: "response",
      command,
      success: true,
      request_seq: request.seq,
      seq: 0,
      body: result,
    });
  }

  ["Adapter.event"](event: DAP.Event): void {
    const { event: name, body } = event;
    this.emit(`Adapter.${name}` as keyof DebugAdapterEventMap, body);
  }

  public initialize(request: InitializeRequest): DAP.InitializeResponse {
    this.#initialized = request;

    this.send("Inspector.enable");
    this.send("Runtime.enable");

    if (request.enableConsole ?? true) {
      this.send("Console.enable");
    }

    if (request.enableControlFlowProfiler) {
      this.send("Runtime.enableControlFlowProfiler");
    }

    if (request.enableLifecycleAgentReporter) {
      this.send("LifecycleReporter.enable");

      if (request.sendImmediatePreventExit) {
        this.send("LifecycleReporter.preventExit");
      }
    }

    if (request.enableTestReporter) {
      this.send("TestReporter.enable");
    }

    // use !== false because by default if unspecified we want to enable the debugger
    // and this option didn't exist beforehand, so we can't make it non-optional
    if (request.enableDebugger !== false) {
      this.send("Debugger.enable").catch(error => {
        const { message } = unknownToError(error);
        if (message !== "Debugger domain already enabled") {
          throw error;
        }
      });

      this.send("Debugger.setAsyncStackTraceDepth", { depth: 200 });
    }

    const { clientID, supportsConfigurationDoneRequest } = request;
    if (!supportsConfigurationDoneRequest && clientID !== "vscode") {
      this.configurationDone();
    }

    // Tell the client what capabilities this adapter supports.
    return capabilities;
  }

  configurationDone(): void {
    // If the client requested that `noDebug` mode be enabled,
    // then we need to disable all breakpoints and pause on statements.
    const active = !this.options?.noDebug;
    this.send("Debugger.setBreakpointsActive", { active });

    // Tell the debugger that its ready to start execution.
    this.send("Inspector.initialized");
  }

  // Required so all implementations have a method that .terminate() always calls.
  // This is useful because we don't want any implementors to forget
  protected abstract exitJSProcess(): void;

  terminate(): void {
    this.exitJSProcess();
    this.emitAdapterEvent("terminated");
  }

  disconnect(request: DAP.DisconnectRequest): void {
    const { terminateDebuggee } = request;

    if (terminateDebuggee) {
      this.terminate();
    }

    this.close();
  }

  async source(request: DAP.SourceRequest): Promise<DAP.SourceResponse> {
    const { source } = request;
    const { scriptId } = await this.#getSource(sourceToId(source));
    const { scriptSource } = await this.send("Debugger.getScriptSource", { scriptId });

    return {
      content: scriptSource,
    };
  }

  async threads(): Promise<DAP.ThreadsResponse> {
    return {
      threads: [
        {
          id: this.#threadId,
          name: "Main Thread",
        },
      ],
    };
  }

  async pause(): Promise<void> {
    await this.send("Debugger.pause");
    this.#stopped = "pause";
  }

  async continue(): Promise<void> {
    await this.send("Debugger.resume");
    this.#stopped = undefined;
  }

  async next(): Promise<void> {
    await this.send("Debugger.stepNext");
    this.#stopped = "step";
  }

  async stepIn(): Promise<void> {
    await this.send("Debugger.stepInto");
    this.#stopped = "step";
  }

  async stepOut(): Promise<void> {
    await this.send("Debugger.stepOut");
    this.#stopped = "step";
  }

  async breakpointLocations(request: DAP.BreakpointLocationsRequest): Promise<DAP.BreakpointLocationsResponse> {
    const { line, endLine, column, endColumn, source: source0 } = request;
    if (process.platform === "win32") {
      source0.path = source0.path ? normalizeWindowsPath(source0.path) : source0.path;
    }
    const source = await this.#getSource(sourceToId(source0));

    const { locations } = await this.send("Debugger.getBreakpointLocations", {
      start: this.#generatedLocation(source, line, column),
      end: this.#generatedLocation(source, endLine ?? line + 1, endColumn),
    });

    return {
      breakpoints: locations.map(location => this.#originalLocation(source, location)),
    };
  }

  #generatedLocation(source: Source, line?: number, column?: number): JSC.Debugger.Location {
    const { sourceMap, scriptId, path } = source;
    const { line: gline, column: gcolumn } = sourceMap.generatedLocation({
      line: this.#lineTo0BasedLine(line),
      column: this.#columnTo0BasedColumn(column),
      url: path,
    });

    return {
      scriptId,
      lineNumber: gline,
      columnNumber: gcolumn,
    };
  }

  #lineTo0BasedLine(line?: number): number {
    if (!numberIsValid(line)) {
      return 0;
    }
    if (!this.#initialized?.linesStartAt1) {
      return line;
    }
    return line - 1;
  }

  #columnTo0BasedColumn(column?: number): number {
    if (!numberIsValid(column)) {
      return 0;
    }
    if (!this.#initialized?.columnsStartAt1) {
      return column;
    }
    return column - 1;
  }

  #originalLocation(
    source: Source,
    line?: number | JSC.Debugger.Location,
    column?: number,
  ): { line: number; column: number } {
    if (typeof line === "object") {
      const { lineNumber, columnNumber } = line;
      line = lineNumber;
      column = columnNumber;
    }

    const { sourceMap } = source;
    const { line: oline, column: ocolumn } = sourceMap.originalLocation({ line, column });

    return {
      line: this.#lineFrom0BasedLine(oline),
      // For now, remove the column from locations because
      // it can be inaccurate and causes weird rendering issues in VSCode.
      column: this.#columnFrom0BasedColumn(0), // ocolumn
    };
  }

  #lineFrom0BasedLine(line?: number): number {
    if (!this.#initialized?.linesStartAt1) {
      return numberIsValid(line) ? line : 0;
    }
    return numberIsValid(line) ? line + 1 : 1;
  }

  #columnFrom0BasedColumn(column?: number): number {
    if (!this.#initialized?.columnsStartAt1) {
      return numberIsValid(column) ? column : 0;
    }
    return numberIsValid(column) ? column + 1 : 1;
  }

  async setBreakpoints(request: DAP.SetBreakpointsRequest): Promise<DAP.SetBreakpointsResponse> {
    const { source, breakpoints: requests = [] } = request;
    const { path, sourceReference } = source;

    let breakpoints: Breakpoint[] | undefined;
    if (path) {
      breakpoints = await this.#setBreakpointsByUrl(path, requests, true);
    } else if (sourceReference) {
      const source = this.#getSourceIfPresent(sourceReference);
      if (source) {
        const { scriptId } = source;
        breakpoints = await this.#setBreakpointsById(scriptId, requests, true);
      }
    }

    return {
      breakpoints: breakpoints ?? [],
    };
  }

  async #setBreakpointsByUrl(url: string, requests: DAP.SourceBreakpoint[], unsetOld?: boolean): Promise<Breakpoint[]> {
    if (process.platform === "win32") {
      url = url ? normalizeWindowsPath(url) : url;
    }
    const source = this.#getSourceIfPresent(url);

    // If the source is not loaded, set a placeholder breakpoint at the start of the file.
    // If the breakpoint is resolved in the future, a `Debugger.breakpointResolved` event
    // will be emitted and each of these breakpoint requests can be retried.
    if (!source) {
      let result;
      try {
        result = await this.send("Debugger.setBreakpointByUrl", {
          url,
          lineNumber: 0,
        });
      } catch (error) {
        return requests.map(() => invalidBreakpoint(error));
      }

      const { breakpointId, locations } = result;
      if (locations.length) {
        // TODO: Source was loaded while the breakpoint was being set?
      }

      return requests.map(request =>
        this.#addFutureBreakpoint({
          breakpointId,
          url,
          breakpoint: request,
        }),
      );
    }

    const oldBreakpoints = this.#getBreakpoints(sourceToId(source));
    const breakpoints = await Promise.all(
      requests.map(async request => {
        const oldBreakpoint = this.#getBreakpointByLocation(source, request);
        if (oldBreakpoint) {
          return oldBreakpoint;
        }

        const { line, column, ...options } = request;
        const location = this.#generatedLocation(source, line, column);

        let result;
        try {
          result = await this.send("Debugger.setBreakpointByUrl", {
            url,
            ...location,
            options: breakpointOptions(options),
          });
        } catch (error) {
          return invalidBreakpoint(error);
        }

        const { breakpointId, locations } = result;

        const breakpoints = locations.map((location, i) =>
          this.#addBreakpoint({
            breakpointId,
            location,
            source,
            request,
            // It is theoretically possible for a breakpoint to resolve to multiple locations.
            // In that case, send a separate `breakpoint` event for each one, excluding the first.
            notify: i > 0,
          }),
        );

        // Each breakpoint request can only be mapped to one breakpoint.
        return breakpoints[0];
      }),
    );

    if (unsetOld) {
      await Promise.all(
        oldBreakpoints.map(({ breakpointId }) => {
          if (!breakpoints.some(({ breakpointId: id }) => breakpointId === id)) {
            return this.#unsetBreakpoint(breakpointId);
          }
        }),
      );
    }

    return breakpoints;
  }

  async #setBreakpointsById(
    scriptId: string,
    requests: DAP.SourceBreakpoint[],
    unsetOld?: boolean,
  ): Promise<Breakpoint[]> {
    const source = await this.#getSourceById(scriptId);
    if (!source) {
      return requests.map(() => invalidBreakpoint());
    }

    const oldBreakpoints = this.#getBreakpoints(sourceToId(source));
    const breakpoints = await Promise.all(
      requests.map(async request => {
        const oldBreakpoint = this.#getBreakpointByLocation(source, request);
        if (oldBreakpoint) {
          return oldBreakpoint;
        }

        const { line, column, ...options } = request;
        const location = this.#generatedLocation(source, line, column);

        let result;
        try {
          result = await this.send("Debugger.setBreakpoint", {
            location,
            options: breakpointOptions(options),
          });
        } catch (error) {
          return invalidBreakpoint(error);
        }

        const { breakpointId, actualLocation } = result;
        return this.#addBreakpoint({
          breakpointId,
          location: actualLocation,
          request,
          source,
        });
      }),
    );

    if (unsetOld) {
      await Promise.all(
        oldBreakpoints.map(({ breakpointId }) => {
          if (!breakpoints.some(({ breakpointId: id }) => breakpointId === id)) {
            return this.#unsetBreakpoint(breakpointId);
          }
        }),
      );
    }

    return breakpoints;
  }

  async #unsetBreakpoint(breakpointId: string): Promise<void> {
    try {
      await this.send("Debugger.removeBreakpoint", { breakpointId });
    } catch {
      // Ignore any errors.
    }

    this.#removeBreakpoint(breakpointId);
    this.#removeFutureBreakpoint(breakpointId);
  }

  #addBreakpoint(options: {
    breakpointId: string;
    location?: JSC.Debugger.Location;
    request?: DAP.SourceBreakpoint;
    source?: Source;
    notify?: boolean;
  }): Breakpoint {
    const { breakpointId, location, source, request, notify } = options;

    let originalLocation;
    if (source) {
      originalLocation = this.#originalLocation(source, location);
    } else {
      originalLocation = {};
    }

    const breakpoints = this.#getBreakpointsById(breakpointId);
    const breakpoint: Breakpoint = {
      id: nextId(),
      breakpointId,
      source,
      request,
      ...originalLocation,
      verified: !!source,
    };

    breakpoints.push(breakpoint);
    return breakpoint;
  }

  #addFutureBreakpoint(options: { breakpointId: string; url: string; breakpoint: DAP.SourceBreakpoint }): Breakpoint {
    const { breakpointId, url, breakpoint } = options;

    const breakpoints = this.#getFutureBreakpoints(breakpointId);
    breakpoints.push({
      url,
      breakpoint,
    });

    return this.#addBreakpoint({
      breakpointId,
      request: breakpoint,
    });
  }

  #removeBreakpoint(breakpointId: string, notify?: boolean): void {
    const breakpoints = this.#breakpoints.get(breakpointId);

    if (!breakpoints || !this.#breakpoints.delete(breakpointId) || !notify) {
      return;
    }

    for (const breakpoint of breakpoints) {
      this.emitAdapterEvent("breakpoint", {
        reason: "removed",
        breakpoint,
      });
    }
  }

  #removeFutureBreakpoint(breakpointId: string, notify?: boolean): void {
    const breakpoint = this.#futureBreakpoints.get(breakpointId);

    if (!breakpoint || !this.#futureBreakpoints.delete(breakpointId)) {
      return;
    }

    this.#removeBreakpoint(breakpointId, notify);
  }

  #getBreakpointsById(breakpointId: string): Breakpoint[] {
    let breakpoints = this.#breakpoints.get(breakpointId);
    if (!breakpoints) {
      this.#breakpoints.set(breakpointId, (breakpoints = []));
    }
    return breakpoints;
  }

  #getBreakpointByLocation(source: Source, location: DAP.SourceBreakpoint): Breakpoint | undefined {
    if (isDebug) {
      console.log("getBreakpointByLocation", {
        source: sourceToId(source),
        location,
        ids: this.#getBreakpoints(sourceToId(source)).map(({ id }) => id),
        breakpointIds: this.#getBreakpoints(sourceToId(source)).map(({ breakpointId }) => breakpointId),
        lines: this.#getBreakpoints(sourceToId(source)).map(({ line }) => line),
        columns: this.#getBreakpoints(sourceToId(source)).map(({ column }) => column),
      });
    }
    let sourceId = sourceToId(source);
    const untitledDocPath = this.#untitledDocPath;
    if (sourceId === untitledDocPath && this.#bunEvalPath) {
      sourceId = this.#bunEvalPath;
    }
    const [breakpoint] = this.#getBreakpoints(sourceId).filter(
      ({ source, request }) => source && sourceToId(source) === sourceId && request?.line === location.line,
    );
    return breakpoint;
  }

  #getBreakpoints(sourceId: string | number): Breakpoint[] {
    let output = [];
    let all = this.#breakpoints;
    for (const breakpoints of all.values()) {
      for (const breakpoint of breakpoints) {
        const source = breakpoint.source;
        if (source && sourceToId(source) === sourceId) {
          output.push(breakpoint);
        }
      }
    }

    return output;
  }

  #getFutureBreakpoints(breakpointId: string): FutureBreakpoint[] {
    let breakpoints = this.#futureBreakpoints.get(breakpointId);
    if (!breakpoints) {
      this.#futureBreakpoints.set(breakpointId, (breakpoints = []));
    }
    return breakpoints;
  }

  async setFunctionBreakpoints(
    request: DAP.SetFunctionBreakpointsRequest,
  ): Promise<DAP.SetFunctionBreakpointsResponse> {
    const { breakpoints: requests } = request;

    const oldBreakpoints = this.#getFunctionBreakpoints();
    const breakpoints = await Promise.all(
      requests.map(async ({ name, ...options }) => {
        const breakpoint = this.#getFunctionBreakpoint(name);
        if (breakpoint) {
          return breakpoint;
        }

        try {
          await this.send("Debugger.addSymbolicBreakpoint", {
            symbol: name,
            caseSensitive: true,
            isRegex: false,
            options: breakpointOptions(options),
          });
        } catch (error) {
          const { message } = unknownToError(error);
          return this.#addFunctionBreakpoint({
            id: nextId(),
            name,
            verified: false,
            message,
          });
        }

        return this.#addFunctionBreakpoint({
          id: nextId(),
          name,
          verified: true,
        });
      }),
    );

    await Promise.all(
      oldBreakpoints.map(async ({ name }) => {
        const isRemoved = !breakpoints.filter(({ name: n }) => name === n).length;
        if (isRemoved) {
          await this.send("Debugger.removeSymbolicBreakpoint", {
            symbol: name,
            caseSensitive: true,
            isRegex: false,
          });
          this.#removeFunctionBreakpoint(name);
        }
      }),
    );

    return {
      breakpoints,
    };
  }

  #getFunctionBreakpoints(): FunctionBreakpoint[] {
    return [...this.#functionBreakpoints.values()];
  }

  #getFunctionBreakpoint(name: string): FunctionBreakpoint | undefined {
    return this.#functionBreakpoints.get(name);
  }

  #addFunctionBreakpoint(breakpoint: FunctionBreakpoint): FunctionBreakpoint {
    const { name } = breakpoint;
    this.#functionBreakpoints.set(name, breakpoint);
    return breakpoint;
  }

  #removeFunctionBreakpoint(name: string): void {
    const breakpoint = this.#functionBreakpoints.get(name);

    if (!breakpoint || !this.#functionBreakpoints.delete(name)) {
      return;
    }

    this.#emitAfterResponse("breakpoint", {
      reason: "removed",
      breakpoint,
    });
  }

  async setExceptionBreakpoints(
    request: DAP.SetExceptionBreakpointsRequest,
  ): Promise<DAP.SetExceptionBreakpointsResponse> {
    const { filters } = request;

    let state: "all" | "uncaught" | "none";
    if (filters.includes("all")) {
      state = "all";
    } else if (filters.includes("uncaught")) {
      state = "uncaught";
    } else {
      state = "none";
    }

    await Promise.all([
      this.send("Debugger.setPauseOnExceptions", { state }),
      this.send("Debugger.setPauseOnAssertions", {
        enabled: filters.includes("assert"),
      }),
      this.send("Debugger.setPauseOnDebuggerStatements", {
        enabled: filters.includes("debugger"),
      }),
      this.send("Debugger.setPauseOnMicrotasks", {
        enabled: filters.includes("microtask"),
      }),
    ]);

    return {
      breakpoints: [],
    };
  }

  async gotoTargets(request: DAP.GotoTargetsRequest): Promise<DAP.GotoTargetsResponse> {
    const { source: source0 } = request;
    if (process.platform === "win32") {
      source0.path = source0.path ? normalizeWindowsPath(source0.path) : source0.path;
    }
    const source = await this.#getSource(sourceToId(source0));

    const { breakpoints } = await this.breakpointLocations(request);
    const targets = breakpoints.map(({ line, column }) =>
      this.#addTarget({
        id: this.#targets.size,
        label: `${line}:${column}`,
        source,
        line,
        column,
      }),
    );

    return {
      targets,
    };
  }

  #addTarget<T extends DAP.GotoTarget | DAP.StepInTarget>(target: T & { source: Source }): T {
    const { id } = target;
    this.#targets.set(id, target);
    return target;
  }

  #getTarget(targetId: number): Target | undefined {
    return this.#targets.get(targetId);
  }

  async goto(request: DAP.GotoRequest): Promise<void> {
    const { targetId } = request;
    const target = this.#getTarget(targetId);
    if (!target) {
      throw new Error("No target found.");
    }

    const { source, line, column } = target;
    const location = this.#generatedLocation(source, line, column);

    await this.send("Debugger.continueToLocation", {
      location,
    });
  }

  async evaluate(request: DAP.EvaluateRequest): Promise<DAP.EvaluateResponse> {
    const { expression, frameId, context } = request;
    const callFrameId = this.#getCallFrameId(frameId);
    const objectGroup = callFrameId ? "debugger" : context;

    const { result, wasThrown } = await this.evaluateInternal({
      expression,
      objectGroup,
      callFrameId,
    });

    if (wasThrown) {
      if (context === "hover" && isSyntaxError(result)) {
        throw Cancel;
      }

      throw new Error(remoteObjectToString(result));
    }

    const { name, value, ...variable } = this.#addObject(result, { objectGroup });
    return {
      ...variable,
      result: value,
    };
  }

  protected async evaluateInternal(options: {
    expression: string;
    objectGroup?: string;
    callFrameId?: string;
  }): Promise<JSC.Runtime.EvaluateResponse> {
    const { expression, objectGroup, callFrameId } = options;
    const method = callFrameId ? "Debugger.evaluateOnCallFrame" : "Runtime.evaluate";

    return this.send(method, {
      callFrameId,
      objectGroup,
      expression: sanitizeExpression(expression),
      generatePreview: true,
      emulateUserGesture: true,
      doNotPauseOnExceptionsAndMuteConsole: true,
      includeCommandLineAPI: true,
    });
  }

  async completions(request: DAP.CompletionsRequest): Promise<DAP.CompletionsResponse> {
    const { text, column, frameId } = request;
    const callFrameId = this.#getCallFrameId(frameId);

    const { expression, hint } = completionToExpression(text);
    const { result, wasThrown } = await this.evaluateInternal({
      expression: expression || "this",
      callFrameId,
      objectGroup: "repl",
    });

    if (wasThrown) {
      if (isSyntaxError(result)) {
        return {
          targets: [],
        };
      }
      throw new Error(remoteObjectToString(result));
    }

    const variable = this.#addObject(result, {
      objectGroup: "repl",
      evaluateName: expression,
    });

    const properties = await this.#getProperties(variable);
    const targets = properties
      .filter(({ name }) => isIdentifier(name) && (!hint || name.includes(hint)))
      .sort(variablesSortBy)
      .map(variableToCompletionItem);

    return {
      targets,
    };
  }

  ["Inspector.connected"](): void {
    this.emitAdapterEvent("output", {
      category: "debug console",
      output: "Debugger attached.\n",
    });

    this.emitAdapterEvent("initialized");
  }

  async ["Inspector.disconnected"](error?: Error): Promise<void> {
    this.emitAdapterEvent("output", {
      category: "debug console",
      output: "Debugger detached.\n",
    });

    if (error) {
      const { message } = error;
      this.emitAdapterEvent("output", {
        category: "stderr",
        output: `${message}\n`,
      });
    }

    this.resetInternal();
  }

  async ["Debugger.scriptParsed"](event: JSC.Debugger.ScriptParsedEvent): Promise<void> {
    const { url, scriptId, sourceMapURL } = event;

    // If no url is present, the script is from a `evaluate` request.
    if (!url) {
      return;
    }

    // Sources can be retrieved in two ways:
    // 1. If it has a `path`, the client retrieves the source from the file system.
    // 2. If it has a `sourceReference`, the client sends a `source` request.
    //    Moreover, the code is usually shown in a read-only editor.
    const isUserCode = path.isAbsolute(url);
    const sourceMap = SourceMap(sourceMapURL);
    const name = sourceName(url);
    const presentationHint = sourcePresentationHint(url);

    if (isUserCode) {
      this.#addSource({
        sourceId: url,
        scriptId,
        name,
        path: url,
        presentationHint,
        sourceMap,
      });
      return;
    }

    const sourceReference = this.#sourceId++;
    this.#addSource({
      sourceId: sourceReference,
      scriptId,
      name,
      sourceReference,
      presentationHint,
      sourceMap,
    });
  }

  ["Debugger.scriptFailedToParse"](event: JSC.Debugger.ScriptFailedToParseEvent): void {
    const { url, errorMessage, errorLine } = event;

    // If no url is present, the script is from an `evaluate` request.
    if (!url) {
      return;
    }

    this.emitAdapterEvent("output", {
      category: "stderr",
      output: errorMessage,
      line: this.#lineFrom0BasedLine(errorLine),
      source: {
        path: url || undefined,
      },
    });
  }

  async ["Debugger.breakpointResolved"](event: JSC.Debugger.BreakpointResolvedEvent): Promise<void> {
    const { breakpointId, location } = event;

    const futureBreakpoints = this.#getFutureBreakpoints(breakpointId);

    // If the breakpoint resolves to a placeholder breakpoint, go through
    // each breakpoint request and attempt to set them again.
    if (futureBreakpoints?.length) {
      const [{ url }] = futureBreakpoints;
      const requests = futureBreakpoints.map(({ breakpoint }) => breakpoint);

      const oldBreakpoints = this.#getBreakpointsById(breakpointId);
      const breakpoints = await this.#setBreakpointsByUrl(url, requests);

      for (let i = 0; i < breakpoints.length; i++) {
        const breakpoint = breakpoints[i];
        const oldBreakpoint = oldBreakpoints[i];

        this.emitAdapterEvent("breakpoint", {
          reason: "changed",
          breakpoint: {
            ...breakpoint,
            id: oldBreakpoint.id,
          },
        });
      }

      // Finally, remove the placeholder breakpoint.
      await this.#unsetBreakpoint(breakpointId);
      return;
    }

    const breakpoints = this.#getBreakpointsById(breakpointId);

    // This is a new breakpoint, which was likely created by another client
    // connected to the same debugger.
    if (!breakpoints.length) {
      const { scriptId } = location;
      const [url] = breakpointId.split(":");
      const source = await this.#getSourceById(scriptId, url);

      this.#addBreakpoint({
        breakpointId,
        location,
        source,
        notify: true,
      });
      return;
    }

    // TODO: update breakpoints?
  }

  ["Debugger.paused"](event: JSC.Debugger.PausedEvent): void {
    const { reason, callFrames, asyncStackTrace, data } = event;

    this.#stackFrames.length = 0;
    this.#stopped ||= stoppedReason(reason);
    for (const callFrame of callFrames) {
      this.#addStackFrame(callFrame);
    }
    if (asyncStackTrace) {
      this.#addAsyncStackTrace(asyncStackTrace);
    }

    // Depending on the reason, the `data` property is set to the reason
    // why the execution was paused. For example, if the reason is "breakpoint",
    // the `data` property is set to the breakpoint ID.
    let hitBreakpointIds: number[] | undefined;

    if (data) {
      if (reason === "exception") {
        const remoteObject = data as JSC.Runtime.RemoteObject;
        this.#exception = this.#addObject(remoteObject, { objectGroup: "debugger" });
      }

      if (reason === "FunctionCall") {
        const { name } = data as { name: string };
        const breakpoint = this.#getFunctionBreakpoint(name);
        if (breakpoint) {
          const { id } = breakpoint;
          hitBreakpointIds = [id];
        }
      }

      if (reason === "Breakpoint") {
        const { breakpointId } = data as JSC.Debugger.BreakpointPauseReason;

        const futureBreakpoints = this.#getFutureBreakpoints(breakpointId);
        if (futureBreakpoints.length) {
          this.send("Debugger.resume");
          return;
        }

        const breakpoints = this.#getBreakpointsById(breakpointId);
        if (breakpoints.length) {
          hitBreakpointIds = breakpoints.map(({ id }) => id);
        }
      }
    }

    this.emitAdapterEvent("stopped", {
      threadId: this.#threadId,
      reason: this.#stopped,
      hitBreakpointIds,
    });
  }

  ["Debugger.resumed"](): void {
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#exception = undefined;
    for (const { variablesReference, objectGroup } of this.#variables.values()) {
      if (objectGroup === "debugger") {
        this.#variables.delete(variablesReference);
      }
    }

    this.emitAdapterEvent("continued", {
      threadId: this.#threadId,
    });
  }

  ["Process.stdout"](output: string): void {
    this.emitAdapterEvent("output", {
      category: "debug console",
      output,
    });
  }

  ["Process.stderr"](output: string): void {
    this.emitAdapterEvent("output", {
      category: "debug console",
      output,
    });
  }

  ["Console.messageAdded"](event: JSC.Console.MessageAddedEvent): void {
    // const { message } = event;
    // const { type, level, text, parameters, line, column, stackTrace } = message;
    // let output: string;
    // let variablesReference: number | undefined;
    // if (parameters?.length) {
    //   output = "";
    //   const variables = parameters.map((parameter, i) => {
    //     const variable = this.#addObject(parameter, { name: `${i}`, objectGroup: "console" });
    //     output += remoteObjectToString(parameter, true) + " ";
    //     return variable;
    //   });
    //   if (variables.length === 1) {
    //     const [{ variablesReference: reference }] = variables;
    //     variablesReference = reference;
    //   } else {
    //     variablesReference = this.#variableId++;
    //     //this.#variables.set(variablesReference, variables);
    //   }
    // } else {
    //   output = text;
    // }
    // if (!output.endsWith("\n")) {
    //   output += "\n";
    // }
    // const color = consoleLevelToAnsiColor(level);
    // if (color) {
    //   output = `${color}${output}`;
    // }
    // if (variablesReference) {
    //   const containerReference = this.#variableId++;
    //   this.#variables.set(containerReference, {
    //     name: "",
    //     value: "",
    //     type: undefined,
    //     variablesReference,
    //   });
    //   variablesReference = containerReference;
    // }
    // let source: Source | undefined;
    // if (stackTrace) {
    //   const { callFrames } = stackTrace;
    //   if (callFrames.length) {
    //     const { scriptId } = callFrames.at(-1)!;
    //     source = this.#getSourceIfPresent(scriptId);
    //   }
    // }
    // let location: Location | {} = {};
    // if (source) {
    //   location = this.#originalLocation(source, line, column);
    // }
    // this.#emit("output", {
    //   category: "debug console",
    //   group: consoleMessageGroup(type),
    //   output,
    //   variablesReference,
    //   source,
    //   ...location,
    // });
  }

  #addSource(source: Source): Source {
    let { sourceId, scriptId, path } = source;

    // Normalize the source path
    if (path) {
      path = source.path = normalizeSourcePath(path, this.#untitledDocPath, this.#bunEvalPath);
    }

    const oldSource = this.#getSourceIfPresent(sourceId);
    if (oldSource) {
      const { scriptId, path: oldPath } = oldSource;
      // For now, the script ID will always change.
      // Could that not be the case in the future?
      this.#sources.delete(scriptId);

      // If the path changed or the source has a source reference,
      // the old source should be marked as removed.
      if (path !== oldPath /*|| sourceReference*/) {
        this.emitAdapterEvent("loadedSource", {
          reason: "removed",
          source: oldSource,
        });
      }
    }

    this.#sources.set(sourceId, source);
    this.#sources.set(scriptId, source);

    this.emitAdapterEvent("loadedSource", {
      // If the reason is "changed", the source will be retrieved using
      // the `source` command, which is why it cannot be set when `path` is present.
      reason: oldSource && !path ? "changed" : "new",
      source,
    });

    if (!path) {
      return source;
    }

    // If there are any pending requests for this source by its path,
    // resolve them now that the source has been loaded.
    const resolves = this.#pendingSources.get(path);
    if (resolves) {
      this.#pendingSources.delete(path);
      for (const resolve of resolves) {
        resolve(source);
      }
    }

    return source;
  }

  loadedSources(): DAP.LoadedSourcesResponse {
    const sources = new Map();

    // Since there are duplicate keys for each source,
    // (e.g. scriptId, path, sourceReference, etc.) it needs to be deduped.
    for (const source of this.#sources.values()) {
      const { sourceId } = source;
      sources.set(sourceId, source);
    }

    return {
      sources: [...sources.values()],
    };
  }

  #getSourceIfPresent(sourceId: string | number): Source | undefined {
    return this.#sources.get(sourceId);
  }

  async #getSource(sourceId: string | number): Promise<Source> {
    const source = this.#getSourceIfPresent(sourceId);

    if (source) {
      return source;
    }

    // Normalize the source path before lookup
    if (typeof sourceId === "string") {
      sourceId = normalizeSourcePath(sourceId, this.#untitledDocPath, this.#bunEvalPath);
    }

    // If the source is not present, it may not have been loaded yet.
    let resolves = this.#pendingSources.get(sourceId.toString());
    if (!resolves) {
      this.#pendingSources.set(sourceId.toString(), (resolves = []));
    }

    return new Promise(resolve => {
      resolves!.push(resolve);
    });
  }

  async #getSourceById(scriptId: string, url?: string): Promise<Source | undefined> {
    const source = this.#getSourceIfPresent(scriptId);
    if (source) {
      return source;
    }

    let result;
    try {
      result = await this.send("Debugger.getScriptSource", { scriptId });
    } catch {
      return undefined;
    }

    const { scriptSource } = result;
    const sourceMap = SourceMap(scriptSource);
    const presentationHint = sourcePresentationHint(url);

    if (url) {
      return this.#addSource({
        scriptId,
        sourceId: url,
        name: sourceName(url),
        path: url,
        sourceMap,
        presentationHint,
      });
    }

    const sourceReference = this.#sourceId++;
    return this.#addSource({
      scriptId,
      sourceId: sourceReference,
      sourceReference,
      sourceMap,
      presentationHint,
    });
  }

  async stackTrace(request: DAP.StackTraceRequest): Promise<DAP.StackTraceResponse> {
    const { length } = this.#stackFrames;
    const { startFrame = 0, levels } = request;
    const endFrame = levels ? startFrame + levels : length;

    return {
      totalFrames: length,
      stackFrames: this.#stackFrames.slice(startFrame, endFrame),
    };
  }

  async scopes(request: DAP.ScopesRequest): Promise<DAP.ScopesResponse> {
    const { frameId } = request;

    for (const stackFrame of this.#stackFrames) {
      const { id, scopes } = stackFrame;
      if (id !== frameId || !scopes) {
        continue;
      }
      return {
        scopes,
      };
    }

    return {
      scopes: [],
    };
  }

  #getCallFrameId(frameId?: number): string | undefined {
    for (const { id, callFrameId } of this.#stackFrames) {
      if (id === frameId) {
        return callFrameId;
      }
    }
    return undefined;
  }

  #addStackFrame(callFrame: JSC.Debugger.CallFrame): StackFrame {
    const { callFrameId, functionName, location, scopeChain, this: thisObject } = callFrame;
    const { scriptId } = location;
    const source = this.#getSourceIfPresent(scriptId);

    let originalLocation: Location;
    if (source) {
      originalLocation = this.#originalLocation(source, location);
    } else {
      const { lineNumber, columnNumber } = location;
      originalLocation = {
        line: this.#lineFrom0BasedLine(lineNumber),
        column: this.#columnFrom0BasedColumn(columnNumber),
      };
    }

    const { line, column } = originalLocation;
    const scopes: Scope[] = [];
    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line,
      column,
      presentationHint: stackFramePresentationHint(source?.path),
      source,
      scopes,
    };
    this.#stackFrames.push(stackFrame);

    for (const scope of scopeChain) {
      const { name, type, location, object, empty } = scope;
      if (empty) {
        continue;
      }

      const { variablesReference } = this.#addObject(object, { objectGroup: "debugger" });
      const presentationHint = scopePresentationHint(type);
      const title = presentationHint ? titleize(presentationHint) : "Unknown";
      const displayName = name ? `${title}: ${name}` : title;

      let originalLocation: Location | undefined;
      if (location) {
        const { scriptId } = location;
        const source = this.#getSourceIfPresent(scriptId);

        if (source) {
          originalLocation = this.#originalLocation(source, location);
        } else {
          const { lineNumber, columnNumber } = location;
          originalLocation = {
            line: this.#lineFrom0BasedLine(lineNumber),
            column: this.#columnFrom0BasedColumn(columnNumber),
          };
        }
      }

      const { line, column } = originalLocation ?? {};
      scopes.push({
        name: displayName,
        presentationHint,
        expensive: presentationHint === "globals",
        variablesReference,
        line,
        column,
        source,
      });
    }

    return stackFrame;
  }

  #addAsyncStackTrace(stackTrace: JSC.Console.StackTrace): void {
    const { callFrames, parentStackTrace } = stackTrace;

    for (const callFrame of callFrames) {
      this.#addAsyncStackFrame(callFrame);
    }

    if (parentStackTrace) {
      this.#addAsyncStackTrace(parentStackTrace);
    }
  }

  #addAsyncStackFrame(callFrame: JSC.Console.CallFrame): StackFrame {
    const { scriptId, functionName } = callFrame;
    const callFrameId = callFrameToId(callFrame);
    const source = this.#getSourceIfPresent(scriptId);

    let originalLocation: Location;
    if (source) {
      originalLocation = this.#originalLocation(source, callFrame);
    } else {
      const { lineNumber, columnNumber } = callFrame;
      originalLocation = {
        line: this.#lineFrom0BasedLine(lineNumber),
        column: this.#columnFrom0BasedColumn(columnNumber),
      };
    }

    const { line, column } = originalLocation;
    const stackFrame: StackFrame = {
      callFrameId,
      scriptId,
      id: this.#stackFrames.length,
      name: functionName || "<anonymous>",
      line,
      column,
      source,
      presentationHint: stackFramePresentationHint(source?.path),
      canRestart: false,
    };
    this.#stackFrames.push(stackFrame);

    return stackFrame;
  }

  async variables(request: DAP.VariablesRequest): Promise<DAP.VariablesResponse> {
    const { variablesReference, start, count } = request;
    const variable = this.#getVariable(variablesReference);

    let variables: Variable[];
    if (!variable) {
      variables = [];
    } else if (Array.isArray(variable)) {
      variables = variable;
    } else {
      variables = await this.#getProperties(variable, start, count);
    }

    return {
      variables: variables.sort(variablesSortBy),
    };
  }

  async setVariable(request: DAP.SetVariableRequest): Promise<DAP.SetVariableResponse> {
    const { variablesReference, name, value } = request;

    const variable = this.#getVariable(variablesReference);
    if (!variable) {
      throw new Error("Variable not found.");
    }

    const { objectId, objectGroup } = variable;
    if (!objectId) {
      throw new Error("Variable cannot be modified.");
    }

    const { result, wasThrown } = await this.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (name) { this[name] = ${value}; return this[name]; }`,
      arguments: [{ value: name }],
      doNotPauseOnExceptionsAndMuteConsole: true,
    });

    if (wasThrown) {
      throw new Error(remoteObjectToString(result));
    }

    return this.#addObject(result, { name, objectGroup });
  }

  async setExpression(request: DAP.SetExpressionRequest): Promise<DAP.SetExpressionResponse> {
    const { expression, value, frameId } = request;
    const callFrameId = this.#getCallFrameId(frameId);
    const objectGroup = callFrameId ? "debugger" : "repl";

    const { result, wasThrown } = await this.evaluateInternal({
      expression: `${expression} = (${value});`,
      objectGroup: "repl",
      callFrameId,
    });

    if (wasThrown) {
      throw new Error(remoteObjectToString(result));
    }

    return this.#addObject(result, { objectGroup });
  }

  #getVariable(variablesReference?: number): Variable | undefined {
    if (!variablesReference) {
      return undefined;
    }
    return this.#variables.get(variablesReference);
  }

  #addObject(
    remoteObject: JSC.Runtime.RemoteObject,
    propertyDescriptor?: Partial<JSC.Runtime.PropertyDescriptor> & { objectGroup?: string; evaluateName?: string },
  ): Variable {
    const { objectId, type, subtype, size } = remoteObject;
    const { objectGroup, evaluateName } = propertyDescriptor ?? {};
    const variablesReference = objectId ? this.#variableId++ : 0;

    const variable: Variable = {
      objectId,
      objectGroup,
      variablesReference,
      type: subtype || type,
      value: remoteObjectToString(remoteObject),
      name: propertyDescriptorToName(propertyDescriptor),
      evaluateName: propertyDescriptorToEvaluateName(propertyDescriptor, evaluateName),
      indexedVariables: isArrayLike(subtype) ? size : undefined,
      namedVariables: isMap(subtype) ? size : undefined,
      presentationHint: remoteObjectToVariablePresentationHint(remoteObject, propertyDescriptor),
    };

    if (variablesReference) {
      this.#variables.set(variablesReference, variable);
    }

    return variable;
  }

  async #getProperties(variable: Variable, offset?: number, count?: number): Promise<Variable[]> {
    const { objectId, objectGroup, type, evaluateName, indexedVariables, namedVariables } = variable;
    const variables: Variable[] = [];

    if (!objectId || type === "symbol") {
      return variables;
    }

    const { properties, internalProperties } = await this.send("Runtime.getDisplayableProperties", {
      objectId,
      generatePreview: true,
    });

    for (const property of properties) {
      variables.push(...this.#addProperty(property, { objectGroup, evaluateName, parentType: type }));
    }

    if (internalProperties) {
      for (const property of internalProperties) {
        variables.push(
          ...this.#addProperty(property, { objectGroup, evaluateName, parentType: type, isSynthetic: true }),
        );
      }
    }

    const hasEntries = type !== "array" && (indexedVariables || namedVariables);
    if (hasEntries) {
      const { entries } = await this.send("Runtime.getCollectionEntries", {
        objectId,
        fetchStart: offset,
        fetchCount: count,
      });

      let i = 0;
      for (const { key, value } of entries) {
        let name = String(i++);
        if (key) {
          const { value, description } = key;
          name = String(value ?? description);
        }
        variables.push(
          ...this.#addProperty(
            { name, value },
            {
              objectGroup,
              evaluateName,
              parentType: type,
              isSynthetic: true,
            },
          ),
        );
      }
    }

    return variables;
  }

  #addProperty(
    propertyDescriptor: JSC.Runtime.PropertyDescriptor | JSC.Runtime.InternalPropertyDescriptor,
    options?: {
      objectGroup?: string;
      evaluateName?: string;
      isSynthetic?: boolean;
      parentType?: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"];
    },
  ): Variable[] {
    const { value, get, set, symbol } = propertyDescriptor as JSC.Runtime.PropertyDescriptor;
    const descriptor = { ...propertyDescriptor, ...options };
    const variables: Variable[] = [];

    if (value) {
      variables.push(this.#addObject(value, descriptor));
    }

    if (get) {
      const { type } = get;
      if (type !== "undefined") {
        variables.push(this.#addObject(get, descriptor));
      }
    }

    if (set) {
      const { type } = set;
      if (type !== "undefined") {
        variables.push(this.#addObject(set, descriptor));
      }
    }

    if (symbol) {
      variables.push(this.#addObject(symbol, descriptor));
    }

    return variables;
  }

  async exceptionInfo(): Promise<DAP.ExceptionInfoResponse> {
    const exception = this.#exception;
    if (!exception) {
      throw new Error("No exception found.");
    }

    const { code, ...details } = await this.#getExceptionDetails(exception);
    return {
      exceptionId: code || "",
      breakMode: "always",
      details,
    };
  }

  async #getExceptionDetails(variable: Variable): Promise<DAP.ExceptionDetails & { code?: string }> {
    const properties = await this.#getProperties(variable);

    let fullTypeName: string | undefined;
    let message: string | undefined;
    let code: string | undefined;
    let stackTrace: string | undefined;
    let innerException: DAP.ExceptionDetails[] | undefined;

    for (const property of properties) {
      const { name, value, type } = property;
      if (name === "name") {
        fullTypeName = value;
      } else if (name === "message") {
        message = type === "string" ? JSON.parse(value) : value;
      } else if (name === "stack") {
        stackTrace = type === "string" ? JSON.parse(value) : value;
      } else if (name === "code") {
        code = type === "string" ? JSON.parse(value) : value;
      } else if (name === "cause") {
        const cause = await this.#getExceptionDetails(property);
        innerException = [cause];
      } else if (name === "errors") {
        const errors = await this.#getProperties(property);
        innerException = await Promise.all(errors.map(error => this.#getExceptionDetails(error)));
      }
    }

    if (!stackTrace) {
      const { value } = variable;
      stackTrace ||= value;
    }

    return {
      fullTypeName,
      message,
      code,
      stackTrace: stripAnsi(stackTrace),
      innerException,
    };
  }

  close(): void {
    this.inspector.close();
    this.resetInternal();
  }

  protected resetInternal(): void {
    this.#pendingSources.clear();
    this.#sources.clear();
    this.#stackFrames.length = 0;
    this.#stopped = undefined;
    this.#exception = undefined;
    this.#breakpoints.clear();
    this.#futureBreakpoints.clear();
    this.#functionBreakpoints.clear();
    this.#targets.clear();
    this.#variables.clear();
    this.options = undefined;
  }
}

/**
 * Create a debug adapter that connects over a unix/tcp socket. Usually
 * in the case of a reverse connection. This is used by the vscode extension.
 *
 * @warning This will gracefully handle socket closure, you don't need to add extra handling.
 */
export class NodeSocketDebugAdapter extends BaseDebugAdapter<NodeSocketInspector> {
  public constructor(socket: Socket, untitledDocPath?: string, bunEvalPath?: string) {
    super(new NodeSocketInspector(socket), untitledDocPath, bunEvalPath);

    socket.once("close", () => {
      this.resetInternal();
    });
  }

  protected exitJSProcess(): void {
    this.evaluateInternal({
      expression: "process.exit(0)",
    });
  }

  public async start() {
    const ok = await this.inspector.start();
    return ok;
  }
}

/**
 * The default debug adapter. Connects via WebSocket
 */
export class WebSocketDebugAdapter extends BaseDebugAdapter<WebSocketInspector> {
  #process?: ChildProcess;
  // True when `#process` is `cmd.exe` wrapping a `.cmd`/`.bat` via
  // `buildShellCommand`. A plain `kill()` on Windows terminates `cmd.exe`
  // only — the child (`bun.exe` launched by the batch file) is reparented
  // and keeps running. We use `taskkill /T /F` to tear down the whole tree
  // instead; see `#killProcess`.
  #processUsesShell = false;

  public constructor(url?: string | URL, untitledDocPath?: string, bunEvalPath?: string) {
    super(new WebSocketInspector(url), untitledDocPath, bunEvalPath);
  }

  async ["Inspector.disconnected"](error?: Error): Promise<void> {
    await super["Inspector.disconnected"](error);

    if (this.#process?.exitCode !== null) {
      this.emitAdapterEvent("terminated");
    }
  }

  protected exitJSProcess() {
    if (!this.#killProcess()) {
      this.evaluateInternal({
        expression: "process.exit(0)",
      });
    }
  }

  /**
   * Terminate the debuggee process. Returns `true` if a termination signal
   * was delivered, `false` if there's no process to kill — matching the
   * return convention of `ChildProcess.kill()` so callers can fall back to
   * an in-process `process.exit()` RPC when this returns false.
   *
   * On Windows, when we spawned via `cmd.exe /d /s /c <bun.cmd>`, the
   * `#process` handle is `cmd.exe` and its child (`bun.exe`) is NOT killed
   * by `TerminateProcess`. Use `taskkill /T /F` to walk the process tree
   * instead. `taskkill` is in System32 which is always on the adapter
   * process's own PATH, so a bare invocation is safe here.
   */
  #killProcess(): boolean {
    const proc = this.#process;
    if (!proc || proc.exitCode !== null) return false;

    if (this.#processUsesShell && process.platform === "win32" && typeof proc.pid === "number") {
      // Fire-and-forget: the inherited pipe output is discarded. Attach an
      // 'error' listener because spawn() surfaces ENOENT asynchronously —
      // without a listener, a missing taskkill would become an uncaught
      // exception in the extension host. If taskkill fails for any reason
      // we still follow up with proc.kill() so at worst we revert to the
      // pre-fix behaviour of orphaning bun.exe rather than crashing.
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {
        proc.kill();
      });
      return true;
    }

    return proc.kill();
  }

  /**
   * Starts the inspector.
   * @param url the inspector url, will default to the one provided in the constructor (if any). If none
   * @returns if the inspector was able to connect
   */
  start(url?: string): Promise<boolean> {
    return this.#attach({ url });
  }

  close() {
    this.#killProcess();
    super.close();
  }

  async launch(request: DAP.LaunchRequest): Promise<void> {
    this.options = { ...request, type: "launch" };

    try {
      await this.#launch(request);
    } catch (error) {
      // Some clients, like VSCode, will show a system-level popup when a `launch` request fails.
      // Instead, we want to show the error as a sidebar notification.
      const { message } = unknownToError(error);

      this.emitAdapterEvent("output", {
        category: "stderr",
        output: `Failed to start debugger.\n${message}`,
      });

      this.terminate();
    }
  }

  async #launch(request: LaunchRequest): Promise<void> {
    const {
      runtime = "bun",
      runtimeArgs = [],
      program,
      args = [],
      cwd,
      env = {},
      strictEnv = false,
      watchMode = false,
      stopOnEntry = false,
      __skipValidation = false,
      stdin,
    } = request;

    if (!__skipValidation && !program) {
      throw new Error("No program specified");
    }

    const processArgs = [...runtimeArgs];

    if (program === "-" && stdin) {
      processArgs.push("--eval", stdin);
    } else if (program) {
      processArgs.push(program);
    }

    processArgs.push(...args);

    if (program && isTestJavaScript(program) && !runtimeArgs.includes("test")) {
      processArgs.unshift("test");
    }

    if (watchMode && !runtimeArgs.includes("--watch") && !runtimeArgs.includes("--hot")) {
      processArgs.unshift(watchMode === "hot" ? "--hot" : "--watch");
    }

    const processEnv = strictEnv
      ? {
          ...env,
        }
      : {
          ...process.env,
          ...env,
        };

    if (process.platform !== "win32") {
      // we're on unix
      const url = `ws+unix://${randomUnixPath()}`;
      const signal = new UnixSignal();

      signal.on("Signal.received", () => {
        this.#attach({ url });
      });

      this.once("Adapter.terminated", () => {
        signal.close();
      });

      const query = stopOnEntry ? "break=1" : "wait=1";
      processEnv["BUN_INSPECT"] = `${url}?${query}`;
      processEnv["BUN_INSPECT_NOTIFY"] = signal.url;

      // This is probably not correct, but it's the best we can do for now.
      processEnv["FORCE_COLOR"] = "1";
      processEnv["BUN_QUIET_DEBUG_LOGS"] = "1";
      processEnv["BUN_DEBUG_QUIET_LOGS"] = "1";

      const started = await this.#spawn({
        command: runtime,
        args: processArgs,
        env: processEnv,
        cwd,
        isDebugee: true,
      });

      if (!started) {
        throw new Error("Program could not be started.");
      }
    } else {
      // we're on windows
      // Create TCPSocketSignal
      const url = `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`; // 127.0.0.1 so it resolves correctly on windows
      const signal = new TCPSocketSignal(await getAvailablePort());

      signal.on("Signal.received", async () => {
        this.#attach({ url });
      });

      this.once("Adapter.terminated", () => {
        signal.close();
      });

      const query = stopOnEntry ? "break=1" : "wait=1";
      processEnv["BUN_INSPECT"] = `${url}?${query}`;
      processEnv["BUN_INSPECT_NOTIFY"] = signal.url; // 127.0.0.1 so it resolves correctly on windows

      // This is probably not correct, but it's the best we can do for now.
      processEnv["FORCE_COLOR"] = "1";
      processEnv["BUN_QUIET_DEBUG_LOGS"] = "1";
      processEnv["BUN_DEBUG_QUIET_LOGS"] = "1";

      const started = await this.#spawn({
        command: runtime,
        args: processArgs,
        env: processEnv,
        cwd,
        isDebugee: true,
      });

      if (!started) {
        throw new Error("Program could not be started.");
      }
    }
  }

  async #spawn(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    isDebugee?: boolean;
  }): Promise<boolean> {
    const { command, args = [], cwd, env, isDebugee } = options;
    const request = { command, args, cwd, env };
    this.emit("Process.requested", request);

    // On Windows, resolve a bare command name via PATH/PATHEXT. If the result
    // is a `.cmd`/`.bat` file, route through `cmd.exe /d /s /c` ourselves
    // (with `windowsVerbatimArguments`) rather than using Node's `shell: true`
    // — see `resolveCommand` and `buildShellCommand` for the reasoning.
    const { command: resolvedCommand, useShell } = resolveCommand(command, env);

    // When routing through cmd.exe, multi-line argv content would silently
    // truncate the script at the first newline. Spill the source to a temp
    // file in that case and remember cleanup for process exit. Pass `cwd`
    // so the temp file lands at `<cwd>/[eval]` — the exact path the VS Code
    // extension's source-mapping layer expects for `--eval` scripts.
    //
    // This runs BEFORE the `try` that wraps `spawn()` so that when the
    // helper throws its actionable "install Bun via the official
    // installer…" guidance, the thrown Error propagates out of `#spawn`
    // → `#launch` → `launch()`'s catch, which surfaces `cause.message`
    // verbatim via the stderr output event. Catching here would either
    // drop the message (emit `Process.exited` with no listener) or wrap
    // it ("Failed to spawn process") and bury it in the cause chain.
    let spawnArgs = args;
    let cleanupTempFiles = () => {};
    if (useShell) {
      const prepared = escapeMultilineArgsForCmd(args, cwd);
      spawnArgs = prepared.args;
      cleanupTempFiles = prepared.cleanup;
    }

    let subprocess: ChildProcess;
    try {
      if (useShell) {
        // Resolve the shell via %ComSpec% first. libuv's search_path uses the
        // child's env PATH, not the extension host's, so in `strictEnv: true`
        // launch configs a bare `"cmd.exe"` could miss System32. Matches
        // Node's own shell:true resolution (lib/child_process.js).
        const comSpec = lookupEnvCaseInsensitive(env ?? {}, "ComSpec") ?? process.env.ComSpec ?? "cmd.exe";
        subprocess = spawn(comSpec, ["/d", "/s", "/c", buildShellCommand(resolvedCommand, spawnArgs)], {
          ...request,
          stdio: ["ignore", "pipe", "pipe"],
          windowsVerbatimArguments: true,
        });
      } else {
        subprocess = spawn(resolvedCommand, spawnArgs, {
          ...request,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (cause) {
      cleanupTempFiles();
      this.emit("Process.exited", new Error("Failed to spawn process", { cause }), null);
      return false;
    }

    subprocess.on("spawn", () => {
      this.emit("Process.spawned", subprocess);

      if (isDebugee) {
        this.#process = subprocess;
        // Remember whether this process is the cmd.exe wrapper so
        // `#killProcess` knows to tear down the whole tree on Windows.
        this.#processUsesShell = useShell;
        this.emitAdapterEvent("process", {
          name: `${command} ${spawnArgs.join(" ")}`,
          systemProcessId: subprocess.pid,
          isLocalProcess: true,
          startMethod: "launch",
        });
      }
    });

    subprocess.on("exit", (code, signal) => {
      cleanupTempFiles();
      this.emit("Process.exited", code, signal);

      if (isDebugee) {
        this.#process = undefined;
        this.#processUsesShell = false;
        this.emitAdapterEvent("exited", {
          exitCode: code ?? -1,
        });
        this.emitAdapterEvent("terminated");
      }
    });

    // Async spawn failures (ENOENT/EACCES on `cmd.exe`, etc.) surface via
    // `error` and never emit `exit`, so the `exit` cleanup above would
    // leak the temp file. `rmSync(..., {force: true})` inside `cleanup`
    // is idempotent so double-firing across `error` and `exit` is safe.
    subprocess.on("error", cleanupTempFiles);

    subprocess.stdout?.on("data", data => {
      this.emit("Process.stdout", data.toString());
    });

    subprocess.stderr?.on("data", data => {
      this.emit("Process.stderr", data.toString());
    });

    return new Promise(resolve => {
      subprocess.on("spawn", () => resolve(true));
      subprocess.on("exit", () => resolve(false));
      subprocess.on("error", () => resolve(false));
    });
  }

  async attach(request: AttachRequest): Promise<void> {
    this.options = { ...request, type: "attach" };

    try {
      await this.#attach(request);
    } catch (error) {
      // Some clients, like VSCode, will show a system-level popup when a `launch` request fails.
      // Instead, we want to show the error as a sidebar notification.
      const { message } = unknownToError(error);
      this.emitAdapterEvent("output", {
        category: "stderr",
        output: `Failed to start debugger.\n${message}`,
      });
      this.terminate();
    }
  }

  async #attach(request: AttachRequest): Promise<boolean> {
    const { url } = request;

    for (let i = 0; i < 3; i++) {
      const ok = await this.inspector.start(url);
      if (ok) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100 * i));
    }

    return false;
  }
}

export const DebugAdapter = WebSocketDebugAdapter;

function stoppedReason(reason: JSC.Debugger.PausedEvent["reason"]): DAP.StoppedEvent["reason"] {
  switch (reason) {
    case "Breakpoint":
      return "breakpoint";
    case "FunctionCall":
      return "function breakpoint";
    case "PauseOnNextStatement":
    case "DebuggerStatement":
      return "pause";
    case "exception":
    case "assert":
      return "exception";
    default:
      return "breakpoint";
  }
}

function titleize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function sourcePresentationHint(url?: string): DAP.Source["presentationHint"] {
  if (!url || !path.isAbsolute(url)) {
    return "deemphasize";
  }
  if (url.includes("/node_modules/") || url.includes("\\node_modules\\")) {
    return "normal";
  }
  return "emphasize";
}

function sourceName(url?: string): string {
  if (!url) {
    return "unknown.js";
  }
  if (isJavaScript(url)) {
    if (process.platform === "win32") {
      url = url.replaceAll("\\", "/");
    }
    return url.split("/").pop() || url;
  }
  return `${url}.js`;
}

function stackFramePresentationHint(path?: string): DAP.StackFrame["presentationHint"] {
  if (!path || path.includes("/node_modules/")) {
    return "subtle";
  }
  return "normal";
}

function scopePresentationHint(type: JSC.Debugger.Scope["type"]): DAP.Scope["presentationHint"] {
  switch (type) {
    case "closure":
    case "functionName":
    case "with":
    case "catch":
    case "nestedLexical":
      return "locals";
    case "global":
    case "globalLexicalEnvironment":
      return "globals";
    default:
      return undefined;
  }
}

function isSet(subtype: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"]): boolean {
  return subtype === "set" || subtype === "weakset";
}

function isArrayLike(subtype: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"]): boolean {
  return subtype === "array" || isSet(subtype);
}

function isMap(subtype: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"]): boolean {
  return subtype === "map" || subtype === "weakmap";
}

function breakpointOptions(breakpoint: Partial<DAP.SourceBreakpoint>): JSC.Debugger.BreakpointOptions {
  const { condition, hitCondition, logMessage } = breakpoint;
  return {
    condition,
    ignoreCount: hitConditionToIgnoreCount(hitCondition),
    autoContinue: !!logMessage,
    actions: [
      {
        type: "evaluate",
        data: logMessageToExpression(logMessage),
        emulateUserGesture: true,
      },
    ],
  };
}

function hitConditionToIgnoreCount(hitCondition?: string): number | undefined {
  if (!hitCondition) {
    return undefined;
  }

  if (hitCondition.includes("<")) {
    throw new Error("Hit condition with '<' is not supported, use '>' or '>=' instead.");
  }

  const count = parseInt(hitCondition.replace(/[^\d+]/g, ""));
  if (isNaN(count)) {
    throw new Error("Hit condition is not a number.");
  }

  if (hitCondition.includes(">") && !hitCondition.includes("=")) {
    return Math.max(0, count);
  }
  return Math.max(0, count - 1);
}

function logMessageToExpression(logMessage?: string): string | undefined {
  if (!logMessage) {
    return undefined;
  }
  // Convert expressions from "hello {name}!" to "`hello ${name}!`"
  return `console.log(\`${logMessage.replace(/\$?{/g, "${")}\`);`;
}

function completionToExpression(completion: string): { expression: string; hint?: string } {
  const lastDot = completion.lastIndexOf(".");
  const last = (s0: string, s1: string) => {
    const i0 = completion.lastIndexOf(s0);
    const i1 = completion.lastIndexOf(s1);
    return i1 > i0 ? i1 + 1 : i0;
  };

  const lastIdentifier = Math.max(lastDot, last("[", "]"), last("(", ")"), last("{", "}"));

  let expression: string;
  let remainder: string;
  if (lastIdentifier > 0) {
    expression = completion.slice(0, lastIdentifier);
    remainder = completion.slice(lastIdentifier);
  } else {
    expression = "";
    remainder = completion;
  }

  const [hint] = completion.slice(lastIdentifier).match(/[#$a-z_][0-9a-z_$]*/gi) ?? [];
  return {
    expression,
    hint,
  };
}

function consoleMessageGroup(type: JSC.Console.ConsoleMessage["type"]): DAP.OutputEvent["group"] {
  switch (type) {
    case "startGroup":
      return "start";
    case "startGroupCollapsed":
      return "startCollapsed";
    case "endGroup":
      return "end";
  }
  return undefined;
}

function sourceToId(source?: DAP.Source): string | number {
  const { path, sourceReference } = source ?? {};
  if (path) {
    return path;
  }
  if (sourceReference) {
    return sourceReference;
  }
  throw new Error("No source found.");
}

function sourceToPath(source?: DAP.Source | string): string {
  if (typeof source === "string") {
    return source;
  }
  if (source) {
    const { path } = source;
    if (path) {
      return path;
    }
  }
  throw new Error("No source found.");
}

function callFrameToId(callFrame: JSC.Console.CallFrame): string {
  const { url, lineNumber, columnNumber } = callFrame;
  return `${url}:${lineNumber}:${columnNumber}`;
}

function sanitizeExpression(expression: string): string {
  expression = expression.trim();
  if (expression.startsWith("{")) {
    expression = `(${expression})`;
  }
  if (expression.startsWith("return ")) {
    expression = expression.slice(7);
  }
  if (expression.startsWith("await ")) {
    expression = expression.slice(6);
  }
  return expression;
}

function remoteObjectToVariablePresentationHint(
  remoteObject: JSC.Runtime.RemoteObject,
  propertyDescriptor?: Partial<JSC.Runtime.PropertyDescriptor> & {
    isSynthetic?: boolean;
    parentType?: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"];
  },
): DAP.VariablePresentationHint {
  const { type, subtype } = remoteObject;
  const { name, enumerable, writable, isPrivate, isSynthetic, symbol, get, set, wasThrown } = propertyDescriptor ?? {};
  const hasGetter = get?.type === "function";
  const hasSetter = set?.type === "function";
  const hasSymbol = symbol?.type === "symbol";

  let kind: string | undefined;
  let visibility: string | undefined;
  let lazy: boolean | undefined;
  let attributes: string[] = [];

  if (type === "function") {
    kind = "method";
  }
  if (subtype === "class") {
    kind = "class";
  }
  if (isSynthetic || isPrivate || hasSymbol) {
    visibility = "protected";
  }
  if (enumerable === false || name === "__proto__") {
    visibility = "internal";
  }
  if (type === "string") {
    attributes.push("rawString");
  }
  if (isSynthetic || writable === false || (hasGetter && !hasSetter)) {
    attributes.push("readOnly");
  }
  if (wasThrown || hasGetter) {
    lazy = true;
    attributes.push("hasSideEffects");
  }

  return {
    kind,
    visibility,
    lazy,
    attributes,
  };
}

function propertyDescriptorToName(propertyDescriptor?: Partial<JSC.Runtime.PropertyDescriptor>): string {
  if (!propertyDescriptor) {
    return "";
  }
  const { name } = propertyDescriptor;
  if (name === "__proto__") {
    return "[[Prototype]]";
  }
  return name ?? "";
}

function propertyDescriptorToEvaluateName(
  propertyDescriptor?: Partial<JSC.Runtime.PropertyDescriptor> & {
    isSynthetic?: boolean;
    parentType?: JSC.Runtime.RemoteObject["type"] | JSC.Runtime.RemoteObject["subtype"];
  },
  evaluateName?: string,
): string | undefined {
  if (!propertyDescriptor) {
    return evaluateName;
  }
  const { name: property, isSynthetic, parentType: type } = propertyDescriptor;
  if (!property) {
    return evaluateName;
  }
  if (!evaluateName) {
    return property;
  }
  if (isSynthetic) {
    if (isMap(type)) {
      if (isNumeric(property)) {
        return `${evaluateName}.get(${property})`;
      }
      return `${evaluateName}.get(${JSON.stringify(property)})`;
    }
    if (isSet(type)) {
      return `[...${evaluateName}.values()][${property}]`;
    }
  }
  if (isNumeric(property)) {
    return `${evaluateName}[${property}]`;
  }
  if (isIdentifier(property)) {
    return `${evaluateName}.${property}`;
  }
  return `${evaluateName}[${JSON.stringify(property)}]`;
}

function isNumeric(string: string): boolean {
  return /^\d+$/.test(string);
}

function isIdentifier(string: string): boolean {
  return /^[#$a-z_][0-9a-z_$]*$/i.test(string);
}

function unknownToError(input: unknown): Error {
  if (input instanceof Error) {
    return input;
  }
  return new Error(String(input));
}

function isJavaScript(path: string): boolean {
  return /\.(c|m)?(j|t)sx?$/.test(path);
}

function isTestJavaScript(path: string): boolean {
  return /\.(test|spec)\.(c|m)?(j|t)sx?$/.test(path);
}

function isSyntaxError(remoteObject: JSC.Runtime.RemoteObject): boolean {
  const { className } = remoteObject;

  switch (className) {
    case "SyntaxError":
    case "ReferenceError":
      return true;
  }

  return false;
}

function variableToCompletionItem(variable: Variable): DAP.CompletionItem {
  const { name, type } = variable;
  return {
    label: name,
    type: variableTypeToCompletionItemType(type),
  };
}

function variableTypeToCompletionItemType(type: Variable["type"]): DAP.CompletionItem["type"] {
  switch (type) {
    case "class":
      return "class";
    case "function":
      return "function";
  }
  return "property";
}

function variablesSortBy(a: DAP.Variable, b: DAP.Variable): number {
  const visibility = (variable: DAP.Variable): number => {
    const { presentationHint } = variable;
    switch (presentationHint?.visibility) {
      case "protected":
        return 1;
      case "private":
        return 2;
      case "internal":
        return 3;
    }
    return 0;
  };
  const index = (variable: DAP.Variable): number => {
    const { name } = variable;
    switch (name) {
      case "[[Prototype]]":
      case "prototype":
      case "__proto__":
        return Number.MAX_VALUE;
    }
    const index = parseInt(name);
    if (isFinite(index)) {
      return index;
    }
    switch (name[0]) {
      case "_":
      case "$":
        return 1;
      case "#":
        return 2;
    }
    return 0;
  };
  const av = visibility(a);
  const bv = visibility(b);
  if (av > bv) return 1;
  if (av < bv) return -1;
  const ai = index(a);
  const bi = index(b);
  if (ai > bi) return 1;
  if (ai < bi) return -1;
  return 0;
}

function isSameLocation(a: { line?: number; column?: number }, b: { line?: number; column?: number }): boolean {
  return (a.line === b.line || (!a.line && !b.line)) && (a.column === b.column || (!a.column && !b.column));
}

function consoleLevelToAnsiColor(level: JSC.Console.ConsoleMessage["level"]): string | undefined {
  switch (level) {
    case "warning":
      return "\u001b[33m";
    case "error":
      return "\u001b[31m";
  }
  return undefined;
}

function numberIsValid(number?: number): number is number {
  return typeof number === "number" && isFinite(number) && number >= 0;
}

function locationIsSame(a?: JSC.Debugger.Location, b?: JSC.Debugger.Location): boolean {
  return a?.scriptId === b?.scriptId && a?.lineNumber === b?.lineNumber && a?.columnNumber === b?.columnNumber;
}

function stripAnsi(string: string): string {
  return string.replace(/\u001b\[\d+m/g, "");
}

function invalidBreakpoint(error?: unknown): Breakpoint {
  const { message } = error ? unknownToError(error) : { message: undefined };
  return {
    id: nextId(),
    breakpointId: "",
    verified: false,
    message,
  };
}

const Cancel = Symbol("Cancel");

let sequence = 1;

function nextId(): number {
  return sequence++;
}

export function getRandomId() {
  return Math.random().toString(36).slice(2);
}

export function normalizeWindowsPath(winPath: string): string {
  winPath = path.normalize(winPath);
  if (winPath[1] === ":" && (winPath[2] === "\\" || winPath[2] === "/")) {
    return (winPath.charAt(0).toUpperCase() + winPath.slice(1)).replaceAll("\\\\", "\\");
  }
  return winPath;
}
