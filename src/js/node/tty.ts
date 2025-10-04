// Hardcoded module "node:tty"

const { validateInteger } = require("internal/validators");
const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");
const fs = require("internal/fs/streams");

function ReadStream(fd): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd);
  }
  fs.ReadStream.$apply(this, ["", { fd }]);
  this.isRaw = false;
  // Only set isTTY to true if the fd is actually a TTY
  this.isTTY = isatty(fd);
}
{
  $toClass(ReadStream, "ReadStream", fs.ReadStream);

  const Prototype = ReadStream.prototype;

  // Add ref/unref methods to make tty.ReadStream behave like Node.js
  // where TTY streams have socket-like behavior
  Prototype.ref = function () {
    // Get the underlying native stream source if available
    const source = this.$bunNativePtr;
    if (source?.updateRef) {
      source.updateRef(true);
    }
    return this;
  };

  Prototype.unref = function () {
    // Get the underlying native stream source if available
    const source = this.$bunNativePtr;
    if (source?.updateRef) {
      source.updateRef(false);
    }
    return this;
  };

  Prototype.setRawMode = function (flag) {
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
        }
        return this;
      }

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
    } else {
      const err = ttySetMode(this.fd, flag);
      if (err) {
        this.emit("error", new Error("setRawMode failed with errno: " + err));
        return this;
      }
    }

    this.isRaw = flag;

    return this;
  };
}

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
{
  $toClass(WriteStream, "WriteStream", fs.WriteStream);

  const Prototype = WriteStream.prototype;

  Prototype._refreshSize = function () {
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

  Prototype.clearLine = function (dir, cb) {
    return require("node:readline").clearLine(this, dir, cb);
  };

  Prototype.clearScreenDown = function (cb) {
    return require("node:readline").clearScreenDown(this, cb);
  };

  Prototype.cursorTo = function (x, y, cb) {
    return require("node:readline").cursorTo(this, x, y, cb);
  };

  // The `getColorDepth` API got inspired by multiple sources such as
  // https://github.com/chalk/supports-color,
  // https://github.com/isaacs/color-support.
  Prototype.getColorDepth = function (env = process.env) {
    return require("internal/tty").getColorDepth(env);
  };

  Prototype.getWindowSize = function () {
    return [this.columns, this.rows];
  };

  Prototype.hasColors = function (count, env) {
    if (env === undefined && (count === undefined || (typeof count === "object" && count !== null))) {
      env = count;
      count = 16;
    } else {
      validateInteger(count, "count", 2);
    }

    return count <= 2 ** this.getColorDepth(env);
  };

  Prototype.moveCursor = function (dx, dy, cb) {
    return require("node:readline").moveCursor(this, dx, dy, cb);
  };

  // Add Symbol.asyncIterator to make tty.WriteStream compatible with code
  // that expects stdout/stderr to be async iterable (like in Node.js where they're Duplex)
  Prototype[Symbol.asyncIterator] = function () {
    // Since WriteStream is write-only, we return an empty async iterator
    // This matches the behavior of Node.js Duplex streams used for stdout/stderr
    return (async function* () {
      // stdout/stderr don't produce readable data, so yield nothing
    })();
  };
}

export default {
  ReadStream: ReadStream as unknown as typeof import("node:tty").ReadStream,
  WriteStream: WriteStream as unknown as typeof import("node:tty").WriteStream,
  isatty,
};
