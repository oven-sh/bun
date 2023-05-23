// src/js/node/child_process.js
function spawn(file, args, options) {
  options = normalizeSpawnArguments(file, args, options);
  validateTimeout(options.timeout);
  validateAbortSignal(options.signal, "options.signal");
  const killSignal2 = sanitizeKillSignal(options.killSignal);
  const child = new ChildProcess;
  debug("spawn", options);
  child.spawn(options);
  if (options.timeout > 0) {
    let timeoutId = setTimeout(() => {
      if (timeoutId) {
        try {
          child.kill(killSignal2);
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
    let onAbortListener = function() {
      abortChildProcess(child, killSignal2);
    };
    const signal = options.signal;
    if (signal.aborted) {
      process.nextTick(onAbortListener);
    } else {
      signal.addEventListener("abort", onAbortListener, { once: true });
      child.once("exit", () => signal.removeEventListener("abort", onAbortListener));
    }
  }
  return child;
}
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
    ...options
  };
  const maxBuffer = options.maxBuffer;
  validateTimeout(options.timeout);
  validateMaxBuffer(maxBuffer);
  options.killSignal = sanitizeKillSignal(options.killSignal);
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    signal: options.signal
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
    if (exited)
      return;
    exited = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!callback)
      return;
    const readableEncoding = child?.stdout?.readableEncoding;
    let stdout;
    let stderr;
    if (encoding || child.stdout && readableEncoding) {
      stdout = ArrayPrototypeJoin.call(_stdout, "");
    } else {
      stdout = BufferConcat(_stdout);
    }
    if (encoding || child.stderr && readableEncoding) {
      stderr = ArrayPrototypeJoin.call(_stderr, "");
    } else {
      stderr = BufferConcat(_stderr);
    }
    if (!ex && code === 0 && signal === null) {
      callback(null, stdout, stderr);
      return;
    }
    if (args?.length)
      cmd += ` ${ArrayPrototypeJoin.call(args, " ")}`;
    if (!ex) {
      let message = `Command failed: ${cmd}`;
      if (stderr)
        message += `\n${stderr}`;
      ex = genericNodeError(message, {
        code,
        killed: child.killed || killed,
        signal
      });
    }
    ex.cmd = cmd;
    callback(ex, stdout, stderr);
  }
  function errorHandler(e) {
    ex = e;
    if (child.stdout)
      child.stdout.destroy();
    if (child.stderr)
      child.stderr.destroy();
    exitHandler();
  }
  function kill() {
    if (child.stdout)
      child.stdout.destroy();
    if (child.stderr)
      child.stderr.destroy();
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
    if (encoding)
      child.stdout.setEncoding(encoding);
    child.stdout.on("data", maxBuffer === Infinity ? function onUnlimitedSizeBufferedData(chunk) {
      ArrayPrototypePush.call(_stdout, chunk);
    } : encoding ? function onChildStdoutEncoded(chunk) {
      stdoutLen += chunk.length;
      if (stdoutLen * 4 > maxBuffer) {
        const encoding2 = child.stdout.readableEncoding;
        const actualLen = Buffer.byteLength(chunk, encoding2);
        if (encodedStdoutLen === undefined) {
          for (let i = 0;i < _stdout.length; i++) {
            encodedStdoutLen += Buffer.byteLength(_stdout[i], encoding2);
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
    } : function onChildStdoutRaw(chunk) {
      stdoutLen += chunk.length;
      if (stdoutLen > maxBuffer) {
        const truncatedLen = maxBuffer - (stdoutLen - chunk.length);
        ArrayPrototypePush.call(_stdout, chunk.slice(0, truncatedLen));
        ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout");
        kill();
      } else {
        ArrayPrototypePush.call(_stdout, chunk);
      }
    });
  }
  if (child.stderr) {
    if (encoding)
      child.stderr.setEncoding(encoding);
    child.stderr.on("data", maxBuffer === Infinity ? function onUnlimitedSizeBufferedData(chunk) {
      ArrayPrototypePush.call(_stderr, chunk);
    } : encoding ? function onChildStderrEncoded(chunk) {
      stderrLen += chunk.length;
      if (stderrLen * 4 > maxBuffer) {
        const encoding2 = child.stderr.readableEncoding;
        const actualLen = Buffer.byteLength(chunk, encoding2);
        if (encodedStderrLen === undefined) {
          for (let i = 0;i < _stderr.length; i++) {
            encodedStderrLen += Buffer.byteLength(_stderr[i], encoding2);
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
    } : function onChildStderrRaw(chunk) {
      stderrLen += chunk.length;
      if (stderrLen > maxBuffer) {
        const truncatedLen = maxBuffer - (stderrLen - chunk.length);
        ArrayPrototypePush.call(_stderr, StringPrototypeSlice.call(chunk, 0, truncatedLen));
        ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr");
        kill();
      } else {
        ArrayPrototypePush.call(_stderr, chunk);
      }
    });
  }
  child.addListener("close", exitHandler);
  child.addListener("error", errorHandler);
  return child;
}
function exec(command, options, callback) {
  const opts = normalizeExecArgs(command, options, callback);
  return execFile(opts.file, opts.options, opts.callback);
}
function spawnSync(file, args, options) {
  options = {
    maxBuffer: MAX_BUFFER,
    ...normalizeSpawnArguments(file, args, options)
  };
  const maxBuffer = options.maxBuffer;
  const encoding = options.encoding;
  debug("spawnSync", options);
  validateTimeout(options.timeout);
  validateMaxBuffer(maxBuffer);
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
    stderr: bunStdio[2]
  });
  const result = {
    signal: null,
    status: exitCode,
    output: [null, stdout, stderr]
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
function execFileSync(file, args, options) {
  ({ file, args, options } = normalizeExecFileArgs(file, args, options));
  const ret = spawnSync(file, args, options);
  const errArgs = [options.argv0 || file];
  ArrayPrototypePush.apply(errArgs, args);
  const err = checkExecSyncError(ret, errArgs);
  if (err)
    throw err;
  return ret.stdout;
}
function execSync(command, options) {
  const opts = normalizeExecArgs(command, options, null);
  const ret = spawnSync(opts.file, opts.options);
  const err = checkExecSyncError(ret, undefined, command);
  if (err)
    throw err;
  return ret.stdout;
}
function fork() {
  throw new Error("Not implemented");
}
var convertToValidSignal = function(signal) {
  if (typeof signal === "number" && getSignalsToNamesMapping()[signal])
    return signal;
  if (typeof signal === "string") {
    const signalName = signals[StringPrototypeToUpperCase.call(signal)];
    if (signalName)
      return signalName;
  }
  throw new ERR_UNKNOWN_SIGNAL(signal);
};
var sanitizeKillSignal = function(killSignal2) {
  if (typeof killSignal2 === "string" || typeof killSignal2 === "number") {
    return convertToValidSignal(killSignal2);
  } else if (killSignal2 != null) {
    throw new ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal2);
  }
};
var getSignalsToNamesMapping = function() {
  if (signalsToNamesMapping !== undefined)
    return signalsToNamesMapping;
  signalsToNamesMapping = ObjectCreate(null);
  for (const key in signals) {
    signalsToNamesMapping[signals[key]] = key;
  }
  return signalsToNamesMapping;
};
var normalizeExecFileArgs = function(file, args, options, callback) {
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
  if (options.argv0 != null) {
    validateString(options.argv0, "options.argv0");
    validateArgumentNullCheck(options.argv0, "options.argv0");
  }
  return { file, args, options, callback };
};
var normalizeExecArgs = function(command, options, callback) {
  validateString(command, "command");
  validateArgumentNullCheck(command, "command");
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  options = { ...options };
  options.shell = typeof options.shell === "string" ? options.shell : true;
  return {
    file: command,
    options,
    callback
  };
};
var normalizeSpawnArguments = function(file, args, options) {
  validateString(file, "file");
  validateArgumentNullCheck(file, "file");
  if (file.length === 0)
    throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");
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
  if (options === undefined)
    options = {};
  else
    validateObject(options, "options");
  let cwd = options.cwd;
  if (cwd != null) {
    cwd = getValidatedPath(cwd, "options.cwd");
  }
  if (options.shell != null && typeof options.shell !== "boolean" && typeof options.shell !== "string") {
    throw new ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], options.shell);
  }
  if (options.argv0 != null) {
    validateString(options.argv0, "options.argv0");
    validateArgumentNullCheck(options.argv0, "options.argv0");
  }
  if (options.shell) {
    validateArgumentNullCheck(options.shell, "options.shell");
    const command = ArrayPrototypeJoin.call([file, ...args], " ");
    if (typeof options.shell === "string")
      file = options.shell;
    else if (false)
      ;
    else
      file = "sh";
    args = ["-c", command];
  }
  if (typeof options.argv0 === "string") {
    ArrayPrototypeUnshift.call(args, options.argv0);
  } else {
    ArrayPrototypeUnshift.call(args, file);
  }
  const env = options.env || process.env;
  const envPairs = env;
  return { ...options, file, args, cwd, envPairs };
};
var checkExecSyncError = function(ret, args, cmd) {
  let err;
  if (ret.error) {
    err = ret.error;
    ObjectAssign(err, ret);
  } else if (ret.status !== 0) {
    let msg = "Command failed: ";
    msg += cmd || ArrayPrototypeJoin.call(args, " ");
    if (ret.stderr && ret.stderr.length > 0)
      msg += `\n${ret.stderr.toString()}`;
    err = genericNodeError(msg, ret);
  }
  return err;
};
var nodeToBun = function(item) {
  if (typeof item === "number") {
    return item;
  } else {
    const result = nodeToBunLookup[item];
    if (result === undefined)
      throw new Error("Invalid stdio option");
    return result;
  }
};
var fdToStdioName = function(fd) {
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
};
var getBunStdioFromOptions = function(stdio) {
  const normalizedStdio = normalizeStdio(stdio);
  const bunStdio = normalizedStdio.map((item) => nodeToBun(item));
  return bunStdio;
};
var normalizeStdio = function(stdio) {
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
    let processedStdio;
    if (stdio.length === 0)
      processedStdio = ["pipe", "pipe", "pipe"];
    else if (stdio.length === 1)
      processedStdio = [stdio[0], "pipe", "pipe"];
    else if (stdio.length === 2)
      processedStdio = [stdio[0], stdio[1], "pipe"];
    else if (stdio.length >= 3)
      processedStdio = [stdio[0], stdio[1], stdio[2]];
    return processedStdio.map((item) => !item ? "pipe" : item);
  } else {
    throw new ERR_INVALID_OPT_VALUE("stdio", stdio);
  }
};
var flushStdio = function(subprocess) {
  const stdio = subprocess.stdio;
  if (stdio == null)
    return;
  for (let i = 0;i < stdio.length; i++) {
    const stream = stdio[i];
    if (!stream || !stream.readable) {
      continue;
    }
    stream.resume();
  }
};
var onSpawnNT = function(self) {
  self.emit("spawn");
};
var abortChildProcess = function(child, killSignal2) {
  if (!child)
    return;
  try {
    if (child.kill(killSignal2)) {
      child.emit("error", new AbortError);
    }
  } catch (err) {
    child.emit("error", err);
  }
};
var validateMaxBuffer = function(maxBuffer) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }
};
var validateArgumentNullCheck = function(arg, propName) {
  if (typeof arg === "string" && StringPrototypeIncludes.call(arg, "\0")) {
    throw new ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
  }
};
var validateArgumentsNullCheck = function(args, propName) {
  for (let i = 0;i < args.length; ++i) {
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
  }
};
var validateTimeout = function(timeout) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0)) {
    throw new ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
};
var validateFunction = function(value, name) {
  if (typeof value !== "function")
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
};
var validateString = function(value, name) {
  if (typeof value !== "string")
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
};
var nullCheck = function(path, propName, throwError = true) {
  const pathIsString = typeof path === "string";
  const pathIsUint8Array = isUint8Array(path);
  if (!pathIsString && !pathIsUint8Array || pathIsString && !StringPrototypeIncludes.call(path, "\0") || pathIsUint8Array && !Uint8ArrayPrototypeIncludes.call(path, 0)) {
    return;
  }
  const err = new ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError) {
    throw err;
  }
  return err;
};
var validatePath = function(path, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path)) {
    throw new ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
  }
  const err = nullCheck(path, propName, false);
  if (err !== undefined) {
    throw err;
  }
};
var getValidatedPath = function(fileURLOrPath, propName = "path") {
  const path = toPathIfFileURL(fileURLOrPath);
  validatePath(path, propName);
  return path;
};
var isUint8Array = function(value) {
  return typeof value === "object" && value !== null && value instanceof Uint8Array;
};
var isURLInstance = function(fileURLOrPath) {
  return fileURLOrPath != null && fileURLOrPath.href && fileURLOrPath.origin;
};
var toPathIfFileURL = function(fileURLOrPath) {
  if (!isURLInstance(fileURLOrPath))
    return fileURLOrPath;
  return Bun.fileURLToPath(fileURLOrPath);
};
var genericNodeError = function(message, options) {
  const err = new Error(message);
  err.code = options.code;
  err.killed = options.killed;
  err.signal = options.signal;
  return err;
};
var ERR_OUT_OF_RANGE = function(str, range, input, replaceDefaultBoolean = false) {
  return new RangeError(`The value of ${str} is out of range. It must be ${range}. Received ${input}`);
};
var ERR_CHILD_PROCESS_STDIO_MAXBUFFER = function(stdio) {
  return Error(`${stdio} maxBuffer length exceeded`);
};
var ERR_UNKNOWN_SIGNAL = function(name) {
  const err = new TypeError(`Unknown signal: ${name}`);
  err.code = "ERR_UNKNOWN_SIGNAL";
  return err;
};
var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
};
var ERR_INVALID_OPT_VALUE = function(name, value) {
  return new TypeError(`The value "${value}" is invalid for option "${name}"`);
};
var ERR_INVALID_ARG_VALUE = function(name, value, reason) {
  return new Error(`The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`);
};
var EventEmitter = import.meta.require("node:events");
var {
  Readable: { fromWeb: ReadableFromWeb },
  NativeWritable
} = import.meta.require("node:stream");
var {
  constants: { signals }
} = import.meta.require("node:os");
var { promisify } = import.meta.require("node:util");
var { ArrayBuffer, Uint8Array, String, Object, Buffer, Promise: Promise2 } = import.meta.primordials;
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
var ArrayBufferIsView = ArrayBuffer.isView;
var NumberIsInteger = Number.isInteger;
var StringPrototypeToUpperCase = String.prototype.toUpperCase;
var StringPrototypeIncludes = String.prototype.includes;
var StringPrototypeSlice = String.prototype.slice;
var Uint8ArrayPrototypeIncludes = Uint8Array.prototype.includes;
var MAX_BUFFER = 1024 * 1024;
var __DEBUG__ = process.env.DEBUG || false;
var __TRACK_STDIO__ = process.env.DEBUG_STDIO;
var debug = __DEBUG__ ? console.log : () => {
};
if (__TRACK_STDIO__) {
  debug("child_process: debug mode on");
  globalThis.__lastId = null;
  globalThis.__getId = () => {
    return globalThis.__lastId !== null ? globalThis.__lastId++ : 0;
  };
}
var customPromiseExecFunction = (orig) => {
  return (...args) => {
    let resolve;
    let reject;
    const promise = new Promise2((res, rej) => {
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
  value: customPromiseExecFunction(exec)
});
var signalsToNamesMapping;

class ChildProcess extends EventEmitter {
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
    if (this.#handle == null)
      return false;
  }
  #handleOnExit(exitCode, signalCode, err) {
    if (this.#exited)
      return;
    this.exitCode = this.#handle.exitCode;
    this.signalCode = exitCode > 0 ? signalCode : null;
    if (this.#stdin) {
      this.#stdin.destroy();
    }
    if (this.#handle) {
      this.#handle = null;
    }
    if (exitCode < 0) {
      const err2 = new SystemError(`Spawned process exited with error code: ${exitCode}`, undefined, "spawn", "EUNKNOWN", "ERR_CHILD_PROCESS_UNKNOWN_ERROR");
      if (this.spawnfile)
        err2.path = this.spawnfile;
      err2.spawnargs = ArrayPrototypeSlice.call(this.spawnargs, 1);
      this.emit("error", err2);
    } else {
      this.emit("exit", this.exitCode, this.signalCode);
    }
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
            return new ShimmedStdin;
          default:
            return null;
        }
      }
      case 2:
      case 1: {
        switch (io) {
          case "pipe":
            return ReadableFromWeb(this.#handle[fdToStdioName(i)], __TRACK_STDIO__ ? {
              encoding,
              __id: `PARENT_${fdToStdioName(i).toUpperCase()}-${globalThis.__getId()}`
            } : { encoding });
          case "inherit":
            return process[fdToStdioName(i)] || null;
          case "destroyed":
            return new ShimmedStdioOutStream;
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
        get: () => this.stdin
      },
      1: {
        get: () => this.stdout
      },
      2: {
        get: () => this.stderr
      }
    });
  }
  get stdin() {
    return this.#stdin ??= this.#getBunSpawnIo(0, this.#encoding);
  }
  get stdout() {
    return this.#stdout ??= this.#getBunSpawnIo(1, this.#encoding);
  }
  get stderr() {
    return this.#stderr ??= this.#getBunSpawnIo(2, this.#encoding);
  }
  get stdio() {
    return this.#stdioObject ??= this.#createStdioObject();
  }
  spawn(options) {
    validateObject(options, "options");
    validateString(options.file, "options.file");
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
        process.nextTick((exitCode2, signalCode2, err2) => this.#handleOnExit(exitCode2, signalCode2, err2), exitCode, signalCode, err);
      },
      lazy: true
    });
    this.pid = this.#handle.pid;
    onSpawnNT(this);
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
    if (this.#handle)
      this.#handle.ref();
  }
  unref() {
    if (this.#handle)
      this.#handle.unref();
  }
}
var nodeToBunLookup = {
  ignore: null,
  pipe: "pipe",
  overlapped: "pipe",
  inherit: "inherit"
};

