const EventEmitter = import.meta.require("node:events");
const { Readable } = import.meta.require("node:stream");

// Sections:
// 1. Exported child_process functions
// 2. child_process helpers
// 3. ChildProcess "class"
// 4. ChildProcess helpers
// 5. Validators
// 6. Node error polyfills
// 7. Node stream polyfills

// TODO:
// IPC support
// Add more tests
// Implement various stdio options
// Finish getValidStdio
// Make sure flushStdio is working
// Finish normalizing spawn args

//------------------------------------------------------------------------------
// Section 1. Exported child_process functions
//------------------------------------------------------------------------------

// TODO: Implement these props when Windows is supported
// *   windowsVerbatimArguments?: boolean;
// *   windowsHide?: boolean;

// TODO:
// argv0 support
// Detached child process support
// Allow setting uid and gid
// Advanced serialization of IPC messages
// Shell support
// Abort signal
// Kill signal

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
 *   signal?: AbortSignal;
 *   timeout?: number;
 *   killSignal?: string | number;
 *   }} [options]
 * @returns {ChildProcess}
 */
export function spawn(file, args, options) {
  options = normalizeSpawnArguments(file, args, options);
  // validateTimeout(options.timeout);
  // validateAbortSignal(options.signal, "options.signal");
  // const killSignal = sanitizeKillSignal(options.killSignal);
  const child = new ChildProcess();

  // debug('spawn', options);
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
    }, options.timeout);

    child.once("exit", () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    });
  }

  // if (options.signal) {
  //   const signal = options.signal;
  //   if (signal.aborted) {
  //     process.nextTick(onAbortListener);
  //   } else {
  //     signal.addEventListener("abort", onAbortListener, { once: true });
  //     child.once("exit", () =>
  //       signal.removeEventListener("abort", onAbortListener)
  //     );
  //   }

  //   function onAbortListener() {
  //     abortChildProcess(child, killSignal);
  //   }
  // }
  return child;
}

//------------------------------------------------------------------------------
// Section 2. child_process helpers
//------------------------------------------------------------------------------

function normalizeSpawnArguments(file, args, options) {
  if (file.length === 0)
    throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");

  if (ArrayIsArray(args)) {
    args = ArrayPrototypeSlice(args);
  } else if (args == null) {
    args = [];
  } else if (typeof args !== "object") {
    throw new ERR_INVALID_ARG_TYPE("args", "object", args);
  } else {
    options = args;
    args = [];
  }

  // validateArgumentsNullCheck(args, "args");

  if (options == null) {
    options = {};
  } else if (typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
  }

  validateString(file, "file");
  validateArray(args, "args");
  validateObject(options, "options");

  return { ...options, file, args };
}

// function normalizeSpawnArguments(file, args, options) {
//   validateString(file, "file");
//   validateArgumentNullCheck(file, "file");

//   if (file.length === 0)
//     throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");

//   if (ArrayIsArray(args)) {
//     args = ArrayPrototypeSlice(args);
//   } else if (args == null) {
//     args = [];
//   } else if (typeof args !== "object") {
//     throw new ERR_INVALID_ARG_TYPE("args", "object", args);
//   } else {
//     options = args;
//     args = [];
//   }

//   validateArgumentsNullCheck(args, "args");

//   if (options === undefined) options = kEmptyObject;
//   else validateObject(options, "options");

//   let cwd = options.cwd;

//   // Validate the cwd, if present.
//   if (cwd != null) {
//     cwd = getValidatedPath(cwd, "options.cwd");
//   }

//   // Validate detached, if present.
//   if (options.detached != null) {
//     validateBoolean(options.detached, "options.detached");
//   }

//   // Validate the uid, if present.
//   if (options.uid != null && !isInt32(options.uid)) {
//     throw new ERR_INVALID_ARG_TYPE("options.uid", "int32", options.uid);
//   }

//   // Validate the gid, if present.
//   if (options.gid != null && !isInt32(options.gid)) {
//     throw new ERR_INVALID_ARG_TYPE("options.gid", "int32", options.gid);
//   }

//   // Validate the shell, if present.
//   if (
//     options.shell != null &&
//     typeof options.shell !== "boolean" &&
//     typeof options.shell !== "string"
//   ) {
//     throw new ERR_INVALID_ARG_TYPE(
//       "options.shell",
//       ["boolean", "string"],
//       options.shell
//     );
//   }

