// Hardcoded module "node:child_process"
const EventEmitter = import.meta.require("node:events");
const {
  Readable: { fromWeb: ReadableFromWeb },
  NativeWritable,
} = import.meta.require("node:stream");
const {
  constants: { signals },
} = import.meta.require("node:os");
const { promisify } = import.meta.require("node:util");

const { ArrayBuffer, Uint8Array, String, Object, Buffer, Promise } = import.meta.primordials;

var ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
var ObjectCreate = Object.create;
var ObjectAssign = Object.assign;
var ObjectDefineProperty = Object.defineProperty;
var BufferConcat = Buffer.concat;
var BufferIsEncoding = Buffer.isEncoding;

var kEmptyObject = ObjectCreate(null);

var ArrayPrototypePush = Array.prototype.push;
var ArrayPrototypeReduce = Array.prototype.reduce;
var ArrayPrototypeFilter = Array.prototype.filter;
var ArrayPrototypeJoin = Array.prototype.join;
var ArrayPrototypeMap = Array.prototype.map;
var ArrayPrototypeIncludes = Array.prototype.includes;
var ArrayPrototypeSlice = Array.prototype.slice;
var ArrayPrototypeUnshift = Array.prototype.unshift;
var ArrayIsArray = Array.isArray;

// var ArrayBuffer = ArrayBuffer;
var ArrayBufferIsView = ArrayBuffer.isView;

var NumberIsInteger = Number.isInteger;
var MathAbs = Math.abs;

var StringPrototypeToUpperCase = String.prototype.toUpperCase;
var StringPrototypeIncludes = String.prototype.includes;
var StringPrototypeSlice = String.prototype.slice;
var Uint8ArrayPrototypeIncludes = Uint8Array.prototype.includes;

const MAX_BUFFER = 1024 * 1024;

// General debug vs tracking stdio streams. Useful for stream debugging in particular
const __DEBUG__ = process.env.DEBUG || false;

// You can use this env var along with `process.env.DEBUG_TRACK_EE` to debug stdio streams
// Just set `DEBUG_TRACK_EE=PARENT_STDOUT-0, PARENT_STDOUT-1`, etc. and `DEBUG_STDIO=1` and you will be able to track particular stdio streams
// TODO: Add ability to track a range of IDs rather than just enumerated ones
const __TRACK_STDIO__ = process.env.DEBUG_STDIO;
const debug = __DEBUG__ ? console.log : () => {};

if (__TRACK_STDIO__) {
  debug("child_process: debug mode on");
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
// detached <boolean> Prepare child to run independently of its parent process. Specific behavior depends on the platform, see options.detached).

// TODO: After IPC channels can be opened
// serialization <string> Specify the kind of serialization used for sending messages between processes. Possible values are 'json' and 'advanced'. See Advanced serialization for more details. Default: 'json'.

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

// TODO: Implement these props when Windows is supported
// *   windowsVerbatimArguments?: boolean;
// *   windowsHide?: boolean;

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

function spawnTimeoutFunction(child, timeoutHolder) {
  var timeoutId = timeoutHolder.timeoutId;
  if (timeoutId > -1) {
    try {
      child.kill(killSignal);
    } catch (err) {
      child.emit("error", err);
    }
    timeoutHolder.timeoutId = -1;
  }
}
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
 *   signal?: AbortSignal;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   }} [options]
 * @returns {ChildProcess}
 */
