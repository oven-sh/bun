// Hardcoded module "node:child_process"
const EventEmitter = require("node:events");
const OsModule = require("node:os");
const { kHandle } = require("internal/shared");
const {
  validateBoolean,
  validateFunction,
  validateString,
  validateAbortSignal,
  validateArray,
  validateObject,
  validateOneOf,
  validateInt32,
} = require("internal/validators");
const { isUint8Array, toPathIfFileURL, getValidatedPath } = require("internal/fs/utils");
const { Buffer } = require("node:buffer");
const events = require("node:events");
const { getSystemErrorName } = require("node:util");
const { default: AbortController } = require("internal/abort_controller");
import type { Readable, Writable, Stream, Pipe } from "node:stream";
import type { Socket } from "node:net";
import type {
  StdioOptions,
  IOType,
  ForkOptions,
  SpawnOptions,
  ExecFileOptions,
  ExecOptions,
  SpawnSyncOptions,
  ExecFileSyncOptions,
  ExecSyncOptions,
  ProcessEnvOptions,
  ChildProcess as NodeChildProcess,
  SpawnSyncReturns,
  ExecFileOptionsWithBufferEncoding,
  ExecFileOptionsWithOtherEncoding,
  ExecFileOptionsWithStringEncoding,
  ExecOptionsWithBufferEncoding,
  ExecOptionsWithStringEncoding,
  SpawnOptionsWithoutStdio,
  SpawnOptionsWithStdioTuple,
  SpawnSyncOptionsWithBufferEncoding,
  SpawnSyncOptionsWithStringEncoding,
  ExecFileSyncOptionsWithBufferEncoding,
  ExecFileSyncOptionsWithStringEncoding,
  ExecSyncOptionsWithBufferEncoding,
  ExecSyncOptionsWithStringEncoding,
  MessageOptions,
  SendHandle,
  Serializable,
  StdioPipeNamed,
} from "node:child_process";
const { ShimmedStdin, ShimmedStdioOutStream } = require("internal/streams/shim");
const { SystemError } = require("internal/errors") as any; // TS2352, TS2694: Assume SystemError exists at runtime

var NetModule;

var ObjectCreate = Object.create;
var ObjectAssign = Object.assign;
var BufferConcat = Buffer.concat;
var BufferIsEncoding = Buffer.isEncoding;

var kEmptyObject = ObjectCreate(null);
var signals = OsModule.constants.signals;

var ArrayPrototypeJoin = Array.prototype.join;
var ArrayPrototypeIncludes = Array.prototype.includes;
var ArrayPrototypeSlice = Array.prototype.slice;
var ArrayPrototypeUnshift = Array.prototype.unshift;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeSort = Array.prototype.sort;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypeLastIndexOf = Array.prototype.lastIndexOf;

var ArrayBufferIsView = ArrayBuffer.isView;

var NumberIsInteger = Number.isInteger;
var StringPrototypeIncludes = String.prototype.includes;
var Uint8ArrayPrototypeIncludes = Uint8Array.prototype.includes;

const MAX_BUFFER = 1024 * 1024;
const kFromNode = Symbol("kFromNode");

// Pass DEBUG_CHILD_PROCESS=1 to enable debug output
if ($debug) {
  $debug("child_process: debug mode on");
  globalThis.__lastId = null;
  globalThis.__getId = () => {
    return globalThis.__lastId !== null ? globalThis.__lastId++ : 0;
  };
}

// Sections:
// 1. Exported child_process functions
// 2. child_process helpers
// 3. ChildProcess "class"
// 4. ChildProcess helpers
// 5. Validators
// 6. Random utilities
// 7. Node errors / error polyfills

// TODO:
// Port rest of node tests
// Fix exit codes with Bun.spawn
// ------------------------------
// Fix errors
// Support file descriptors being passed in for stdio
// ------------------------------
// TODO: Look at Pipe to see if we can support passing Node Pipe objects to stdio param

// TODO: Add these params after support added in Bun.spawn
// uid <number> Sets the user identity of the process (see setuid(2)).
// gid <number> Sets the group identity of the process (see setgid(2)).

// stdio <Array> | <string> Child's stdio configuration (see options.stdio).
// Support wrapped ipc types (e.g. net.Socket, dgram.Socket, TTY, etc.)
// IPC FD passing support

// From node child_process docs(https://nodejs.org/api/child_process.html#optionsstdio):
// 'ipc': Create an IPC channel for passing messages/file descriptors between parent and child.
// A ChildProcess may have at most one IPC stdio file descriptor. Setting this option enables the subprocess.send() method.
// If the child is a Node.js process, the presence of an IPC channel will enable process.send() and process.disconnect() methods,
// as well as 'disconnect' and 'message' events within the child.

//------------------------------------------------------------------------------
// Section 1. Exported child_process functions
//------------------------------------------------------------------------------

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * Spawns a new process using the given `file`.
 * @param {string} file
 * @param {string[]} [args]
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {ChildProcess}
 */
function spawn(file: string, args?: string[] | SpawnOptions, options?: SpawnOptions): ChildProcess {
  const normalizedOptions = normalizeSpawnArguments(file, args, options);
  validateTimeout(normalizedOptions.timeout);
  validateAbortSignal(normalizedOptions.signal, "options.signal");
  const killSignal: number | undefined = sanitizeKillSignal(normalizedOptions.killSignal);
  const child = new ChildProcess();

  $debug("spawn", normalizedOptions);
  normalizedOptions[kFromNode] = true;
  child.spawn(normalizedOptions);

  const timeout = normalizedOptions.timeout;
  if (timeout && timeout > 0) {
    let timeoutId: Timer | null = setTimeout(() => {
      if (timeoutId) {
        timeoutId = null;

        try {
          child.kill(killSignal);
        } catch (err) {
          child.emit("error", err);
        }
      }
    }, timeout).unref();

    child.once("exit", () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    });
  }

  const signal = normalizedOptions.signal;
  if (signal) {
    if (signal.aborted) {
      process.nextTick(onAbortListener);
    } else {
      signal.addEventListener("abort", onAbortListener, { once: true });
      child.once("exit", () => signal.removeEventListener("abort", onAbortListener));
    }

    function onAbortListener() {
      abortChildProcess(child, killSignal, signal?.reason);
    }
  }
  return child;
}

/**
 * Spawns the specified file as a shell.
 * @param {string} file
 * @param {string[]} [args]
 * @param {import('node:child_process').ExecFileOptions} [options]
 * @param {(
 *   error?: Error,
 *   stdout?: string | Buffer,
 *   stderr?: string | Buffer
 *   ) => any} [callback]
 * @returns {ChildProcess}
 */
