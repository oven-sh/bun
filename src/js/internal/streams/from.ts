const SymbolIterator: typeof Symbol.iterator = Symbol.iterator;
const SymbolAsyncIterator: typeof Symbol.asyncIterator = Symbol.asyncIterator;
const PromisePrototypeThen = Promise.prototype.$then;
const { aggregateTwoErrors } = require("internal/errors");

interface MaybeIterable {
  [Symbol.asyncIterator]?(): AsyncIterator<unknown>;
  [Symbol.iterator]?(): Iterator<unknown>;
}

function from<T extends $Node.Readable>(
  Readable: new (options?: $Node.DuplexOptions) => T,
  iterable: string | MaybeIterable,
  opts?: $Node.DuplexOptions,
) {
  let iterator: Iterator<unknown> | AsyncIterator<unknown>;
  if (typeof iterable === "string" || iterable instanceof Buffer) {
    return new Readable({
      objectMode: true,
      ...opts,
      read() {
        this.push(iterable);
        this.push(null);
      },
    });
  }

  let isAsync: boolean;
  if (iterable?.[SymbolAsyncIterator]) {
    isAsync = true;
    iterator = iterable[SymbolAsyncIterator]();
  } else if (iterable?.[SymbolIterator]) {
    isAsync = false;
    iterator = iterable[SymbolIterator]();
  } else {
    throw $ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
  }

  const readable = new Readable({
    objectMode: true,
    highWaterMark: 1,
    // TODO(ronag): What options should be allowed?
    ...opts,
  });

  // Flag to protect against _read
  // being called before last iteration completion.
  let reading = false;
  let isAsyncValues = false;

  readable._read = function () {
    if (!reading) {
      reading = true;

      if (isAsync) {
        nextAsync();
      } else if (isAsyncValues) {
        nextSyncWithAsyncValues();
      } else {
        nextSyncWithSyncValues();
      }
    }
  };

  const originalDestroy = readable._destroy;
  readable._destroy = function (error, cb) {
    // Chain the instance _destroy (e.g. duplexify's ac.abort()) first: it is
    // what unblocks a generator parked on its source, so close() can settle.
    originalDestroy.$call(this, error, destroyError => {
      const combinedError = destroyError || error;
      PromisePrototypeThen.$call(
        close(combinedError),
        $isCallable(cb) ? () => process.nextTick(cb, combinedError) : () => {}, // nextTick is here in case cb throws
        $isCallable(cb) ? closeError => process.nextTick(cb, aggregateTwoErrors(combinedError!, closeError)) : () => {},
      );
    });
  };

  async function close(error: Error | null | undefined) {
    const hadError = error !== undefined && error !== null;
    const hasThrow = typeof iterator.throw === "function";
    if (hadError && hasThrow) {
      const { value, done } = await iterator.throw!(error);
      await value;
      if (done) {
        return;
      }
    }
    if (typeof iterator.return === "function") {
      const { value } = await iterator.return!();
      await value;
    }
  }

  // There are a lot of duplication here, it's done on purpose for performance
  // reasons - avoid await when not needed.

  function nextSyncWithSyncValues() {
    for (;;) {
      try {
        const { value, done } = (iterator as Iterator<unknown>).next();

        if (done) {
          readable.push(null);
          return;
        }

        if (value && typeof (value as { then?: unknown }).then === "function") {
          return changeToAsyncValues(value);
        }

        if (value === null) {
          reading = false;
          throw $ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(value)) {
          continue;
        }

        reading = false;
      } catch (err) {
        readable.destroy(err as Error);
      }
      break;
    }
  }

  async function changeToAsyncValues(value: unknown) {
    isAsyncValues = true;

    try {
      const res = await value;

      if (res === null) {
        reading = false;
        throw $ERR_STREAM_NULL_VALUES();
      }

      if (readable.push(res)) {
        nextSyncWithAsyncValues();
        return;
      }

      reading = false;
    } catch (err) {
      readable.destroy(err as Error);
    }
  }

  async function nextSyncWithAsyncValues() {
    for (;;) {
      try {
        const { value, done } = (iterator as Iterator<unknown>).next();

        if (done) {
          readable.push(null);
          return;
        }

        const res = value && typeof (value as { then?: unknown }).then === "function" ? await value : value;

        if (res === null) {
          reading = false;
          throw $ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(res)) {
          continue;
        }

        reading = false;
      } catch (err) {
        readable.destroy(err as Error);
      }
      break;
    }
  }

  async function nextAsync() {
    for (;;) {
      try {
        const { value, done } = await iterator.next();

        if (done) {
          readable.push(null);
          return;
        }

        if (value === null) {
          reading = false;
          throw $ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(value)) {
          continue;
        }

        reading = false;
      } catch (err) {
        readable.destroy(err as Error);
      }
      break;
    }
  }
  return readable;
}

export default from;