export function spawn(file, args, options) {
  options = normalizeSpawnArguments(file, args, options);
  validateTimeout(options.timeout);
  validateAbortSignal(options.signal, "options.signal");
  const killSignal = sanitizeKillSignal(options.killSignal);
  const child = new ChildProcess();

  debug("spawn", options);
  child.spawn(options);

  if (options.timeout > 0) {
    let timeoutId = setTimeout(() => {
      if (timeoutId) {
        try {
          child.kill(killSignal);
        } catch (err) {
          child.emit("error", err);
        }
        timeoutId = null;
      }
    });

    child.once("exit", () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    });
  }

  if (options.signal) {
    const signal = options.signal;
    if (signal.aborted) {
      process.nextTick(onAbortListener);
    } else {
      signal.addEventListener("abort", onAbortListener, { once: true });
      child.once("exit", () => signal.removeEventListener("abort", onAbortListener));
    }

    function onAbortListener() {
      abortChildProcess(child, killSignal);
    }
  }
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
export function execFile(file, args, options, callback) {
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
    // gid: options.gid,
    shell: options.shell,
    signal: options.signal,
    // uid: options.uid,
  });

  let encoding;
  const _stdout = [];
  const _stderr = [];
  if (options.encoding !== "buffer" && BufferIsEncoding(options.encoding)) {
    encoding = options.encoding;
  } else {
    encoding = null;
  }
  let stdoutLen = 0;
  let stderrLen = 0;
  let killed = false;
  let exited = false;
  let timeoutId;
  let encodedStdoutLen;
  let encodedStderrLen;

  let ex = null;

  let cmd = file;

  function exitHandler(code, signal) {
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
      stdout = ArrayPrototypeJoin.call(_stdout, "");
    } else {
      stdout = BufferConcat(_stdout);
    }
    if (encoding || (child.stderr && readableEncoding)) {
      stderr = ArrayPrototypeJoin.call(_stderr, "");
    } else {
      stderr = BufferConcat(_stderr);
    }

    if (!ex && code === 0 && signal === null) {
      callback(null, stdout, stderr);
      return;
    }

    if (args?.length) cmd += ` ${ArrayPrototypeJoin.call(args, " ")}`;
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

    if (child.stdout) child.stdout.destroy();
    if (child.stderr) child.stderr.destroy();

    exitHandler();
  }

  function kill() {
    if (child.stdout) child.stdout.destroy();
    if (child.stderr) child.stderr.destroy();

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
      kill();
      timeoutId = null;
    }, options.timeout);
  }

  if (child.stdout) {
    if (encoding) child.stdout.setEncoding(encoding);

    child.stdout.on(
      "data",
      maxBuffer === Infinity
        ? function onUnlimitedSizeBufferedData(chunk) {
            ArrayPrototypePush.call(_stdout, chunk);
          }
        : encoding
        ? function onChildStdoutEncoded(chunk) {
            stdoutLen += chunk.length;

            if (stdoutLen * 4 > maxBuffer) {
              const encoding = child.stdout.readableEncoding;
              const actualLen = Buffer.byteLength(chunk, encoding);
              if (encodedStdoutLen === undefined) {
                for (let i = 0; i < _stdout.length; i++) {
                  encodedStdoutLen += Buffer.byteLength(_stdout[i], encoding);
                }
              } else {
                encodedStdoutLen += actualLen;
              }
              const truncatedLen = maxBuffer - (encodedStdoutLen - actualLen);
              ArrayPrototypePush.call(_stdout, StringPrototypeSlice.apply(chunk, 0, truncatedLen));

              ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout");
              kill();
            } else {
              ArrayPrototypePush.call(_stdout, chunk);
            }
          }
        : function onChildStdoutRaw(chunk) {
            stdoutLen += chunk.length;

            if (stdoutLen > maxBuffer) {
              const truncatedLen = maxBuffer - (stdoutLen - chunk.length);
              ArrayPrototypePush.call(_stdout, chunk.slice(0, truncatedLen));

              ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout");
              kill();
            } else {
              ArrayPrototypePush.call(_stdout, chunk);
            }
          },
    );
  }

  if (child.stderr) {
    if (encoding) child.stderr.setEncoding(encoding);

    child.stderr.on(
      "data",
      maxBuffer === Infinity
        ? function onUnlimitedSizeBufferedData(chunk) {
            ArrayPrototypePush.call(_stderr, chunk);
          }
        : encoding
        ? function onChildStderrEncoded(chunk) {
            stderrLen += chunk.length;

            if (stderrLen * 4 > maxBuffer) {
              const encoding = child.stderr.readableEncoding;
              const actualLen = Buffer.byteLength(chunk, encoding);
              if (encodedStderrLen === undefined) {
                for (let i = 0; i < _stderr.length; i++) {
                  encodedStderrLen += Buffer.byteLength(_stderr[i], encoding);
                }
              } else {
                encodedStderrLen += actualLen;
              }
              const truncatedLen = maxBuffer - (encodedStderrLen - actualLen);
              ArrayPrototypePush.call(_stderr, StringPrototypeSlice.call(chunk, 0, truncatedLen));

              ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr");
              kill();
            } else {
              ArrayPrototypePush.call(_stderr, chunk);
            }
          }
        : function onChildStderrRaw(chunk) {
            stderrLen += chunk.length;

            if (stderrLen > maxBuffer) {
              const truncatedLen = maxBuffer - (stderrLen - chunk.length);
              ArrayPrototypePush.call(_stderr, StringPrototypeSlice.call(chunk, 0, truncatedLen));

              ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr");
              kill();
            } else {
              ArrayPrototypePush.call(_stderr, chunk);
            }
          },
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
 *   }} [options]
 * @param {(
 *   error?: Error,
 *   stdout?: string | Buffer,
 *   stderr?: string | Buffer
 *   ) => any} [callback]
 * @returns {ChildProcess}
 */
