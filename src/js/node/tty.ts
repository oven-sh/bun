const {
  setRawMode: ttySetMode,
  isatty,
  getWindowSize: _getWindowSize,
} = $cpp("ProcessBindingTTYWrap.cpp", "createBunTTYFunctions");

// primordials
const NumberIsInteger = Number.isInteger;

function ReadStream(fd) {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd);
  }
  if (fd >> 0 !== fd || fd < 0) throw new RangeError("fd must be a positive integer");

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
        this[require("node:stream")[Symbol.for("::bunternal::")].kEnsureConstructed]();

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

let OSRelease;

const COLORS_2 = 1;
const COLORS_16 = 4;
const COLORS_256 = 8;
const COLORS_16m = 24;

// Some entries were taken from `dircolors`
// (https://linux.die.net/man/1/dircolors). The corresponding terminals might
// support more than 16 colors, but this was not tested for.
//
// Copyright (C) 1996-2016 Free Software Foundation, Inc. Copying and
// distribution of this file, with or without modification, are permitted
// provided the copyright notice and this notice are preserved.
const TERM_ENVS = {
  "eterm": COLORS_16,
  "cons25": COLORS_16,
  "console": COLORS_16,
  "cygwin": COLORS_16,
  "dtterm": COLORS_16,
  "gnome": COLORS_16,
  "hurd": COLORS_16,
  "jfbterm": COLORS_16,
  "konsole": COLORS_16,
  "kterm": COLORS_16,
  "mlterm": COLORS_16,
  "mosh": COLORS_16m,
  "putty": COLORS_16,
  "st": COLORS_16,
  // https://github.com/da-x/rxvt-unicode/tree/v9.22-with-24bit-color
  "rxvt-unicode-24bit": COLORS_16m,
  // https://gist.github.com/XVilka/8346728#gistcomment-2823421
  "terminator": COLORS_16m,
};

const TERM_ENVS_REG_EXP = [/ansi/, /color/, /linux/, /^con[0-9]*x[0-9]/, /^rxvt/, /^screen/, /^xterm/, /^vt100/];

let warned = false;
function warnOnDeactivatedColors(env) {
  if (warned) return;
  let name = "";
  if (env.NODE_DISABLE_COLORS !== undefined) name = "NODE_DISABLE_COLORS";
  if (env.NO_COLOR !== undefined) {
    if (name !== "") {
      name += "' and '";
    }
    name += "NO_COLOR";
  }

  if (name !== "") {
    process.emitWarning(`The '${name}' env is ignored due to the 'FORCE_COLOR' env being set.`, "Warning");
    warned = true;
  }
}

function WriteStream(fd) {
  if (!(this instanceof WriteStream)) return new WriteStream(fd);
  if (fd >> 0 !== fd || fd < 0) throw new RangeError("fd must be a positive integer");

  const stream = require("node:fs").WriteStream.$call(this, "", { fd });

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
      // Use level 0-3 to support the same levels as `chalk` does. This is done for
      // consistency throughout the ecosystem.
      if (env.FORCE_COLOR !== undefined) {
        switch (env.FORCE_COLOR) {
          case "":
          case "1":
          case "true":
            warnOnDeactivatedColors(env);
            return COLORS_16;
          case "2":
            warnOnDeactivatedColors(env);
            return COLORS_256;
          case "3":
            warnOnDeactivatedColors(env);
            return COLORS_16m;
          default:
            return COLORS_2;
        }
      }

      if (
        env.NODE_DISABLE_COLORS !== undefined ||
        // See https://no-color.org/
        env.NO_COLOR !== undefined ||
        // The "dumb" special terminal, as defined by terminfo, doesn't support
        // ANSI color control codes.
        // See https://invisible-island.net/ncurses/terminfo.ti.html#toc-_Specials
        env.TERM === "dumb"
      ) {
        return COLORS_2;
      }

      if (process.platform === "win32") {
        // Lazy load for startup performance.
        if (OSRelease === undefined) {
          const { release } = require("node:os");
          OSRelease = release().split(".");
        }
        // Windows 10 build 10586 is the first Windows release that supports 256
        // colors. Windows 10 build 14931 is the first release that supports
        // 16m/TrueColor.
        if (+OSRelease[0] >= 10) {
          const build = +OSRelease[2];
          if (build >= 14931) return COLORS_16m;
          if (build >= 10586) return COLORS_256;
        }

        return COLORS_16;
      }

      if (env.TMUX) {
        return COLORS_256;
      }

      if (env.CI) {
        if (
          ["APPVEYOR", "BUILDKITE", "CIRCLECI", "DRONE", "GITHUB_ACTIONS", "GITLAB_CI", "TRAVIS"].some(
            sign => sign in env,
          ) ||
          env.CI_NAME === "codeship"
        ) {
          return COLORS_256;
        }
        return COLORS_2;
      }

      if ("TEAMCITY_VERSION" in env) {
        return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? COLORS_16 : COLORS_2;
      }

      switch (env.TERM_PROGRAM) {
        case "iTerm.app":
          if (!env.TERM_PROGRAM_VERSION || /^[0-2]\./.test(env.TERM_PROGRAM_VERSION)) {
            return COLORS_256;
          }
          return COLORS_16m;
        case "HyperTerm":
        case "MacTerm":
          return COLORS_16m;
        case "Apple_Terminal":
          return COLORS_256;
      }

      if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") {
        return COLORS_16m;
      }

      if (env.TERM) {
        if (/^xterm-256/.test(env.TERM) !== null) {
          return COLORS_256;
        }

        const termEnv = env.TERM.toLowerCase();

        if (TERM_ENVS[termEnv]) {
          return TERM_ENVS[termEnv];
        }
        if (TERM_ENVS_REG_EXP.some(term => term.test(termEnv))) {
          return COLORS_16;
        }
      }
      // Move 16 color COLORTERM below 16m and 256
      if (env.COLORTERM) {
        return COLORS_16;
      }
      return COLORS_2;
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

var validateInteger = (value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== "number") throw ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!NumberIsInteger(value)) throw ERR_OUT_OF_RANGE(name, "an integer", value);
  if (value < min || value > max) throw ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
};

export default { ReadStream, WriteStream, isatty };

function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value?.toString()}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function ERR_OUT_OF_RANGE(name, range, value) {
  const err = new RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  err.code = "ERR_OUT_OF_RANGE";
  return err;
}
