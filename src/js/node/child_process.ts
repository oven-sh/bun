// Hardcoded module "node:child_process"
const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const OsModule = require("node:os");
const { ERR_INVALID_ARG_TYPE, ERR_IPC_DISCONNECTED } = require("internal/errors");
const { kHandle } = require("internal/shared");

var NetModule;

var ObjectCreate = Object.create;
var ObjectAssign = Object.assign;
var BufferConcat = Buffer.concat;
var BufferIsEncoding = Buffer.isEncoding;

var kEmptyObject = ObjectCreate(null);
var signals = OsModule.constants.signals;

var ArrayPrototypePush = Array.prototype.push;
var ArrayPrototypeJoin = Array.prototype.join;
var ArrayPrototypeMap = Array.prototype.map;
var ArrayPrototypeIncludes = Array.prototype.includes;
var ArrayPrototypeSlice = Array.prototype.slice;
var ArrayPrototypeUnshift = Array.prototype.unshift;

var ArrayBufferIsView = ArrayBuffer.isView;

var NumberIsInteger = Number.isInteger;

var StringPrototypeToUpperCase = String.prototype.toUpperCase;
var StringPrototypeIncludes = String.prototype.includes;
var StringPrototypeSlice = String.prototype.slice;
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

var NativeWritable;
var ReadableFromWeb;

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
// detached <boolean> Prepare child to run independently of its parent process. Specific behavior depends on the platform, see options.detached).

// TODO: Add support for ipc option, verify only one IPC channel in array
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
 * @param {{
 *   cwd?: string;
 *   env?: Record<string, string>;
 *   argv0?: string;
 *   stdio?: Array | string;
 *   detached?: boolean;
 *   uid?: number;
 *   gid?: number;
 *   serialization?: string;
 *   shell?: boolean | string;
 *   windowsHide?: boolean;
 *   windowsVerbatimArguments?: boolean;
 *   signal?: AbortSignal;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   }} [options]
 * @returns {ChildProcess}
 */
function spawn(file, args, options) {
  options = normalizeSpawnArguments(file, args, options);
  validateTimeout(options.timeout);
  validateAbortSignal(options.signal, "options.signal");
  const killSignal = sanitizeKillSignal(options.killSignal);
  const child = new ChildProcess();

  $debug("spawn", options);
  options[kFromNode] = true;
  child.spawn(options);

  const timeout = options.timeout;
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

  const signal = options.signal;
  if (signal) {
    if (signal.aborted) {
      process.nextTick(onAbortListener);
    } else {
      signal.addEventListener("abort", onAbortListener, { once: true });
      child.once("exit", () => signal.removeEventListener("abort", onAbortListener));
    }

    function onAbortListener() {
      abortChildProcess(child, killSignal, signal.reason);
    }
  }
  process.nextTick(() => {
    child.emit("spawn");
  });
  return child;
}

/**
 * Spawns the specified file as a shell.
 * @param {string} file
 * @param {string[]} [args]
 * @param {{
 *   cwd?: string;
 *   env?: Record<string, string>;
 *   encoding?: string;
 *   timeout?: number;
 *   maxBuffer?: number;
 *   killSignal?: string | number;
 *   uid?: number;
 *   gid?: number;
 *   windowsHide?: boolean;
 *   windowsVerbatimArguments?: boolean;
 *   shell?: boolean | string;
 *   signal?: AbortSignal;
 *   }} [options]
 * @param {(
 *   error?: Error,
 *   stdout?: string | Buffer,
 *   stderr?: string | Buffer
 *   ) => any} [callback]
 * @returns {ChildProcess}
 */
