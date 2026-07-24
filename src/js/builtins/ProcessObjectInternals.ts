/*
 * Copyright Joyent, Inc. and other Node contributors.
 * Copyright 2023 Codeblog Corp. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const enum BunProcessStdinFdType {
  file = 0,
  pipe = 1,
  socket = 2,
}

export function getStdioWriteStream(
  process: typeof globalThis.process,
  fd: number,
  isTTY: boolean,
  fdType: BunProcessStdinFdType,
) {
  $assert(fd === 1 || fd === 2, `Expected fd to be 1 or 2, got ${fd}`);

  let stream;
  if (isTTY) {
    const tty = require("node:tty");
    stream = new tty.WriteStream(fd);
    // TODO: this is the wrong place for this property.
    // but the TTY is technically duplex
    // see test-fs-syncwritestream.js
    stream.readable = true;
    process.on("SIGWINCH", () => {
      stream._refreshSize();
    });
    stream._type = "tty";
  } else {
    const fs = require("node:fs");
    stream = new fs.WriteStream(null, { autoClose: false, fd, $fastPath: true });
    stream.readable = false;
    stream._type = "fs";

    // When stdout/stderr are piped or connected to a socket, they should have Symbol.asyncIterator
    // to match Node.js behavior where they become Duplex streams (Socket)
    // But when redirected to a file, they shouldn't have it
    if (fdType === BunProcessStdinFdType.pipe || fdType === BunProcessStdinFdType.socket) {
      stream[Symbol.asyncIterator] = function () {
        return (async function* () {
          // stdout/stderr don't produce readable data, so yield nothing
        })();
      };
    } else {
      // File-backed stdio: Node's SyncWriteStream runs end() -> finish ->
      // destroy -> the _destroy override below -> _undestroy(), which resets
      // writable state so later writes succeed. autoClose:false disabled that.
      stream._writableState.autoDestroy = true;
    }
  }

  if (fd === 1 || fd === 2) {
    stream.destroySoon = stream.destroy;
    stream._destroy = function (err, cb) {
      cb(err);
      this._undestroy();

      if (!this._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };

    const kFastPath = require("internal/fs/streams").kWriteStreamFastPath;
    stream._final = function (cb) {
      try {
        const sink = this[kFastPath];
        if (sink && sink !== true) {
          const result = sink.flush();
          if ($isPromise(result)) {
            result.then(
              () => cb(null),
              err => cb(err),
            );
            return;
          }
        }
        cb(null);
      } catch (err) {
        cb(err);
      }
    };
  }

  stream._isStdio = true;
  stream.fd = fd;

  const underlyingSink = stream[require("internal/fs/streams").kWriteStreamFastPath];
  $assert(underlyingSink);
  return [stream, underlyingSink];
}

export function getStdinStream(
  process: typeof globalThis.process,
  fd: number,
  isTTY: boolean,
  fdType: BunProcessStdinFdType,
) {
  $assert(fd === 0);
  const native = Bun.stdin.stream();
  const source = native.$bunNativePtr;

  var reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  let needsInternalReadRefresh = false;
  // if true, while the stream is own()ed it will not
  let forceUnref = false;

  function own() {
    // After EOF there is nothing left to read: no acquisition path ('readable'
    // listeners, resume(), ref(), an explicit read()) may take the reader back.
    if (stream_reachedEof) return;
    $debug("ref();", reader ? "already has reader" : "getting reader");
    reader ??= native.getReader();
    source.updateRef(forceUnref ? false : true);
    source?.setFlowing?.(true);

    if (needsInternalReadRefresh) {
      needsInternalReadRefresh = false;
      internalRead(stream);
    }
  }

  function disown() {
    $debug("unref();");
    source?.setFlowing?.(false);

    if (reader) {
      // releaseLock() rejects any in-flight internalRead() with a TypeError; that
      // rejection is handled there by observing that `reader` was cleared here.
      reader.releaseLock();
      reader = undefined;
      $debug("released reader");
    }
    source?.updateRef?.(false);
  }

  const ReadStream = isTTY ? require("node:tty").ReadStream : require("node:fs").ReadStream;
  const stream = new ReadStream(null, { fd, autoClose: false });

  const originalOn = stream.on;

  let stream_destroyed = false;
  let stream_reachedEof = false;
  stream.addListener = stream.on = function (event, listener) {
    // Streams don't generally required to present any data when only
    // `readable` events are present, i.e. `readableFlowing === false`
    //
    // However, Node.js has a this quirk whereby `process.stdin.read()`
    // blocks under TTY mode, thus looping `.read()` in this particular
    // case would not result in truncation.
    //
    // Therefore the following hack is only specific to `process.stdin`
    // and does not apply to the underlying Stream implementation.
    if (event === "readable") {
      own();
    }
    return originalOn.$call(this, event, listener);
  };

  stream.fd = fd;

  // tty.ReadStream is supposed to extend from net.Socket.
  // but we haven't made that work yet. Until then, we need to manually add some of net.Socket's methods
  if (isTTY || fdType !== BunProcessStdinFdType.file) {
    stream.ref = function () {
      forceUnref = false;
      own();
      return this;
    };

    stream.unref = function () {
      forceUnref = true;
      source?.updateRef?.(false);
      return this;
    };
  }

  const originalPause = stream.pause;
  stream.pause = function () {
    return originalPause.$call(this);
  };

  const originalResume = stream.resume;
  stream.resume = function () {
    own();
    return originalResume.$call(this);
  };

  const originalRead = stream.read;
  stream.read = function (size) {
    const ret = originalRead.$call(this, size);
    // An explicit read() must acquire the native reader: _read() without one only
    // records needsInternalReadRefresh, which own() replays. Owning afterwards so a
    // throwing size never refs stdin; read(0) kicks never own (pause() relies on it).
    if (size !== 0 && reader === undefined && !stream_destroyed) {
      own();
    }
    return ret;
  };

  function rethrowUncaught(err) {
    throw err;
  }

  async function internalRead(stream) {
    $debug("internalRead();");
    // The reader this read belongs to. releaseLock() rejects the in-flight read(); by the
    // time that rejection lands, own() may already have acquired a NEW reader, so the catch
    // must key on this acquisition rather than on the current `reader`.
    const readerForThisRead = reader;
    let value;
    try {
      $assert(readerForThisRead);
      ({ value } = await readerForThisRead.read());
    } catch (err) {
      if (readerForThisRead !== reader) {
        // disown() released this read's reader while it was in flight (stdin may have been
        // re-owned since), so the read rejected because the stream was unref()ed, not
        // because it failed. triggerRead() re-arms if/when it is ref()ed again.
        triggerRead.$call(stream, undefined);
        return;
      }
      stream.destroy(err);
      return;
    }

    try {
      if (value) {
        stream.push(value);
      } else {
        // EOF. Nothing is left to read, so release the native reader before
        // push(null) runs user 'readable' listeners; the process must be able
        // to exit even if one of them throws or never drains the buffer.
        stream_reachedEof = true;
        disown();
        // push(null) instead of emitting 'end' by hand so read(n) can still
        // return the buffered < n byte remainder and 'end'/'readableEnded'
        // come from the stream machinery once the buffer drains.
        stream.push(null);
      }
    } catch (err) {
      if (value) triggerRead.$call(stream, undefined);
      process.nextTick(rethrowUncaught, err);
    }
  }

  function triggerRead(_size) {
    $debug("_read();", reader);

    if (reader) {
      internalRead(this);
    } else {
      // The stream has not been ref()ed yet. If it is ever ref()ed,
      // run internalRead()
      needsInternalReadRefresh = true;
    }
  }
  stream._read = triggerRead;

  stream.on("resume", () => {
    if (stream.isPaused()) return; // fake resume
    $debug('on("resume");');
    own();
    stream._undestroy();
    stream_destroyed = false;
  });

  stream._readableState.reading = false;

  stream.on("pause", () => {
    process.nextTick(() => {
      // Only disown if the stream is still paused (not resumed in the meantime)
      if (!stream.readableFlowing) {
        stream._readableState.reading = false;
        disown();
      }
    });
  });

  // The stream is created with autoClose: false so autoDestroy is off; match
  // Node by destroying stdin once 'end' has emitted ('close' follows 'end').
  stream.on("end", () => {
    if (!stream_destroyed) {
      stream_destroyed = true;
      process.nextTick(() => {
        stream.destroy();
      });
    }
  });

  stream.on("close", () => {
    if (!stream_destroyed) {
      stream_destroyed = true;
      process.nextTick(() => {
        stream.destroy();
        disown();
      });
    }
  });

  return stream;
}
export function initializeNextTickQueue(
  process: typeof globalThis.process,
  nextTickQueue,
  drainMicrotasksFn,
  reportUncaughtExceptionFn,
) {
  var queue;
  var tickInitHooks;
  var process;
  var nextTickQueue = nextTickQueue;
  var drainMicrotasks = drainMicrotasksFn;
  var reportUncaughtException = reportUncaughtExceptionFn;

  const { validateFunction } = require("internal/validators");

  var setup;
  setup = () => {
    const { FixedQueue } = require("internal/fixed_queue");
    queue = new FixedQueue();
    tickInitHooks = require("internal/async_hooks_tick").tickInitHooks;

    function processTicksAndRejections() {
      var tock;
      do {
        while ((tock = queue.shift()) !== null) {
          var callback = tock.callback;
          var args = tock.args;
          var frame = tock.frame;
          var restore = $getInternalField($asyncContext, 0);
          $putInternalField($asyncContext, 0, frame);
          try {
            if (args === undefined) {
              callback();
            } else {
              switch (args.length) {
                case 1:
                  callback(args[0]);
                  break;
                case 2:
                  callback(args[0], args[1]);
                  break;
                case 3:
                  callback(args[0], args[1], args[2]);
                  break;
                case 4:
                  callback(args[0], args[1], args[2], args[3]);
                  break;
                default:
                  callback(...args);
                  break;
              }
            }
          } catch (e) {
            reportUncaughtException(e);
          } finally {
            $putInternalField($asyncContext, 0, restore);
          }
        }

        drainMicrotasks();
      } while (!queue.isEmpty());
    }

    $putInternalField(nextTickQueue, 0, 0);
    $putInternalField(nextTickQueue, 1, queue);
    $putInternalField(nextTickQueue, 2, processTicksAndRejections);
    setup = undefined;
  };

  function nextTick(cb, ...args) {
    validateFunction(cb, "callback");
    if (setup) {
      setup();
      process = globalThis.process;
    }
    if (process._exiting) return;

    const tock = {
      callback: cb,
      // We want to avoid materializing the args if there are none because it's
      // a waste of memory and Array.prototype.slice shows up in profiling.
      args: $argumentCount() > 1 ? args : undefined,
      frame: $getInternalField($asyncContext, 0),
    };
    if (tickInitHooks.length !== 0) {
      // node fires one TickObject init per process.nextTick() call, at
      // construction time (before the callback runs).
      const asyncHooksTick = require("internal/async_hooks_tick");
      const asyncId = asyncHooksTick.newAsyncId();
      // Snapshot: enable()/disable() from inside a hook must not affect the
      // in-flight dispatch (node stages such mutations in tmp_array until
      // the emit completes).
      const hooks = tickInitHooks.slice();
      for (let i = 0; i < hooks.length; i++) {
        try {
          hooks[i](asyncId, "TickObject", 0, tock);
        } catch (err) {
          // node: a throwing init hook is fatal (fatalError: print + exit 1),
          // never surfaced to the process.nextTick() caller. console is a
          // user-mutable global, so shield the print; exit regardless.
          try {
            console.error(typeof err?.stack === "string" ? err.stack : err);
          } catch {}
          process.exit(1);
        }
      }
    }
    queue.push(tock);
    $putInternalField(nextTickQueue, 0, 1);
  }

  return nextTick;
}

type InternalEnvMap = Record<string, string>;
type EditWindowsEnvVarCb = (key: string, value: null | string) => void;

export function windowsEnv(
  internalEnv: InternalEnvMap,
  envMapList: Array<string>,
  editWindowsEnvVar: EditWindowsEnvVarCb,
  coerceForWrite,
  resetTZ,
) {
  (internalEnv as any)[Bun.inspect.custom] = () => {
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

  (internalEnv as any).toJSON = () => {
    // Mirror enumeration: original-case key names, case-insensitive values.
    // Spreading internalEnv directly would leak the canonical UPPERCASE
    // storage keys into JSON.stringify(process.env) and IPC env echoes.
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

  // Shared write path for the `set` and `defineProperty` traps. Plain
  // assignment (never Object.defineProperty on the target) keeps the
  // proxy CustomAccessors on `internalEnv` and their side effects intact.
  function writeEnvVar(p: string, k: string, value: unknown) {
    // coerceForWrite runs Node's EnvSetter semantics (DEP0104 for
    // non-string values under --pending-deprecation, then ToString) and
    // fires the TZ timezone side effect on every write, so it survives a
    // prior `delete process.env.TZ` dropping the CustomAccessor.
    const coerced = coerceForWrite(k, value);
    // Track the key for enumeration if it isn't already there. Don't gate on
    // `k in internalEnv`: the proxy accessors (HTTP_PROXY, ...) always exist
    // as DontEnum CustomAccessors even when the variable was never set.
    if (!envMapList.includes(p) && !envMapList.some(x => x.toUpperCase() === k)) {
      envMapList.push(p);
    }
    if (internalEnv[k] !== coerced) {
      editWindowsEnvVar(k, coerced);
      internalEnv[k] = coerced;
    }
  }

  return new Proxy(internalEnv, {
    get(_, p) {
      if (typeof p !== "string") {
        // Symbol keys (e.g. Bun.inspect.custom) live on internalEnv as-is.
        return (internalEnv as any)[p];
      }
      // Env-var lookup is case-insensitive on Windows: the canonical
      // uppercase key wins when the variable exists.
      const k = p.toUpperCase();
      if (k in internalEnv) {
        return internalEnv[k];
      }
      // Not an env var: fall through to own as-is properties (toJSON) and
      // inherited Object.prototype methods (hasOwnProperty, toString, ...),
      // matching node where `process.env.hasOwnProperty` is callable.
      return internalEnv[p];
    },
    set(_, p, value) {
      // Node's process.env throws a TypeError for symbol keys and symbol
      // values (ToString on a Symbol throws).
      if (typeof p === "symbol" || typeof value === "symbol") {
        throw new TypeError("Cannot convert a Symbol value to a string");
      }
      const k = p.toUpperCase();
      // Node silently ignores assignments to an empty variable name
      // (https://github.com/nodejs/node/issues/32920).
      if (k === "") {
        return true;
      }
      // If toString() throws, we want to avoid the key existing in envMapList.
      writeEnvVar(p, k, value);
      return true;
    },
    has(_, p) {
      // Case-insensitive env-var query first, then ordinary lookup so own
      // as-is properties and Object.prototype methods answer `in` like node
      // (`'hasOwnProperty' in process.env` is true on all platforms).
      if (typeof p === "string" && p.toUpperCase() in internalEnv) {
        return true;
      }
      return p in internalEnv;
    },
    deleteProperty(_, p) {
      // Deleting a symbol key is a no-op that reports success in Node.
      if (typeof p === "symbol") {
        return true;
      }
      const k = String(p).toUpperCase();
      const i = envMapList.findIndex(x => x.toUpperCase() === k);
      if (i !== -1) {
        envMapList.splice(i, 1);
      }
      editWindowsEnvVar(k, null);
      // Node's RealEnvStore::Delete resets Date caches for TZ; internalEnv
      // is a plain object here so `delete internalEnv[k]` never reaches the
      // TZ setter — fire the reset explicitly.
      if (k === "TZ") resetTZ();
      return delete internalEnv[k];
    },
    defineProperty(_, p, attributes) {
      // String(symbol) does not throw (it returns the descriptive string), so
      // reject symbol keys explicitly like the set trap does.
      if (typeof p === "symbol") {
        throw new TypeError("Cannot convert a Symbol value to a string");
      }
      // Same validation as JSEnvironmentVariableMap::defineOwnProperty on
      // POSIX: only plain, fully-permissive data descriptors are accepted.
      if ("get" in attributes || "set" in attributes) {
        throw $ERR_INVALID_OBJECT_DEFINE_PROPERTY(
          "'process.env' does not accept an accessor(getter/setter) descriptor",
        );
      }
      // Node also requires a [[Value]]: a value-less data descriptor is
      // rejected rather than defining the property as undefined.
      if (
        !("value" in attributes) ||
        attributes.configurable !== true ||
        attributes.writable !== true ||
        attributes.enumerable !== true
      ) {
        throw $ERR_INVALID_OBJECT_DEFINE_PROPERTY(
          "'process.env' only accepts a configurable, writable, and enumerable data descriptor",
        );
      }
      if (typeof attributes.value === "symbol") {
        throw new TypeError("Cannot convert a Symbol value to a string");
      }
      const k = p.toUpperCase();
      // Node silently ignores an empty variable name, like the set trap.
      if (k === "") {
        return true;
      }
      // Node's EnvDefiner delegates the validated value to EnvSetter, i.e.
      // plain assignment — never a real defineProperty on the target.
      writeEnvVar(p, k, attributes.value);
      return true;
    },
    getOwnPropertyDescriptor(target, p) {
      if (typeof p === "string") {
        const desc = Reflect.getOwnPropertyDescriptor(target, p.toUpperCase());
        if (desc) return desc;
      }
      // Own as-is properties (toJSON, Bun.inspect.custom symbol).
      return Reflect.getOwnPropertyDescriptor(target, p);
    },
    ownKeys() {
      // .slice() because paranoia that there is a way to call this without the engine cloning it for us
      return envMapList.slice();
    },
  });
}

export function getChannel() {
  const EventEmitter = require("node:events");
  const setRef = $newRustFunction("node_cluster_binding.rs", "setRef", 1);
  return new (class Control extends EventEmitter {
    constructor() {
      super();
    }

    ref() {
      setRef(true);
    }

    unref() {
      setRef(false);
    }
  })();
}

export function rawDebug() {
  // util.format straight to fd 2, bypassing process.stderr (which may be
  // hijacked or broken). os.EOL, not "\n": Node's _rawDebug writes through
  // text-mode stderr (\r\n on Windows) and the upstream test asserts it.
  const { formatWithOptions } = require("node:util");
  const { writeSync } = require("node:fs");
  const { EOL } = require("node:os");
  // Node's _rawDebug is a never-throw last resort (fwrite return ignored):
  // an EBADF on a closed fd 2 must not surface.
  try {
    writeSync(2, formatWithOptions({}, ...arguments) + EOL);
  } catch {}
}

export function installOnWarningListener(process, redirectPath, disabledArr) {
  // Port of Node's lib/internal/process/warning.js onWarning, registered as a
  // real 'warning' listener so removeAllListeners('warning') silences it and
  // a throwing user listener does not skip the print.
  //
  // node:fs is only loaded when --redirect-warnings/NODE_REDIRECT_WARNINGS is
  // set; the common case (no redirect) never needs it.
  const appendFileSync = redirectPath ? require("node:fs").appendFileSync : undefined;
  // Capture at install time so later tampering with globalThis.console
  // cannot silence warnings.
  const consoleError = console.error;
  // --disable-warning names/codes as a Set: matches Node's SafeSet lookup
  // and avoids an FFI + utf8() encode per emit.
  const disabled = disabledArr && disabledArr.length ? new Set(disabledArr) : null;
  let traceWarningHelperShown = false;

  function writeOut(message) {
    if (redirectPath) {
      try {
        appendFileSync(redirectPath, message + "\n");
        return;
      } catch {
        // Intentional simplification: appendFileSync opens per-write and
        // falls back to stderr per-warning on failure, whereas Node holds a
        // single fd and writes async. Open failures retry on the next
        // warning like Node's writeToFile.
      }
    }
    // console.error goes through process.stderr, so hijackStderr in tests
    // observes it and Windows console gets WriteConsoleW.
    consoleError(message);
  }

  function onWarning(warning) {
    if (!(warning instanceof Error)) return;
    const name = warning.name || "Warning";
    const isDeprecation = name === "DeprecationWarning";
    if (isDeprecation && process.noDeprecation) return;
    const code = warning.code;
    // --disable-warning filters the *print*, not the emit — user listeners
    // still receive the event (Node keeps this check inside onWarning).
    if (disabled && (disabled.has(name) || (code && disabled.has(code)))) return;
    const trace = process.traceProcessWarnings || (isDeprecation && process.traceDeprecation);
    let msg = `(node:${process.pid}) `;
    if (code) msg += `[${code}] `;
    // Only touch `.stack` when tracing: reading it materializes the lazy
    // stack trace and can run a user Error.prepareStackTrace, like Node's
    // `if (trace && warning.stack)` short-circuit.
    // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
    if (trace && warning.stack) {
      msg += warning.stack;
    } else {
      const s = typeof warning.toString === "function" ? warning.toString() : `${name}: ${warning.message}`;
      msg += s;
    }
    const detail = warning.detail;
    if (typeof detail === "string") msg += `\n${detail}`;
    writeOut(msg);
    if (!trace && !traceWarningHelperShown) {
      traceWarningHelperShown = true;
      const { basename } = require("node:path");
      writeOut(
        `(Use \`${basename(process.argv0 || "node")} --trace-warnings ...\` to show where the warning was created)`,
      );
    }
  }

  // prependListener: user listeners added before the first emitWarning must
  // still fire *after* the print, matching Node's bootstrap ordering.
  process.prependListener("warning", onWarning);
}

export function loadEnvFile(path) {
  // process.loadEnvFile(path = ".env"): parse a dotenv file and apply it to
  // process.env. Reading with fs gives the Node-shaped ENOENT error
  // ({ code, syscall: "open", path }) for missing files.
  if (path === undefined) {
    path = ".env";
  } else {
    const { validateString } = require("internal/validators");
    validateString(path, "path");
  }
  const content = require("node:fs").readFileSync(path, "utf8");
  const parsed = require("node:util").parseEnv(content);
  const env = process.env;
  for (const key of Object.keys(parsed)) {
    // Node: existing env keys win; the file only fills in missing ones.
    // Compare against undefined rather than `in`: accessor-backed keys (TZ,
    // HTTP_PROXY) always exist but read back undefined while unset.
    if (env[key] === undefined) {
      env[key] = parsed[key];
    }
  }
}

export function createProcessFinalization(process) {
  let entries: Array<{ ref: WeakRef<object>; fn: Function; evt: string }> = [];
  let installed = false;

  // Node uses validateObject(obj, "obj", kValidateObjectAllowFunction): the
  // ref may be a function (any WeakRef-compatible target), and the argument
  // is named "obj" in error messages.
  function validateRef(obj) {
    if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) {
      throw $ERR_INVALID_ARG_TYPE("obj", "object", obj);
    }
  }

  function runFinalization(event) {
    // Node clears refs[event] before invoking, so each registration fires
    // at most once even if beforeExit runs again. Splitting first also lets
    // a callback re-register for a later event without re-firing now.
    const toRun: typeof entries = [];
    entries = entries.filter(e => {
      if (e.evt !== event) return true;
      toRun.push(e);
      return false;
    });
    for (const entry of toRun) {
      const obj = entry.ref.deref();
      if (obj !== undefined) entry.fn(obj, event);
    }
  }

  function ensureInstalled() {
    if (installed) return;
    installed = true;
    // process.on (append), not prependListener: Node's install() uses
    // process.on so a user exit listener added before the first
    // finalization.register() fires before the finalization callback.
    process.on("exit", () => runFinalization("exit"));
    process.on("beforeExit", () => runFinalization("beforeExit"));
  }

  function registerWithEvent(ref, fn, evt) {
    validateRef(ref);
    // Node does not validate `fn` here; a non-callable fn only throws at
    // exit/beforeExit time when it's invoked.
    ensureInstalled();
    entries.push({ ref: new WeakRef(ref), fn, evt });
  }

  return {
    register(ref, fn) {
      registerWithEvent(ref, fn, "exit");
    },
    registerBeforeExit(ref, fn) {
      registerWithEvent(ref, fn, "beforeExit");
    },
    unregister(ref) {
      validateRef(ref);
      // Node also drops entries whose target was already collected, so a dead
      // registration stops pinning its callback.
      entries = entries.filter(entry => {
        const target = entry.ref.deref();
        return target !== undefined && target !== ref;
      });
    },
  };
}

export function buildAllowedNodeEnvironmentFlags() {
  // Node's process.allowedNodeEnvironmentFlags: a frozen Set whose has()
  // normalizes underscores to dashes, tolerates missing leading dashes, and
  // strips "=value" suffixes. The canonical entries are kept in a closure so
  // Set.prototype.add.call(...) cannot make new entries observable.
  const canonical = [
    "--conditions",
    "--diagnostic-dir",
    "--disable-warning",
    "--dns-result-order",
    "--enable-source-maps",
    "--import",
    "--inspect",
    "--inspect-brk",
    "--inspect-port",
    "--max-http-header-size",
    "--no-addons",
    "--no-deprecation",
    "--no-warnings",
    "--pending-deprecation",
    "--perf-basic-prof",
    "--perf-basic-prof-only-functions",
    "--perf-prof",
    "--perf-prof-unwinding-info",
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    "--redirect-warnings",
    "--require",
    "-r",
    "--stack-trace-limit",
    "--throw-deprecation",
    "--title",
    "--trace-deprecation",
    "--trace-warnings",
    "--use-bundled-ca",
    "--use-openssl-ca",
    "--use-system-ca",
    "--zero-fill-buffers",
  ];
  const canonicalSet = new Set(canonical);

  class NodeEnvironmentFlagsSet extends Set {
    add() {
      return this;
    }
    delete() {
      return false;
    }
    clear() {}
    has(key) {
      if (typeof key === "string") {
        key = key.replaceAll("_", "-");
        if (/^--?[^-]/.test(key)) {
          key = key.replace(/=.*$/, "");
          return canonicalSet.has(key);
        }
        if (!key.startsWith("-")) {
          if (canonicalSet.has(`--${key}`)) return true;
          return canonicalSet.has(`-${key}`);
        }
      }
      return false;
    }
    forEach(callback, thisArg) {
      for (const flag of canonical) {
        callback.$call(thisArg, flag, flag, this);
      }
    }
    get size() {
      return canonicalSet.size;
    }
    *[Symbol.iterator]() {
      yield* canonical;
    }
    *values() {
      yield* canonical;
    }
    *keys() {
      yield* canonical;
    }
    *entries() {
      for (const flag of canonical) yield [flag, flag];
    }
  }

  Object.freeze(NodeEnvironmentFlagsSet.prototype.constructor);
  Object.freeze(NodeEnvironmentFlagsSet.prototype);
  return Object.freeze(new NodeEnvironmentFlagsSet());
}

export function getActiveResourcesInfo() {
  return require("internal/active_handles").getActiveResourcesInfo();
}

export function getActiveHandles() {
  return require("internal/active_handles").getActiveHandles();
}

export function getActiveRequests() {
  return require("internal/active_handles").getActiveRequests();
}
