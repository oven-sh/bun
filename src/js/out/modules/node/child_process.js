function spawn(file, args, options) {
  options = normalizeSpawnArguments(file, args, options), validateTimeout(options.timeout), validateAbortSignal(options.signal, "options.signal");
  const killSignal2 = sanitizeKillSignal(options.killSignal), child = new ChildProcess;
  if (debug("spawn", options), child.spawn(options), options.timeout > 0) {
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
      if (timeoutId)
        clearTimeout(timeoutId), timeoutId = null;
    });
  }
  if (options.signal) {
    let onAbortListener = function() {
      abortChildProcess(child, killSignal2);
    };
    const signal = options.signal;
    if (signal.aborted)
      process.nextTick(onAbortListener);
    else
      signal.addEventListener("abort", onAbortListener, { once: !0 }), child.once("exit", () => signal.removeEventListener("abort", onAbortListener));
  }
  return child;
}
function execFile(file, args, options, callback) {
  ({ file, args, options, callback } = normalizeExecFileArgs(file, args, options, callback)), options = {
    encoding: "utf8",
    timeout: 0,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGTERM",
    cwd: null,
    env: null,
    shell: !1,
    ...options
  };
  const maxBuffer = options.maxBuffer;
  validateTimeout(options.timeout), validateMaxBuffer(maxBuffer), options.killSignal = sanitizeKillSignal(options.killSignal);
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    signal: options.signal
  });
  let encoding;
  const _stdout = [], _stderr = [];
  if (options.encoding !== "buffer" && BufferIsEncoding(options.encoding))
    encoding = options.encoding;
  else
    encoding = null;
  let stdoutLen = 0, stderrLen = 0, killed = !1, exited = !1, timeoutId, encodedStdoutLen, encodedStderrLen, ex = null, cmd = file;
  function exitHandler(code, signal) {
    if (exited)
      return;
    if (exited = !0, timeoutId)
      clearTimeout(timeoutId), timeoutId = null;
    if (!callback)
      return;
    const readableEncoding = child?.stdout?.readableEncoding;
    let stdout, stderr;
    if (encoding || child.stdout && readableEncoding)
      stdout = ArrayPrototypeJoin.call(_stdout, "");
    else
      stdout = BufferConcat(_stdout);
    if (encoding || child.stderr && readableEncoding)
      stderr = ArrayPrototypeJoin.call(_stderr, "");
    else
      stderr = BufferConcat(_stderr);
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
    ex.cmd = cmd, callback(ex, stdout, stderr);
  }
  function errorHandler(e) {
    if (ex = e, child.stdout)
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
    killed = !0;
    try {
      child.kill(options.killSignal);
    } catch (e) {
      ex = e, exitHandler();
    }
  }
  if (options.timeout > 0)
    timeoutId = setTimeout(function delayedKill() {
      kill(), timeoutId = null;
    }, options.timeout);
  if (child.stdout) {
    if (encoding)
      child.stdout.setEncoding(encoding);
    child.stdout.on("data", maxBuffer === Infinity ? function onUnlimitedSizeBufferedData(chunk) {
      ArrayPrototypePush.call(_stdout, chunk);
    } : encoding ? function onChildStdoutEncoded(chunk) {
      if (stdoutLen += chunk.length, stdoutLen * 4 > maxBuffer) {
        const encoding2 = child.stdout.readableEncoding, actualLen = Buffer.byteLength(chunk, encoding2);
        if (encodedStdoutLen === void 0)
          for (let i = 0;i < _stdout.length; i++)
            encodedStdoutLen += Buffer.byteLength(_stdout[i], encoding2);
        else
          encodedStdoutLen += actualLen;
        const truncatedLen = maxBuffer - (encodedStdoutLen - actualLen);
        ArrayPrototypePush.call(_stdout, StringPrototypeSlice.apply(chunk, 0, truncatedLen)), ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout"), kill();
      } else
        ArrayPrototypePush.call(_stdout, chunk);
    } : function onChildStdoutRaw(chunk) {
      if (stdoutLen += chunk.length, stdoutLen > maxBuffer) {
        const truncatedLen = maxBuffer - (stdoutLen - chunk.length);
        ArrayPrototypePush.call(_stdout, chunk.slice(0, truncatedLen)), ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout"), kill();
      } else
        ArrayPrototypePush.call(_stdout, chunk);
    });
  }
  if (child.stderr) {
    if (encoding)
      child.stderr.setEncoding(encoding);
    child.stderr.on("data", maxBuffer === Infinity ? function onUnlimitedSizeBufferedData(chunk) {
      ArrayPrototypePush.call(_stderr, chunk);
    } : encoding ? function onChildStderrEncoded(chunk) {
      if (stderrLen += chunk.length, stderrLen * 4 > maxBuffer) {
        const encoding2 = child.stderr.readableEncoding, actualLen = Buffer.byteLength(chunk, encoding2);
        if (encodedStderrLen === void 0)
          for (let i = 0;i < _stderr.length; i++)
            encodedStderrLen += Buffer.byteLength(_stderr[i], encoding2);
        else
          encodedStderrLen += actualLen;
        const truncatedLen = maxBuffer - (encodedStderrLen - actualLen);
        ArrayPrototypePush.call(_stderr, StringPrototypeSlice.call(chunk, 0, truncatedLen)), ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr"), kill();
      } else
        ArrayPrototypePush.call(_stderr, chunk);
    } : function onChildStderrRaw(chunk) {
      if (stderrLen += chunk.length, stderrLen > maxBuffer) {
        const truncatedLen = maxBuffer - (stderrLen - chunk.length);
        ArrayPrototypePush.call(_stderr, StringPrototypeSlice.call(chunk, 0, truncatedLen)), ex = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr"), kill();
      } else
        ArrayPrototypePush.call(_stderr, chunk);
    });
  }
  return child.addListener("close", exitHandler), child.addListener("error", errorHandler), child;
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
  const { maxBuffer, encoding } = options;
  debug("spawnSync", options), validateTimeout(options.timeout), validateMaxBuffer(maxBuffer), options.killSignal = sanitizeKillSignal(options.killSignal);
  const stdio = options.stdio || "pipe", bunStdio = getBunStdioFromOptions(stdio);
  var { input } = options;
  if (input)
    if (ArrayBufferIsView(input))
      bunStdio[0] = input;
    else if (typeof input === "string")
      bunStdio[0] = Buffer.from(input, encoding || "utf8");
    else
      throw new ERR_INVALID_ARG_TYPE(`options.stdio[0]`, ["Buffer", "TypedArray", "DataView", "string"], input);
  const { stdout, stderr, success, exitCode } = Bun.spawnSync({
    cmd: options.args,
    env: options.env || void 0,
    cwd: options.cwd || void 0,
    stdin: bunStdio[0],
    stdout: bunStdio[1],
    stderr: bunStdio[2]
  }), result = {
    signal: null,
    status: exitCode,
    output: [null, stdout, stderr]
  };
  if (stdout && encoding && encoding !== "buffer")
    result.output[1] = result.output[1]?.toString(encoding);
  if (stderr && encoding && encoding !== "buffer")
    result.output[2] = result.output[2]?.toString(encoding);
  if (result.stdout = result.output[1], result.stderr = result.output[2], !success)
    result.error = new SystemError(result.output[2], options.file, "spawnSync", -1, result.status), result.error.spawnargs = ArrayPrototypeSlice.call(options.args, 1);
  return result;
}
function execFileSync(file, args, options) {
  ({ file, args, options } = normalizeExecFileArgs(file, args, options));
  const ret = spawnSync(file, args, options), errArgs = [options.argv0 || file];
  ArrayPrototypePush.apply(errArgs, args);
  const err = checkExecSyncError(ret, errArgs);
  if (err)
    throw err;
  return ret.stdout;
}
function execSync(command, options) {
  const opts = normalizeExecArgs(command, options, null), ret = spawnSync(opts.file, opts.options), err = checkExecSyncError(ret, void 0, command);
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
}, sanitizeKillSignal = function(killSignal2) {
  if (typeof killSignal2 === "string" || typeof killSignal2 === "number")
    return convertToValidSignal(killSignal2);
  else if (killSignal2 != null)
    throw new ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal2);
}, getSignalsToNamesMapping = function() {
  if (signalsToNamesMapping !== void 0)
    return signalsToNamesMapping;
  signalsToNamesMapping = ObjectCreate(null);
  for (let key in signals)
    signalsToNamesMapping[signals[key]] = key;
  return signalsToNamesMapping;
}, normalizeExecFileArgs = function(file, args, options, callback) {
  if (ArrayIsArray(args))
    args = ArrayPrototypeSlice.call(args);
  else if (args != null && typeof args === "object")
    callback = options, options = args, args = null;
  else if (typeof args === "function")
    callback = args, options = null, args = null;
  if (args == null)
    args = [];
  if (typeof options === "function")
    callback = options;
  else if (options != null)
    validateObject(options, "options");
  if (options == null)
    options = kEmptyObject;
  if (callback != null)
    validateFunction(callback, "callback");
  if (options.argv0 != null)
    validateString(options.argv0, "options.argv0"), validateArgumentNullCheck(options.argv0, "options.argv0");
  return { file, args, options, callback };
}, normalizeExecArgs = function(command, options, callback) {
  if (validateString(command, "command"), validateArgumentNullCheck(command, "command"), typeof options === "function")
    callback = options, options = void 0;
  return options = { ...options }, options.shell = typeof options.shell === "string" ? options.shell : !0, {
    file: command,
    options,
    callback
  };
}, normalizeSpawnArguments = function(file, args, options) {
  if (validateString(file, "file"), validateArgumentNullCheck(file, "file"), file.length === 0)
    throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");
  if (ArrayIsArray(args))
    args = ArrayPrototypeSlice.call(args);
  else if (args == null)
    args = [];
  else if (typeof args !== "object")
    throw new ERR_INVALID_ARG_TYPE("args", "object", args);
  else
    options = args, args = [];
  if (validateArgumentsNullCheck(args, "args"), options === void 0)
    options = {};
  else
    validateObject(options, "options");
  let cwd = options.cwd;
  if (cwd != null)
    cwd = getValidatedPath(cwd, "options.cwd");
  if (options.shell != null && typeof options.shell !== "boolean" && typeof options.shell !== "string")
    throw new ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], options.shell);
  if (options.argv0 != null)
    validateString(options.argv0, "options.argv0"), validateArgumentNullCheck(options.argv0, "options.argv0");
  if (options.shell) {
    validateArgumentNullCheck(options.shell, "options.shell");
    const command = ArrayPrototypeJoin.call([file, ...args], " ");
    if (typeof options.shell === "string")
      file = options.shell;
    else
      file = "sh";
    args = ["-c", command];
  }
  if (typeof options.argv0 === "string")
    ArrayPrototypeUnshift.call(args, options.argv0);
  else
    ArrayPrototypeUnshift.call(args, file);
  const envPairs = options.env || process.env;
  return { ...options, file, args, cwd, envPairs };
}, checkExecSyncError = function(ret, args, cmd) {
  let err;
  if (ret.error)
    err = ret.error, ObjectAssign(err, ret);
  else if (ret.status !== 0) {
    let msg = "Command failed: ";
    if (msg += cmd || ArrayPrototypeJoin.call(args, " "), ret.stderr && ret.stderr.length > 0)
      msg += `\n${ret.stderr.toString()}`;
    err = genericNodeError(msg, ret);
  }
  return err;
}, nodeToBun = function(item) {
  if (typeof item === "number")
    return item;
  else {
    const result = nodeToBunLookup[item];
    if (result === void 0)
      throw new Error("Invalid stdio option");
    return result;
  }
}, fdToStdioName = function(fd) {
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
}, getBunStdioFromOptions = function(stdio) {
  return normalizeStdio(stdio).map((item) => nodeToBun(item));
}, normalizeStdio = function(stdio) {
  if (typeof stdio === "string")
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
  else if (ArrayIsArray(stdio)) {
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
  } else
    throw new ERR_INVALID_OPT_VALUE("stdio", stdio);
}, flushStdio = function(subprocess) {
  const stdio = subprocess.stdio;
  if (stdio == null)
    return;
  for (let i = 0;i < stdio.length; i++) {
    const stream = stdio[i];
    if (!stream || !stream.readable)
      continue;
    stream.resume();
  }
}, onSpawnNT = function(self) {
  self.emit("spawn");
}, abortChildProcess = function(child, killSignal2) {
  if (!child)
    return;
  try {
    if (child.kill(killSignal2))
      child.emit("error", new AbortError);
  } catch (err) {
    child.emit("error", err);
  }
}, validateMaxBuffer = function(maxBuffer) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0))
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
}, validateArgumentNullCheck = function(arg, propName) {
  if (typeof arg === "string" && StringPrototypeIncludes.call(arg, "\0"))
    throw new ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
}, validateArgumentsNullCheck = function(args, propName) {
  for (let i = 0;i < args.length; ++i)
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
}, validateTimeout = function(timeout) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0))
    throw new ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
};
var validateFunction = function(value, name) {
  if (typeof value !== "function")
    throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
}, validateString = function(value, name) {
  if (typeof value !== "string")
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}, nullCheck = function(path, propName, throwError = !0) {
  const pathIsString = typeof path === "string", pathIsUint8Array = isUint8Array(path);
  if (!pathIsString && !pathIsUint8Array || pathIsString && !StringPrototypeIncludes.call(path, "\0") || pathIsUint8Array && !Uint8ArrayPrototypeIncludes.call(path, 0))
    return;
  const err = new ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError)
    throw err;
  return err;
}, validatePath = function(path, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path))
    throw new ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
  const err = nullCheck(path, propName, !1);
  if (err !== void 0)
    throw err;
}, getValidatedPath = function(fileURLOrPath, propName = "path") {
  const path = toPathIfFileURL(fileURLOrPath);
  return validatePath(path, propName), path;
}, isUint8Array = function(value) {
  return typeof value === "object" && value !== null && value instanceof Uint8Array;
}, isURLInstance = function(fileURLOrPath) {
  return fileURLOrPath != null && fileURLOrPath.href && fileURLOrPath.origin;
}, toPathIfFileURL = function(fileURLOrPath) {
  if (!isURLInstance(fileURLOrPath))
    return fileURLOrPath;
  return Bun.fileURLToPath(fileURLOrPath);
}, genericNodeError = function(message, options) {
  const err = new Error(message);
  return err.code = options.code, err.killed = options.killed, err.signal = options.signal, err;
}, ERR_OUT_OF_RANGE = function(str, range, input, replaceDefaultBoolean = !1) {
  return new RangeError(`The value of ${str} is out of range. It must be ${range}. Received ${input}`);
}, ERR_CHILD_PROCESS_STDIO_MAXBUFFER = function(stdio) {
  return Error(`${stdio} maxBuffer length exceeded`);
}, ERR_UNKNOWN_SIGNAL = function(name) {
  const err = new TypeError(`Unknown signal: ${name}`);
  return err.code = "ERR_UNKNOWN_SIGNAL", err;
}, ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  return err.code = "ERR_INVALID_ARG_TYPE", err;
}, ERR_INVALID_OPT_VALUE = function(name, value) {
  return new TypeError(`The value "${value}" is invalid for option "${name}"`);
}, ERR_INVALID_ARG_VALUE = function(name, value, reason) {
  return new Error(`The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`);
}, EventEmitter = import.meta.require("node:events"), {
  Readable: { fromWeb: ReadableFromWeb },
  NativeWritable
} = import.meta.require("node:stream"), {
  constants: { signals }
} = import.meta.require("node:os"), { promisify } = import.meta.require("node:util"), { ArrayBuffer, Uint8Array, String, Object, Buffer, Promise: Promise2 } = import.meta.primordials, ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty, ObjectCreate = Object.create, ObjectAssign = Object.assign, ObjectDefineProperty = Object.defineProperty, BufferConcat = Buffer.concat, BufferIsEncoding = Buffer.isEncoding, kEmptyObject = ObjectCreate(null), ArrayPrototypePush = Array.prototype.push, ArrayPrototypeReduce = Array.prototype.reduce, ArrayPrototypeFilter = Array.prototype.filter, ArrayPrototypeJoin = Array.prototype.join, ArrayPrototypeMap = Array.prototype.map, ArrayPrototypeIncludes = Array.prototype.includes, ArrayPrototypeSlice = Array.prototype.slice, ArrayPrototypeUnshift = Array.prototype.unshift, ArrayIsArray = Array.isArray, ArrayBufferIsView = ArrayBuffer.isView, NumberIsInteger = Number.isInteger;
var StringPrototypeToUpperCase = String.prototype.toUpperCase, StringPrototypeIncludes = String.prototype.includes, StringPrototypeSlice = String.prototype.slice, Uint8ArrayPrototypeIncludes = Uint8Array.prototype.includes, MAX_BUFFER = 1048576, __DEBUG__ = process.env.DEBUG || !1, __TRACK_STDIO__ = process.env.DEBUG_STDIO, debug = __DEBUG__ ? console.log : () => {
};
if (__TRACK_STDIO__)
  debug("child_process: debug mode on"), globalThis.__lastId = null, globalThis.__getId = () => {
    return globalThis.__lastId !== null ? globalThis.__lastId++ : 0;
  };