function execFile(
  file: string,
  args?: string[] | null | ExecFileOptions,
  options?: ExecFileOptions | null | ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any),
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any,
): ChildProcess {
  let normalized = normalizeExecFileArgs(file, args, options, callback);
  const _file = normalized.file;
  const _args = normalized.args;
  const _options = normalized.options;
  const _callback = normalized.callback;

  const finalOptions = {
    encoding: "utf8",
    timeout: 0,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGTERM",
    cwd: undefined, // Use undefined instead of null for consistency
    env: undefined, // Use undefined instead of null for consistency
    shell: false,
    ..._options,
  };

  const maxBuffer = finalOptions.maxBuffer;

  // Validate the timeout, if present.
  validateTimeout(finalOptions.timeout);

  // Validate maxBuffer, if present.
  validateMaxBuffer(maxBuffer);

  const killSignalNum = sanitizeKillSignal(finalOptions.killSignal);

  const child = spawn(_file, _args as string[], {
    cwd: finalOptions.cwd,
    env: finalOptions.env ?? undefined, // Ensure env is ProcessEnv or undefined
    gid: finalOptions.gid,
    uid: finalOptions.uid,
    shell: finalOptions.shell,
    signal: finalOptions.signal,
    timeout: finalOptions.timeout,
    killSignal: killSignalNum,
    windowsHide: !!finalOptions.windowsHide,
    windowsVerbatimArguments: !!finalOptions.windowsVerbatimArguments,
    argv0: (finalOptions as SpawnOptions).argv0, // Pass argv0 if present
  });

  let encoding: BufferEncoding | null;
  const _stdout: (string | Buffer)[] = [];
  const _stderr: (string | Buffer)[] = [];
  const optionsEncoding = finalOptions.encoding;
  if (optionsEncoding !== "buffer" && BufferIsEncoding(optionsEncoding)) {
    encoding = optionsEncoding as BufferEncoding;
  } else {
    encoding = null;
  }
  let killed = false;
  let exited = false;
  let timeoutId: Timer | null | undefined;

  let ex: (Error & { cmd?: string; code?: string | number; killed?: boolean; signal?: number | NodeJS.Signals | null }) | null =
    null;

  let cmd = _file;

  function exitHandler(code = 0, signal?: number | NodeJS.Signals | null) {
    if (exited) return;
    exited = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!_callback) return;

    // merge chunks
    let stdout;
    let stderr;
    if (encoding) {
      stdout = ArrayPrototypeJoin.$call(_stdout, "");
      stderr = ArrayPrototypeJoin.$call(_stderr, "");
    } else {
      stdout = BufferConcat(_stdout as Buffer[]);
      stderr = BufferConcat(_stderr as Buffer[]);
    }

    if (!ex && code === 0 && signal === null) {
      _callback(undefined, stdout, stderr); // Use undefined instead of null for error
      return;
    }

    if (_args?.length) cmd += ` ${ArrayPrototypeJoin.$call(_args, " ")}`;
    if (!ex) {
      let message = `Command failed: ${cmd}`;
      if (stderr) message += `\n${stderr}`;
      ex = genericNodeError(message, {
        code: typeof code === "number" && code < 0 ? getSystemErrorName(code) : code,
        killed: child.killed || killed,
        signal: signal,
      });
    }

    ex.cmd = cmd;
    _callback(ex, stdout, stderr);
  }

  function errorHandler(e) {
    ex = e instanceof Error ? e : new Error(String(e));

    const { stdout, stderr } = child;

    if (stdout) stdout.destroy();
    if (stderr) stderr.destroy();

    exitHandler();
  }

  function kill() {
    const { stdout, stderr } = child;

    if (stdout) stdout.destroy();
    if (stderr) stderr.destroy();

    killed = true;
    try {
      child.kill(killSignalNum);
    } catch (e) {
      ex = e instanceof Error ? e : new Error(String(e));
      exitHandler();
    }
  }

  if (finalOptions.timeout && finalOptions.timeout > 0) {
    timeoutId = setTimeout(function delayedKill() {
      timeoutId = null;
      kill();
    }, finalOptions.timeout).unref();
  }

  function addOnDataListener(child_buffer: Readable, _buffer: (string | Buffer)[], kind: string) {
    if (encoding) child_buffer.setEncoding(encoding);

    let totalLen = 0;
    if (maxBuffer === Infinity) {
      child_buffer.on("data", function onDataNoMaxBuf(chunk) {
        $arrayPush(_buffer, chunk);
      });
      return;
    }
    child_buffer.on("data", function onData(chunk) {
      const readableEncoding = child_buffer.readableEncoding;
      let length: number;
      if (readableEncoding) {
        length = Buffer.byteLength(chunk, readableEncoding);
      } else {
        length = (chunk as Buffer).length; // Assume Buffer if no encoding
      }
      totalLen += length;

      if (totalLen > maxBuffer!) {
        // maxBuffer is validated non-null
        const truncatedLen = maxBuffer! - (totalLen - length);
        if (readableEncoding) {
          $arrayPush(_buffer, String.prototype.slice.$call(chunk, 0, truncatedLen));
        } else {
          $arrayPush(_buffer, (chunk as Buffer).slice(0, truncatedLen));
        }

        ex = $ERR_CHILD_PROCESS_STDIO_MAXBUFFER(kind);
        kill();
      } else {
        $arrayPush(_buffer, chunk);
      }
    });
  }

  if (child.stdout) addOnDataListener(child.stdout as Readable, _stdout, "stdout");
  if (child.stderr) addOnDataListener(child.stderr as Readable, _stderr, "stderr");

  child.addListener("close", exitHandler);
  child.addListener("error", errorHandler);

  return child;
}

/**
 * Spawns a shell executing the given command.
 * @param {string} command
 * @param {import('node:child_process').ExecOptions} [options]
 * @param {(
 *   error?: Error,
 *   stdout?: string | Buffer,
 *   stderr?: string | Buffer
 *   ) => any} [callback]
 * @returns {ChildProcess}
 */
function exec(
  command: string,
  options?: ExecOptions | null | ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any),
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any,
): ChildProcess {
  const opts = normalizeExecArgs(command, options, callback);
  return execFile(opts.file, undefined, opts.options, opts.callback);
}

const kCustomPromisifySymbol = Symbol.for("nodejs.util.promisify.custom");

const customPromiseExecFunction = (orig: (...args: any[]) => ChildProcess) => {
  return (...args: any[]) => {
    const { resolve, reject, promise } = Promise.withResolvers<{ stdout: string | Buffer; stderr: string | Buffer }>();

    (promise as any).child = orig(...args, (err, stdout, stderr) => {
      if (err != null) {
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout: stdout!, stderr: stderr! }); // stdout/stderr guaranteed non-null on success
      }
    });

    return promise;
  };
};

Object.defineProperty(exec, kCustomPromisifySymbol, {
  __proto__: null,
  configurable: true,
  value: customPromiseExecFunction(exec),
});

(exec as any)[kCustomPromisifySymbol][kCustomPromisifySymbol] = (exec as any)[kCustomPromisifySymbol];

Object.defineProperty(execFile, kCustomPromisifySymbol, {
  __proto__: null,
  configurable: true,
  value: customPromiseExecFunction(execFile),
});

(execFile as any)[kCustomPromisifySymbol][kCustomPromisifySymbol] = (execFile as any)[kCustomPromisifySymbol];

// TS2430: Define SpawnSyncResult explicitly instead of extending
interface SpawnSyncResult {
  pid: number;
  output: (string | Buffer | null)[];
  stdout: string | Buffer | null;
  stderr: string | Buffer | null;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error & { spawnargs?: string[]; syscall?: string; path?: string; code?: string | number };
}

/**
 * Spawns a new process synchronously using the given `file`.
 * @param {string} file
 * @param {string[]} [args]
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 * @returns {SpawnSyncResult}
 */
