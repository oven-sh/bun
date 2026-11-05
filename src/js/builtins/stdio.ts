type NeedsWholeStream = () => never;
type WriteToSink = (fd: number, data: unknown) => number | boolean | Promise<unknown>;
type GetWindowSize = (fd: number, size: number[]) => boolean;
type ServedByLightStream = Record<"values" | "methods", string[]>;

// What a compiled program has for process.stdout and process.stderr where getStdioWriteStream() was left out of it: the program asks the
// streams for `fd`, `isTTY`, `columns`, `rows`, `getColorDepth` and `write` and does nothing else with them. Every other operation on such an object is a trap
// that calls `needsWholeStream`. The compiler keeps getStdioWriteStream() wherever the program does anything else with a stream (internal/streams/load_all.ts has the names), and
// native code then makes the streams with that and never comes here. `needsWholeStream` does not return.
// console.log asks a proxy nothing: it prints the target, and looks at each of its members. So the target has one, a getter, and that is such a trap too.
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
  // And all of node:stream puts its operators on Readable.prototype, which a program that has loaded a part of it reaches.
  const streams = require("internal/streams/load_all");
  streams.rest?.();
  const served: ServedByLightStream = streams.servedByLightOutputs;
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

  const readsSizeOfTerminal: (() => void)[] = [];

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

    // tty.WriteStream asks the terminal in its constructor and again at each SIGWINCH, and at no read.
    let lastSize: number[] | undefined;
    readsSizeOfTerminal[fd] = () => {
      const size = [0, 0];
      if (getWindowSize(fd, size) === true) lastSize = size;
    };
    function sizeOfTerminal(index: number) {
      return lastSize === undefined ? undefined : lastSize[index];
    }

    const handler: ProxyHandler<{}> & {
      "%write of this stream%": typeof writeToThis;
      "%write of both streams%": typeof writeFast;
    } = {
      get(_, key) {
        // As in the whole stream.
        if (key === "%write of this stream%") return undefined;
        if (!served.values.includes(key as string) && !served.methods.includes(key as string)) needsWholeStream();
        if (key === "write") return handler["%write of both streams%"];
        if (key === "isTTY") return isTTY ? true : undefined;
        if (key === "fd") return fd;
        // tty.WriteStream has them from its constructor and again at each SIGWINCH. Any other stream has neither.
        if (key === "columns") return sizeOfTerminal(0);
        if (key === "rows") return sizeOfTerminal(1);
        // tty.WriteStream inherits it, and looks at no receiver. Any other stream has none.
        if (key === "getColorDepth") {
          if (!isTTY) return undefined;
          const tty = require("internal/tty");
          const prototype = tty.prototypeOfWriteStream;
          return prototype === undefined ? tty.getColorDepthOfStream : prototype.getColorDepth;
        }
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
      "%write of both streams%": writeFast,
    };
    return new Proxy(
      {
        get "%the whole stream%"() {
          return needsWholeStream();
        },
      },
      handler,
    );
  }

  return {
    stdout: makeStream(1, isOutputTTY, isOutputFile),
    stderr: makeStream(2, isErrorTTY, isErrorFile),
    // Native code calls it when a stream that is a terminal is first read. The whole stream also tells its listeners, and this one has none.
    listenForSizeOfTerminal(fd: number) {
      const readSize = readsSizeOfTerminal[fd];
      readSize();
      process.on("SIGWINCH", readSize);
    },
  };
}

// The same for process.stdin, which is asked for `fd` and `isTTY` alone.
export function getLightStdinStream(isTTY: boolean, needsWholeStream: NeedsWholeStream) {
  // As in getLightStdioWriteStreams().
  void process.nextTick;
  require("node:events");
  const streams = require("internal/streams/load_all");
  streams.rest?.();
  const served: ServedByLightStream = streams.servedByLightInput;
  return new Proxy(
    {
      get "%the whole stream%"() {
        return needsWholeStream();
      },
    },
    {
      get(_, key) {
        if (!served.values.includes(key as string) && !served.methods.includes(key as string)) needsWholeStream();
        if (key === "isTTY") return isTTY ? true : undefined;
        if (key === "fd") return 0;
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
