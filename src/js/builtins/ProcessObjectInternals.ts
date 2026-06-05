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

  var shouldDisown = false;
  let needsInternalReadRefresh = false;
  // if true, while the stream is own()ed it will not
  let forceUnref = false;

  function own() {
    $debug("ref();", reader ? "already has reader" : "getting reader");
    reader ??= native.getReader();
    source.updateRef(forceUnref ? false : true);
    source?.setFlowing?.(true);

    shouldDisown = false;
    if (needsInternalReadRefresh) {
      needsInternalReadRefresh = false;
      internalRead(stream);
    }
  }

  function disown() {
    $debug("unref();");
    source?.setFlowing?.(false);

    if (reader) {
      try {
        reader.releaseLock();
        reader = undefined;
        $debug("released reader");
      } catch (e: any) {
        $debug("reader lock cannot be released, waiting");
        $assert(e.message === "There are still pending read requests, cannot release the lock");

        // Releasing the lock is not possible as there are active reads
        // we will instead pretend we are unref'd, and release the lock once the reads are finished.
        shouldDisown = true;
        source?.updateRef?.(false);
      }
    } else if (source) {
      source.updateRef(false);
    }
  }

  const ReadStream = isTTY ? require("node:tty").ReadStream : require("node:fs").ReadStream;
  const stream = new ReadStream(null, { fd, autoClose: false });

  const originalOn = stream.on;

  let stream_destroyed = false;
  let stream_endEmitted = false;
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

  async function internalRead(stream) {
    $debug("internalRead();");
    try {
      $assert(reader);
      const { value } = await reader.read();

      if (value) {
        stream.push(value);

        if (shouldDisown) disown();
      } else {
        if (!stream_endEmitted) {
          stream_endEmitted = true;
          stream.emit("end");
        }
        if (!stream_destroyed) {
          stream_destroyed = true;
          stream.destroy();
          disown();
        }
      }
    } catch (err) {
      if (err?.code === "ERR_STREAM_RELEASE_LOCK") {
        // The stream was unref()ed. It may be ref()ed again in the future,
        // or maybe it has already been ref()ed again and we just need to
        // restart the internalRead() function. triggerRead() will figure that out.
        triggerRead.$call(stream, undefined);
        return;
      }
      stream.destroy(err);
    }
  }

  function triggerRead(_size) {
    $debug("_read();", reader);

    if (reader && !shouldDisown) {
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
  var process;
  var nextTickQueue = nextTickQueue;
  var drainMicrotasks = drainMicrotasksFn;
  var reportUncaughtException = reportUncaughtExceptionFn;

  const { validateFunction } = require("internal/validators");

  var setup;
  setup = () => {
    const { FixedQueue } = require("internal/fixed_queue");
    queue = new FixedQueue();

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

    queue.push({
      callback: cb,
      // We want to avoid materializing the args if there are none because it's
      // a waste of memory and Array.prototype.slice shows up in profiling.
      args: $argumentCount() > 1 ? args : undefined,
      frame: $getInternalField($asyncContext, 0),
    });
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
) {
  // The use of String(key) here is intentional because Node.js as of v21.5.0 will throw
  // on symbol keys as it seems they assume the user uses string keys:
  //
  // it throws "Cannot convert a Symbol value to a string"

  (internalEnv as any)[Bun.inspect.custom] = () => {
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

  (internalEnv as any).toJSON = () => {
    // Mirror enumeration (and the inspect.custom helper above): original-case
    // key names with case-insensitive lookups. Spreading internalEnv directly
    // would leak the canonical UPPERCASE storage keys into
    // JSON.stringify(process.env) and IPC env echoes.
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

  return new Proxy(internalEnv, {
    get(_, p) {
      if (typeof p !== "string") return undefined;
      const k = p.toUpperCase();
      // Own env vars first (case-insensitive); otherwise fall through to an
      // ordinary lookup with the original key so inherited Object.prototype
      // methods (hasOwnProperty, toString, ...) resolve like in Node.
      if (Object.prototype.hasOwnProperty.$call(internalEnv, k)) {
        return internalEnv[k];
      }
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
      value = String(value); // If toString() throws, we want to avoid it existing in the envMapList
      // Track the key for enumeration if it isn't already there. Don't gate on
      // `k in internalEnv`: the proxy-related env-var accessors (HTTP_PROXY,
      // HTTPS_PROXY, NO_PROXY and lowercase variants) always exist on
      // `internalEnv` as DontEnum CustomAccessors even when the var was never
      // in the OS env block, so the `in` check is true while envMapList
      // correctly omits them. A first-time runtime assignment must still add
      // the key so `Object.keys(process.env)` / `{...process.env}` see it.
      if (!envMapList.includes(p) && !envMapList.some(x => x.toUpperCase() === k)) {
        envMapList.push(p);
      }
      if (internalEnv[k] !== value) {
        editWindowsEnvVar(k, value);
        internalEnv[k] = value;
      }
      return true;
    },
    has(_, p) {
      return typeof p !== "symbol" ? String(p).toUpperCase() in internalEnv : false;
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
      if (attributes.configurable !== true || attributes.writable !== true || attributes.enumerable !== true) {
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
      const value = String(attributes.value);
      // Same tracking rule as the set trap: don't gate on `k in internalEnv`,
      // because the proxy-related env-var accessors (HTTP_PROXY etc.) always
      // exist there as DontEnum CustomAccessors even when the variable was
      // never in the OS env block; a first definition must still become
      // enumerable.
      if (!envMapList.includes(p) && !envMapList.some(x => x.toUpperCase() === k)) {
        envMapList.push(p);
      }
      const result = $Object.$defineProperty(internalEnv, k, { ...attributes, value });
      editWindowsEnvVar(k, value);
      return result;
    },
    getOwnPropertyDescriptor(target, p) {
      return typeof p === "string" ? Reflect.getOwnPropertyDescriptor(target, p.toUpperCase()) : undefined;
    },
    ownKeys() {
      // .slice() because paranoia that there is a way to call this without the engine cloning it for us
      return envMapList.slice();
    },
  });
}

export function getChannel() {
  const EventEmitter = require("node:events");
  const setRef = $newZigFunction("node_cluster_binding.zig", "setRef", 1);
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
  // process._rawDebug: util.format the arguments and write straight to fd 2,
  // bypassing the process.stderr stream (which may be hijacked or broken).
  // No rest parameter: builtins are strict functions and the parser rejects
  // non-simple parameter lists.
  // os.EOL, not "\n": Node's native _rawDebug writes through the CRT's
  // text-mode stderr, which emits \r\n on Windows, and the upstream test
  // asserts the platform line ending. fs.writeSync writes raw bytes, so the
  // translation has to happen here.
  const { formatWithOptions } = require("node:util");
  const { writeSync } = require("node:fs");
  const { EOL } = require("node:os");
  writeSync(2, formatWithOptions({}, ...arguments) + EOL);
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
  for (const key of Object.keys(parsed)) {
    process.env[key] = parsed[key];
  }
}

export function createProcessFinalization(process) {
  const { validateObject, validateFunction } = require("internal/validators");
  let entries: Array<{ ref: WeakRef<object>; fn: Function; evt: string }> = [];
  let installed = false;

  function runFinalization(event) {
    for (const entry of entries.slice()) {
      if (entry.evt !== event) continue;
      const obj = entry.ref.deref();
      if (obj === undefined) continue;
      if (event === "exit") {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      }
      entry.fn(obj, event);
    }
  }

  function ensureInstalled() {
    if (installed) return;
    installed = true;
    process.prependListener("exit", () => runFinalization("exit"));
    process.prependListener("beforeExit", () => runFinalization("beforeExit"));
  }

  function registerWithEvent(ref, fn, evt) {
    validateObject(ref, "ref");
    validateFunction(fn, "fn");
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
      validateObject(ref, "ref");
      entries = entries.filter(entry => entry.ref.deref() !== ref);
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

  return Object.freeze(new NodeEnvironmentFlagsSet());
}