function spawnSync(file: string, args?: string[] | SpawnSyncOptions, options?: SpawnSyncOptions): SpawnSyncResult {
  const normalizedOptions = {
    maxBuffer: MAX_BUFFER,
    ...normalizeSpawnArguments(file, args, options),
  };

  const maxBuffer = normalizedOptions.maxBuffer;
  const encoding = normalizedOptions.encoding;

  $debug("spawnSync", normalizedOptions);

  // Validate the timeout, if present.
  validateTimeout(normalizedOptions.timeout);

  // Validate maxBuffer, if present.
  validateMaxBuffer(maxBuffer);

  // Validate and translate the kill signal, if present.
  const killSignalNum = sanitizeKillSignal(normalizedOptions.killSignal);

  const stdio = normalizedOptions.stdio || "pipe";
  const bunStdio = getBunStdioFromOptions(stdio);

  var { input } = normalizedOptions;
  if (input) {
    if (ArrayBufferIsView(input)) {
      bunStdio[0] = input;
    } else if (typeof input === "string") {
      bunStdio[0] = Buffer.from(input, encoding === "buffer" ? "utf8" : encoding || "utf8");
    } else {
      throw $ERR_INVALID_ARG_TYPE(`options.stdio[0]`, ["string", "Buffer", "TypedArray", "DataView"], input);
    }
  }

  var error: Error | undefined;
  let stdout: Buffer | null = null;
  let stderr: Buffer | null = null;
  let exitCode: number | null = null;
  let signalCode: string | null = null;
  let exitedDueToTimeout = false;
  let exitedDueToMaxBuffer = false;
  let pid: number | undefined = undefined;

  try {
    // TS2769: Construct options object carefully for Bun.spawnSync
    var syncResult = Bun.spawnSync({
      cmd: [normalizedOptions.file, ...Array.prototype.slice.$call(normalizedOptions.args, 1)],
      env: normalizedOptions.env || undefined,
      cwd: normalizedOptions.cwd as string | undefined, // TS2769 fix: Cast cwd
      stdio: bunStdio as any, // Cast because the type is complex and dynamic
      windowsVerbatimArguments: !!normalizedOptions.windowsVerbatimArguments,
      windowsHide: !!normalizedOptions.windowsHide,
      argv0: normalizedOptions.argv0 ?? undefined, // Pass undefined if null
      timeout: normalizedOptions.timeout,
      killSignal: killSignalNum,
      maxBuffer: normalizedOptions.maxBuffer,
      input: normalizedOptions.input, // Pass input if present
    });
    stdout = syncResult.stdout;
    stderr = syncResult.stderr;
    exitCode = syncResult.exitCode;
    signalCode = syncResult.signalCode ?? null;
    exitedDueToTimeout = syncResult.exitedDueToTimeout ?? false;
    exitedDueToMaxBuffer = syncResult.exitedDueToMaxBuffer ?? false;
    pid = syncResult.pid;
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  const result: SpawnSyncResult = {
    signal: signalCode as NodeJS.Signals | null,
    status: exitCode,
    output: [null, stdout, stderr],
    pid: pid!, // pid should always be assigned if no error, or caught above
    stdout: null, // assigned below
    stderr: null, // assigned below
  };

  if (error) {
    result.error = error;
    // Ensure path and spawnargs are set on the error object
    if (result.error) {
      result.error.path = normalizedOptions.file;
      result.error.spawnargs = ArrayPrototypeSlice.$call(normalizedOptions.args, 1);
    }
  }

  if (stdout && encoding && encoding !== "buffer") {
    result.output[1] = stdout.toString(encoding);
  }

  if (stderr && encoding && encoding !== "buffer") {
    result.output[2] = stderr.toString(encoding);
  }

  result.stdout = result.output[1] ?? null;
  result.stderr = result.output[2] ?? null;

  if (exitedDueToTimeout && error == null) {
    result.error = new SystemError(
      "spawnSync " + normalizedOptions.file + " ETIMEDOUT",
      "ETIMEDOUT",
      etimedoutErrorCode(),
      "spawnSync " + normalizedOptions.file,
    );
  }
  if (exitedDueToMaxBuffer && error == null) {
    result.error = new SystemError(
      "spawnSync " + normalizedOptions.file + " ENOBUFS (stdout or stderr buffer reached maxBuffer size limit)",
      "ENOBUFS",
      enobufsErrorCode(),
      "spawnSync " + normalizedOptions.file,
    );
  }

  if (result.error) {
    result.error.syscall = "spawnSync " + normalizedOptions.file;
    if (!result.error.path) result.error.path = normalizedOptions.file;
    if (!result.error.spawnargs) result.error.spawnargs = ArrayPrototypeSlice.$call(normalizedOptions.args, 1);
  }

  return result;
}
const etimedoutErrorCode = $newZigFunction("node_util_binding.zig", "etimedoutErrorCode", 0);
const enobufsErrorCode = $newZigFunction("node_util_binding.zig", "enobufsErrorCode", 0);

/**
 * Spawns a file as a shell synchronously.
 * @param {string} file
 * @param {string[]} [args]
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 * @returns {Buffer | string}
 */
function execFileSync(
  file: string,
  args?: string[] | null | ExecFileSyncOptions,
  options?: ExecFileSyncOptions,
): Buffer | string {
  let normalized = normalizeExecFileArgs(file, args, options);
  const _file = normalized.file;
  const _args = normalized.args;
  const _options = normalized.options;

  const spawnOptions: SpawnSyncOptions = {
    ..._options,
    argv0: (_options as SpawnOptions).argv0, // Include argv0 if present
    stdio: (_options as ExecFileSyncOptions).stdio, // TS2339 fix: Cast to access stdio
  };

  const inheritStderr = !spawnOptions.stdio;
  const ret = spawnSync(_file, _args as string[], spawnOptions); // Cast args as string[]

  if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr);

  const errArgs = [(spawnOptions as SpawnOptions).argv0 || _file];
  if (_args) {
    errArgs.push(...(_args as string[])); // Cast args as string[]
  }
  const err = checkExecSyncError(ret, errArgs, undefined);

  if (err) throw err;

  return ret.stdout!; // stdout is guaranteed non-null if no error is thrown
}

/**
 * Spawns a shell executing the given `command` synchronously.
 * @param {string} command
 * @param {import('node:child_process').ExecSyncOptions} [options]
 * @returns {Buffer | string}
 */
function execSync(command: string, options?: ExecSyncOptions): Buffer | string {
  const opts = normalizeExecArgs(command, options, undefined); // Pass undefined for callback
  const spawnOptions: SpawnSyncOptions = {
    ...opts.options,
    stdio: (opts.options as ExecSyncOptions).stdio, // Include stdio if present
  };
  const inheritStderr = !spawnOptions.stdio;

  // Pass undefined for args, normalizeSpawnArguments will handle shell command parsing
  const ret = spawnSync(opts.file, undefined, spawnOptions);

  if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr);

  const err = checkExecSyncError(ret, undefined, command);

  if (err) throw err;

  return ret.stdout!; // stdout is guaranteed non-null if no error is thrown
}

function stdioStringToArray(
  stdio: StdioPipeNamed | "inherit" | "ignore",
  channel?: "ipc",
): (StdioPipeNamed | number | "ignore" | "ipc")[] {
  let options: (StdioPipeNamed | number | "ignore")[];

  switch (stdio) {
    case "ignore":
    case "overlapped":
    case "pipe":
      options = [stdio, stdio, stdio];
      break;
    case "inherit":
      options = [0, 1, 2];
      break;
    default:
      throw $ERR_INVALID_ARG_VALUE("stdio", stdio);
  }

  if (channel) $arrayPush(options, channel);

  return options as (StdioPipeNamed | number | "ignore" | "ipc")[];
}

/**
 * Spawns a new Node.js process + fork.
 * @param {string|URL} modulePath
 * @param {string[]} [args]
 * @param {import('node:child_process').ForkOptions} [options]
 * @returns {ChildProcess}
 */
