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

  // Both constructors below sit on the per-VM stdio FileSink for `fd` (via
  // `Bun.file(fd).writer()`), the same object console.* writes through.
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

  // Node's stdio streams (net.Socket / SyncWriteStream) run with autoDestroy:
  // end() -> finish -> destroy -> the _destroy override below -> _undestroy()
  // resets state so later writes succeed, and a failed write goes
  // errorOrDestroy -> destroy -> _undestroy -> 'error' *every* time instead
  // of latching on errorEmitted after the first. autoClose:false turned it off.
  stream._writableState.autoDestroy = true;

  // Node terminates on the first unhandled 'error'; Bun keeps running after an
  // uncaught exception, so a write loop on a dead pipe would otherwise print
  // one uncaught EPIPE per write. Surface the first, drop the repeats.
  let unhandledErrorSeen = false;
  stream._destroy = function (err, cb) {
    if (err && this.listenerCount("error") === 0) {
      if (unhandledErrorSeen) err = null;
      unhandledErrorSeen = true;
    }
    cb(err);
    this._undestroy();
    updateObserved(this);

    if (!this._writableState.emitClose) {
      process.nextTick(() => {
        this.emit("close");
      });
    }
  };

  const { kWriteStreamFastPath, kOnPendingWrite } = require("internal/fs/streams");
  stream._final = function (cb) {
    try {
      const sink = this[kWriteStreamFastPath];
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

  // console.* writes straight to the shared native sink unless doing so could
  // be told apart from a `write()` call: while this Writable is corked, is
  // ending/ended, or has a write in flight (later chunks queue in *its*
  // buffer, and a native write would jump that queue). Keep the native side
  // informed; it checks a bitfield, never these JS objects.
  const setStdioObserved = $newCppFunction("BunProcess.cpp", "jsFunctionSetStdioObserved", 2);
  let pendingWrite = false;
  function updateObserved(stream) {
    const state = stream._writableState;
    setStdioObserved(
      fd,
      (state.corked ? 1 : 0) | (state.ending || state.ended || state.destroyed ? 2 : 0) | (pendingWrite ? 4 : 0),
    );
  }
  stream[kOnPendingWrite] = function (pending) {
    pendingWrite = pending;
    updateObserved(this);
  };
  const { cork, uncork, end, destroy } = stream;
  stream.cork = function () {
    cork.$call(this);
    updateObserved(this);
  };
  stream.uncork = function () {
    uncork.$call(this);
    updateObserved(this);
  };
  stream.end = function (...args) {
    const ret = end.$apply(this, args);
    updateObserved(this);
    return ret;
  };
  stream.destroy = stream.destroySoon = function (...args) {
    const ret = destroy.$apply(this, args);
    updateObserved(this);
    return ret;
  };

  stream._isStdio = true;
  stream.fd = fd;

  $assert(stream[kWriteStreamFastPath], "stdio stream must be FileSink-backed");
  return stream;
}

// A console.* write on the shared stdio sink failed (EPIPE etc.). Node's
// console swallows write errors, but the stream still emits 'error' for
// whoever listens; with nobody listening it must not become an uncaught
// exception (that is what console's once('error', noop) guard is for).
// https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L380-L399
export function reportStdioSinkError(stream, err) {
  if (typeof stream?.listenerCount === "function" && stream.listenerCount("error") > 0) {
    stream.destroy(err);
  }
}

// process.exit() / end of program: chunks this stdio Writable had queued in
// JS behind an in-flight write are handed to the native sink now, so the exit
// drain (FileSink::drain_sync) writes them instead of dropping them. Chunks
// held by an explicit, never-released cork() stay held.
export function flushStdioWriteStreamOnExit(stream) {
  const state = stream?._writableState;
  if (!state || state.corked) return;
  const sink = stream[require("internal/fs/streams").kWriteStreamFastPath];
  if (!sink || sink === true) return;
  const buffered = require("internal/streams/writable").takeBuffered(state);
  for (let i = 0; i < buffered.length; i++) {
    const { chunk, encoding } = buffered[i];
    // A failure here (rejected promise: the sink's latched EPIPE/EIO; throw: a
    // closed sink) was already surfaced by the write ahead of these chunks;
    // the exit must go on.
    try {
      const result = sink.write(
        typeof chunk === "string" && encoding !== "utf8" && encoding !== "utf-8" && encoding !== "buffer"
          ? Buffer.from(chunk, encoding)
          : chunk,
      );
      if ($isPromise(result)) result.then(undefined, () => {});
    } catch {}
  }
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
    // Mirror enumeration: original-case key names, case-insensitive values.
    // Spreading internalEnv directly would leak the canonical UPPERCASE
    // storage keys into JSON.stringify(process.env) and IPC env echoes.
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

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
      const k = String(p).toUpperCase();
      $assert(typeof p === "string"); // proxy is only string and symbol. the symbol would have thrown by now
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
      // Case-insensitive env-var query first, then ordinary lookup so own
      // as-is properties and Object.prototype methods answer `in` like node
      // (`'hasOwnProperty' in process.env` is true on all platforms).
      if (typeof p === "string" && p.toUpperCase() in internalEnv) {
        return true;
      }
      return p in internalEnv;
    },
    deleteProperty(_, p) {
      const k = String(p).toUpperCase();
      const i = envMapList.findIndex(x => x.toUpperCase() === k);
      if (i !== -1) {
        envMapList.splice(i, 1);
      }
      editWindowsEnvVar(k, null);
      return typeof p !== "symbol" ? delete internalEnv[k] : false;
    },
    defineProperty(_, p, attributes) {
      const k = String(p).toUpperCase();
      $assert(typeof p === "string"); // proxy is only string and symbol. the symbol would have thrown by now
      if (!(k in internalEnv) && !envMapList.includes(p)) {
        envMapList.push(p);
      }
      editWindowsEnvVar(k, internalEnv[k]);
      return $Object.$defineProperty(internalEnv, k, attributes);
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
