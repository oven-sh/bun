// tty.WriteStream alone: a TTY process.stdout must not load node:net.

const {
  isatty,
  getWindowSize: _getWindowSize,
}: {
  isatty(fd: unknown): boolean;
  /** Fills `size` with [columns, rows]. */
  getWindowSize(fd: number | null, size: number[]): boolean;
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");
const fs = require("internal/fs/streams");

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

type Self = $Node.TTYWriteStream;
function WriteStream(this: Self, fd: number): void {
  if (!(this instanceof WriteStream)) return new WriteStream(fd) as any;

  // Answers its `this`: the prototype below is `fs.WriteStream.prototype` itself.
  const stream = fs.WriteStream.$call(this, null, { fd, $fastPath: true, autoClose: false }) as unknown as Self;
  stream.columns = undefined;
  stream.rows = undefined;
  stream.isTTY = isatty(stream.fd);

  if (stream.isTTY) {
    const windowSizeArray = [0, 0];
    if (_getWindowSize(fd, windowSizeArray) === true) {
      stream.columns = windowSizeArray[0];
      stream.rows = windowSizeArray[1];
    }
  }

  return stream as unknown as void;
}

Object.defineProperty(WriteStream, "prototype", {
  get() {
    const Real = fs.WriteStream.prototype;
    Object.defineProperty(WriteStream, "prototype", { value: Real });

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

    // After https://github.com/chalk/supports-color and https://github.com/isaacs/color-support.
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

    // Node's stdout is a Duplex, so it is async iterable. It yields nothing.
    WriteStream.prototype[Symbol.asyncIterator] = function () {
      return (async function* () {})();
    };

    return Real;
  },
  enumerable: true,
  configurable: true,
});

export default { WriteStream, isatty };