function fork(modulePath: string | URL, args: string[] | ForkOptions = [], options?: ForkOptions): ChildProcess {
  modulePath = getValidatedPath(modulePath, "modulePath");

  // Get options and args arguments.
  let processedArgs: string[];
  if (args == null) {
    processedArgs = [];
  } else if (typeof args === "object" && !$isJSArray(args)) {
    options = args;
    processedArgs = [];
  } else {
    validateArray(args, "args");
    processedArgs = args;
  }

  if (options != null) {
    validateObject(options, "options");
  }
  const opts: ForkOptions = Object.assign(Object.create(null), options);
  opts.execPath = opts.execPath || process.execPath;
  validateArgumentNullCheck(opts.execPath, "options.execPath");

  // Prepare arguments for fork:
  // execArgv = options.execArgv || process.execArgv;
  // validateArgumentsNullCheck(execArgv, "options.execArgv");

  // if (execArgv === process.execArgv && process._eval != null) {
  //   const index = ArrayPrototypeLastIndexOf.$call(execArgv, process._eval);
  //   if (index > 0) {
  //     // Remove the -e switch to avoid fork bombing ourselves.
  //     execArgv = ArrayPrototypeSlice.$call(execArgv);
  //     ArrayPrototypeSplice.$call(execArgv, index - 1, 2);
  //   }
  // }

  processedArgs = [/*...execArgv,*/ modulePath as string, ...processedArgs]; // Cast modulePath

  if (typeof opts.stdio === "string") {
    opts.stdio = stdioStringToArray(opts.stdio as StdioPipeNamed | "inherit" | "ignore", "ipc") as StdioOptions;
  } else if (!$isJSArray(opts.stdio)) {
    // Use a separate fd=3 for the IPC channel. Inherit stdin, stdout,
    // and stderr from the parent if silent isn't set.
    opts.stdio = stdioStringToArray(opts.silent ? "pipe" : "inherit", "ipc") as StdioOptions;
  } else if (!ArrayPrototypeIncludes.$call(opts.stdio, "ipc")) {
    throw $ERR_CHILD_PROCESS_IPC_REQUIRED("options.stdio");
  }

  // ForkOptions extends SpawnOptions, so this cast is safe.
  // We explicitly set shell: false as per Node.js fork behavior.
  const spawnOpts: SpawnOptions = { ...opts, shell: false };

  return spawn(opts.execPath!, processedArgs, spawnOpts); // Assert execPath is non-null
}

//------------------------------------------------------------------------------
// Section 2. child_process helpers
//------------------------------------------------------------------------------
function convertToValidSignal(signal: string | number): number {
  if (typeof signal === "number" && getSignalsToNamesMapping()[signal]) return signal;

  if (typeof signal === "string") {
    const signalName = signals[StringPrototypeToUpperCase.$call(signal)];
    if (signalName) return signalName;
  }

  throw ERR_UNKNOWN_SIGNAL(signal);
}

function sanitizeKillSignal(killSignal: string | number | NodeJS.Signals | undefined | null): number | undefined {
  if (typeof killSignal === "string" || typeof killSignal === "number") {
    return convertToValidSignal(killSignal);
  } else if (killSignal != null) {
    throw $ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal);
  }
  return undefined; // Return undefined if killSignal is null or undefined
}

let signalsToNamesMapping: Record<number, string> = {}; // Initialize directly
function getSignalsToNamesMapping(): Record<number, string> {
  if (Object.keys(signalsToNamesMapping).length === 0) {
    for (const key in signals) {
      signalsToNamesMapping[signals[key]] = key;
    }
  }
  return signalsToNamesMapping;
}

interface NormalizedExecFileArgs {
  file: string;
  args: string[] | null;
  options: ExecFileOptions;
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any;
}

function normalizeExecFileArgs(
  file: string,
  args?: string[] | null | ExecFileOptions,
  options?: ExecFileOptions | null | ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any),
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any,
): NormalizedExecFileArgs {
  let processedArgs: string[] | null = null;
  let processedOptions: ExecFileOptions | null = null;
  let processedCallback: ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any) | undefined =
    undefined;

  if ($isJSArray(args)) {
    processedArgs = ArrayPrototypeSlice.$call(args);
    processedOptions = options as ExecFileOptions | null;
    processedCallback = callback;
  } else if (args != null && typeof args === "object") {
    processedArgs = null;
    processedOptions = args;
    processedCallback = options as (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any;
  } else if (typeof args === "function") {
    processedArgs = null;
    processedOptions = null;
    processedCallback = args;
  } else { // args is null or undefined
    processedArgs = null;
    processedOptions = options as ExecFileOptions | null;
    processedCallback = callback;
  }

  if (processedArgs == null) {
    processedArgs = [];
  }

  if (typeof processedOptions === "function") {
    processedCallback = processedOptions;
    processedOptions = null;
  } else if (processedOptions != null) {
    validateObject(processedOptions, "options");
  }

  if (processedOptions == null) {
    processedOptions = kEmptyObject as ExecFileOptions;
  }

  if (processedCallback != null) {
    validateFunction(processedCallback, "callback");
  }

  // Validate argv0, if present.
  const argv0 = (processedOptions as any).argv0;
  if (argv0 != null) {
    validateString(argv0, "options.argv0");
    validateArgumentNullCheck(argv0, "options.argv0");
  }

  return { file, args: processedArgs, options: processedOptions, callback: processedCallback };
}

interface NormalizedExecArgs {
  file: string;
  options: ExecOptions;
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any;
}

