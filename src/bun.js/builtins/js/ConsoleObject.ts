$overriddenName = "[Symbol.asyncIterator]";
export function asyncIterator(this: Console) {
  const Iterator = async function* ConsoleAsyncIterator() {
    const stream = Bun.stdin.stream();
    var reader = stream.getReader();

    // TODO: use builtin
    var decoder = new (globalThis as any).TextDecoder("utf-8", { fatal: false }) as TextDecoder;
    var deferredError;
    var indexOf = Bun.indexOfLine;

    try {
      while (true) {
        var done, value;
        var pendingChunk;
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

        var actualChunk;
        // we assume it was given line-by-line
        for (const chunk of value) {
          actualChunk = chunk;
          if (pendingChunk) {
            actualChunk = Buffer.concat([pendingChunk, chunk]);
            pendingChunk = null;
          }

          var last = 0;
          // TODO: "\r", 0x4048, 0x4049, 0x404A, 0x404B, 0x404C, 0x404D, 0x404E, 0x404F
          var i = indexOf(actualChunk, last);
          while (i !== -1) {
            yield decoder.decode(actualChunk.subarray(last, i));
            last = i + 1;
            i = indexOf(actualChunk, last);
          }

          pendingChunk = actualChunk.subarray(last);
        }
      }
    } catch (e) {
      deferredError = e;
    } finally {
      reader.releaseLock();

      if (deferredError) {
        throw deferredError;
      }
    }
  };

  const symbol = globalThis.Symbol.asyncIterator;
  this[symbol] = Iterator;
  return Iterator();
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
