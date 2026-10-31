// Hardcoded module "node:tty"

// Note: please keep this module's loading constrants light, as some users
// import it just to call `isatty`. In that case, `node:stream` is not needed.

const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
  rawModeStateSize,
}: {
  /** The errno, or 0. On Windows, for stdin: `(flag)`. */
  setRawMode(fdOrFlag: number | boolean | null, flag?: boolean, state?: Uint8Array): number;
  isatty(fd: unknown): boolean;
  /** Fills `size` with [columns, rows]. */
  getWindowSize(fd: number | null, size: number[]): boolean;
  rawModeStateSize: number;
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");

// libuv stores the mode and the saved termios on each uv_tty_t, so a stream
// going back to cooked never disturbs another one on the same terminal. Keep
// that state per ReadStream rather than per process.
const kRawModeState = Symbol("rawModeState");

type Environment = Record<string, string | undefined>;
type DoneCallback = (error?: Error | null) => void;

declare global {
  namespace $Node {
    interface TTYReadStream extends ReadStream {
      isRaw: boolean;
      isTTY: boolean;
      /** On `process.stdin`, which is a native readable. */
      $bunNativePtr?: $Bindgen.FileInternalReadableStreamSource;
      $start(): void;
      [kRawModeState]?: Uint8Array;
      ref(): this;
      unref(): this;
      setRawMode(flag: boolean): this;
    }

    interface TTYWriteStream extends WriteStream {
      columns: number | undefined;
      rows: number | undefined;
      isTTY: boolean;
      _refreshSize(): void;
      clearLine(dir: number, cb?: DoneCallback): boolean;
      clearScreenDown(cb?: DoneCallback): boolean;
      cursorTo(x: number, y?: number | DoneCallback, cb?: DoneCallback): boolean;
      getColorDepth(env?: Environment): number;
      getWindowSize(): [number | undefined, number | undefined];
      hasColors(count?: number | Environment, env?: Environment): boolean;
      moveCursor(dx: number, dy: number, cb?: DoneCallback): boolean;
    }
  }
}

function ReadStream(this: $Node.TTYReadStream, fd: number | null): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd) as any;
  }
  require("internal/fs/streams").ReadStream.$apply(this, ["", { fd }]);
  this.isRaw = false;
  // Only set isTTY to true if the fd is actually a TTY
  this.isTTY = isatty(fd);
}

// The class stands below fs.ReadStream, and internal/fs/streams loads node:stream. So it is put there when it is first read.
function setUpReadStream() {
  $toClass(ReadStream, "ReadStream", require("internal/fs/streams").ReadStream);
  Object.defineProperty(ReadStream, "prototype", prototypeOfReadStream);
  return ReadStream;
}

const prototypeOfReadStream = {
  get() {
    const Prototype = Object.create(require("internal/fs/streams").ReadStream.prototype);

    // Add ref/unref methods to make tty.ReadStream behave like Node.js
    // where TTY streams have socket-like behavior
    Prototype.ref = function (this: $Node.TTYReadStream) {
      // Get the underlying native stream source if available
      const source = this.$bunNativePtr;
      if (source?.updateRef) {
        source.updateRef(true);
      }
      return this;
    };

    Prototype.unref = function (this: $Node.TTYReadStream) {
      // Get the underlying native stream source if available
      const source = this.$bunNativePtr;
      if (source?.updateRef) {
        source.updateRef(false);
      }
      return this;
    };

    Prototype.setRawMode = function (this: $Node.TTYReadStream, flag: boolean) {
      flag = !!flag;

      // On windows, this goes through the stream handle itself, as it must call
      // uv_tty_set_mode on the uv_tty_t.
      //
      // On POSIX, I tried to use the same approach, but it didn't work reliably,
      // so we just use the file descriptor and use termios APIs directly.
      if (process.platform === "win32") {
        // Special case for stdin, as it has a shared uv_tty handle
        // and it's stream is constructed differently
        if (this.fd === 0) {
          const err = ttySetMode(flag);
          if (err) {
            this.emit("error", new Error("setRawMode failed with errno: " + err));
            return this;
          }
        } else {
          const handle = this.$bunNativePtr;
          if (!handle) {
            this.emit("error", new Error("setRawMode failed because it was called on something that is not a TTY"));
            return this;
          }

          // If you call setRawMode before you call on('data'), the stream will
          // not be constructed, leading to EBADF
          // This corresponds to the `ensureConstructed` function in `native-readable.ts`
          this.$start();

          const err = handle.setRawMode(flag);
          if (err) {
            this.emit("error", err);
            return this;
          }
        }
      } else {
        const state = (this[kRawModeState] ??= new Uint8Array(rawModeStateSize));
        const err = ttySetMode(this.fd, flag, state);
        if (err) {
          this.emit("error", new Error("setRawMode failed with errno: " + err));
          return this;
        }
      }

      this.isRaw = flag;

      return this;
    };

    Prototype._destroy = function (this: $Node.TTYReadStream, err: Error | null, cb: DoneCallback) {
      if (isStdio(this.fd)) return cb(err);
      require("internal/fs/streams").ReadStream.prototype._destroy.$call(this, err, cb);
    };

    Object.defineProperty(ReadStream, "prototype", { value: Prototype });

    return Prototype;
  },
  enumerable: true,
  configurable: true,
};

