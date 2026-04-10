// Hardcoded module "node:tty"

// Note: please keep this module's loading constrants light, as some users
// import it just to call `isatty`. In that case, `node:stream` is not needed.

const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");
const fs = require("internal/fs/streams");

const { TTY } = process.binding("tty_wrap");

// Node lib/tty.js: tty.ReadStream extends net.Socket with a native TTY handle.
// readableHighWaterMark: 0 makes push() return false on every chunk so
// onStreamRead's backpressure path readStop()s between reads, and _read()
// readStart()s again only when a consumer pulls.
function ReadStream(fd, options): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd, options);
  }
  if (fd >> 0 !== fd || fd < 0) {
    throw $ERR_OUT_OF_RANGE("fd", "a non-negative integer", fd);
  }

  const ctx: { code?: string } = {};
  const tty = new TTY(fd, ctx);
  if (ctx.code !== undefined) {
    const err = new Error("TTY initialization failed: " + ctx.code);
    (err as any).code = "ERR_TTY_INIT_FAILED";
    throw err;
  }

  const { Socket } = require("node:net");
  Socket.$call(this, {
    readableHighWaterMark: 0,
    handle: tty,
    manualStart: true,
    ...options,
  });

  this.fd = fd;
  this.isRaw = false;
  this.isTTY = true;
}

Object.defineProperty(ReadStream, "prototype", {
  get() {
    const { Socket } = require("node:net");
    const Prototype = Object.create(Socket.prototype);

    Prototype.setRawMode = function (flag) {
      flag = !!flag;
      const err = this._handle?.setRawMode(flag);
      if (err) {
        this.emit("error", new Error("setRawMode failed with errno: " + err));
        return this;
      }
      this.isRaw = flag;
      return this;
    };

    Object.defineProperty(ReadStream, "prototype", { value: Prototype });
    Object.setPrototypeOf(ReadStream, Socket);
    return Prototype;
  },
  enumerable: true,
  configurable: true,
});

function WriteStream(fd): void {
  if (!(this instanceof WriteStream)) return new WriteStream(fd);

  const stream = fs.WriteStream.$call(this, null, { fd, $fastPath: true, autoClose: false });
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

  return stream;
}

Object.defineProperty(WriteStream, "prototype", {
  get() {
    const Real = fs.WriteStream.prototype;
    Object.defineProperty(WriteStream, "prototype", { value: Real });

    WriteStream.prototype._refreshSize = function () {
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

    WriteStream.prototype.clearLine = function (dir, cb) {
      return require("node:readline").clearLine(this, dir, cb);
    };

    WriteStream.prototype.clearScreenDown = function (cb) {
      return require("node:readline").clearScreenDown(this, cb);
    };

    WriteStream.prototype.cursorTo = function (x, y, cb) {
      return require("node:readline").cursorTo(this, x, y, cb);
    };

    // The `getColorDepth` API got inspired by multiple sources such as
    // https://github.com/chalk/supports-color,
    // https://github.com/isaacs/color-support.
    WriteStream.prototype.getColorDepth = function (env = process.env) {
      return require("internal/tty").getColorDepth(env);
    };

    WriteStream.prototype.getWindowSize = function () {
      return [this.columns, this.rows];
    };

    WriteStream.prototype.hasColors = function (count, env) {
      if (env === undefined && (count === undefined || (typeof count === "object" && count !== null))) {
        env = count;
        count = 16;
      } else {
        validateInteger(count, "count", 2);
      }

      return count <= 2 ** this.getColorDepth(env);
    };

    WriteStream.prototype.moveCursor = function (dx, dy, cb) {
      return require("node:readline").moveCursor(this, dx, dy, cb);
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

    return Real;
  },
  enumerable: true,
  configurable: true,
});

export default { ReadStream, WriteStream, isatty };