function execFile(file, args, options, callback) {
  ({ file, args, options, callback } = normalizeExecFileArgs(file, args, options, callback));

  options = {
    encoding: "utf8",
    timeout: 0,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGTERM",
    cwd: null,
    env: null,
    shell: false,
    ...options,
  };

  const maxBuffer = options.maxBuffer;

  // Validate the timeout, if present.
  validateTimeout(options.timeout);

  // Validate maxBuffer, if present.
  validateMaxBuffer(maxBuffer);

  options.killSignal = sanitizeKillSignal(options.killSignal);

  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    killSignal: options.killSignal,
    uid: options.uid,
    gid: options.gid,
    windowsHide: options.windowsHide,
    windowsVerbatimArguments: options.windowsVerbatimArguments,
    shell: options.shell,
    signal: options.signal,
  });

  let encoding;
  const _stdout = [];
  const _stderr = [];
  if (options.encoding !== "buffer" && BufferIsEncoding(options.encoding)) {
    encoding = options.encoding;
  } else {
    encoding = null;
  }
  let killed = false;
  let exited = false;
  let timeoutId;

  let ex: Error | null = null;

  let cmd = file;

  function exitHandler(code = 0, signal?: number | null) {
    if (exited) return;
    exited = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!callback) return;

    const readableEncoding = child?.stdout?.readableEncoding;
    // merge chunks
    let stdout;
    let stderr;
    if (encoding || (child.stdout && readableEncoding)) {
      stdout = ArrayPrototypeJoin.$call(_stdout, "");
    } else {
      stdout = BufferConcat(_stdout);
    }
    if (encoding || (child.stderr && readableEncoding)) {
      stderr = ArrayPrototypeJoin.$call(_stderr, "");
    } else {
      stderr = BufferConcat(_stderr);
    }

    if (!ex && code === 0 && signal === null) {
      callback(null, stdout, stderr);
      return;
    }

    if (args?.length) cmd += ` ${ArrayPrototypeJoin.$call(args, " ")}`;
    if (!ex) {
      let message = `Command failed: ${cmd}`;
      if (stderr) message += `\n${stderr}`;
      ex = genericNodeError(message, {
        // code: code < 0 ? getSystemErrorName(code) : code, // TODO: Add getSystemErrorName
        code: code,
        killed: child.killed || killed,
        signal: signal,
      });
    }

    ex.cmd = cmd;
    callback(ex, stdout, stderr);
  }

  function errorHandler(e) {
    ex = e;

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
      child.kill(options.killSignal);
    } catch (e) {
      ex = e;
      exitHandler();
    }
  }

  if (options.timeout > 0) {
    timeoutId = setTimeout(function delayedKill() {
      timeoutId = null;
      kill();
    }, options.timeout).unref();
  }

  const onData = (array, kind) => {
    let total = 0;
    let encodedLength;
    return encoding
      ? function onDataEncoded(chunk) {
          total += chunk.length;

          if (total > maxBuffer) {
            const out = child[kind];
            const encoding = out.readableEncoding;
            const actualLen = Buffer.byteLength(chunk, encoding);
            if (encodedLength === undefined) {
              encodedLength = 0;

              for (let i = 0, length = array.length; i < length; i++) {
                encodedLength += Buffer.byteLength(array[i], encoding);
              }
            }

            encodedLength += actualLen;

            if (encodedLength > maxBuffer) {
              const joined = ArrayPrototypeJoin.$call(array, "");
              let combined = joined + chunk;
              combined = StringPrototypeSlice.$call(combined, 0, maxBuffer);
              array.length = 1;
              array[0] = combined;
              ex = ERR_CHILD_PROCESS_STDIO_MAXBUFFER(kind);
              kill();
            } else {
              const val = ArrayPrototypeJoin.$call(array, "") + chunk;
              array.length = 1;
              array[0] = val;
            }
          } else {
            $arrayPush(array, chunk);
          }
        }
      : function onDataRaw(chunk) {
          total += chunk.length;

          if (total > maxBuffer) {
            const truncatedLen = maxBuffer - (total - chunk.length);
            $arrayPush(array, chunk.slice(0, truncatedLen));

            ex = ERR_CHILD_PROCESS_STDIO_MAXBUFFER(kind);
            kill();
          } else {
            $arrayPush(array, chunk);
          }
        };
  };

  if (child.stdout) {
    if (encoding) child.stdout.setEncoding(encoding);

    child.stdout.on(
      "data",
      maxBuffer === Infinity
        ? function onUnlimitedSizeBufferedData(chunk) {
            $arrayPush(_stdout, chunk);
          }
        : onData(_stdout, "stdout"),
    );
  }

  if (child.stderr) {
    if (encoding) child.stderr.setEncoding(encoding);

    child.stderr.on(
      "data",
      maxBuffer === Infinity
        ? function onUnlimitedSizeBufferedData(chunk) {
            $arrayPush(_stderr, chunk);
          }
        : onData(_stderr, "stderr"),
    );
  }

  child.addListener("close", exitHandler);
  child.addListener("error", errorHandler);

  return child;
}

/**
 * Spawns a shell executing the given command.
 * @param {string} command
 * @param {{
 *   cmd?: string;
 *   env?: Record<string, string>;
 *   encoding?: string;
 *   shell?: string;
 *   signal?: AbortSignal;
 *   timeout?: number;
 *   maxBuffer?: number;
 *   killSignal?: string | number;
 *   uid?: number;
 *   gid?: number;
 *   windowsHide?: boolean;
 *   windowsVerbatimArguments?: boolean;
 *   }} [options]
 * @param {(
 *   error?: Error,
 *   stdout?: string | Buffer,
 *   stderr?: string | Buffer
 *   ) => any} [callback]
 * @returns {ChildProcess}
 */
function exec(command, options, callback) {
  const opts = normalizeExecArgs(command, options, callback);
  return execFile(opts.file, opts.options, opts.callback);
}

const kCustomPromisifySymbol = Symbol.for("nodejs.util.promisify.custom");