type Self = $Node.TTYWriteStream;
function WriteStream(this: Self, fd: number): void {
  if (!(this instanceof WriteStream)) return new WriteStream(fd) as any;

  require("internal/fs/streams").WriteStream.$call(this, null, { fd, $fastPath: true, autoClose: false });
  this.columns = undefined;
  this.rows = undefined;
  this.isTTY = isatty(this.fd);

  if (this.isTTY) {
    const windowSizeArray = [0, 0];
    if (_getWindowSize(fd, windowSizeArray) === true) {
      this.columns = windowSizeArray[0];
      this.rows = windowSizeArray[1];
    }
  }
}

Object.defineProperty(WriteStream, "prototype", {
  get() {
    const Prototype = Object.create(require("internal/fs/streams").WriteStream.prototype);
    Object.defineProperty(WriteStream, "prototype", { value: Prototype });

    WriteStream.prototype._destroy = function (this: $Node.TTYWriteStream, err: Error | null, cb: DoneCallback) {
      // Ending a FileSink never closes the stream's fd, so only a stream without one has to skip the close.
      if (isStdio(this.fd) && !this[require("internal/fs/streams").kWriteStreamFastPath]) {
        this.fd = null;
        return cb(err);
      }
      require("internal/fs/streams").WriteStream.prototype._destroy.$call(this, err, cb);
    };

    WriteStream.prototype._refreshSize = function (this: $Node.TTYWriteStream) {
      const oldCols = this.columns;
      const oldRows = this.rows;
      const windowSizeArray = [0, 0];
      if (_getWindowSize(this.fd, windowSizeArray) === true) {
        if (oldCols !== windowSizeArray[0] || oldRows !== windowSizeArray[1]) {
          this.columns = windowSizeArray[0];
          this.rows = windowSizeArray[1];
          this.emit("resize");
        }
      }
    };

    WriteStream.prototype.clearLine = function (this: $Node.TTYWriteStream, dir: number, cb?: DoneCallback) {
      return require("internal/readline/callbacks").published.clearLine(this, dir, cb);
    };

    WriteStream.prototype.clearScreenDown = function (this: $Node.TTYWriteStream, cb?: DoneCallback) {
      return require("internal/readline/callbacks").published.clearScreenDown(this, cb);
    };

    WriteStream.prototype.cursorTo = function (
      this: $Node.TTYWriteStream,
      x: number,
      y?: number | DoneCallback,
      cb?: DoneCallback,
    ) {
      return require("internal/readline/callbacks").published.cursorTo(this, x, y, cb);
    };

    // The `getColorDepth` API got inspired by multiple sources such as
    // https://github.com/chalk/supports-color,
    // https://github.com/isaacs/color-support.
    WriteStream.prototype.getColorDepth = function (env: Environment = process.env) {
      return require("internal/tty").getColorDepth(env);
    };

    WriteStream.prototype.getWindowSize = function (this: $Node.TTYWriteStream) {
      return [this.columns, this.rows];
    };

    WriteStream.prototype.hasColors = function (
      this: $Node.TTYWriteStream,
      count?: number | Environment,
      env?: Environment,
    ) {
      if (env === undefined && (count === undefined || (typeof count === "object" && count !== null))) {
        env = count;
        count = 16;
      } else {
        validateInteger(count, "count", 2);
      }

      return (count as number) <= 2 ** this.getColorDepth(env);
    };

    WriteStream.prototype.moveCursor = function (
      this: $Node.TTYWriteStream,
      dx: number,
      dy: number,
      cb?: DoneCallback,
    ) {
      return require("internal/readline/callbacks").published.moveCursor(this, dx, dy, cb);
    };

    // Add Symbol.asyncIterator to make tty.WriteStream compatible with code
    // that expects stdout/stderr to be async iterable (like in Node.js where they're Duplex)
    WriteStream.prototype[Symbol.asyncIterator] = function () {
      // Since WriteStream is write-only, we return an empty async iterator
      // This matches the behavior of Node.js Duplex streams used for stdout/stderr
      return (async function* () {
        // stdout/stderr don't produce readable data, so yield nothing
      })();
    };

    return Prototype;
  },
  enumerable: true,
  configurable: true,
});

// Node's tty streams wrap a libuv TTY handle, and closing one never closes descriptors 0-2.
function isStdio(fd: number | null) {
  return fd != null && fd <= 2;
}

function materializeReadStream<T>(value: T): T {
  Reflect.defineProperty(tty, "ReadStream", { value, writable: true, configurable: true });
  return value;
}

const tty = {
  get ReadStream() {
    return materializeReadStream(setUpReadStream());
  },
  set ReadStream(value) {
    materializeReadStream(value);
  },
  WriteStream,
  isatty,
};
export default tty;