function normalizeExecArgs(
  command: string,
  options?: ExecOptions | null | ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any),
  callback?: (error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any,
): NormalizedExecArgs {
  validateString(command, "command");
  validateArgumentNullCheck(command, "command");

  let processedOptions: ExecOptions | undefined;
  let processedCallback: ((error?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => any) | undefined;

  if (typeof options === "function") {
    processedCallback = options;
    processedOptions = undefined;
  } else {
    processedOptions = options ?? undefined; // Handle null case
    processedCallback = callback;
  }

  // Make a shallow copy so we don't clobber the user's options object.
  processedOptions = { ...processedOptions };
  processedOptions.shell = typeof processedOptions.shell === "string" ? processedOptions.shell : (processedOptions.shell ?? undefined);

  return {
    file: command,
    options: processedOptions,
    callback: processedCallback,
  };
}

const kBunEnv = Symbol("bunEnv");

type NormalizedSpawnOptions = SpawnOptions & {
  args: string[];
  file: string;
  [kBunEnv]: Record<string, string>;
  detached: boolean;
  windowsHide: boolean;
  windowsVerbatimArguments: boolean;
  argv0: string | undefined; // Changed from string | null
  maxBuffer?: number;
  encoding?: BufferEncoding | "buffer" | null;
  [kFromNode]?: boolean;
  envPairs?: string[]; // Added missing property
  input?: string | NodeJS.ArrayBufferView | undefined; // Added missing property
  serialization?: "json" | "advanced"; // Added missing property
};

function normalizeSpawnArguments(file: string, args?: string[] | SpawnOptions, options?: SpawnOptions): NormalizedSpawnOptions {
  validateString(file, "file");
  validateArgumentNullCheck(file, "file");

  if (file.length === 0) throw $ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");

  let processedArgs: string[];
  let processedOptions: SpawnOptions;

  if ($isJSArray(args)) {
    processedArgs = ArrayPrototypeSlice.$call(args);
    processedOptions = options === undefined ? {} : options;
  } else if (args == null) {
    processedArgs = [];
    processedOptions = options === undefined ? {} : options;
  } else if (typeof args !== "object") {
    throw $ERR_INVALID_ARG_TYPE("args", "object", args);
  } else {
    processedOptions = args;
    processedArgs = [];
  }

  validateArgumentsNullCheck(processedArgs, "args");
  validateObject(processedOptions, "options");

  let cwd = processedOptions.cwd;

  // Validate the cwd, if present.
  if (cwd != null) {
    cwd = getValidatedPath(cwd, "options.cwd");
  }

  // Validate detached, if present.
  if (processedOptions.detached != null) {
    validateBoolean(processedOptions.detached, "options.detached");
  }

  // Validate the uid, if present.
  if (processedOptions.uid != null) {
    validateInt32(processedOptions.uid, "options.uid");
  }

  // Validate the gid, if present.
  if (processedOptions.gid != null) {
    validateInt32(processedOptions.gid, "options.gid");
  }

  // Validate the shell, if present.
  if (processedOptions.shell != null && typeof processedOptions.shell !== "boolean" && typeof processedOptions.shell !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], processedOptions.shell);
  }

  // Validate argv0, if present.
  if (processedOptions.argv0 != null) {
    validateString(processedOptions.argv0, "options.argv0");
    validateArgumentNullCheck(processedOptions.argv0, "options.argv0");
  }

  // Validate windowsHide, if present.
  if (processedOptions.windowsHide != null) {
    validateBoolean(processedOptions.windowsHide, "options.windowsHide");
  }

  let windowsVerbatimArguments = processedOptions.windowsVerbatimArguments;
  if (windowsVerbatimArguments != null) {
    validateBoolean(windowsVerbatimArguments, "options.windowsVerbatimArguments");
  }

  let finalFile = file;
  let finalArgs = processedArgs;

  // Handle shell
  if (processedOptions.shell) {
    validateArgumentNullCheck(processedOptions.shell, "options.shell");
    const command = ArrayPrototypeJoin.$call([finalFile, ...finalArgs], " ");
    // Set the shell, switches, and commands.
    if (process.platform === "win32") {
      if (typeof processedOptions.shell === "string") finalFile = processedOptions.shell;
      else finalFile = process.env.comspec || "cmd.exe";
      // '/d /s /c' is used only for cmd.exe.
      if (/^(?:.*\\)?cmd(?:\.exe)?$/i.exec(finalFile) !== null) {
        finalArgs = ["/d", "/s", "/c", `"${command}"`];
        windowsVerbatimArguments = true; // Reassignment happens here
      } else {
        finalArgs = ["-c", command];
      }
    } else {
      if (typeof processedOptions.shell === "string") finalFile = processedOptions.shell;
      else if (process.platform === "android") finalFile = "sh";
      else finalFile = "/bin/sh";
      finalArgs = ["-c", command];
    }
  }

  // Handle argv0
  if (typeof processedOptions.argv0 === "string") {
    ArrayPrototypeUnshift.$call(finalArgs, processedOptions.argv0);
  } else {
    ArrayPrototypeUnshift.$call(finalArgs, finalFile);
  }

  const env = processedOptions.env || process.env;
  const bunEnv: Record<string, string> = {};

  // // process.env.NODE_V8_COVERAGE always propagates, making it possible to
  // // collect coverage for programs that spawn with white-listed environment.
  // copyProcessEnvToEnv(env, "NODE_V8_COVERAGE", options.env);

  let envKeys: string[] = [];
  for (const key in env) {
    ArrayPrototypePush.$call(envKeys, key);
  }

  if (process.platform === "win32") {
    // On Windows env keys are case insensitive. Filter out duplicates, keeping only the first one (in lexicographic order)
    const sawKey = new Set();
    envKeys = ArrayPrototypeFilter.$call(ArrayPrototypeSort.$call(envKeys), key => {
      const uppercaseKey = StringPrototypeToUpperCase.$call(key);
      if (sawKey.has(uppercaseKey)) {
        return false;
      }
      sawKey.add(uppercaseKey);
      return true;
    });
  }

  for (const key of envKeys) {
    const value = env[key];
    // Fix TS2322: Ensure value is string before assigning
    if (typeof value === 'string') {
      validateArgumentNullCheck(key, `options.env['${key}']`);
      validateArgumentNullCheck(value, `options.env['${key}']`);
      bunEnv[key] = value;
    }
  }

  return {
    // Make a shallow copy so we don't clobber the user's options object.
    ...processedOptions, // Spread original options first
    args: finalArgs,
    cwd: cwd ?? undefined, // Ensure cwd is string or undefined
    [kBunEnv]: bunEnv,
    file: finalFile,
    detached: !!processedOptions.detached, // Fix TS2322: Ensure boolean
    argv0: processedOptions.argv0 ?? undefined, // Fix TS2322: Ensure string | undefined
    windowsHide: !!processedOptions.windowsHide,
    windowsVerbatimArguments: !!windowsVerbatimArguments,
    // Other properties like killSignal, timeout, maxBuffer, encoding, stdio, serialization are handled by callers or later steps
    envPairs: (processedOptions as any).envPairs, // Include envPairs if present
    input: (processedOptions as any).input, // Include input if present
    serialization: (processedOptions as any).serialization, // Include serialization if present
  };
}

function checkExecSyncError(ret: SpawnSyncResult, args?: string[], cmd?: string) {
  let err = ret.error;
  if (err) {
    ObjectAssign(err, {
      status: ret.status,
      signal: ret.signal,
      output: ret.output,
      pid: ret.pid,
      stdout: ret.stdout,
      stderr: ret.stderr,
    });
  } else if (ret.status !== 0) {
    let msg = "Command failed: ";
    msg += cmd || ArrayPrototypeJoin.$call(args || [], " ");
    if (ret.stderr && ret.stderr.length > 0) {
      // Check if stderr is not null before calling toString
      msg += `\n${ret.stderr.toString()}`;
    }
    err = genericNodeError(msg, {
      status: ret.status,
      signal: ret.signal,
      output: ret.output,
      pid: ret.pid,
      stdout: ret.stdout,
      stderr: ret.stderr,
    });
  }
  return err;
}
function parseEnvPairs(envPairs: string[] | undefined): Record<string, string> | undefined {
  if (!envPairs) return undefined;
  const resEnv: Record<string, string> = {};
  for (const line of envPairs) {
    const [key, ...value] = line.split("=", 2);
    resEnv[key] = value.join("=");
  }
  return resEnv;
}

//------------------------------------------------------------------------------
// Section 3. ChildProcess class
//------------------------------------------------------------------------------
class ChildProcess extends EventEmitter implements NodeChildProcess {
  #handle!: $ZigGeneratedClasses.Subprocess | null;
  #closesNeeded = 1;
  #closesGot = 0;

  signalCode: NodeJS.Signals | null = null;
  exitCode: number | null = null;
  spawnfile!: string;
  spawnargs!: string[];
  pid!: number;
  channel: Pipe | null | undefined; // TS2416 fix: Align with base type
  killed = false; // Initialize to false

  // Conditionally defined methods for IPC
  // TS2416 fix: Implement overloads matching NodeChildProcess
  send(message: Serializable, callback?: (error: Error | null) => void): boolean;
  send(message: Serializable, sendHandle?: SendHandle, callback?: (error: Error | null) => void): boolean;
  send(
    message: Serializable,
    sendHandle?: SendHandle,
    options?: MessageOptions,
    callback?: (error: Error | null) => void,
  ): boolean;
  send(
    message: Serializable,
    sendHandle?: SendHandle | ((error: Error | null) => void),
    options?: MessageOptions | ((error: Error | null) => void),
    callback?: (error: Error | null) => void,
  ): boolean {
    // Implementation delegates to #send or #sendNotConnected based on state
    if (this.#handle && this.connected) {
      return this.#send(message, sendHandle as any, options as any, callback as any);
    } else {
      return this.#sendNotConnected(message, sendHandle as any, options as any, callback as any);
    }
  }
  disconnect: () => void;