const customPromiseExecFunction = orig => {
  return (...args) => {
    const { resolve, reject, promise } = Promise.withResolvers();

    promise.child = orig(...args, (err, stdout, stderr) => {
      if (err !== null) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
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

exec[kCustomPromisifySymbol][kCustomPromisifySymbol] = exec[kCustomPromisifySymbol];

Object.defineProperty(execFile, kCustomPromisifySymbol, {
  __proto__: null,
  configurable: true,
  value: customPromiseExecFunction(execFile),
});

execFile[kCustomPromisifySymbol][kCustomPromisifySymbol] = execFile[kCustomPromisifySymbol];

/**
 * Spawns a new process synchronously using the given `file`.
 * @param {string} file
 * @param {string[]} [args]
 * @param {{
 *   cwd?: string;
 *   input?: string | Buffer | TypedArray | DataView;
 *   argv0?: string;
 *   stdio?: string | Array;
 *   env?: Record<string, string>;
 *   uid?: number;
 *   gid?: number;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   maxBuffer?: number;
 *   encoding?: string;
 *   shell?: boolean | string;
 *   windowsHide?: boolean;
 *   windowsVerbatimArguments?: boolean;
 *   }} [options]
 * @returns {{
 *   pid: number;
 *   output: Array;
 *   stdout: Buffer | string;
 *   stderr: Buffer | string;
 *   status: number | null;
 *   signal: string | null;
 *   error: Error;
 *   }}
 */
function spawnSync(file, args, options) {
  options = {
    maxBuffer: MAX_BUFFER,
    ...normalizeSpawnArguments(file, args, options),
  };

  const maxBuffer = options.maxBuffer;
  const encoding = options.encoding;

  $debug("spawnSync", options);

  // Validate the timeout, if present.
  validateTimeout(options.timeout);

  // Validate maxBuffer, if present.
  validateMaxBuffer(maxBuffer);

  // Validate and translate the kill signal, if present.
  options.killSignal = sanitizeKillSignal(options.killSignal);

  const stdio = options.stdio || "pipe";
  const bunStdio = getBunStdioFromOptions(stdio);

  var { input } = options;
  if (input) {
    if (ArrayBufferIsView(input)) {
      bunStdio[0] = input;
    } else if (typeof input === "string") {
      bunStdio[0] = Buffer.from(input, encoding || "utf8");
    } else {
      throw ERR_INVALID_ARG_TYPE(`options.stdio[0]`, ["Buffer", "TypedArray", "DataView", "string"], input);
    }
  }

  const {
    stdout = null,
    stderr = null,
    success,
    exitCode,
  } = Bun.spawnSync({
    cmd: options.args,
    env: options.env || undefined,
    cwd: options.cwd || undefined,
    stdio: bunStdio,
    windowsVerbatimArguments: options.windowsVerbatimArguments,
    windowsHide: options.windowsHide,
  });

  const result = {
    signal: null,
    status: exitCode,
    // TODO: Need to expose extra pipes from Bun.spawnSync to child_process
    output: [null, stdout, stderr],
  };

  if (stdout && encoding && encoding !== "buffer") {
    result.output[1] = result.output[1]?.toString(encoding);
  }

  if (stderr && encoding && encoding !== "buffer") {
    result.output[2] = result.output[2]?.toString(encoding);
  }

  result.stdout = result.output[1];
  result.stderr = result.output[2];

  if (!success) {
    result.error = new SystemError(result.output[2], options.file, "spawnSync", -1, result.status);
    result.error.spawnargs = ArrayPrototypeSlice.$call(options.args, 1);
  }

  return result;
}

/**
 * Spawns a file as a shell synchronously.
 * @param {string} file
 * @param {string[]} [args]
 * @param {{
 *   cwd?: string;
 *   input?: string | Buffer | TypedArray | DataView;
 *   stdio?: string | Array;
 *   env?: Record<string, string>;
 *   uid?: number;
 *   gid?: number;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   maxBuffer?: number;
 *   encoding?: string;
 *   windowsHide?: boolean;
 *   shell?: boolean | string;
 *   }} [options]
 * @returns {Buffer | string}
 */
function execFileSync(file, args, options) {
  ({ file, args, options } = normalizeExecFileArgs(file, args, options));

  const inheritStderr = !options.stdio;
  const ret = spawnSync(file, args, options);

  if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr);

  const errArgs = [options.argv0 || file];
  ArrayPrototypePush.$apply(errArgs, args);
  const err = checkExecSyncError(ret, errArgs);

  if (err) throw err;

  return ret.stdout;
}

/**
 * Spawns a shell executing the given `command` synchronously.
 * @param {string} command
 * @param {{
 *   cwd?: string;
 *   input?: string | Buffer | TypedArray | DataView;
 *   stdio?: string | Array;
 *   env?: Record<string, string>;
 *   shell?: string;
 *   uid?: number;
 *   gid?: number;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   maxBuffer?: number;
 *   encoding?: string;
 *   windowsHide?: boolean;
 *   }} [options]
 * @returns {Buffer | string}
 */
function execSync(command, options) {
  const opts = normalizeExecArgs(command, options, null);
  const inheritStderr = !opts.options.stdio;

  const ret = spawnSync(opts.file, opts.options);

  if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr);

  const err = checkExecSyncError(ret, undefined, command);

  if (err) throw err;

  return ret.stdout;
}

function stdioStringToArray(stdio, channel) {
  let options;

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
      throw ERR_INVALID_ARG_VALUE("stdio", stdio);
  }

  if (channel) $arrayPush(options, channel);

  return options;
}

/**
 * Spawns a new Node.js process + fork.
 * @param {string|URL} modulePath
 * @param {string[]} [args]
 * @param {{
 *   cwd?: string;
 *   detached?: boolean;
 *   env?: Record<string, string>;
 *   execPath?: string;
 *   execArgv?: string[];
 *   gid?: number;
 *   serialization?: string;
 *   signal?: AbortSignal;
 *   killSignal?: string | number;
 *   silent?: boolean;
 *   stdio?: Array | string;
 *   uid?: number;
 *   windowsVerbatimArguments?: boolean;
 *   timeout?: number;
 *   }} [options]
 * @returns {ChildProcess}
 */
function fork(modulePath, args = [], options) {
  modulePath = getValidatedPath(modulePath, "modulePath");

  // Get options and args arguments.
  let execArgv;

  if (args == null) {
    args = [];
  } else if (typeof args === "object" && !$isJSArray(args)) {
    options = args;
    args = [];
  } else {
    validateArray(args, "args");
  }

  if (options != null) {
    validateObject(options, "options");
  }
  options = { __proto__: null, ...options, shell: false };
  options.execPath = options.execPath || process.execPath;
  validateArgumentNullCheck(options.execPath, "options.execPath");

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

  args = [/*...execArgv,*/ modulePath, ...args];

  if (typeof options.stdio === "string") {
    options.stdio = stdioStringToArray(options.stdio, "ipc");
  } else if (!$isJSArray(options.stdio)) {
    // Use a separate fd=3 for the IPC channel. Inherit stdin, stdout,
    // and stderr from the parent if silent isn't set.
    options.stdio = stdioStringToArray(options.silent ? "pipe" : "inherit", "ipc");
  } else if (!ArrayPrototypeIncludes.$call(options.stdio, "ipc")) {
    throw ERR_CHILD_PROCESS_IPC_REQUIRED("options.stdio");
  }

  return spawn(options.execPath, args, options);
}

//------------------------------------------------------------------------------
// Section 2. child_process helpers
//------------------------------------------------------------------------------
function convertToValidSignal(signal) {
  if (typeof signal === "number" && getSignalsToNamesMapping()[signal]) return signal;

  if (typeof signal === "string") {
    const signalName = signals[StringPrototypeToUpperCase.$call(signal)];
    if (signalName) return signalName;
  }

  throw ERR_UNKNOWN_SIGNAL(signal);
}

function sanitizeKillSignal(killSignal) {
  if (typeof killSignal === "string" || typeof killSignal === "number") {
    return convertToValidSignal(killSignal);
  } else if (killSignal != null) {
    throw ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal);
  }
}

