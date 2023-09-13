$overriddenName = "[Symbol.asyncIterator]";
export function asyncIterator(this: Console) {
  var stream = Bun.stdin.stream();

  var decoder = new TextDecoder("utf-8", { fatal: false });
  var indexOf = Bun.indexOfLine;
  var actualChunk: Uint8Array;
  var i: number = -1;
  var idx: number;
  var last: number;
  var done: boolean;
  var value: Uint8Array[];
  var value_len: number;
  var pendingChunk: Uint8Array | undefined;

  async function* ConsoleAsyncIterator() {
    var reader = stream.getReader();
    var deferredError;
    try {
      if (i !== -1) {
        last = i + 1;
        i = indexOf(actualChunk, last);

        console.log("last", last, "i", i, "actualChunk", actualChunk);

        while (i !== -1) {
          yield decoder.decode(actualChunk.subarray(last, i));
          last = i + 1;
          i = indexOf(actualChunk, last);
        }

        for (idx++; idx < value_len; idx++) {
          actualChunk = value[idx];
          if (pendingChunk) {
            actualChunk = Buffer.concat([pendingChunk, actualChunk]);
            pendingChunk = undefined;
          }

          last = 0;
          // TODO: "\r", 0x4048, 0x4049, 0x404A, 0x404B, 0x404C, 0x404D, 0x404E, 0x404F
          i = indexOf(actualChunk, last);
          while (i !== -1) {
            yield decoder.decode(actualChunk.subarray(last, i));
            last = i + 1;
            i = indexOf(actualChunk, last);
          }
          i = -1;

          pendingChunk = actualChunk.subarray(last);
        }
        actualChunk = undefined!;
      }

      while (true) {
        const firstResult = reader.readMany();
        if ($isPromise(firstResult)) {
          ({ done, value } = await firstResult);
        } else {
          ({ done, value } = firstResult);
        }

        if (done) {
          if (pendingChunk) {
            yield decoder.decode(pendingChunk);
          }
          return;
        }

        // we assume it was given line-by-line
        for (idx = 0, value_len = value.length; idx < value_len; idx++) {
          actualChunk = value[idx];
          if (pendingChunk) {
            actualChunk = Buffer.concat([pendingChunk, actualChunk]);
            pendingChunk = undefined;
          }

          last = 0;
          // TODO: "\r", 0x4048, 0x4049, 0x404A, 0x404B, 0x404C, 0x404D, 0x404E, 0x404F
          i = indexOf(actualChunk, last);
          while (i !== -1) {
            // This yield may end the function, in that case we need to be able to recover state
            // if the iterator was fired up again.
            yield decoder.decode(actualChunk.subarray(last, i));
            last = i + 1;
            i = indexOf(actualChunk, last);
          }
          i = -1;

          pendingChunk = actualChunk.subarray(last);
        }
        actualChunk = undefined!;
      }
    } catch (e) {
      deferredError = e;
    } finally {
      reader.releaseLock();

      if (deferredError) {
        throw deferredError;
      }
    }
  }

  const symbol = globalThis.Symbol.asyncIterator;
  this[symbol] = ConsoleAsyncIterator;
  return ConsoleAsyncIterator();
}

export function write(this: Console, input) {
  var writer = $getByIdDirectPrivate(this, "writer");
  if (!writer) {
    var length = $toLength(input?.length ?? 0);
    writer = Bun.stdout.writer({ highWaterMark: length > 65536 ? length : 65536 });
    $putByIdDirectPrivate(this, "writer", writer);
  }

  var wrote = writer.write(input);

  const count = $argumentCount();
  for (var i = 1; i < count; i++) {
    wrote += writer.write($argument(i));
  }

  writer.flush(true);
  return wrote;
}
