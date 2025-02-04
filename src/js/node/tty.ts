// Note: please keep this module's loading constrants light, as some users
// import it just to call `isatty`. In that case, `node:stream` is not needed.
const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");

function ReadStream(fd): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd);
  }
  require("node:fs").ReadStream.$apply(this, ["", { fd }]);
  this.isRaw = false;
  this.isTTY = true;
}

Object.defineProperty(ReadStream, "prototype", {
  get() {
    const Prototype = Object.create(require("node:fs").ReadStream.prototype);

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

    Object.defineProperty(ReadStream, "prototype", { value: Prototype });

    return Prototype;
  },
  enumerable: true,
  configurable: true,
});

function WriteStream(fd): void {
  if (!(this instanceof WriteStream)) return new WriteStream(fd);

  const stream = require("node:fs").WriteStream.$call(this, null, { fd, $fastPath: true, autoClose: false });
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
    const Real = require("node:fs").WriteStream.prototype;
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

    return Real;
  },
  enumerable: true,
  configurable: true,
});

export default { ReadStream, WriteStream, isatty };