//   // Validate argv0, if present.
//   if (options.argv0 != null) {
//     validateString(options.argv0, "options.argv0");
//     validateArgumentNullCheck(options.argv0, "options.argv0");
//   }

//   // // Validate windowsHide, if present.
//   // if (options.windowsHide != null) {
//   //   validateBoolean(options.windowsHide, "options.windowsHide");
//   // }

//   // // Validate windowsVerbatimArguments, if present.
//   // let { windowsVerbatimArguments } = options;
//   // if (windowsVerbatimArguments != null) {
//   //   validateBoolean(
//   //     windowsVerbatimArguments,
//   //     "options.windowsVerbatimArguments"
//   //   );
//   // }

//   if (options.shell) {
//     validateArgumentNullCheck(options.shell, "options.shell");
//     const command = ArrayPrototypeJoin([file, ...args], " ");
//     // Set the shell, switches, and commands.
//     if (process.platform === "win32") {
//       if (typeof options.shell === "string") file = options.shell;
//       else file = process.env.comspec || "cmd.exe";
//       // '/d /s /c' is used only for cmd.exe.
//       if (RegExpPrototypeExec(/^(?:.*\\)?cmd(?:\.exe)?$/i, file) !== null) {
//         args = ["/d", "/s", "/c", `"${command}"`];
//         windowsVerbatimArguments = true;
//       } else {
//         args = ["-c", command];
//       }
//     } else {
//       if (typeof options.shell === "string") file = options.shell;
//       else if (process.platform === "android") file = "/system/bin/sh";
//       else file = "/bin/sh";
//       args = ["-c", command];
//     }
//   }

//   if (typeof options.argv0 === "string") {
//     ArrayPrototypeUnshift(args, options.argv0);
//   } else {
//     ArrayPrototypeUnshift(args, file);
//   }

//   const env = options.env || process.env;
//   const envPairs = [];

//   // process.env.NODE_V8_COVERAGE always propagates, making it possible to
//   // collect coverage for programs that spawn with white-listed environment.
//   copyProcessEnvToEnv(env, "NODE_V8_COVERAGE", options.env);

//   let envKeys = [];
//   // Prototype values are intentionally included.
//   for (const key in env) {
//     ArrayPrototypePush(envKeys, key);
//   }

//   if (process.platform === "win32") {
//     // On Windows env keys are case insensitive. Filter out duplicates,
//     // keeping only the first one (in lexicographic order)
//     const sawKey = new SafeSet();
//     envKeys = ArrayPrototypeFilter(ArrayPrototypeSort(envKeys), (key) => {
//       const uppercaseKey = StringPrototypeToUpperCase(key);
//       if (sawKey.has(uppercaseKey)) {
//         return false;
//       }
//       sawKey.add(uppercaseKey);
//       return true;
//     });
//   }

//   for (const key of envKeys) {
//     const value = env[key];
//     if (value !== undefined) {
//       validateArgumentNullCheck(key, `options.env['${key}']`);
//       validateArgumentNullCheck(value, `options.env['${key}']`);
//       ArrayPrototypePush(envPairs, `${key}=${value}`);
//     }
//   }

//   return {
//     // Make a shallow copy so we don't clobber the user's options object.
//     ...options,
//     args,
//     cwd,
//     detached: !!options.detached,
//     envPairs,
//     file,
//     // windowsHide: !!options.windowsHide,
//     // windowsVerbatimArguments: !!windowsVerbatimArguments,
//   };
// }

//------------------------------------------------------------------------------
// Section 3. ChildProcess class
//------------------------------------------------------------------------------

export class ChildProcess extends EventEmitter {
  constructor() {
    super();
    this._closesNeeded = 0;
    this._closesGot = 0;
    this.connected = false;
    this.signalCode = null;
    this.exitCode = null;
    this.killed = false;
    this.spawnfile = undefined;
    this.spawnargs = undefined;
    this.pid = undefined;
    this.stdin = undefined;
    this.stdout = undefined;
    this.stderr = undefined;
    this.stdio = undefined;
    this.channel = undefined;
    this._handle = undefined;
    this._handleQueue = undefined;
    this._pendingMessage = undefined;
    this._pendingHandle = undefined;
    this._channel = undefined;
    this._serialization = undefined;
    this._eventsCount = undefined;
    this._events = undefined;
    this._error = null;
    this._maxListeners = undefined;
    this._exited = false;
  }

