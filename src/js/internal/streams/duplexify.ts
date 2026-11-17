"use strict";

const {
  isReadable,
  isWritable,
  isIterable,
  isNodeStream,
  isReadableNodeStream,
  isWritableNodeStream,
  isDuplexNodeStream,
  isReadableStream,
  isWritableStream,
} = require("internal/streams/utils");
const eos = require("internal/streams/end-of-stream");
const { destroyer } = require("internal/streams/destroy");
const Duplex = require("internal/streams/duplex");
const Readable = require("internal/streams/readable");
const Writable = require("internal/streams/writable");
const from = require("internal/streams/from");

const PromiseWithResolvers = Promise.withResolvers.bind(Promise);

class Duplexify extends Duplex {
  constructor(options?: $Node.DuplexOptions) {
    super(options);

    // https://github.com/nodejs/node/pull/34385

    if (options?.readable === false) {
      this._readableState.readable = false;
      this._readableState.ended = true;
      this._readableState.endEmitted = true;
    }

    if (options?.writable === false) {
      this._writableState.writable = false;
      this._writableState.ending = true;
      this._writableState.ended = true;
      this._writableState.finished = true;
    }
  }
}

type Then = ((onFulfilled: (value: unknown) => unknown, onRejected: (error: Error) => unknown) => unknown) | undefined;

function duplexify(body, name?: string): $Node.Duplex {
  if (isDuplexNodeStream(body)) {
    return body;
  }

  if (isReadableNodeStream(body)) {
    return _duplexify({ readable: body });
  }

  if (isWritableNodeStream(body)) {
    return _duplexify({ writable: body });
  }

  if (isNodeStream(body)) {
    return _duplexify({ writable: false, readable: false });
  }

  if (isReadableStream(body)) {
    return _duplexify({ readable: Readable.fromWeb(body) });
  }

  if (isWritableStream(body)) {
    return _duplexify({ writable: Writable.fromWeb(body) });
  }

  if (typeof body === "function") {
    const { value, write, final, destroy } = fromAsyncGen(body);

    // Body might be a constructor function instead of an async generator function.
    if (isDuplexNodeStream(value)) {
      return value;
    }

    if (isIterable(value)) {
      return from(Duplexify, value, {
        // TODO (ronag): highWaterMark?
        objectMode: true,
        write,
        final,
        destroy,
      });
    }

    const then = (value as { then?: Then } | null | undefined)?.then;
    if (typeof then === "function") {
      let d: Duplexify;

      const promise = then.$call(
        value,
        val => {
          if (val != null) {
            throw $ERR_INVALID_RETURN_VALUE("nully", "body", val);
          }
        },
        err => {
          destroyer(d, err);
        },
      );

      return (d = new Duplexify({
        // TODO (ronag): highWaterMark?
        objectMode: true,
        readable: false,
        write,
        final(cb) {
          final(async () => {
            try {
              await promise;
              process.nextTick(cb, null);
            } catch (err) {
              process.nextTick(cb, err);
            }
          });
        },
        destroy,
      }));
    }

    throw $ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name!, value);
  }

  if ($inheritsBlob(body)) {
    return duplexify((body as Blob).arrayBuffer());
  }

  if (isIterable(body)) {
    return from(Duplexify, body, {
      // TODO (ronag): highWaterMark?
      objectMode: true,
      writable: false,
    });
  }

  if (isReadableStream(body?.readable) && isWritableStream(body?.writable)) {
    return Duplexify.fromWeb(body);
  }

  if (typeof body?.writable === "object" || typeof body?.readable === "object") {
    const readable = body?.readable
      ? isReadableNodeStream(body?.readable)
        ? body?.readable
        : duplexify(body.readable)
      : undefined;

    const writable = body?.writable
      ? isWritableNodeStream(body?.writable)
        ? body?.writable
        : duplexify(body.writable)
      : undefined;

    return _duplexify({ readable, writable });
  }

  const then: Then = body?.then;
  if (typeof then === "function") {
    let d: Duplexify;

    then.$call(
      body,
      val => {
        if (val != null) {
          d.push(val);
        }
        d.push(null);
      },
      err => {
        destroyer(d, err);
      },
    );

    return (d = new Duplexify({
      objectMode: true,
      writable: false,
      read() {},
    }));
  }

  throw $ERR_INVALID_ARG_TYPE(
    name!,
    [
      "Blob",
      "ReadableStream",
      "WritableStream",
      "Stream",
      "Iterable",
      "AsyncIterable",
      "Function",
      "{ readable, writable } pair",
      "Promise",
    ],
    body,
  );
}

interface AsyncGenWrite {
  __proto__?: null;
  chunk?: unknown;
  done: boolean;
  cb: (err?: Error | null) => void;
}

