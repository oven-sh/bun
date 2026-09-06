// tty.WriteStream on its own, so that a TTY process.stdout does not load
// node:tty's other dependency, node:net.

const { isatty, getWindowSize: _getWindowSize } = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");
const fs = require("internal/fs/streams");

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

export default { WriteStream, isatty };