var customPromiseExecFunction = (orig) => {
  return (...args) => {
    let resolve, reject;
    const promise = new Promise2((res, rej) => {
      resolve = res, reject = rej;
    });
    return promise.child = orig(...args, (err, stdout, stderr) => {
      if (err !== null)
        err.stdout = stdout, err.stderr = stderr, reject(err);
      else
        resolve({ stdout, stderr });
    }), promise;
  };
};
ObjectDefineProperty(exec, promisify.custom, {
  __proto__: null,
  enumerable: !1,
  value: customPromiseExecFunction(exec)
});
var signalsToNamesMapping;

class ChildProcess extends EventEmitter {
  #handle;
  #exited = !1;
  #closesNeeded = 1;
  #closesGot = 0;
  connected = !1;
  signalCode = null;
  exitCode = null;
  spawnfile;
  spawnargs;
  pid;
  channel;
  get killed() {
    if (this.#handle == null)
      return !1;
  }
  #handleOnExit(exitCode, signalCode, err) {
    if (this.#exited)
      return;
    if (this.exitCode = this.#handle.exitCode, this.signalCode = exitCode > 0 ? signalCode : null, this.#stdin)
      this.#stdin.destroy();
    if (this.#handle)
      this.#handle = null;
    if (exitCode < 0) {
      const err2 = new SystemError(`Spawned process exited with error code: ${exitCode}`, void 0, "spawn", "EUNKNOWN", "ERR_CHILD_PROCESS_UNKNOWN_ERROR");
      if (this.spawnfile)
        err2.path = this.spawnfile;
      err2.spawnargs = ArrayPrototypeSlice.call(this.spawnargs, 1), this.emit("error", err2);
    } else
      this.emit("exit", this.exitCode, this.signalCode);
    process.nextTick(flushStdio, this), this.#maybeClose(), this.#exited = !0, this.#stdioOptions = ["destroyed", "destroyed", "destroyed"];
  }
  #getBunSpawnIo(i, encoding) {
    if (__DEBUG__ && !this.#handle)
      if (this.#handle === null)
        debug("ChildProcess: getBunSpawnIo: this.#handle is null. This means the subprocess already exited");
      else
        debug("ChildProcess: getBunSpawnIo: this.#handle is undefined");
    const io = this.#stdioOptions[i];
    switch (i) {
      case 0:
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
      case 2:
      case 1:
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
    validateObject(options, "options"), validateString(options.file, "options.file");
    var file = this.spawnfile = options.file, spawnargs;
    if (options.args == null)
      spawnargs = this.spawnargs = [];
    else
      validateArray(options.args, "options.args"), spawnargs = this.spawnargs = options.args;
    const stdio = options.stdio || ["pipe", "pipe", "pipe"], bunStdio = getBunStdioFromOptions(stdio);
    var env = options.envPairs || void 0;
    this.#encoding = options.encoding || void 0, this.#stdioOptions = bunStdio, this.#handle = Bun.spawn({
      cmd: spawnargs,
      stdin: bunStdio[0],
      stdout: bunStdio[1],
      stderr: bunStdio[2],
      cwd: options.cwd || void 0,
      env: env || process.env,
      onExit: (handle, exitCode, signalCode, err) => {
        this.#handle = handle, this.pid = this.#handle.pid, process.nextTick((exitCode2, signalCode2, err2) => this.#handleOnExit(exitCode2, signalCode2, err2), exitCode, signalCode, err);
      },
      lazy: !0
    }), this.pid = this.#handle.pid, onSpawnNT(this);
  }
  send() {
    console.log("ChildProcess.prototype.send() - Sorry! Not implemented yet");
  }
  disconnect() {
    console.log("ChildProcess.prototype.disconnect() - Sorry! Not implemented yet");
  }
  kill(sig) {
    const signal = sig === 0 ? sig : convertToValidSignal(sig === void 0 ? "SIGTERM" : sig);
    if (this.#handle)
      this.#handle.kill(signal);
    return this.#maybeClose(), !0;
  }
  #maybeClose() {
    if (debug("Attempting to maybe close..."), this.#closesGot++, this.#closesGot === this.#closesNeeded)
      this.emit("close", this.exitCode, this.signalCode);
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
    return !1;
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
  if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal)))
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
};
var validateObject = (value, name, options = null) => {
  const allowArray = options?.allowArray ?? !1, allowFunction = options?.allowFunction ?? !1;
  if (!(options?.nullable ?? !1) && value === null || !allowArray && ArrayIsArray.call(value) || typeof value !== "object" && (!allowFunction || typeof value !== "function"))
    throw new ERR_INVALID_ARG_TYPE(name, "object", value);
}, validateArray = (value, name, minLength = 0) => {
  if (!ArrayIsArray(value))
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  if (value.length < minLength) {
    const reason = `must be longer than ${minLength}`;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
  }
}, Error = globalThis.Error, TypeError = globalThis.TypeError, RangeError = globalThis.RangeError;

class AbortError extends Error {
  code = "ABORT_ERR";
  name = "AbortError";
  constructor(message = "The operation was aborted", options = void 0) {
    if (options !== void 0 && typeof options !== "object")
      throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
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
    this.path = path, this.syscall = syscall, this.errno = errno, this.code = code;
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
