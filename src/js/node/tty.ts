// Hardcoded module "node:tty"

// Note: please keep this module's loading constrants light, as some users
// import it just to call `isatty`. In that case, `node:stream` is not needed.

const {
  isatty: isTTY,
  getWindowSize: _getWindowSize,
}: {
  isatty(fd: unknown): boolean;
  /** Fills `size` with [columns, rows]. */
  getWindowSize(fd: number | null, size: number[]): boolean;
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");

type Environment = Record<string, string | undefined>;
type DoneCallback = (error?: Error | null) => void;

declare global {
  namespace $Node {
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

const NumberIsInteger = Number.isInteger;

// https://github.com/nodejs/node/blob/v26.3.0/lib/tty.js#L46-L49: `fd` is not converted.
function isatty(fd: unknown): boolean {
  return NumberIsInteger(fd) && (fd as number) >= 0 && (fd as number) <= 2147483647 && isTTY(fd);
}

type Self = $Node.TTYWriteStream;
function WriteStream(this: Self, fd: number): void {
  if (!(this instanceof WriteStream)) return new WriteStream(fd) as any;
  if (fd >> 0 !== fd || fd < 0) throw $ERR_INVALID_FD(fd);

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

// An accessor, as the stream classes of node:fs: node:tty loads node:net when ReadStream is first read or assigned.
function materializeReadStream<T>(value: T): T {
  Reflect.defineProperty(tty, "ReadStream", { value, writable: true, configurable: true });
  return value;
}

const tty = {
  get ReadStream() {
    return materializeReadStream(require("internal/tty/read_stream").ReadStream);
  },
  set ReadStream(value) {
    materializeReadStream(value);
  },
  WriteStream,
  isatty,
};
export default tty;