function fromAsyncGen(
  fn: (source: AsyncGenerator<unknown, void, unknown>, options: { signal: AbortSignal }) => unknown,
) {
  let {
    promise,
    resolve,
  }: {
    promise: Promise<AsyncGenWrite> | null;
    resolve: ((value: AsyncGenWrite) => void) | null;
  } = PromiseWithResolvers<AsyncGenWrite>();
  const ac = new AbortController();
  const signal = ac.signal;
  const value = fn(
    (async function* () {
      while (true) {
        const _promise = promise;
        promise = null;
        const { chunk, done, cb } = await _promise;
        process.nextTick(cb);
        if (done) return;
        if (signal.aborted) throw $makeAbortError(undefined, { cause: signal.reason });
        ({ promise, resolve } = PromiseWithResolvers<AsyncGenWrite>());
        yield chunk;
      }
    })(),
    { signal },
  );

  return {
    value,
    write(chunk: unknown, encoding: string, cb: $Node.ErrorCallback) {
      const _resolve = resolve;
      resolve = null;
      _resolve!({ chunk, done: false, cb });
    },
    final(cb: $Node.ErrorCallback) {
      const _resolve = resolve;
      resolve = null;
      _resolve!({ done: true, cb });
    },
    destroy(err: Error | null, cb: $Node.ErrorCallback) {
      ac.abort(err);

      // If the source async iterator is waiting for the next write/final
      // signal, unblock it so the readable side can observe the abort and
      // finish destroying.
      if (resolve !== null) {
        const _resolve = resolve;
        resolve = null;
        _resolve({ __proto__: null, done: true, cb() {} });
      }

      cb(err);
    },
  };
}

// `false` for a side that is missing is only ever tested for truth, like `undefined`.
function _duplexify(pair: { readable?: $Node.Readable | false; writable?: $Node.Writable | false }) {
  const r = (
    pair.readable && typeof pair.readable.read !== "function" ? Readable.wrap(pair.readable) : pair.readable
  ) as $Node.Readable | undefined;
  const w = pair.writable as $Node.Writable | undefined;

  let readable = !!isReadable(r);
  let writable = !!isWritable(w);

  let ondrain: $Node.ErrorCallback | null | undefined;
  let onfinish: $Node.ErrorCallback | null | undefined;
  let onreadable: (() => void) | null | undefined;
  let onclose: $Node.ErrorCallback | null | undefined;
  let d: Duplexify;

  function onfinished(err?: Error | null) {
    const cb = onclose;
    onclose = null;

    if (cb) {
      cb(err);
    } else if (err) {
      d.destroy(err);
    }
  }

  // TODO(ronag): Avoid double buffering.
  // Implement Writable/Readable/Duplex traits.
  // See, https://github.com/nodejs/node/pull/33515.
  d = new Duplexify({
    // TODO (ronag): highWaterMark?
    readableObjectMode: !!r?.readableObjectMode,
    writableObjectMode: !!w?.writableObjectMode,
    readable,
    writable,
  });

  if (writable) {
    eos(w!, err => {
      writable = false;
      if (err) {
        destroyer(r, err);
      }
      onfinished(err);
    });

    d._write = function (chunk, encoding, callback) {
      if (w!.write(chunk, encoding)) {
        callback();
      } else {
        ondrain = callback;
      }
    };

    d._final = function (callback) {
      w!.end();
      onfinish = callback;
    };

    w!.on("drain", function () {
      if (ondrain) {
        const cb = ondrain;
        ondrain = null;
        cb();
      }
    });

    w!.on("finish", function () {
      if (onfinish) {
        const cb = onfinish;
        onfinish = null;
        cb();
      }
    });
  }

  if (readable) {
    eos(r!, err => {
      readable = false;
      if (err) {
        destroyer(w, err);
      }
      onfinished(err);
    });

    r!.on("readable", function () {
      if (onreadable) {
        const cb = onreadable;
        onreadable = null;
        cb();
      }
    });

    r!.on("end", function () {
      d.push(null);
    });

    d._read = function () {
      while (true) {
        const buf = r!.read();

        if (buf === null) {
          onreadable = d._read as () => void;
          return;
        }

        if (!d.push(buf)) {
          return;
        }
      }
    };
  }

  d._destroy = function (err, callback) {
    if (!err && onclose !== null) {
      err = $makeAbortError();
    }

    onreadable = null;
    ondrain = null;
    onfinish = null;

    if (onclose === null) {
      callback(err);
    } else {
      onclose = callback;
      destroyer(w, err);
      destroyer(r, err);
    }
  };

  return d;
}

export default duplexify;