export function exec(command, options, callback) {
  const opts = normalizeExecArgs(command, options, callback);
  return execFile(opts.file, opts.options, opts.callback);
}

const customPromiseExecFunction = orig => {
  return (...args) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

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

ObjectDefineProperty(exec, promisify.custom, {
  __proto__: null,
  enumerable: false,
  value: customPromiseExecFunction(exec),
});

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
export function spawnSync(file, args, options) {
  options = {
    maxBuffer: MAX_BUFFER,
    ...normalizeSpawnArguments(file, args, options),
  };

  const maxBuffer = options.maxBuffer;
  const encoding = options.encoding;

  debug("spawnSync", options);

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
      throw new ERR_INVALID_ARG_TYPE(`options.stdio[0]`, ["Buffer", "TypedArray", "DataView", "string"], input);
    }
  }

  const { stdout, stderr, success, exitCode } = Bun.spawnSync({
    cmd: options.args,
    env: options.env || undefined,
    cwd: options.cwd || undefined,
    stdin: bunStdio[0],
    stdout: bunStdio[1],
    stderr: bunStdio[2],
  });

  const result = {
    signal: null,
    status: exitCode,
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
    result.error.spawnargs = ArrayPrototypeSlice.call(options.args, 1);
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
export function execFileSync(file, args, options) {
  ({ file, args, options } = normalizeExecFileArgs(file, args, options));

  // const inheritStderr = !options.stdio;
  const ret = spawnSync(file, args, options);

  // if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr);

  const errArgs = [options.argv0 || file];
  ArrayPrototypePush.apply(errArgs, args);
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
export function execSync(command, options) {
  const opts = normalizeExecArgs(command, options, null);
  // const inheritStderr = !opts.options.stdio;

  const ret = spawnSync(opts.file, opts.options);

  // if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr); // TODO: Uncomment when we have process.stderr

  const err = checkExecSyncError(ret, undefined, command);

  if (err) throw err;

  return ret.stdout;
}

export function fork() {
  throw new Error("Not implemented");
}

//------------------------------------------------------------------------------
// Section 2. child_process helpers
//------------------------------------------------------------------------------
function convertToValidSignal(signal) {
  if (typeof signal === "number" && getSignalsToNamesMapping()[signal]) return signal;

  if (typeof signal === "string") {
    const signalName = signals[StringPrototypeToUpperCase.call(signal)];
    if (signalName) return signalName;
  }

  throw new ERR_UNKNOWN_SIGNAL(signal);
}

function sanitizeKillSignal(killSignal) {
  if (typeof killSignal === "string" || typeof killSignal === "number") {
    return convertToValidSignal(killSignal);
  } else if (killSignal != null) {
    throw new ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal);
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
  if (ArrayIsArray(args)) {
    args = ArrayPrototypeSlice.call(args);
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

  if (file.length === 0) throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");

  if (ArrayIsArray(args)) {
    args = ArrayPrototypeSlice.call(args);
  } else if (args == null) {
    args = [];
  } else if (typeof args !== "object") {
    throw new ERR_INVALID_ARG_TYPE("args", "object", args);
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

  // TODO: Detached check
  // TODO: Gid check
  // TODO: Uid check

  // Validate the shell, if present.
  if (options.shell != null && typeof options.shell !== "boolean" && typeof options.shell !== "string") {
    throw new ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], options.shell);
  }

  // Validate argv0, if present.
  if (options.argv0 != null) {
    validateString(options.argv0, "options.argv0");
    validateArgumentNullCheck(options.argv0, "options.argv0");
  }

  // TODO: Windows checks for Windows specific options

  // Handle shell
  if (options.shell) {
    validateArgumentNullCheck(options.shell, "options.shell");
    const command = ArrayPrototypeJoin.call([file, ...args], " ");
    // TODO: Windows moment
    // Set the shell, switches, and commands.
    // if (process.platform === "win32") {
    //   if (typeof options.shell === "string") file = options.shell;
    //   else file = process.env.comspec || "cmd.exe";
    //   // '/d /s /c' is used only for cmd.exe.
    //   if (RegExpPrototypeExec(/^(?:.*\\)?cmd(?:\.exe)?$/i, file) !== null) {
    //     args = ["/d", "/s", "/c", `"${command}"`];
    //     windowsVerbatimArguments = true;
    //   } else {
    //     args = ["-c", command];
    //   }
    // } else {
    if (typeof options.shell === "string") file = options.shell;
    else if (process.platform === "android") file = "sh";
    else file = "sh";
    args = ["-c", command];
    // }
  }

  // Handle argv0
  if (typeof options.argv0 === "string") {
    ArrayPrototypeUnshift.call(args, options.argv0);
  } else {
    ArrayPrototypeUnshift.call(args, file);
  }

  const env = options.env || process.env;
  const envPairs = env;

  // // process.env.NODE_V8_COVERAGE always propagates, making it possible to
  // // collect coverage for programs that spawn with white-listed environment.
  // copyProcessEnvToEnv(env, "NODE_V8_COVERAGE", options.env);

  // TODO: Windows env support here...

  return { ...options, file, args, cwd, envPairs };
}

function checkExecSyncError(ret, args, cmd) {
  let err;
  if (ret.error) {
    err = ret.error;
    ObjectAssign(err, ret);
  } else if (ret.status !== 0) {
    let msg = "Command failed: ";
    msg += cmd || ArrayPrototypeJoin.call(args, " ");
    if (ret.stderr && ret.stderr.length > 0) msg += `\n${ret.stderr.toString()}`;
    err = genericNodeError(msg, ret);
  }
  return err;
}

//------------------------------------------------------------------------------
// Section 3. ChildProcess class
//------------------------------------------------------------------------------
export class ChildProcess extends EventEmitter {
  #handle;
  #exited = false;
  #closesNeeded = 1;
  #closesGot = 0;

  connected = false;
  signalCode = null;
  exitCode = null;
  spawnfile;
  spawnargs;
  pid;
  channel;

  get killed() {
    if (this.#handle == null) return false;
  }

  // constructor(options) {
  //   super(options);
  //   this.#handle[owner_symbol] = this;
  // }

  #handleOnExit(exitCode, signalCode, err) {
    if (this.#exited) return;
    this.exitCode = this.#handle.exitCode;
    this.signalCode = exitCode > 0 ? signalCode : null;

    if (this.#stdin) {
      this.#stdin.destroy();
    }

    if (this.#handle) {
      this.#handle = null;
    }

    if (exitCode < 0) {
      const err = new SystemError(
        `Spawned process exited with error code: ${exitCode}`,
        undefined,
        "spawn",
        "EUNKNOWN",
        "ERR_CHILD_PROCESS_UNKNOWN_ERROR",
      );

      if (this.spawnfile) err.path = this.spawnfile;

      err.spawnargs = ArrayPrototypeSlice.call(this.spawnargs, 1);
      this.emit("error", err);
    } else {
      this.emit("exit", this.exitCode, this.signalCode);
    }

    // If any of the stdio streams have not been touched,
    // then pull all the data through so that it can get the
    // eof and emit a 'close' event.
    // Do it on nextTick so that the user has one last chance
    // to consume the output, if for example they only want to
    // start reading the data once the process exits.
    process.nextTick(flushStdio, this);

    this.#maybeClose();
    this.#exited = true;
    this.#stdioOptions = ["destroyed", "destroyed", "destroyed"];
  }

  #getBunSpawnIo(i, encoding) {
    if (__DEBUG__ && !this.#handle) {
      if (this.#handle === null) {
        debug("ChildProcess: getBunSpawnIo: this.#handle is null. This means the subprocess already exited");
      } else {
        debug("ChildProcess: getBunSpawnIo: this.#handle is undefined");
      }
    }
    const io = this.#stdioOptions[i];
    switch (i) {
      case 0: {
        switch (io) {
          case "pipe":
            return new NativeWritable(this.#handle.stdin);
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
          case "pipe":
            return ReadableFromWeb(
              this.#handle[fdToStdioName(i)],
              __TRACK_STDIO__
                ? {
                    encoding,
                    __id: `PARENT_${fdToStdioName(i).toUpperCase()}-${globalThis.__getId()}`,
                  }
                : { encoding },
            );
          case "inherit":
            return process[fdToStdioName(i)] || null;
          case "destroyed":
            return new ShimmedStdioOutStream();
          default:
            return null;
        }
      }
    }
  }

  #stdin;
  #stdout;
  #stderr;
  #stdioObject;
  #encoding;
  #stdioOptions;

  #createStdioObject() {
    return Object.create(null, {
      0: {
        get: () => this.stdin,
      },
      1: {
        get: () => this.stdout,
      },
      2: {
        get: () => this.stderr,
      },
    });
  }

  get stdin() {
    return (this.#stdin ??= this.#getBunSpawnIo(0, this.#encoding));
  }

  get stdout() {
    return (this.#stdout ??= this.#getBunSpawnIo(1, this.#encoding));
  }

  get stderr() {
    return (this.#stderr ??= this.#getBunSpawnIo(2, this.#encoding));
  }

  get stdio() {
    return (this.#stdioObject ??= this.#createStdioObject());
  }

  spawn(options) {
    validateObject(options, "options");

    // validateOneOf(options.serialization, "options.serialization", [
    //   undefined,
    //   "json",
    //   // "advanced", // TODO
    // ]);
    // const serialization = options.serialization || "json";

    // if (ipc !== undefined) {
    //   // Let child process know about opened IPC channel
    //   if (options.envPairs === undefined) options.envPairs = [];
    //   else validateArray(options.envPairs, "options.envPairs");

    //   ArrayPrototypePush.call(options.envPairs, `NODE_CHANNEL_FD=${ipcFd}`);
    //   ArrayPrototypePush.call(
    //     options.envPairs,
    //     `NODE_CHANNEL_SERIALIZATION_MODE=${serialization}`
    //   );
    // }

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

    var env = options.envPairs || undefined;

    this.#encoding = options.encoding || undefined;
    this.#stdioOptions = bunStdio;
    this.#handle = Bun.spawn({
      cmd: spawnargs,
      stdin: bunStdio[0],
      stdout: bunStdio[1],
      stderr: bunStdio[2],
      cwd: options.cwd || undefined,
      env: env || process.env,
      onExit: (handle, exitCode, signalCode, err) => {
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
    });
    this.pid = this.#handle.pid;

    onSpawnNT(this);

    // const ipc = stdio.ipc;
    // const ipcFd = stdio.ipcFd;
    // stdio = options.stdio = stdio.stdio;

    // for (i = 0; i < stdio.length; i++) {
    //   const stream = stdio[i];
    //   if (stream.type === "ignore") continue;

    //   if (stream.ipc) {
    //     this._closesNeeded++;
    //     continue;
    //   }

    //   // The stream is already cloned and piped, thus stop its readable side,
    //   // otherwise we might attempt to read from the stream when at the same time
    //   // the child process does.
    //   if (stream.type === "wrap") {
    //     stream.handle.reading = false;
    //     stream.handle.readStop();
    //     stream._stdio.pause();
    //     stream._stdio.readableFlowing = false;
    //     stream._stdio._readableState.reading = false;
    //     stream._stdio[kIsUsedAsStdio] = true;
    //     continue;
    //   }

    //   if (stream.handle) {
    //     stream.socket = createSocket(
    //       this.pid !== 0 ? stream.handle : null,
    //       i > 0
    //     );

    // // Add .send() method and start listening for IPC data
    // if (ipc !== undefined) setupChannel(this, ipc, serialization);
  }

  send() {
    console.log("ChildProcess.prototype.send() - Sorry! Not implemented yet");
  }

  disconnect() {
    console.log("ChildProcess.prototype.disconnect() - Sorry! Not implemented yet");
  }

  kill(sig) {
    const signal = sig === 0 ? sig : convertToValidSignal(sig === undefined ? "SIGTERM" : sig);

    if (this.#handle) {
      this.#handle.kill(signal);
    }

    this.#maybeClose();

    // TODO: Figure out how to make this conform to the Node spec...
    // The problem is that the handle does not report killed until the process exits
    // So we can't return whether or not the process was killed because Bun.spawn seems to handle this async instead of sync like Node does
    // return this.#handle?.killed ?? true;
    return true;
  }

  #maybeClose() {
    debug("Attempting to maybe close...");
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
};

function nodeToBun(item) {
  // If inherit and we are referencing stdin/stdout/stderr index,
  // we can get the fd from the ReadStream for the corresponding stdio
  if (typeof item === "number") {
    return item;
  } else {
    const result = nodeToBunLookup[item];
    if (result === undefined) throw new Error("Invalid stdio option");
    return result;
  }
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
  const bunStdio = normalizedStdio.map(item => nodeToBun(item));
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
        throw new ERR_INVALID_OPT_VALUE("stdio", stdio);
    }
  } else if (ArrayIsArray(stdio)) {
    // Validate if each is a valid stdio type
    // TODO: Support wrapped types here

    let processedStdio;
    if (stdio.length === 0) processedStdio = ["pipe", "pipe", "pipe"];
    else if (stdio.length === 1) processedStdio = [stdio[0], "pipe", "pipe"];
    else if (stdio.length === 2) processedStdio = [stdio[0], stdio[1], "pipe"];
    else if (stdio.length >= 3) processedStdio = [stdio[0], stdio[1], stdio[2]];

    return processedStdio.map(item => (!item ? "pipe" : item));
  } else {
    throw new ERR_INVALID_OPT_VALUE("stdio", stdio);
  }
}

function flushStdio(subprocess) {
  const stdio = subprocess.stdio;
  if (stdio == null) return;

  for (let i = 0; i < stdio.length; i++) {
    const stream = stdio[i];
    // TODO(addaleax): This doesn't necessarily account for all the ways in
    // which data can be read from a stream, e.g. being consumed on the
    // native layer directly as a StreamBase.
    if (!stream || !stream.readable) {
      continue;
    }
    stream.resume();
  }
}

function onSpawnNT(self) {
  self.emit("spawn");
}

function abortChildProcess(child, killSignal) {
  if (!child) return;
  try {
    if (child.kill(killSignal)) {
      child.emit("error", new AbortError());
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
  end() {}
  pipe() {}
}

class ShimmedStdioOutStream extends EventEmitter {
  pipe() {}
}

//------------------------------------------------------------------------------
// Section 5. Validators
//------------------------------------------------------------------------------

function validateMaxBuffer(maxBuffer) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }
}

function validateArgumentNullCheck(arg, propName) {
  if (typeof arg === "string" && StringPrototypeIncludes.call(arg, "\u0000")) {
    throw new ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
  }
}

function validateArgumentsNullCheck(args, propName) {
  for (let i = 0; i < args.length; ++i) {
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
  }
}

function validateTimeout(timeout) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0)) {
    throw new ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
}

function validateBoolean(value, name) {
  if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

/**
 * @callback validateFunction
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is Function}
 */

/** @type {validateFunction} */
function validateFunction(value, name) {
  if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
}

/**
 * @callback validateAbortSignal
 * @param {*} signal
 * @param {string} name
 */

/** @type {validateAbortSignal} */
const validateAbortSignal = (signal, name) => {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
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
  if (!ArrayPrototypeIncludes.call(oneOf, value)) {
    const allowed = ArrayPrototypeJoin.call(
      ArrayPrototypeMap.call(oneOf, v => (typeof v === "string" ? `'${v}'` : String(v))),
      ", ",
    );
    const reason = "must be one of: " + allowed;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
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
    (!allowArray && ArrayIsArray.call(value)) ||
    (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "object", value);
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
  if (!ArrayIsArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    const reason = `must be longer than ${minLength}`;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
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
  if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}

function nullCheck(path, propName, throwError = true) {
  const pathIsString = typeof path === "string";
  const pathIsUint8Array = isUint8Array(path);

  // We can only perform meaningful checks on strings and Uint8Arrays.
  if (
    (!pathIsString && !pathIsUint8Array) ||
    (pathIsString && !StringPrototypeIncludes.call(path, "\u0000")) ||
    (pathIsUint8Array && !Uint8ArrayPrototypeIncludes.call(path, 0))
  ) {
    return;
  }

  const err = new ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError) {
    throw err;
  }
  return err;
}

function validatePath(path, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path)) {
    throw new ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
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
      throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
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
//     if (!ArrayIsArray(expected)) {
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
//       if (ArrayPrototypeIncludes.call(kTypes, value)) {
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
//         ArrayPrototypeSplice.call(types, pos, 1);
//         ArrayPrototypePush.call(instances, "Object");
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
//         msg += `one of ${ArrayPrototypeJoin.call(other, ", ")}, or ${last}`;
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
  return Error(`${stdio} maxBuffer length exceeded`);
}

function ERR_UNKNOWN_SIGNAL(name) {
  const err = new TypeError(`Unknown signal: ${name}`);
  err.code = "ERR_UNKNOWN_SIGNAL";
  return err;
}

function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function ERR_INVALID_OPT_VALUE(name, value) {
  return new TypeError(`The value "${value}" is invalid for option "${name}"`);
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  return new Error(`The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`);
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

  [Symbol.for("CommonJS")]: 0,
};
