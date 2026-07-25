// Hardcoded module "node:tty"

// Note: please keep this module's loading constrants light, as some users
// import it just to call `isatty`. In that case, `node:stream` is not needed.

const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
  rawModeStateSize,
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

const { validateInteger } = require("internal/validators");

// libuv stores the mode and the saved termios on each uv_tty_t, so a stream
// going back to cooked never disturbs another one on the same terminal. Keep
// that state per ReadStream rather than per process.
const kRawModeState = Symbol("rawModeState");

// The stream classes pull in node:stream + node:fs; build them on first access.
let ReadStream;
let WriteStream;

function loadReadStream() {
  if (ReadStream) return ReadStream;
  const fs = require("internal/fs/streams");

  function ReadStreamImpl(fd): void {
    if (!(this instanceof ReadStreamImpl)) {
      return new ReadStreamImpl(fd);
    }
    fs.ReadStream.$apply(this, ["", { fd }]);
    this.isRaw = false;
    // Only set isTTY to true if the fd is actually a TTY
    this.isTTY = isatty(fd);
  }
  $toClass(ReadStreamImpl, "ReadStream", fs.ReadStream);

  Object.defineProperty(ReadStreamImpl, "prototype", {
    get() {
      const Prototype = Object.create(fs.ReadStream.prototype);

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

      Object.defineProperty(ReadStreamImpl, "prototype", { value: Prototype });

      return Prototype;
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(ReadStreamImpl, "name", { value: "ReadStream" });
  return (ReadStream = ReadStreamImpl);
}

function loadWriteStream() {
  if (WriteStream) return WriteStream;
  const fs = require("internal/fs/streams");

  function WriteStreamImpl(fd): void {
    if (!(this instanceof WriteStreamImpl)) return new WriteStreamImpl(fd);

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

  Object.defineProperty(WriteStreamImpl, "prototype", {
    get() {
      const Real = fs.WriteStream.prototype;
      Object.defineProperty(WriteStreamImpl, "prototype", { value: Real });

      WriteStreamImpl.prototype._refreshSize = function () {
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

      WriteStreamImpl.prototype.clearLine = function (dir, cb) {
        return require("node:readline").clearLine(this, dir, cb);
      };

      WriteStreamImpl.prototype.clearScreenDown = function (cb) {
        return require("node:readline").clearScreenDown(this, cb);
      };

      WriteStreamImpl.prototype.cursorTo = function (x, y, cb) {
        return require("node:readline").cursorTo(this, x, y, cb);
      };

      // The `getColorDepth` API got inspired by multiple sources such as
      // https://github.com/chalk/supports-color,
      // https://github.com/isaacs/color-support.
      WriteStreamImpl.prototype.getColorDepth = function (env = process.env) {
        return require("internal/tty").getColorDepth(env);
      };

      WriteStreamImpl.prototype.getWindowSize = function () {
        return [this.columns, this.rows];
      };

      WriteStreamImpl.prototype.hasColors = function (count, env) {
        if (env === undefined && (count === undefined || (typeof count === "object" && count !== null))) {
          env = count;
          count = 16;
        } else {
          validateInteger(count, "count", 2);
        }

        return count <= 2 ** this.getColorDepth(env);
      };

      WriteStreamImpl.prototype.moveCursor = function (dx, dy, cb) {
        return require("node:readline").moveCursor(this, dx, dy, cb);
      };

      // Add Symbol.asyncIterator to make tty.WriteStream compatible with code
      // that expects stdout/stderr to be async iterable (like in Node.js where they're Duplex)
      WriteStreamImpl.prototype[Symbol.asyncIterator] = function () {
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

  Object.defineProperty(WriteStreamImpl, "name", { value: "WriteStream" });
  return (WriteStream = WriteStreamImpl);
}

function defineTTYValue(name, value) {
  Reflect.defineProperty(exports, name, { value, writable: true, enumerable: true, configurable: true });
  return value;
}

const exports = {
  get ReadStream() {
    return defineTTYValue("ReadStream", loadReadStream());
  },
  set ReadStream(value) {
    defineTTYValue("ReadStream", value);
  },
  get WriteStream() {
    return defineTTYValue("WriteStream", loadWriteStream());
  },
  set WriteStream(value) {
    defineTTYValue("WriteStream", value);
  },
  isatty,
};

export default exports;