  constructor() {
    super();
    // Initialize disconnect to throw if IPC is not enabled
    this.disconnect = this.#disconnectNotConnected;
  }

  [Symbol.dispose]() {
    if (!this.killed) {
      this.kill();
    }
  }

  #handleOnExit(exitCode: number, signalCode: string | null, err: Error | null) {
    if (signalCode) {
      this.signalCode = signalCode as NodeJS.Signals;
    } else {
      this.exitCode = exitCode;
    }

    // Drain stdio streams
    {
      if (this.#stdin) {
        this.#stdin.destroy();
      } else {
        this.#stdioOptions[0] = "destroyed";
      }

      // If there was an error while spawning the subprocess, then we will never have any IO to drain.
      if (err) {
        this.#stdioOptions[1] = this.#stdioOptions[2] = "destroyed";
      }

      const stdout = this.#stdout,
        stderr = this.#stderr;

      if (stdout === undefined) {
        this.#stdout = this.#getBunSpawnIo(1, this.#encoding, true) as Readable | null;
      } else if (stdout && this.#stdioOptions[1] === "pipe" && !stdout?.destroyed) {
        (stdout as any).resume?.();
      }

      if (stderr === undefined) {
        this.#stderr = this.#getBunSpawnIo(2, this.#encoding, true) as Readable | null;
      } else if (stderr && this.#stdioOptions[2] === "pipe" && !stderr?.destroyed) {
        (stderr as any).resume?.();
      }
    }

    if (err) {
      if (this.spawnfile) (err as any).path = this.spawnfile;
      (err as any).spawnargs = ArrayPrototypeSlice.$call(this.spawnargs, 1);
      (err as any).pid = this.pid;
      this.emit("error", err);
    } else if (exitCode < 0) {
      const err = new SystemError(
        `Spawned process exited with error code: ${exitCode}`,
        "EUNKNOWN",
        exitCode,
        "spawn",
      );
      err.pid = this.pid;

      if (this.spawnfile) err.path = this.spawnfile;

      err.spawnargs = ArrayPrototypeSlice.$call(this.spawnargs, 1);
      this.emit("error", err);
    }

    this.emit("exit", this.exitCode, this.signalCode);

