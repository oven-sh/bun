/*
 * Copyright Joyent, Inc. and other Node contributors.
 * Copyright 2023 Codeblog Corp. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// @ts-ignore
import type { ReadableStreamDefaultReader } from "stream/web";
import type FileSink from "bun:sqlite";
import kWriteStreamFastPath from "internal/fs/streams";
import type { ReadStream as TTYReadStream, WriteStream as TTYWriteStream } from "node:tty";
import type { ReadStream as FSReadStream, WriteStream as FSWriteStream } from "node:fs";

const enum BunProcessStdinFdType {
  file = 0,
  pipe = 1,
  socket = 2,
}

export function getStdioWriteStream(
  fd: number,
  isTTY: boolean,
  _fdType: BunProcessStdinFdType,
): [TTYWriteStream | FSWriteStream, FileSink | null | undefined] {
  $assert(typeof fd === "number", `Expected fd to be a number, got ${typeof fd}`);

  let stream: TTYWriteStream | FSWriteStream;
  let underlyingSink: FileSink | null | undefined = undefined;

  if (isTTY) {
    const tty = require("node:tty");
    stream = new tty.WriteStream(fd) as TTYWriteStream;
    (stream as any).readable = true; // Node.js compatibility quirk
    process.on("SIGWINCH", () => {
      (stream as any)._refreshSize();
    });
    (stream as any)._type = "tty";
    // TTY streams don't have the kWriteStreamFastPath sink
  } else {
    const fs = require("node:fs");
    stream = new fs.WriteStream(null, { autoClose: false, fd, $fastPath: true }) as FSWriteStream;
    (stream as any).readable = false;
    (stream as any)._type = "fs";
    // Access the fast path sink only for FSWriteStream
    underlyingSink = (stream as any)[(kWriteStreamFastPath as unknown as PropertyKey)];
    $assert(underlyingSink, "FSWriteStream for stdio should have an underlying sink");
  }

  if (fd === 1 || fd === 2) {
    (stream as any).destroySoon = (stream as any).destroy;
    (stream as any)._destroy = function (err, cb) {
      cb(err);
      (this as any)._undestroy();

      if (!(this as any)._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };
  }

  (stream as any)._isStdio = true;
  (stream as any).fd = fd;

  return [stream, underlyingSink];
}

export function getStdinStream(fd: number, isTTY: boolean, fdType: BunProcessStdinFdType) {
  const native = Bun.stdin.stream();
  const source = native.$bunNativePtr as $ZigGeneratedClasses.FileInternalReadableStreamSource;

  var reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  var shouldUnref = false;
  let needsInternalReadRefresh = false;

  function ref() {
    $debug("ref();", reader ? "already has reader" : "getting reader");
    reader ??= native.getReader();
    source.updateRef(true);
    shouldUnref = false;
    if (needsInternalReadRefresh) {
      needsInternalReadRefresh = false;
      internalRead(stream);
    }
  }

  function unref() {
    $debug("unref();");

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
        source?.updateRef?.(false);
      }
    } else if (source) {
      source.updateRef(false);
    }
  }

  const ReadStream = isTTY ? require("node:tty").ReadStream : require("node:fs").ReadStream;
  const stream: TTYReadStream | FSReadStream = new (ReadStream as { new (...args: any[]): TTYReadStream | FSReadStream })(null, { fd, autoClose: false });

  const originalOn = (stream as any).on;

  let stream_destroyed = false;
  let stream_endEmitted = false;
  (stream as any).addListener = (stream as any).on = function (event, listener) {
    if (event === "readable") {
      ref();
    }
    return originalOn.$call(this, event, listener);
  };

  (stream as any).fd = fd;

  // tty.ReadStream is supposed to extend from net.Socket.
  // but we haven't made that work yet. Until then, we need to manually add some of net.Socket's methods
  if (isTTY || fdType !== BunProcessStdinFdType.file) {
    (stream as any).ref = function () {
      ref();
      return this;
    };

    (stream as any).unref = function () {
      unref();
      return this;
    };
  }

  const originalPause = (stream as any).pause;
  (stream as any).pause = function () {
    $debug("pause();");
    let r = originalPause.$call(this);
    unref();
    return r;
  };

  const originalResume = (stream as any).resume;
  (stream as any).resume = function () {
    $debug("resume();");
    ref();
    return originalResume.$call(this);
  };

  async function internalRead(stream) {
    $debug("internalRead();");
    try {
      $assert(reader);
      const { value } = await reader!.read();

      if (value) {
        (stream as any).push(value);

        if (shouldUnref) unref();
      } else {
        if (!stream_endEmitted) {
          stream_endEmitted = true;
          (stream as any).emit("end");
        }
        if (!stream_destroyed) {
          stream_destroyed = true;
          (stream as any).destroy();
          unref();
        }
      }
    } catch (err) {
      if ((err as Error)?.code === "ERR_STREAM_RELEASE_LOCK") {
        // The stream was unref()ed. It may be ref()ed again in the future,
        // or maybe it has already been ref()ed again and we just need to
        // restart the internalRead() function. triggerRead() will figure that out.
        (triggerRead as any).$call(stream);
        return;
      }
      (stream as any).destroy(err);
    }
  }

  function triggerRead(_size) {
    $debug("_read();", reader);

    if (reader && !shouldUnref) {
      internalRead(this);
    } else {
      // The stream has not been ref()ed yet. If it is ever ref()ed,
      // run internalRead()
      needsInternalReadRefresh = true;
    }
  }
  (stream as any)._read = triggerRead;

  (stream as any).on("resume", () => {
    if ((stream as any).isPaused()) return; // fake resume
    $debug('on("resume");');
    ref();
    (stream as any)._undestroy();
    stream_destroyed = false;
  });

  (stream as any)._readableState.reading = false;

  (stream as any).on("pause", () => {
    process.nextTick(() => {
      if (!(stream as any).readableFlowing) {
        (stream as any)._readableState.reading = false;
      }
    });
  });

  (stream as any).on("close", () => {
    if (!stream_destroyed) {
      stream_destroyed = true;
      process.nextTick(() => {
        (stream as any).destroy();
        unref();
      });
    }
  });

  return stream;
}
export function initializeNextTickQueue(process, nextTickQueue, drainMicrotasksFn, reportUncaughtExceptionFn) {
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

$getter;
export function mainModule() {
  var existing = $getByIdDirectPrivate(this, "main");
  // note: this doesn't handle "process.mainModule = undefined"
  if (typeof existing !== "undefined") {
    return existing;
  }

  return $requireMap.$get(Bun.main);
}

$overriddenName = "set mainModule";
export function setMainModule(value) {
  $putByIdDirectPrivate(this, "main", value);
  return true;
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

  (internalEnv as any)[require("node:util").inspect.custom as typeof Bun.inspect.custom] = () => {
    let o = {};
    for (let k of envMapList) {
      o[k] = internalEnv[k.toUpperCase()];
    }
    return o;
  };

  (internalEnv as any).toJSON = () => {
    return { ...internalEnv };
  };

  return new Proxy(internalEnv, {
    get(_, p) {
      return typeof p === "string" ? internalEnv[p.toUpperCase()] : undefined;
    },
    set(_, p, value) {
      const k = String(p).toUpperCase();
      $assert(typeof p === "string"); // proxy is only string and symbol. the symbol would have thrown by now
      value = String(value); // If toString() throws, we want to avoid it existing in the envMapList
      if (!(k in internalEnv) && !envMapList.includes(p as string)) {
        envMapList.push(p as string);
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
      if (!(k in internalEnv) && !envMapList.includes(p as string)) {
        envMapList.push(p as string);
      }
      editWindowsEnvVar(k, internalEnv[k]);
      Object.defineProperty(internalEnv, k, attributes);
      return true; // Return boolean as required by ProxyHandler
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
  const setRef = $newZigFunction("node_cluster_binding.zig", "setRef", 3);
  return new (EventEmitter as { new (): any })();
}