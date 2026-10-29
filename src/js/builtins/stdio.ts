type NeedsWholeStream = () => never;
type WriteToSink = (fd: number, data: unknown) => number | boolean | Promise<unknown>;
type GetWindowSize = (fd: number, size: number[]) => boolean;

// What a compiled program has for process.stdout and process.stderr where getStdioWriteStream() was left out of it: the program asks the
// streams for `fd`, `isTTY`, `columns`, `rows` and `write` and does nothing else with them. Every other operation on such an object is a trap
// that calls `needsWholeStream`, so the compiler, which follows the traps, keeps getStdioWriteStream() wherever one of them can run, and
// native code then makes the streams with that and never comes here. `needsWholeStream` does not return.
// `writeToSink` calls write() of what the constructor of fs.WriteStream makes for the descriptor: native code makes it when the stream is
// first read. `getWindowSize` is the one of node:tty.
export function getLightStdioWriteStreams(
  isOutputTTY: boolean,
  isOutputFile: boolean,
  isErrorTTY: boolean,
  isErrorFile: boolean,
  needsWholeStream: NeedsWholeStream,
  writeToSink: WriteToSink,
  getWindowSize: GetWindowSize,
) {
  // What else a program can tell of the modules of the whole stream once they are loaded. They read process.nextTick, and a tick that is
  // queued by the first read of it comes earlier than any other. And node:events puts its EventEmitter.prototype above the prototype of `process`.
  const nextTick = process.nextTick;
  require("node:events");
  // Whether it is writeFast() that asks a stream for its own half of it. Anybody else finds nothing under that key, as in the whole stream.
  let isAskedByWriteFast = false;

  // writeFast() of internal/fs/streams, which both streams have for `write`.
  function writeFast(this: any, data: any, encoding?: unknown, cb?: unknown): boolean {
    if (this === undefined) throw new TypeError("undefined is not an object (evaluating 'kWriteMonkeyPatchDefense')");
    if (this === null) throw new TypeError("null is not an object (evaluating 'kWriteMonkeyPatchDefense')");
    isAskedByWriteFast = true;
    const writeToThis = this["%write of this stream%"];
    isAskedByWriteFast = false;
    // A receiver that is no stream has nothing under the keys of internal/fs/streams, which then calls its _write().
    if (typeof writeToThis !== "function")
      throw new TypeError(
        "this._write is not a function. (In 'this._write(data, encoding, cb)', 'this._write' is undefined)",
      );
    return writeToThis(data, encoding, cb);
  }

  function makeStream(fd: number, isTTY: boolean, isFile: boolean) {
    let hasEmittedError = false;

    // For a stream that was never ended, destroyed or listened to.
    function writeToThis(data: any, encoding?: unknown, cb?: unknown): boolean {
      if (typeof encoding === "function") cb = encoding;
      if (isFile) hasEmittedError = false;
      const maybePromise = writeToSink(fd, data);
      if (!$isPromise(maybePromise)) {
        if (typeof cb === "function") cb(null);
        return true;
      }
      maybePromise.then(
        () => {
          if (typeof cb === "function") cb(null);
        },
        err => {
          if (typeof cb === "function") cb(err);
          // errorOrDestroy(): nobody listens for "error", so emitting it throws the error, and it is emitted once. A stream over a file
          // emits behind the callbacks of the writes that failed with this one, outside of any promise, and may emit again for a later write.
          if (hasEmittedError) return;
          hasEmittedError = true;
          if (!isFile) throw err;
          queueMicrotask(() => {
            nextTick(() => {
              throw err;
            });
          });
        },
      );
      return false;
    }

    let lastSize: number[] | undefined;
    function sizeOfTerminal(index: number) {
      if (!isTTY) return undefined;
      const size = [0, 0];
      if (getWindowSize(fd, size) === true) lastSize = size;
      return lastSize === undefined ? undefined : lastSize[index];
    }

    return new Proxy(
      {},
      {
        get(_, key) {
          if (key === "write") return writeFast;
          if (key === "isTTY") return isTTY ? true : undefined;
          if (key === "fd") return fd;
          // tty.WriteStream has them from its constructor and again at each SIGWINCH. Any other stream has neither.
          if (key === "columns") return sizeOfTerminal(0);
          if (key === "rows") return sizeOfTerminal(1);
          if (key === "%write of this stream%") return isAskedByWriteFast ? writeToThis : undefined;
          // A trap is always handed a key. The compiler takes a parameter for one that may be missing.
          if (key === undefined) return undefined;
          needsWholeStream();
        },
        set: needsWholeStream,
        has: needsWholeStream,
        deleteProperty: needsWholeStream,
        defineProperty: needsWholeStream,
        getOwnPropertyDescriptor: needsWholeStream,
        ownKeys: needsWholeStream,
        getPrototypeOf: needsWholeStream,
        setPrototypeOf: needsWholeStream,
        isExtensible: needsWholeStream,
        preventExtensions: needsWholeStream,
      },
    );
  }

  return {
    stdout: makeStream(1, isOutputTTY, isOutputFile),
    stderr: makeStream(2, isErrorTTY, isErrorFile),
    // Native code calls it when a stream that is a terminal is first read. The whole stream reads its size anew there and tells its listeners.
    listenForSizeOfTerminal() {
      process.on("SIGWINCH", () => {});
    },
  };
}

// The same for process.stdin, which is asked for `fd` and `isTTY` alone.
export function getLightStdinStream(isTTY: boolean, needsWholeStream: NeedsWholeStream) {
  // As in getLightStdioWriteStreams().
  void process.nextTick;
  require("node:events");
  return new Proxy(
    {},
    {
      get(_, key) {
        if (key === "isTTY") return isTTY ? true : undefined;
        if (key === "fd") return 0;
        if (key === undefined) return undefined;
        needsWholeStream();
      },
      set: needsWholeStream,
      has: needsWholeStream,
      deleteProperty: needsWholeStream,
      defineProperty: needsWholeStream,
      getOwnPropertyDescriptor: needsWholeStream,
      ownKeys: needsWholeStream,
      getPrototypeOf: needsWholeStream,
      setPrototypeOf: needsWholeStream,
      isExtensible: needsWholeStream,
      preventExtensions: needsWholeStream,
    },
  );
}