  _handleOnExit(exitCode, signalCode) {
    if (this._exited) return;
    if (signalCode) {
      this.signalCode = signalCode;
    } else {
      this.exitCode = exitCode;
    }

    if (this.stdin) {
      this.stdin.destroy();
    }
    if (this._handle) {
      this._handle = null;
    }

    if (exitCode < 0) {
      const syscall = this.spawnfile ? "spawn " + this.spawnfile : "spawn";
      const err = errnoException(exitCode, syscall);

      if (this.spawnfile) err.path = this.spawnfile;

      err.spawnargs = ArrayPrototypeSlice(this.spawnargs, 1);
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

    maybeClose(this);
    this._exited = true;
  }
  // this._handle[owner_symbol] = this;

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

    //   ArrayPrototypePush(options.envPairs, `NODE_CHANNEL_FD=${ipcFd}`);
    //   ArrayPrototypePush(
    //     options.envPairs,
    //     `NODE_CHANNEL_SERIALIZATION_MODE=${serialization}`
    //   );
    // }

    validateString(options.file, "options.file");
    this.spawnfile = options.file;

    if (options.args === undefined) {
      this.spawnargs = [];
    } else {
      validateArray(options.args, "options.args");
      this.spawnargs = options.args;
    }

    this._handle = Bun.spawn({
      cmd: [this.spawnfile, ...this.spawnargs],
      stdin: "pipe", // TODO: Unhardcode
      stdout: "pipe", // TODO: Unhardcode
      stderr: "pipe", // TODO: Unhardcode
      onExit: this._handleOnExit.bind(this),
    });
    // NOTE: We need these for supporting the `ChildProcess` EventEmitter-style API for pipes
    // There may be a better way to do this...
    this.stdout = newStreamReadableFromReadableStream(this._handle.stdout, {
      encoding: "utf8",
    });
    this.stderr = newStreamReadableFromReadableStream(this._handle.stderr, {
      encoding: "utf8",
    });
    // const err = this._handle.spawn(options);
    process.nextTick(onSpawnNT, this);

    this.pid = this._handle.pid;

    // If no `stdio` option was given - use default
    // let stdio = options.stdio || "pipe"; // TODO: reset default
    // let stdio = options.stdio || ["pipe", "pipe", "pipe"];

    // stdio = getValidStdio(stdio, false);

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

    //     if (i > 0 && this.pid !== 0) {
    //       this._closesNeeded++;
    //       stream.socket.on("close", () => {
    //         maybeClose(this);
    //       });
    //     }
    //   }
    // }

    // this.stdin =
    //   stdio.length >= 1 && stdio[0].socket !== undefined ? stdio[0].socket : null;
    // this.stdout =
    //   stdio.length >= 2 && stdio[1].socket !== undefined ? stdio[1].socket : null;
    // this.stderr =
    //   stdio.length >= 3 && stdio[2].socket !== undefined ? stdio[2].socket : null;

    // this.stdio = [];

    // for (i = 0; i < stdio.length; i++)
    //   ArrayPrototypePush(
    //     this.stdio,
    //     stdio[i].socket === undefined ? null : stdio[i].socket
    //   );

    // // Add .send() method and start listening for IPC data
    // if (ipc !== undefined) setupChannel(this, ipc, serialization);
  }

  kill(signal) {
    if (this.killed) return;

    if (this._handle) {
      this._handle.kill(signal);
    }

    this.killed = true;
    this.emit("exit", null, signal);
    maybeClose(this);
  }
}

//------------------------------------------------------------------------------
// Section 4. ChildProcess helpers
//------------------------------------------------------------------------------

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

// TODO: Deps for getValidStdio():
// stdioStringToArray
// Pipe
// ERR_IPC_ONE_PIPE
// PipeConstants.SOCKET
// inspect
// getHandleWrapType

// function getValidStdio(stdio, sync) {
//   let ipc;
//   let ipcFd;

//   // Replace shortcut with an array
//   if (typeof stdio === "string") {
//     stdio = stdioStringToArray(stdio);
//   } else if (!ArrayIsArray(stdio)) {
//     throw new ERR_INVALID_ARG_VALUE("stdio", stdio);
//   }

//   // At least 3 stdio will be created
//   // Don't concat() a new Array() because it would be sparse, and
//   // stdio.reduce() would skip the sparse elements of stdio.
//   // See https://stackoverflow.com/a/5501711/3561
//   while (stdio.length < 3) ArrayPrototypePush(stdio, undefined);