let signalsToNamesMapping;
function getSignalsToNamesMapping() {
  if (signalsToNamesMapping !== undefined) return signalsToNamesMapping;

  signalsToNamesMapping = ObjectCreate(null);
  for (const key in signals) {
    signalsToNamesMapping[signals[key]] = key;
  }

  return signalsToNamesMapping;
}

function normalizeExecFileArgs(file, args, options, callback) {
  if ($isJSArray(args)) {
    args = ArrayPrototypeSlice.$call(args);
  } else if (args != null && typeof args === "object") {
    callback = options;
    options = args;
    args = null;
  } else if (typeof args === "function") {
    callback = args;
    options = null;
    args = null;
  }

  if (args == null) {
    args = [];
  }

  if (typeof options === "function") {
    callback = options;
  } else if (options != null) {
    validateObject(options, "options");
  }

  if (options == null) {
    options = kEmptyObject;
  }

  if (callback != null) {
    validateFunction(callback, "callback");
  }

  // Validate argv0, if present.
  if (options.argv0 != null) {
    validateString(options.argv0, "options.argv0");
    validateArgumentNullCheck(options.argv0, "options.argv0");
  }

  return { file, args, options, callback };
}

function normalizeExecArgs(command, options, callback) {
  validateString(command, "command");
  validateArgumentNullCheck(command, "command");

  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }

  // Make a shallow copy so we don't clobber the user's options object.
  options = { ...options };
  options.shell = typeof options.shell === "string" ? options.shell : true;

  return {
    file: command,
    options: options,
    callback: callback,
  };
}

function normalizeSpawnArguments(file, args, options) {
  validateString(file, "file");
  validateArgumentNullCheck(file, "file");

  if (file.length === 0) throw ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");

  if ($isJSArray(args)) {
    args = ArrayPrototypeSlice.$call(args);
  } else if (args == null) {
    args = [];
  } else if (typeof args !== "object") {
    throw ERR_INVALID_ARG_TYPE("args", "object", args);
  } else {
    options = args;
    args = [];
  }

  validateArgumentsNullCheck(args, "args");

  if (options === undefined) options = {};
  else validateObject(options, "options");

  let cwd = options.cwd;

  // Validate the cwd, if present.
  if (cwd != null) {
    cwd = getValidatedPath(cwd, "options.cwd");
  }

  // Validate detached, if present.
  if (options.detached != null) {
    validateBoolean(options.detached, "options.detached");
  }

  // Validate the uid, if present.
  if (options.uid != null && !isInt32(options.uid)) {
    throw ERR_INVALID_ARG_TYPE("options.uid", "int32", options.uid);
  }

  // Validate the gid, if present.
  if (options.gid != null && !isInt32(options.gid)) {
    throw ERR_INVALID_ARG_TYPE("options.gid", "int32", options.gid);
  }

  // Validate the shell, if present.
  if (options.shell != null && typeof options.shell !== "boolean" && typeof options.shell !== "string") {
    throw ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], options.shell);
  }

  // Validate argv0, if present.
  if (options.argv0 != null) {
    validateString(options.argv0, "options.argv0");
    validateArgumentNullCheck(options.argv0, "options.argv0");
  }

  // Validate windowsHide, if present.
  if (options.windowsHide != null) {
    validateBoolean(options.windowsHide, "options.windowsHide");
  }

  let { windowsVerbatimArguments } = options;
  if (windowsVerbatimArguments != null) {
    validateBoolean(windowsVerbatimArguments, "options.windowsVerbatimArguments");
  }

  // Handle shell
  if (options.shell) {
    validateArgumentNullCheck(options.shell, "options.shell");
    const command = ArrayPrototypeJoin.$call([file, ...args], " ");
    // Set the shell, switches, and commands.
    if (process.platform === "win32") {
      if (typeof options.shell === "string") file = options.shell;
      else file = process.env.comspec || "cmd.exe";
      // '/d /s /c' is used only for cmd.exe.
      if (/^(?:.*\\)?cmd(?:\.exe)?$/i.exec(file) !== null) {
        args = ["/d", "/s", "/c", `"${command}"`];
        windowsVerbatimArguments = true;
      } else {
        args = ["-c", command];
      }
    } else {
      if (typeof options.shell === "string") file = options.shell;
      else if (process.platform === "android") file = "sh";
      else file = "/bin/sh";
      args = ["-c", command];
    }
  }

  // Handle argv0
  if (typeof options.argv0 === "string") {
    ArrayPrototypeUnshift.$call(args, options.argv0);
  } else {
    ArrayPrototypeUnshift.$call(args, file);
  }

  const env = options.env || process.env;
  const envPairs = env;

  // // process.env.NODE_V8_COVERAGE always propagates, making it possible to
  // // collect coverage for programs that spawn with white-listed environment.
  // copyProcessEnvToEnv(env, "NODE_V8_COVERAGE", options.env);

  // TODO: Windows env support here...

  return {
    // Make a shallow copy so we don't clobber the user's options object.
    __proto__: null,
    ...options,
    args,
    cwd,
    detached: !!options.detached,
    envPairs,
    file,
    windowsHide: !!options.windowsHide,
    windowsVerbatimArguments: !!windowsVerbatimArguments,
  };
}