    this.#maybeClose();
  }

  #getBunSpawnIo(i: number, encoding?: BufferEncoding, autoResume = false): Readable | Writable | Stream | null {
    if ($debug && !this.#handle) {
      if (this.#handle === null) {
        $debug("ChildProcess: getBunSpawnIo: this.#handle is null. This means the subprocess already exited");
      } else {
        $debug("ChildProcess: getBunSpawnIo: this.#handle is undefined");
      }
    }

    const handle = this.#handle;
    const io = this.#stdioOptions[i];
    switch (i) {
      case 0: {
        switch (io) {
          case "pipe": {
            const stdin = handle?.stdin;

            if (!stdin)
              // This can happen if the process was already killed.
              return new ShimmedStdin();
            return require("internal/fs/streams").writableFromFileSink(stdin);
          }
          case "inherit":
            return null;
          case "destroyed":
            return new ShimmedStdin();
          default:
            return null;
        }
      }
      case 2:
      case 1: {
        switch (io) {
          case "pipe": {
            const stdioName = fdToStdioName(i as 1 | 2)!;
            const value = handle?.[stdioName];
            // This can happen if the process was already killed.
            if (!value) return new ShimmedStdioOutStream();

            const pipe = require("internal/streams/native-readable").constructNativeReadable(value as any, { encoding });
            this.#closesNeeded++;
            events.once(pipe as any, "close").then(() => this.#maybeClose());
            if (autoResume) (pipe as any).resume();
            return pipe as unknown as Readable; // Cast to Readable
          }
          case "destroyed":
            return new ShimmedStdioOutStream();
          default:
            return null;
        }
      }
      default:
        switch (io) {
          case "pipe":
            if (!NetModule) NetModule = require("node:net");
            const fd = handle && (handle.stdio as any[])?.[i];
            if (!fd) return null;
            return new NetModule.Socket({ fd }); // Use Socket constructor
        }
        return null;
    }
  }

  #stdin: Writable | null | undefined;
  #stdout: Readable | null | undefined;
  #stderr: Readable | null | undefined;
  #stdioObject: NodeChildProcess['stdio'] | undefined;
  #encoding: BufferEncoding | undefined;
  #stdioOptions!: (string | number | null | NodeJS.TypedArray | ArrayBufferView)[];

  #createStdioObject(): NodeChildProcess['stdio'] {
    const opts = this.#stdioOptions;
    const length = opts.length;
    let result: (Readable | Writable | Stream | null)[] = new Array(length);
    for (let i = 0; i < length; i++) {
      const element = opts[i];

      if (element !== "pipe") {
        result[i] = null;
        continue;
      }
      switch (i) {
        case 0:
          result[i] = this.stdin;
          continue;
        case 1:
          result[i] = this.stdout;
          continue;
        case 2:
          result[i] = this.stderr;
          continue;
        default:
          result[i] = this.#getBunSpawnIo(i, this.#encoding, false);
          continue;
      }
    }
    // Cast to the expected tuple type. This might not be perfectly accurate
    // if the length is different, but it satisfies the interface.
    return result as NodeChildProcess['stdio'];
  }

  get stdin(): Writable | null {
    return (this.#stdin ??= this.#getBunSpawnIo(0, this.#encoding, false) as Writable | null);
  }

  get stdout(): Readable | null {
    return (this.#stdout ??= this.#getBunSpawnIo(1, this.#encoding, false) as Readable | null);
  }

  get stderr(): Readable | null {
    return (this.#stderr ??= this.#getBunSpawnIo(2, this.#encoding, false) as Readable | null);
  }

  get stdio(): NodeChildProcess['stdio'] {
    return (this.#stdioObject ??= this.#createStdioObject());
  }

  get connected(): boolean {
    const handle = this.#handle;
    if (handle === null) return false;
    return handle.connected ?? false;
  }

  get [kHandle]() {
    return this.#handle;
  }

  spawn(options: NormalizedSpawnOptions) {
    validateObject(options, "options");

    validateOneOf(options.serialization, "options.serialization", [undefined, "json", "advanced"]);
    const serialization = options.serialization || "json";

    const stdio = options.stdio || ["pipe", "pipe", "pipe"];
    const bunStdio = getBunStdioFromOptions(stdio);

    const has_ipc = $isJSArray(stdio) && stdio.includes("ipc");

    // validate options.envPairs but only if has_ipc. for some reason.
    if (has_ipc) {
      if (options.envPairs !== undefined) {
        validateArray(options.envPairs, "options.envPairs");
      }
    }

    var env = options[kBunEnv] || parseEnvPairs(options.envPairs) || process.env;

    this.#encoding = options.encoding === "buffer" ? undefined : options.encoding || undefined;
    this.#stdioOptions = bunStdio;
    const stdioCount = bunStdio.length; // Use normalized bunStdio length
    const hasSocketsToEagerlyLoad = stdioCount >= 3;

    validateString(options.file, "options.file");
    // Assign spawnfile/spawnargs before try block
    var file = this.spawnfile = options.file;
    var spawnargs;
    if (options.args === undefined) {
      spawnargs = this.spawnargs = [];
      // how is this allowed?
    } else {
      validateArray(options.args, "options.args");
      spawnargs = this.spawnargs = options.args;
    }
    // normalizeSpawnargs has already prepended argv0 to the spawnargs array
    // Bun.spawn() expects cmd[0] to be the command to run, and argv0 to replace the first arg when running the command,
    // so we have to set argv0 to spawnargs[0] and cmd[0] to file

    try {
      this.#handle = Bun.spawn({
        cmd: [file, ...Array.prototype.slice.$call(spawnargs, 1)],
        stdio: bunStdio as any, // Cast because the type is complex and dynamic
        cwd: options.cwd as string | undefined, // Cast cwd
        env: env,
        detached: !!options.detached, // Fix TS2322: Ensure boolean
        onExit: (handle, exitCode, signalCode, err) => {
          this.#handle = handle as $ZigGeneratedClasses.Subprocess;
          this.pid = this.#handle!.pid as number;
          $debug("ChildProcess: onExit", exitCode, signalCode, err, this.pid);

          if (hasSocketsToEagerlyLoad) {
            process.nextTick(() => {
              this.stdio;
              $debug("ChildProcess: onExit", exitCode, signalCode, err, this.pid);
            });
          }

          process.nextTick(
            (exitCode, signalCode, err) => this.#handleOnExit(exitCode, signalCode, err),
            exitCode,
            signalCode,
            err,
          );
        },
        lazy: true,
        ipc: has_ipc ? this.#emitIpcMessage.bind(this) : undefined,
        onDisconnect: has_ipc ? ok => this.#onDisconnect(ok) : undefined,
        serialization,
        argv0: spawnargs[0],
        windowsHide: !!options.windowsHide,
        windowsVerbatimArguments: !!options.windowsVerbatimArguments,
      }) as $ZigGeneratedClasses.Subprocess;
      this.pid = this.#handle.pid as number;

      $debug("ChildProcess: spawn", this.pid, spawnargs);

      process.nextTick(() => {
        this.emit("spawn");
      });

      if (has_ipc) {
        // Re-assign send/disconnect now that IPC is confirmed
        this.send = (
          message: Serializable,
          sendHandle?: SendHandle | ((error: Error | null) => void),
          options?: MessageOptions | ((error: Error | null) => void),
          callback?: (error: Error | null) => void,
        ): boolean => this.#send(message, sendHandle as any, options as any, callback as any);
        this.disconnect = this.#disconnect;
        this.channel = new Control() as any; // Cast Control to satisfy Pipe | null | undefined
        Object.defineProperty(this, "_channel", {
          get() {
            return this.channel;
          },
          set(value) {
            this.channel = value;
          },
        });
        if (options[kFromNode]) this.#closesNeeded += 1;
      }

      if (hasSocketsToEagerlyLoad) {
        const stdio = this.stdio; // Access the getter once
        for (let i = 3; i < stdio.length; i++) {
          const item = stdio[i];
          // Only ref sockets (assuming only sockets have ref and are relevant here)
          if (item && typeof (item as any).ref === "function") {
            (item as any).ref();
          }
        }
      }
    } catch (ex) {
      if (ex == null || typeof ex !== "object" || !Object.hasOwn(ex, "errno")) throw ex;
      this.#handle = null;
      (ex as any).syscall = "spawn " + this.spawnfile;
      (ex as any).spawnargs = Array.prototype.slice.$call(this.spawnargs, 1);
      process.nextTick(() => {
        this.emit("error", ex);
        this.emit("close", (ex as Error & { errno?: number }).errno ?? -1);
      });
    }
  }

  #emitIpcMessage(message: any) {
    this.emit("message", message);
  }

  #sendNotConnected(message: Serializable, sendHandle?: SendHandle, options?: MessageOptions, callback?: (error: Error | null) => void): boolean {
    const error = $ERR_IPC_CHANNEL_CLOSED();
    if (typeof sendHandle === "function") {
      callback = sendHandle;
    } else if (typeof options === "function") {
      callback = options;
    }
    if (callback) {
      process.nextTick(callback, error);
    } else {
      this.emit("error", error);
    }
    return false;
  }

  #disconnectNotConnected() {
    this.emit("error", $ERR_IPC_CHANNEL_CLOSED());
  }

  // Internal implementation for send, called by the overloaded public `send`
  #send(message: Serializable, sendHandle?: SendHandle, options?: MessageOptions, callback?: (error: Error | null) => void): boolean {
    if (typeof sendHandle === "function") {
      callback = sendHandle;
      sendHandle = undefined;
      options = undefined;
    } else if (typeof options === "function") {
      callback = options;
      options = undefined;
    } else if (options !== undefined) {
      if (typeof options !== "object" || options === null) {
        throw $ERR_INVALID_ARG_TYPE("options", "object", options);
      }
    }

    if (!this.#handle || !this.connected) {
      const error = $ERR_IPC_CHANNEL_CLOSED();
      if (callback) {
        process.nextTick(callback, error);
      } else {
        this.emit("error", error);
      }
      return false;
    }

    // Bun does not handle handles yet
    try {
      this.#handle.send(message);
      if (callback) process.nextTick(callback, null);
      return true;
    } catch (error) {
      if (callback) {
        process.nextTick(callback, error);
      } else {
        this.emit("error", error);
      }
      return false;
    }
  }

  #onDisconnect(firstTime: boolean) {
    if (!firstTime) {
      // strange
      return;
    }
    $assert(!this.connected);
    process.nextTick(() => this.emit("disconnect"));
    process.nextTick(() => this.#maybeClose());
  }
  #disconnect() {
    if (!this.connected) {
      this.emit("error", $ERR_IPC_DISCONNECTED());
      return;
    }
    this.#handle!.disconnect();
    this.channel = null;
    // Revert send/disconnect to the "not connected" versions
    this.send = (
      message: Serializable,
      sendHandle?: SendHandle | ((error: Error | null) => void),
      options?: MessageOptions | ((error: Error | null) => void),
      callback?: (error: Error | null) => void,
    ): boolean => this.#sendNotConnected(message, sendHandle as any, options as any, callback as any);
    this.disconnect = this.#disconnectNotConnected;
  }

  kill(sig?: number | NodeJS.Signals) {
    const signal = sig === 0 ? sig : convertToValidSignal(sig === undefined ? "SIGTERM" : sig);

    const handle = this.#handle;
    if (handle) {
      if (handle.killed) {
        this.killed = true;
        return true;
      }

      try {
        handle.kill(signal);
        this.killed = true;
        return true;
      } catch (e) {
        this.emit("error", e);
      }
    }

    return false;
  }

  #maybeClose() {
    $debug("Attempting to maybe close...");
    this.#closesGot++;
    if (this.#closesGot === this.#closesNeeded) {
      this.emit("close", this.exitCode, this.signalCode);
    }
  }

  ref() {
    if (this.#handle) this.#handle.ref();
  }

  unref() {
    if (this.#handle) this.#handle.unref();
  }
}

//------------------------------------------------------------------------------
// Section 4. ChildProcess helpers
//------------------------------------------------------------------------------
const nodeToBunLookup = {
  ignore: null,
  pipe: "pipe",
  overlapped: "pipe", // TODO: this may need to work differently for Windows
  inherit: "inherit",
  ipc: "ipc",
};

function nodeToBun(item: any, index: number, _array?: any[]): string | number | null | NodeJS.TypedArray | ArrayBufferView {
  // If not defined, use the default.
  // For stdin/stdout/stderr, it's pipe. For others, it's ignore.
  if (item == null) {
    return index > 2 ? "ignore" : "pipe";
  }
  // If inherit and we are referencing stdin/stdout/stderr index,
  // we can get the fd from the ReadStream for the corresponding stdio
  if (typeof item === "number") {
    return item;
  }
  if (isNodeStreamReadable(item)) {
    if (typeof item === "object" && Object.hasOwn(item, "fd") && typeof (item as any).fd === "number")
      return (item as any).fd;
    throw new Error(`TODO: stream.Readable stdio @ ${index}`);
  }
  if (isNodeStreamWritable(item)) {
    if (typeof item === "object" && Object.hasOwn(item, "fd") && typeof (item as any).fd === "number")
      return (item as any).fd;
    throw new Error(`TODO: stream.Writable stdio @ ${index}`);
  }
  const result = nodeToBunLookup[item];
  if (result === undefined) {
    throw new Error(`Invalid stdio option[${index}] "${item}"`);
  }
  return result;
}

/**
 * Safer version of `item instance of node:stream.Readable`.
 *
 * @param item {object}
 * @returns {boolean}
 */
function isNodeStreamReadable(item): item is Readable {
  if (typeof item !== "object") return false;
  if (!item) return false;
  if (typeof item.on !== "function") return false;
  if (typeof item.pipe !== "function") return false;
  return true;
}

/**
 * Safer version of `item instance of node:stream.Writable`.
 *
 * @param item {objects}
 * @returns {boolean}
 */
function isNodeStreamWritable(item): item is Writable {
  if (typeof item !== "object") return false;
  if (!item) return false;
  if (typeof item.on !== "function") return false;
  if (typeof item.write !== "function") return false;
  return true;
}

function fdToStdioName(fd: number): "stdin" | "stdout" | "stderr" | null {
  switch (fd) {
    case 0:
      return "stdin";
    case 1:
      return "stdout";
    case 2:
      return "stderr";
    default:
      return null;
  }
}

function getBunStdioFromOptions(stdio: StdioOptions | undefined): (string | number | null | NodeJS.TypedArray | ArrayBufferView)[] {
  const normalizedStdio = normalizeStdio(stdio);
  if (normalizedStdio.filter(v => v === "ipc").length > 1) throw $ERR_IPC_ONE_PIPE();
  // Node options:
  // pipe: just a pipe
  // ipc = can only be one in array
  // overlapped -- same as pipe on Unix based systems
  // inherit -- 'inherit': equivalent to ['inherit', 'inherit', 'inherit'] or [0, 1, 2]
  // ignore -- > /dev/null, more or less same as null option for Bun.spawn stdio
  // TODO: Stream -- use this stream
  // number -- used as FD
  // null, undefined: Use default value. Not same as ignore, which is Bun.spawn null.
  // null/undefined: For stdio fds 0, 1, and 2 (in other words, stdin, stdout, and stderr) a pipe is created. For fd 3 and up, the default is 'ignore'

  // Important Bun options
  // pipe
  // fd
  // null - no stdin/stdout/stderr

  // Translations: node -> bun
  // pipe -> pipe
  // overlapped -> pipe
  // ignore -> null
  // inherit -> inherit (stdin/stdout/stderr)
  // Stream -> throw err for now
  const bunStdio = normalizedStdio.map(nodeToBun);
  return bunStdio;
}

function normalizeStdio(stdio: StdioOptions | undefined): (IOType | 'ipc' | number | Stream | null | undefined)[] {
  if (typeof stdio === "string") {
    switch (stdio) {
      case "ignore":
        return ["ignore", "ignore", "ignore"];
      case "pipe":
        return ["pipe", "pipe", "pipe"];
      case "inherit":
        return ["inherit", "inherit", "inherit"];
      default:
        throw ERR_INVALID_OPT_VALUE("stdio", stdio);
    }
  } else if ($isJSArray(stdio)) {
    // Validate if each is a valid stdio type
    // TODO: Support wrapped types here

    let processedStdio: (IOType | 'ipc' | number | Stream | null | undefined)[];
    if (stdio.length === 0) processedStdio = ["pipe", "pipe", "pipe"];
    else if (stdio.length === 1) processedStdio = [stdio[0], "pipe", "pipe"];
    else if (stdio.length === 2) processedStdio = [stdio[0], stdio[1], "pipe"];
    else if (stdio.length >= 3) processedStdio = stdio;
    else processedStdio = ["pipe", "pipe", "pipe"]; // Should not happen based on checks above

    return processedStdio;
  } else if (stdio === undefined || stdio === null) {
    return ["pipe", "pipe", "pipe"]; // Default for null/undefined
  } else {
    throw ERR_INVALID_OPT_VALUE("stdio", stdio);
  }
}

function abortChildProcess(child: ChildProcess, killSignal: number | undefined, reason: any) {
  if (!child) return;
  try {
    if (child.kill(killSignal)) {
      child.emit("error", $makeAbortError(undefined, { cause: reason }));
    }
  } catch (err) {
    child.emit("error", err);
  }
}

class Control extends EventEmitter {
  constructor() {
    super();
  }
}

//------------------------------------------------------------------------------
// Section 5. Validators
//------------------------------------------------------------------------------

function validateMaxBuffer(maxBuffer: number | undefined | null) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw $ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }
}