//   // Translate stdio into C++-readable form
//   // (i.e. PipeWraps or fds)
//   stdio = ArrayPrototypeReduce(
//     stdio,
//     (acc, stdio, i) => {
//       function cleanup() {
//         for (let i = 0; i < acc.length; i++) {
//           if (
//             (acc[i].type === "pipe" || acc[i].type === "ipc") &&
//             acc[i].handle
//           )
//             acc[i].handle.close();
//         }
//       }

//       // Defaults
//       if (stdio == null) {
//         stdio = i < 3 ? "pipe" : "ignore";
//       }

//       if (stdio === "ignore") {
//         ArrayPrototypePush(acc, { type: "ignore" });
//       } else if (
//         stdio === "pipe" ||
//         stdio === "overlapped" ||
//         (typeof stdio === "number" && stdio < 0)
//       ) {
//         const a = {
//           type: stdio === "overlapped" ? "overlapped" : "pipe",
//           readable: i === 0,
//           writable: i !== 0,
//         };

//         if (!sync) a.handle = new Pipe(PipeConstants.SOCKET);

//         ArrayPrototypePush(acc, a);
//       } else if (stdio === "ipc") {
//         if (sync || ipc !== undefined) {
//           // Cleanup previously created pipes
//           cleanup();
//           if (!sync) throw new ERR_IPC_ONE_PIPE();
//           else throw new ERR_IPC_SYNC_FORK();
//         }

//         ipc = new Pipe(PipeConstants.IPC);
//         ipcFd = i;

//         ArrayPrototypePush(acc, {
//           type: "pipe",
//           handle: ipc,
//           ipc: true,
//         });
//       } else if (stdio === "inherit") {
//         ArrayPrototypePush(acc, {
//           type: "inherit",
//           fd: i,
//         });
//       } else if (typeof stdio === "number" || typeof stdio.fd === "number") {
//         ArrayPrototypePush(acc, {
//           type: "fd",
//           fd: typeof stdio === "number" ? stdio : stdio.fd,
//         });
//       } else if (
//         getHandleWrapType(stdio) ||
//         getHandleWrapType(stdio.handle) ||
//         getHandleWrapType(stdio._handle)
//       ) {
//         const handle = getHandleWrapType(stdio)
//           ? stdio
//           : getHandleWrapType(stdio.handle)
//           ? stdio.handle
//           : stdio._handle;

//         ArrayPrototypePush(acc, {
//           type: "wrap",
//           wrapType: getHandleWrapType(handle),
//           handle: handle,
//           _stdio: stdio,
//         });
//       } else if (isArrayBufferView(stdio) || typeof stdio === "string") {
//         if (!sync) {
//           cleanup();
//           throw new ERR_INVALID_SYNC_FORK_INPUT(inspect(stdio));
//         }
//       } else {
//         // Cleanup
//         cleanup();
//         throw new ERR_INVALID_ARG_VALUE("stdio", stdio);
//       }

//       return acc;
//     },
//     []
//   );

//   return { stdio, ipc, ipcFd };
// }

function stdioStringToArray(stdio, channel) {
  const options = [];

  switch (stdio) {
    case "ignore":
    case "overlapped":
    case "pipe":
      ArrayPrototypePush(options, stdio, stdio, stdio);
      break;
    case "inherit":
      ArrayPrototypePush(options, 0, 1, 2);
      break;
    default:
      throw new ERR_INVALID_ARG_VALUE("stdio", stdio);
  }

  if (channel) ArrayPrototypePush(options, channel);

  return options;
}

function getHandleWrapType(stream) {
  if (stream instanceof Pipe) return "pipe";
  if (stream instanceof TTY) return "tty";
  if (stream instanceof TCP) return "tcp";
  if (stream instanceof UDP) return "udp";

  return false;
}

