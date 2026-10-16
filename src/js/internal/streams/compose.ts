"use strict";

const { pipelineImpl } = require("internal/streams/pipeline");
const { once } = require("internal/shared");
const Duplex = require("internal/streams/duplex");
const { destroyer } = require("internal/streams/destroy");
const {
  isNodeStream,
  isReadable,
  isWritable,
  isWebStream,
  isTransformStream,
  isWritableStream,
  isReadableStream,
} = require("internal/streams/utils");
const eos = require("internal/streams/end-of-stream");

const ArrayPrototypeSlice = Array.prototype.slice;
const PromisePrototypeThen = $Promise.prototype.$then;

const nop = () => {};

// What compose() shares with an inner pipeline that has a pump: the pipeline's stop, and the web sides compose locked.
interface Inner {
  stop: ((err: unknown, always: boolean) => void) | undefined;
  writer: WritableStreamDefaultWriter | undefined;
  reader: ReadableStreamDefaultReader | undefined;
  readable: ReadableStream | undefined;
}

// User code can replace cancel() and abort(): a throw, or a result that is not a promise, must not change a teardown.
function ignoreOutcome(result) {
  if ($isPromise(result)) PromisePrototypeThen.$call(result, undefined, nop);
}

export default function compose(...streams) {
  if (streams.length === 0) {
    throw $ERR_MISSING_ARGS("streams");
  }

  if (streams.length === 1) {
    return Duplex.from(streams[0]);
  }

  const orgStreams = ArrayPrototypeSlice.$call(streams);

  if (typeof streams[0] === "function") {
    streams[0] = Duplex.from(streams[0]);
  }

  const lastIdx = streams.length - 1;
  if (typeof streams[lastIdx] === "function") {
    streams[lastIdx] = Duplex.from(streams[lastIdx]);
  }

  let pumped = false;
  for (let n = 0; n < streams.length; ++n) {
    const isNode = isNodeStream(streams[n]);
    pumped ||= !isNode;
    if (!isNode && !isWebStream(streams[n])) {
      // TODO(ronag): Add checks for non streams.
      continue;
    }
    if (
      n < streams.length - 1 &&
      !(isReadable(streams[n]) || isReadableStream(streams[n]) || isTransformStream(streams[n]))
    ) {
      throw $ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be readable");
    }
    if (n > 0 && !(isWritable(streams[n]) || isWritableStream(streams[n]) || isTransformStream(streams[n]))) {
      throw $ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be writable");
    }
  }

  let ondrain;
  let onfinish;
  let onreadable;
  let onclose;
  let d;
  const inner: Inner | undefined = pumped
    ? { stop: undefined, writer: undefined, reader: undefined, readable: undefined }
    : undefined;

  function onfinished(err) {
    const cb = onclose;
    onclose = null;
    if (inner !== undefined) inner.stop = undefined;

    if (cb) {
      cb(err);
    } else if (err) {
      d.destroy(err);
    } else if (!readable && !writable) {
      d.destroy();
    }
  }

  const head = streams[0];
  const tail = pipelineImpl(streams, once(onfinished), undefined, inner);

  const writable = !!(isWritable(head) || isWritableStream(head) || isTransformStream(head));
  const readable = !!(isReadable(tail) || isReadableStream(tail) || isTransformStream(tail));

  // TODO(ronag): Avoid double buffering.
  // Implement Writable/Readable/Duplex traits.
  // See, https://github.com/nodejs/node/pull/33515.
  d = new Duplex({
    // TODO (ronag): highWaterMark?
    writableObjectMode: !!head?.writableObjectMode,
    readableObjectMode: !!tail?.readableObjectMode,
    writable,
    readable,
  });

  if (writable) {
    if (isNodeStream(head)) {
      d._write = function (chunk, encoding, callback) {
        if (head.write(chunk, encoding)) {
          callback();
        } else {
          ondrain = callback;
        }
      };

      d._final = function (callback) {
        head.end();
        onfinish = callback;
      };

      head.on("drain", function () {
        if (ondrain) {
          const cb = ondrain;
          ondrain = null;
          cb();
        }
      });
    } else if (isWebStream(head)) {
      const writable = (isTransformStream(head) ? head.writable : head) as WritableStream;
      const writer = writable.getWriter();
      inner!.writer = writer;

      d._write = async function (chunk, encoding, callback) {
        try {
          await writer.ready;
          writer.write(chunk).catch(() => {});
          callback();
        } catch (err) {
          callback(err);
        }
      };

      d._final = async function (callback) {
        try {
          await writer.ready;
          writer.close().catch(() => {});
          onfinish = callback;
        } catch (err) {
          callback(err);
        }
      };
    }

    const toRead = isTransformStream(tail) ? tail.readable : tail;

    eos(toRead, () => {
      if (onfinish) {
        const cb = onfinish;
        onfinish = null;
        cb();
      }
    });
  }

  if (readable) {
    if (isNodeStream(tail)) {
      tail.on("readable", function () {
        if (onreadable) {
          const cb = onreadable;
          onreadable = null;
          cb();
        }
      });

      tail.on("end", function () {
        d.push(null);
      });

      d._read = function () {
        while (true) {
          const buf = tail.read();
          if (buf === null) {
            onreadable = d._read;
            return;
          }

          if (!d.push(buf)) {
            return;
          }
        }
      };
    } else if (isWebStream(tail)) {
      const readable = (isTransformStream(tail) ? tail.readable : tail) as ReadableStream;
      const reader = readable.getReader();
      inner!.reader = reader;
      inner!.readable = readable;
      d._read = async function () {
        while (true) {
          try {
            const { value, done } = await reader.read();

            if (!d.push(value)) {
              return;
            }

            if (done) {
              d.push(null);
              return;
            }
          } catch {
            return;
          }
        }
      };
    }
  }

  d._destroy = function (err, callback) {
    if (!err && onclose !== null) {
      err = $makeAbortError();
    }

    onreadable = null;
    ondrain = null;
    onfinish = null;

    // autoDestroy calls _destroy at a normal completion too: the inner pipeline then succeeds, and nothing is stopped.
    let early = false;
    if (inner !== undefined) {
      // 'finish' proves that the tail is done. 'end' alone does not: the tail, and a writable side, must have got their last input.
      const inputEnded = (!isNodeStream(tail) || tail.writableEnded) && (!writable || d._writableState.finalCalled);
      const completed = (writable && d.writableFinished) || (readable && d.readableEnded && inputEnded);
      early = !completed;
    }

    if (isNodeStream(tail)) {
      destroyer(tail, err);
    }

    // Deliberate divergence from Node v26.3.0, which stops a node tail only and can then wait forever for the inner pipeline: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/compose.js#L223-L240
    let cut = false;
    if (early) {
      const { writer, reader } = inner!;
      // Not behind a web ReadableStream head: node's test-webstreams-compose.js expects no event from that shape.
      if (reader !== undefined && !isReadableStream(head)) {
        cut = true;
        try {
          // Release first: a cancel under the lock ends the pending read of _read() with `done`, and 'end' comes before 'error'.
          reader.releaseLock();
          ignoreOutcome(inner!.readable!.cancel(err));
        } catch {}
      }
      if (writer !== undefined) {
        try {
          ignoreOutcome(writer.abort(err));
        } catch {}
      }
    }

    if (onclose === null) {
      callback(err);
    } else {
      onclose = callback;
      // After the cut the rest of the output is lost: a pipeline that has not ended then reports `err` even when it succeeds.
      if (early) inner!.stop!(err, cut);
    }
  };

  return d;
}