function validateArgumentNullCheck(arg: any, propName: string) {
  if (typeof arg === "string" && StringPrototypeIncludes.$call(arg, "\u0000")) {
    throw $ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
  }
}

function validateArgumentsNullCheck(args: any[], propName: string) {
  for (let i = 0; i < args.length; ++i) {
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
  }
}

function validateTimeout(timeout: number | undefined) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0)) {
    throw $ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
}

function isInt32(value: any): value is number {
  return value === (value | 0);
}

function nullCheck(path: string | Uint8Array, propName: string, throwError = true): Error | undefined {
  const pathIsString = typeof path === "string";
  const pathIsUint8Array = isUint8Array(path);

  // We can only perform meaningful checks on strings and Uint8Arrays.
  if (
    (!pathIsString && !pathIsUint8Array) ||
    (pathIsString && !StringPrototypeIncludes.$call(path, "\u0000")) ||
    (pathIsUint8Array && !Uint8ArrayPrototypeIncludes.$call(path, 0))
  ) {
    return undefined;
  }

  const err = $ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError) {
    throw err;
  }
  return err;
}

function validatePath(path: string | Buffer | URL, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path)) {
    throw $ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
  }

  const err = nullCheck(path as string | Uint8Array, propName, false); // Cast needed after type check

  if (err !== undefined) {
    throw err;
  }
}

//------------------------------------------------------------------------------
// Section 6. Random utilities
//------------------------------------------------------------------------------

function isURLInstance(fileURLOrPath: any): fileURLOrPath is URL {
  return fileURLOrPath != null && fileURLOrPath.href && fileURLOrPath.origin;
}

//------------------------------------------------------------------------------
// Section 7. Node errors / error polyfills
//------------------------------------------------------------------------------
var Error = globalThis.Error;
var TypeError = globalThis.TypeError;

function genericNodeError(message: string, errorProperties: object): Error {
  // eslint-disable-next-line no-restricted-syntax
  const err = new Error(message);
  ObjectAssign(err, errorProperties);
  return err;
}

function ERR_UNKNOWN_SIGNAL(name: any): TypeError {
  const err = new TypeError(`Unknown signal: ${name}`);
  err.code = "ERR_UNKNOWN_SIGNAL";
  return err;
}

function ERR_INVALID_OPT_VALUE(name: string, value: any): TypeError {
  const err = new TypeError(`The value "${value}" is invalid for option "${name}"`);
  err.code = "ERR_INVALID_OPT_VALUE";
  return err;
}

export default {
  ChildProcess,
  spawn,
  execFile,
  exec,
  fork,
  spawnSync,
  execFileSync,
  execSync,
};