function maybeClose(subprocess) {
  subprocess._closesGot++;

  if (subprocess._closesGot === subprocess._closesNeeded) {
    subprocess.emit("close", subprocess.exitCode, subprocess.signalCode);
  }
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

//------------------------------------------------------------------------------
// Section 5. Validators
//------------------------------------------------------------------------------

function validateBoolean(value, name) {
  if (typeof value !== "boolean")
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

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
  if (!ArrayPrototypeIncludes(oneOf, value)) {
    const allowed = ArrayPrototypeJoin(
      ArrayPrototypeMap(oneOf, (v) =>
        typeof v === "string" ? `'${v}'` : String(v)
      ),
      ", "
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
  const allowArray = getOwnPropertyValueOrDefault(options, "allowArray", false);
  const allowFunction = getOwnPropertyValueOrDefault(
    options,
    "allowFunction",
    false
  );
  const nullable = getOwnPropertyValueOrDefault(options, "nullable", false);
  if (
    (!nullable && value === null) ||
    (!allowArray && ArrayIsArray(value)) ||
    (typeof value !== "object" &&
      (!allowFunction || typeof value !== "function"))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
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
  if (typeof value !== "string")
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}

/**
 * @param {?object} options
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function getOwnPropertyValueOrDefault(options, key, defaultValue) {
  return options == null || !ObjectPrototypeHasOwnProperty(options, key)
    ? defaultValue
    : options[key];
}

function ObjectPrototypeHasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function ArrayPrototypePush(array, ...items) {
  return array.push(...items);
}

function ArrayPrototypeReduce(array, callback, initialValue) {
  return array.reduce(callback, initialValue);
}

function ArrayPrototypeJoin(array, separator) {
  return array.join(separator);
}

function ArrayPrototypeMap(array, callback) {
  return array.map(callback);
}

function ArrayPrototypeSlice(array, begin, end) {
  return array.slice(begin, end);
}

function ArrayPrototypeFilter(array, callback) {
  return array.filter(callback);
}

function ArrayPrototypeIncludes(array, searchElement, fromIndex) {
  return array.includes(searchElement, fromIndex);
}

function ArrayIsArray(arg) {
  return Array.isArray(arg);
}

function isArrayBufferView(value) {
  return value instanceof ArrayBufferView;
}

//------------------------------------------------------------------------------
// 6. Node error polyfills
//------------------------------------------------------------------------------

function ERR_INVALID_ARG_TYPE(name, type, value) {
  return new Error(
    `The argument '${name}' is invalid. Received '${value}' for type '${type}'`
  );
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  return new Error(
    `The value '${value}' is invalid for argument '${name}'. Reason: ${reason}`
  );
}

// TODO: Add actual proper error implementation here
function errnoException(err, name) {
  return new Error(`Error: ${name}. Internal error: ${err.message}`);
}

//------------------------------------------------------------------------------
// 7. Node stream polyfills
//------------------------------------------------------------------------------
Readable.prototype.on = function (event, listener) {
  EventEmitter.prototype.on.call(this, event, listener);
  if (event === "data") {
    this._readableState.flowing = true;
    this._read();
  }
};
/**
 * @param {ReadableStream} readableStream
 * @param {{
 *   highWaterMark? : number,
 *   encoding? : string,
 *   objectMode? : boolean,
 *   signal? : AbortSignal,
 * }} [options]
 * @returns {Readable}
 */
export function newStreamReadableFromReadableStream(
  readableStream,
  options = {}
) {
  if (!isReadableStream(readableStream)) {
    throw new ERR_INVALID_ARG_TYPE(
      "readableStream",
      "ReadableStream",
      readableStream
    );
  }

  validateObject(options, "options");
  const { highWaterMark, encoding, objectMode = false, signal } = options;

  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw new ERR_INVALID_ARG_VALUE(encoding, "options.encoding");
  validateBoolean(objectMode, "options.objectMode");

  const reader = readableStream.getReader();

  let closed = false;

  const readable = new Readable({
    objectMode,
    highWaterMark,
    encoding,
    signal,

    read() {
      reader
        .read()
        .then((chunk) => {
          if (chunk.done) {
            // Value should always be undefined here.
            readable.push(null);
          } else {
            readable.push(chunk.value);
          }
        })
        .catch((error) => destroy(readable, error));
    },

    destroy(error, callback) {
      function done() {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => {
            throw error;
          });
        }
      }

      if (!closed) {
        reader.cancel(error).then(done).catch(done);
        return;
      }
      done();
    },
  });

  reader.closed
    .then(() => {
      closed = true;
    })
    .catch((error) => {
      closed = true;
      destroy(readable, error);
    });

  return readable;
}

function isReadableStream(value) {
  return value instanceof ReadableStream;
}

export default {
  ChildProcess,
  spawn,

  [Symbol.for("CommonJS")]: 0,
};
