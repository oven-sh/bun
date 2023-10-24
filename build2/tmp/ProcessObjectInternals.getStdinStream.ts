// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ProcessObjectInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(fd) {  var reader: ReadableStreamDefaultReader | undefined;
  var readerRef;
  function ref() {
    reader ??= Bun.stdin.stream().getReader();
    // TODO: remove this. likely we are dereferencing the stream
    // when there is still more data to be read.
    readerRef ??= setInterval(() => {}, 1 << 30);
  }

  function unref() {
    if (readerRef) {
      clearInterval(readerRef);
      readerRef = undefined;
    }
    if (reader) {
      reader.cancel();
      reader = undefined;
    }
  }

  const tty = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 46/*node:tty*/) || __intrinsic__createInternalModuleById(46/*node:tty*/));

  const ReadStream = tty.isatty(fd) ? tty.ReadStream : (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 21/*node:fs*/) || __intrinsic__createInternalModuleById(21/*node:fs*/)).ReadStream;
  const stream = new ReadStream(fd);

  const originalOn = stream.on;
  stream.on = function (event, listener) {
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
      ref();
    }
    return originalOn.__intrinsic__call(this, event, listener);
  };

  stream.fd = fd;

  const originalPause = stream.pause;
  stream.pause = function () {
    unref();
    return originalPause.__intrinsic__call(this);
  };

  const originalResume = stream.resume;
  stream.resume = function () {
    ref();
    return originalResume.__intrinsic__call(this);
  };

  async function internalRead(stream) {
    try {
      var done: any, value: any;
      const read = reader?.readMany();

      if (__intrinsic__isPromise(read)) {
        ({ done, value } = await read);
      } else {
        // @ts-expect-error
        ({ done, value } = read);
      }

      if (!done) {
        stream.push(value[0]);

        // shouldn't actually happen, but just in case
        const length = value.length;
        for (let i = 1; i < length; i++) {
          stream.push(value[i]);
        }
      } else {
        stream.emit("end");
        stream.pause();
      }
    } catch (err) {
      stream.destroy(err);
    }
  }

  stream._read = function (size) {
    internalRead(this);
  };

  stream.on("resume", () => {
    ref();
    stream._undestroy();
  });

  stream._readableState.reading = false;

  stream.on("pause", () => {
    process.nextTick(() => {
      if (!stream.readableFlowing) {
        stream._readableState.reading = false;
      }
    });
  });

  stream.on("close", () => {
    process.nextTick(() => {
      stream.destroy();
      unref();
    });
  });

  return stream;
}).$$capture_end$$;