class ShimmedStdin extends EventEmitter {
  constructor() {
    super();
  }
  write() {
    return false;
  }
  destroy() {
  }
  end() {
  }
  pipe() {
  }
}

class ShimmedStdioOutStream extends EventEmitter {
  pipe() {
  }
}
var validateAbortSignal = (signal, name) => {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};
var validateObject = (value, name, options = null) => {
  const allowArray = options?.allowArray ?? false;
  const allowFunction = options?.allowFunction ?? false;
  const nullable = options?.nullable ?? false;
  if (!nullable && value === null || !allowArray && ArrayIsArray.call(value) || typeof value !== "object" && (!allowFunction || typeof value !== "function")) {
    throw new ERR_INVALID_ARG_TYPE(name, "object", value);
  }
};
var validateArray = (value, name, minLength = 0) => {
  if (!ArrayIsArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    const reason = `must be longer than ${minLength}`;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};
var Error = globalThis.Error;
var TypeError = globalThis.TypeError;
var RangeError = globalThis.RangeError;

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
var child_process_default = {
  ChildProcess,
  spawn,
  execFile,
  exec,
  fork,
  spawnSync,
  execFileSync,
  execSync,
  [Symbol.for("CommonJS")]: 0
};
export {
  spawnSync,
  spawn,
  fork,
  execSync,
  execFileSync,
  execFile,
  exec,
  child_process_default as default,
  ChildProcess
};

//# debugId=EAE716ABDB59DB0164756e2164756e21