function checkExecSyncError(ret, args, cmd?) {
  let err;
  if (ret.error) {
    err = ret.error;
    ObjectAssign(err, ret);
  } else if (ret.status !== 0) {
    let msg = "Command failed: ";
    msg += cmd || ArrayPrototypeJoin.$call(args, " ");
    if (ret.stderr && ret.stderr.length > 0) msg += `\n${ret.stderr.toString()}`;
    err = genericNodeError(msg, ret);
  }
  return err;
}

//------------------------------------------------------------------------------
// Section 3. ChildProcess class
//------------------------------------------------------------------------------
class ChildProcess extends EventEmitter {
  #handle;
  #closesNeeded = 1;
  #closesGot = 0;

  signalCode = null;
  exitCode = null;
  spawnfile;
  spawnargs;
  pid;
  channel;
  killed = false;

  [Symbol.dispose]() {
    if (!this.killed) {
      this.kill();
    }
  }

  #handleOnExit(exitCode, signalCode, err) {
    if (signalCode) {
      this.signalCode = signalCode;
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
        this.#stdout = this.#getBunSpawnIo(1, this.#encoding, true);
      } else if (stdout && this.#stdioOptions[1] === "pipe" && !stdout?.destroyed) {
        stdout.resume?.();
      }

      if (stderr === undefined) {
        this.#stderr = this.#getBunSpawnIo(2, this.#encoding, true);
      } else if (stderr && this.#stdioOptions[2] === "pipe" && !stderr?.destroyed) {
        stderr.resume?.();
      }
    }

    if (err) {
      if (this.spawnfile) err.path = this.spawnfile;
      err.spawnargs = ArrayPrototypeSlice.$call(this.spawnargs, 1);
      err.pid = this.pid;
      this.emit("error", err);
    } else if (exitCode < 0) {
      const err = new SystemError(
        `Spawned process exited with error code: ${exitCode}`,
        undefined,
        "spawn",
        "EUNKNOWN",
        "ERR_CHILD_PROCESS_UNKNOWN_ERROR",
      );
      err.pid = this.pid;

      if (this.spawnfile) err.path = this.spawnfile;

      err.spawnargs = ArrayPrototypeSlice.$call(this.spawnargs, 1);
      this.emit("error", err);
    }

    this.emit("exit", this.exitCode, this.signalCode);

    this.#maybeClose();
  }

  #getBunSpawnIo(i, encoding, autoResume = false) {
    if ($debug && !this.#handle) {
      if (this.#handle === null) {
        $debug("ChildProcess: getBunSpawnIo: this.#handle is null. This means the subprocess already exited");
      } else {
        $debug("ChildProcess: getBunSpawnIo: this.#handle is undefined");
      }
    }

    NativeWritable ||= StreamModule.NativeWritable;
    ReadableFromWeb ||= StreamModule.Readable.fromWeb;

    const io = this.#stdioOptions[i];
    switch (i) {
      case 0: {
        switch (io) {
          case "pipe": {
            const stdin = this.#handle.stdin;

            if (!stdin)
              // This can happen if the process was already killed.
              return new ShimmedStdin();

            return new NativeWritable(stdin);
          }
          case "inherit":
            return process.stdin || null;
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
            const value = this.#handle[fdToStdioName(i)];

            if (!value)
              // This can happen if the process was already killed.
              return new ShimmedStdioOutStream();

            const pipe = ReadableFromWeb(value, { encoding });
            this.#closesNeeded++;
            pipe.once("close", () => this.#maybeClose());
            if (autoResume) pipe.resume();
            return pipe;
          }
          case "inherit":
            return process[fdToStdioName(i)] || null;
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
            const fd = this.#handle.stdio[i];
            if (!fd) return null;
            return new NetModule.connect({ fd });
        }
        return null;
    }
  }

  #stdin;
  #stdout;
  #stderr;
  #stdioObject;
  #encoding;
  #stdioOptions;

  #createStdioObject() {
    const opts = this.#stdioOptions;
    const length = opts.length;
    let result = new Array(length);
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
    return result;
  }

  get stdin() {
    return (this.#stdin ??= this.#getBunSpawnIo(0, this.#encoding, false));
  }

  get stdout() {
    return (this.#stdout ??= this.#getBunSpawnIo(1, this.#encoding, false));
  }

  get stderr() {
    return (this.#stderr ??= this.#getBunSpawnIo(2, this.#encoding, false));
  }

  get stdio() {
    return (this.#stdioObject ??= this.#createStdioObject());
  }

  get connected() {
    const handle = this.#handle;
    if (handle === null) return false;
    return handle.connected ?? false;
  }

  get [kHandle]() {
    return this.#handle;
  }

  spawn(options) {
    validateObject(options, "options");

    validateOneOf(options.serialization, "options.serialization", [undefined, "json", "advanced"]);
    const serialization = options.serialization || "json";

    validateString(options.file, "options.file");
    // NOTE: This is confusing... So node allows you to pass a file name
    // But also allows you to pass a command in the args and it should execute
    // To add another layer of confusion, they also give the option to pass an explicit "argv0"
    // which overrides the actual command of the spawned process...
    var file;
    file = this.spawnfile = options.file;

    var spawnargs;
    if (options.args == null) {
      spawnargs = this.spawnargs = [];
    } else {
      validateArray(options.args, "options.args");
      spawnargs = this.spawnargs = options.args;
    }

    const stdio = options.stdio || ["pipe", "pipe", "pipe"];
    const bunStdio = getBunStdioFromOptions(stdio);
    const argv0 = file || options.argv0;

    const has_ipc = $isJSArray(stdio) && stdio[3] === "ipc";
    var env = options.envPairs || process.env;

    const detachedOption = options.detached;
    this.#encoding = options.encoding || undefined;
    this.#stdioOptions = bunStdio;
    const stdioCount = stdio.length;
    const hasSocketsToEagerlyLoad = stdioCount >= 3;

    this.#handle = Bun.spawn({
      cmd: spawnargs,
      stdio: bunStdio,
      cwd: options.cwd || undefined,
      env: env,
      detached: typeof detachedOption !== "undefined" ? !!detachedOption : false,
      onExit: (handle, exitCode, signalCode, err) => {
        if (hasSocketsToEagerlyLoad) {
          this.stdio;
        }
        $debug("ChildProcess: onExit", exitCode, signalCode, err, this.pid);
        this.#handle = handle;
        this.pid = this.#handle.pid;

        process.nextTick(
          (exitCode, signalCode, err) => this.#handleOnExit(exitCode, signalCode, err),
          exitCode,
          signalCode,
          err,
        );
      },
      lazy: true,
      ipc: has_ipc ? this.#emitIpcMessage.bind(this) : undefined,
      onDisconnect: has_ipc ? ok => this.#disconnect(ok) : undefined,
      serialization,
      argv0,
      windowsHide: !!options.windowsHide,
      windowsVerbatimArguments: !!options.windowsVerbatimArguments,
    });
    this.pid = this.#handle.pid;

    $debug("ChildProcess: spawn", this.pid, spawnargs);

    onSpawnNT(this);

    if (has_ipc) {
      this.send = this.#send;
      this.disconnect = this.#disconnect;
      if (options[kFromNode]) this.#closesNeeded += 1;
    }

    if (hasSocketsToEagerlyLoad) {
      for (let item of this.stdio) {
        item?.ref?.();
      }
    }
  }

  #emitIpcMessage(message) {
    this.emit("message", message);
  }

  #send(message, handle, options, callback) {
    if (typeof handle === "function") {
      callback = handle;
      handle = undefined;
      options = undefined;
    } else if (typeof options === "function") {
      callback = options;
      options = undefined;
    } else if (options !== undefined) {
      if (typeof options !== "object" || options === null) {
        throw ERR_INVALID_ARG_TYPE("options", "Object", options);
      }
    }

    if (!this.#handle) {
      if (callback) {
        process.nextTick(callback, new TypeError("Process was closed while trying to send message"));
      } else {
        this.emit("error", new TypeError("Process was closed while trying to send message"));
      }
      return false;
    }

    // Bun does not handle handles yet
    try {
      this.#handle.send(message);
      if (callback) process.nextTick(callback);
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

  #disconnect(ok) {
    if (ok == null) {
      $assert(this.connected);
      this.#handle.disconnect();
    } else if (!ok) {
      this.emit("error", ERR_IPC_DISCONNECTED());
      return;
    }
    this.#handle.disconnect();
    $assert(!this.connected);
    process.nextTick(() => this.emit("disconnect"));
    this.#maybeClose();
  }

  kill(sig?) {
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

function nodeToBun(item, index) {
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
    if (Object.hasOwn(item, "fd") && typeof item.fd === "number") return item.fd;
    throw new Error(`TODO: stream.Readable stdio @ ${index}`);
  }
  if (isNodeStreamWritable(item)) {
    if (Object.hasOwn(item, "fd") && typeof item.fd === "number") return item.fd;
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
function isNodeStreamReadable(item) {
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
function isNodeStreamWritable(item) {
  if (typeof item !== "object") return false;
  if (!item) return false;
  if (typeof item.on !== "function") return false;
  if (typeof item.write !== "function") return false;
  return true;
}

function fdToStdioName(fd) {
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

function getBunStdioFromOptions(stdio) {
  const normalizedStdio = normalizeStdio(stdio);
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

function normalizeStdio(stdio) {
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

    let processedStdio;
    if (stdio.length === 0) processedStdio = ["pipe", "pipe", "pipe"];
    else if (stdio.length === 1) processedStdio = [stdio[0], "pipe", "pipe"];
    else if (stdio.length === 2) processedStdio = [stdio[0], stdio[1], "pipe"];
    else if (stdio.length >= 3) processedStdio = stdio;

    return processedStdio;
  } else {
    throw ERR_INVALID_OPT_VALUE("stdio", stdio);
  }
}

function onSpawnNT(self) {
  self.emit("spawn");
}

function abortChildProcess(child, killSignal, reason) {
  if (!child) return;
  try {
    if (child.kill(killSignal)) {
      child.emit("error", new AbortError(undefined, { cause: reason }));
    }
  } catch (err) {
    child.emit("error", err);
  }
}

class ShimmedStdin extends EventEmitter {
  constructor() {
    super();
  }
  write() {
    return false;
  }
  destroy() {}
  end() {
    return this;
  }
  pipe() {
    return this;
  }
  resume() {
    return this;
  }
}

class ShimmedStdioOutStream extends EventEmitter {
  pipe() {}
  get destroyed() {
    return true;
  }

  resume() {
    return this;
  }

  destroy() {
    return this;
  }
}

//------------------------------------------------------------------------------
// Section 5. Validators
//------------------------------------------------------------------------------

function validateMaxBuffer(maxBuffer) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }
}

function validateArgumentNullCheck(arg, propName) {
  if (typeof arg === "string" && StringPrototypeIncludes.$call(arg, "\u0000")) {
    throw ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
  }
}

function validateArgumentsNullCheck(args, propName) {
  for (let i = 0; i < args.length; ++i) {
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
  }
}

function validateTimeout(timeout) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0)) {
    throw ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
}

function validateBoolean(value, name) {
  if (typeof value !== "boolean") throw ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

/**
 * @callback validateFunction
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is Function}
 */

/** @type {validateFunction} */
function validateFunction(value, name) {
  if (typeof value !== "function") throw ERR_INVALID_ARG_TYPE(name, "Function", value);
}

/**
 * @callback validateAbortSignal
 * @param {*} signal
 * @param {string} name
 */

/** @type {validateAbortSignal} */
const validateAbortSignal = (signal, name) => {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};

/**
 * @callback validateOneOf
 * @template T
 * @param {T} value
 * @param {string} name
 * @param {T[]} oneOf
 */

/** @type {validateOneOf} */
const validateOneOf = (value, name, oneOf) => {
  // const validateOneOf = hideStackFrames((value, name, oneOf) => {
  if (!ArrayPrototypeIncludes.$call(oneOf, value)) {
    const allowed = ArrayPrototypeJoin.$call(
      ArrayPrototypeMap.$call(oneOf, v => (typeof v === "string" ? `'${v}'` : String(v))),
      ", ",
    );
    const reason = "must be one of: " + allowed;
    throw ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};

/**
 * @callback validateObject
 * @param {*} value
 * @param {string} name
 * @param {{
 *   allowArray?: boolean,
 *   allowFunction?: boolean,
 *   nullable?: boolean
 * }} [options]
 */

/** @type {validateObject} */
const validateObject = (value, name, options = null) => {
  // const validateObject = hideStackFrames((value, name, options = null) => {
  const allowArray = options?.allowArray ?? false;
  const allowFunction = options?.allowFunction ?? false;
  const nullable = options?.nullable ?? false;
  if (
    (!nullable && value === null) ||
    (!allowArray && $isJSArray(value)) ||
    (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
  ) {
    throw ERR_INVALID_ARG_TYPE(name, "object", value);
  }
};

/**
 * @callback validateArray
 * @param {*} value
 * @param {string} name
 * @param {number} [minLength]
 * @returns {asserts value is any[]}
 */

/** @type {validateArray} */
const validateArray = (value, name, minLength = 0) => {
  // const validateArray = hideStackFrames((value, name, minLength = 0) => {
  if (!$isJSArray(value)) {
    throw ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    const reason = `must be longer than ${minLength}`;
    throw ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};

/**
 * @callback validateString
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is string}
 */

/** @type {validateString} */
function validateString(value, name) {
  if (typeof value !== "string") throw ERR_INVALID_ARG_TYPE(name, "string", value);
}

function isInt32(value) {
  return value === (value | 0);
}

function nullCheck(path, propName, throwError = true) {
  const pathIsString = typeof path === "string";
  const pathIsUint8Array = isUint8Array(path);

  // We can only perform meaningful checks on strings and Uint8Arrays.
  if (
    (!pathIsString && !pathIsUint8Array) ||
    (pathIsString && !StringPrototypeIncludes.$call(path, "\u0000")) ||
    (pathIsUint8Array && !Uint8ArrayPrototypeIncludes.$call(path, 0))
  ) {
    return;
  }

  const err = ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError) {
    throw err;
  }
  return err;
}

function validatePath(path, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path)) {
    throw ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
  }

  const err = nullCheck(path, propName, false);

  if (err !== undefined) {
    throw err;
  }
}

function getValidatedPath(fileURLOrPath, propName = "path") {
  const path = toPathIfFileURL(fileURLOrPath);
  validatePath(path, propName);
  return path;
}

function isUint8Array(value) {
  return typeof value === "object" && value !== null && value instanceof Uint8Array;
}

//------------------------------------------------------------------------------
// Section 6. Random utilities
//------------------------------------------------------------------------------

function isURLInstance(fileURLOrPath) {
  return fileURLOrPath != null && fileURLOrPath.href && fileURLOrPath.origin;
}

function toPathIfFileURL(fileURLOrPath) {
  if (!isURLInstance(fileURLOrPath)) return fileURLOrPath;
  return Bun.fileURLToPath(fileURLOrPath);
}

//------------------------------------------------------------------------------
// Section 7. Node errors / error polyfills
//------------------------------------------------------------------------------
var Error = globalThis.Error;
var TypeError = globalThis.TypeError;
var RangeError = globalThis.RangeError;

// Node uses a slightly different abort error than standard DOM. See: https://github.com/nodejs/node/blob/main/lib/internal/errors.js
class AbortError extends Error {
  code = "ABORT_ERR";
  name = "AbortError";
  constructor(message = "The operation was aborted", options = undefined) {
    if (options !== undefined && typeof options !== "object") {
      throw ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    super(message, options);
  }
}

function genericNodeError(message, options) {
  const err = new Error(message);
  err.code = options.code;
  err.killed = options.killed;
  err.signal = options.signal;
  return err;
}

// const messages = new Map();

// Utility function for registering the error codes. Only used here. Exported
// *only* to allow for testing.
// function E(sym, val, def) {
//   messages.set(sym, val);
//   def = makeNodeErrorWithCode(def, sym);
//   errorCodes[sym] = def;
// }

// function makeNodeErrorWithCode(Base, key) {
//   return function NodeError(...args) {
//     // const limit = Error.stackTraceLimit;
//     // if (isErrorStackTraceLimitWritable()) Error.stackTraceLimit = 0;
//     const error = new Base();
//     // Reset the limit and setting the name property.
//     // if (isErrorStackTraceLimitWritable()) Error.stackTraceLimit = limit;
//     const message = getMessage(key, args);
//     error.message = message;
//     // captureLargerStackTrace(error);
//     error.code = key;
//     return error;
//   };
// }

// function getMessage(key, args) {
//   const msgFn = messages.get(key);
//   if (args.length !== msgFn.length)
//     throw new Error(
//       `Invalid number of args for error message ${key}. Got ${args.length}, expected ${msgFn.length}.`
//     );
//   return msgFn(...args);
// }

// E(
//   "ERR_INVALID_ARG_TYPE",
//   (name, expected, actual) => {
//     assert(typeof name === "string", "'name' must be a string");
//     if (!$isJSArray(expected)) {
//       expected = [expected];
//     }

//     let msg = "The ";
//     if (StringPrototypeEndsWith(name, " argument")) {
//       // For cases like 'first argument'
//       msg += `${name} `;
//     } else {
//       const type = StringPrototypeIncludes(name, ".") ? "property" : "argument";
//       msg += `"${name}" ${type} `;
//     }
//     msg += "must be ";

//     const types = [];
//     const instances = [];
//     const other = [];

//     for (const value of expected) {
//       assert(
//         typeof value === "string",
//         "All expected entries have to be of type string"
//       );
//       if (ArrayPrototypeIncludes.$call(kTypes, value)) {
//         ArrayPrototypePush(types, StringPrototypeToLowerCase(value));
//       } else if (RegExpPrototypeExec(classRegExp, value) !== null) {
//         ArrayPrototypePush(instances, value);
//       } else {
//         assert(
//           value !== "object",
//           'The value "object" should be written as "Object"'
//         );
//         ArrayPrototypePush(other, value);
//       }
//     }

//     // Special handle `object` in case other instances are allowed to outline
//     // the differences between each other.
//     if (instances.length > 0) {
//       const pos = ArrayPrototypeIndexOf(types, "object");
//       if (pos !== -1) {
//         ArrayPrototypeSplice.$call(types, pos, 1);
//         $arrayPush(instances, "Object");
//       }
//     }

//     if (types.length > 0) {
//       if (types.length > 2) {
//         const last = ArrayPrototypePop(types);
//         msg += `one of type ${ArrayPrototypeJoin(types, ", ")}, or ${last}`;
//       } else if (types.length === 2) {
//         msg += `one of type ${types[0]} or ${types[1]}`;
//       } else {
//         msg += `of type ${types[0]}`;
//       }
//       if (instances.length > 0 || other.length > 0) msg += " or ";
//     }

//     if (instances.length > 0) {
//       if (instances.length > 2) {
//         const last = ArrayPrototypePop(instances);
//         msg += `an instance of ${ArrayPrototypeJoin(
//           instances,
//           ", "
//         )}, or ${last}`;
//       } else {
//         msg += `an instance of ${instances[0]}`;
//         if (instances.length === 2) {
//           msg += ` or ${instances[1]}`;
//         }
//       }
//       if (other.length > 0) msg += " or ";
//     }

//     if (other.length > 0) {
//       if (other.length > 2) {
//         const last = ArrayPrototypePop(other);
//         msg += `one of ${ArrayPrototypeJoin.$call(other, ", ")}, or ${last}`;
//       } else if (other.length === 2) {
//         msg += `one of ${other[0]} or ${other[1]}`;
//       } else {
//         if (StringPrototypeToLowerCase(other[0]) !== other[0]) msg += "an ";
//         msg += `${other[0]}`;
//       }
//     }

//     msg += `. Received ${determineSpecificType(actual)}`;

//     return msg;
//   },
//   TypeError
// );

function ERR_OUT_OF_RANGE(str, range, input, replaceDefaultBoolean = false) {
  // Node implementation:
  // assert(range, 'Missing "range" argument');
  // let msg = replaceDefaultBoolean
  //   ? str
  //   : `The value of "${str}" is out of range.`;
  // let received;
  // if (NumberIsInteger(input) && MathAbs(input) > 2 ** 32) {
  //   received = addNumericalSeparator(String(input));
  // } else if (typeof input === "bigint") {
  //   received = String(input);
  //   if (input > 2n ** 32n || input < -(2n ** 32n)) {
  //     received = addNumericalSeparator(received);
  //   }
  //   received += "n";
  // } else {
  //   received = lazyInternalUtilInspect().inspect(input);
  // }
  // msg += ` It must be ${range}. Received ${received}`;
  // return new RangeError(msg);
  return new RangeError(`The value of ${str} is out of range. It must be ${range}. Received ${input}`);
}

function ERR_CHILD_PROCESS_STDIO_MAXBUFFER(stdio) {
  const err = Error(`${stdio} maxBuffer length exceeded`);
  err.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  return err;
}

function ERR_UNKNOWN_SIGNAL(name) {
  const err = new TypeError(`Unknown signal: ${name}`);
  err.code = "ERR_UNKNOWN_SIGNAL";
  return err;
}

function ERR_INVALID_OPT_VALUE(name, value) {
  const err = new TypeError(`The value "${value}" is invalid for option "${name}"`);
  err.code = "ERR_INVALID_OPT_VALUE";
  return err;
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  const err = new Error(`The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`);
  err.code = "ERR_INVALID_ARG_VALUE";
  return err;
}

function ERR_CHILD_PROCESS_IPC_REQUIRED(name) {
  const err = new TypeError(`Forked processes must have an IPC channel, missing value 'ipc' in ${name}`);
  err.code = "ERR_CHILD_PROCESS_IPC_REQUIRED";
  return err;
}

class SystemError extends Error {
  path;
  syscall;
  errno;
  code;
  constructor(message, path, syscall, errno, code) {
    super(message);
    this.path = path;
    this.syscall = syscall;
    this.errno = errno;
    this.code = code;
  }

  get name() {
    return "SystemError";
  }
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
