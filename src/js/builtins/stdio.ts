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
  // What writeFast() of internal/fs/streams does with a receiver that is not a stream: it asks for the state of a stream and then calls _write().
  function writeToForeignReceiver(receiver: any): never {
    if (receiver === undefined)
      throw new TypeError("undefined is not an object (evaluating 'kWriteMonkeyPatchDefense')");
    if (receiver === null) throw new TypeError("null is not an object (evaluating 'kWriteMonkeyPatchDefense')");
    if (receiver._writableState !== undefined) needsWholeStream();
    if (receiver._write !== undefined) needsWholeStream();
    throw new TypeError(
      "this._write is not a function. (In 'this._write(data, encoding, cb)', 'this._write' is undefined)",
    );
  }

  // writeFast() of internal/fs/streams, which both streams have for `write`.
  function writeFast(this: any, data: any, encoding?: unknown, cb?: unknown): boolean {
    if (!$isProxyObject(this)) return writeToForeignReceiver(this);
    // Each stream's own half lies in the handler of its proxy, which no program can reach. A proxy of the program has none there.
    const handler = $getProxyInternalField(this, $proxyFieldHandler);
    // A proxy that was revoked has no handler.
    if (handler === null) return needsWholeStream();
    const writeToThis = handler["%write of this stream%"];
    if (writeToThis !== undefined) return writeToThis(data, encoding, cb);
    return needsWholeStream();
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

    const handler: ProxyHandler<{}> & { "%write of this stream%": typeof writeToThis } = {
      get(_, key) {
        if (key === "write") return writeFast;
        if (key === "isTTY") return isTTY ? true : undefined;
        if (key === "fd") return fd;
        // tty.WriteStream has them from its constructor and again at each SIGWINCH. Any other stream has neither.
        if (key === "columns") return sizeOfTerminal(0);
        if (key === "rows") return sizeOfTerminal(1);
        // As in the whole stream.
        if (key === "%write of this stream%") return undefined;
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
      "%write of this stream%": writeToThis,
    };
    return new Proxy({}, handler);
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
