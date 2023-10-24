(function (){"use strict";
let $assert = function(check, sourceString, ...message) {
  if (!check) {
    const prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return e.name + ': ' + e.message + '\n' + stack.slice(1).map(x => '  at ' + x.toString()).join('\n');
    };
    const e = new Error(sourceString);
    e.stack; // materialize stack
    e.name = 'AssertionError';
    Error.prepareStackTrace = prevPrepareStackTrace;
    console.error('[tty] ASSERTION FAILED: ' + sourceString);
    if (message.length) console.warn(...message);
    console.warn(e.stack.split('\n')[1] + '\n');
    if (Bun.env.ASSERT === 'CRASH') process.exit(0xAA);
    throw e;
  }
}
// build3/tmp/node/tty.ts
var ReadStream = function(fd) {
  if (!(this instanceof ReadStream))
    return new ReadStream(fd);
  if (fd >> 0 !== fd || fd < 0)
    @throwRangeError("fd must be a positive integer");
  const stream = (@getInternalField(@internalModuleRegistry, 21) || @createInternalModuleById(21)).ReadStream.@call(this, "", {
    fd
  });
  Object.setPrototypeOf(stream, ReadStream.prototype);
  stream.isRaw = false;
  stream.isTTY = true;
  $assert(stream instanceof ReadStream, "stream instanceof ReadStream");
  return stream;
};
var warnOnDeactivatedColors = function(env) {
  if (warned)
    return;
  let name = "";
  if (env.NODE_DISABLE_COLORS !== @undefined)
    name = "NODE_DISABLE_COLORS";
  if (env.NO_COLOR !== @undefined) {
    if (name !== "") {
      name += "' and '";
    }
    name += "NO_COLOR";
  }
  if (name !== "") {
    process.emitWarning(`The '${name}' env is ignored due to the 'FORCE_COLOR' env being set.`, "Warning");
    warned = true;
  }
};
var WriteStream = function(fd) {
  if (!(this instanceof WriteStream))
    return new WriteStream(fd);
  if (fd >> 0 !== fd || fd < 0)
    @throwRangeError("fd must be a positive integer");
  const stream = (@getInternalField(@internalModuleRegistry, 21) || @createInternalModuleById(21)).WriteStream.@call(this, "", {
    fd
  });
  stream.columns = @undefined;
  stream.rows = @undefined;
  stream.isTTY = isatty(stream.fd);
  if (stream.isTTY) {
    const windowSizeArray = [0, 0];
    if (_getWindowSize(fd, windowSizeArray) === true) {
      stream.columns = windowSizeArray[0];
      stream.rows = windowSizeArray[1];
    }
  }
  return stream;
};
var { ttySetMode, isatty, getWindowSize: _getWindowSize } = @lazy("tty");
var NumberIsInteger = Number.isInteger;
Object.defineProperty(ReadStream, "prototype", {
  get() {
    const Prototype = Object.create((@getInternalField(@internalModuleRegistry, 21) || @createInternalModuleById(21)).ReadStream.prototype);
    Prototype.setRawMode = function(flag) {
      const mode = flag ? 1 : 0;
      const err = ttySetMode(this.fd, mode);
      if (err) {
        this.emit("error", new Error("setRawMode failed with errno: " + err));
        return this;
      }
      this.isRaw = flag;
      return this;
    };
    Object.defineProperty(ReadStream, "prototype", { value: Prototype });
    return Prototype;
  },
  enumerable: true,
  configurable: true
});
var COLORS_2 = 1;
var COLORS_16 = 4;
var COLORS_256 = 8;
var COLORS_16m = 24;
var TERM_ENVS = {
  eterm: COLORS_16,
  cons25: COLORS_16,
  console: COLORS_16,
  cygwin: COLORS_16,
  dtterm: COLORS_16,
  gnome: COLORS_16,
  hurd: COLORS_16,
  jfbterm: COLORS_16,
  konsole: COLORS_16,
  kterm: COLORS_16,
  mlterm: COLORS_16,
  mosh: COLORS_16m,
  putty: COLORS_16,
  st: COLORS_16,
  "rxvt-unicode-24bit": COLORS_16m,
  terminator: COLORS_16m
};
var TERM_ENVS_REG_EXP = [/ansi/, /color/, /linux/, /^con[0-9]*x[0-9]/, /^rxvt/, /^screen/, /^xterm/, /^vt100/];
var warned = false;
Object.defineProperty(WriteStream, "prototype", {
  get() {
    const Real = (@getInternalField(@internalModuleRegistry, 21) || @createInternalModuleById(21)).WriteStream.prototype;
    Object.defineProperty(WriteStream, "prototype", { value: Real });
    WriteStream.prototype._refreshSize = function() {
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
    var readline = @undefined;
    WriteStream.prototype.clearLine = function(dir, cb) {
      return (readline ??= @getInternalField(@internalModuleRegistry, 35) || @createInternalModuleById(35)).clearLine(this, dir, cb);
    };
    WriteStream.prototype.clearScreenDown = function(cb) {
      return (readline ??= @getInternalField(@internalModuleRegistry, 35) || @createInternalModuleById(35)).clearScreenDown(this, cb);
    };
    WriteStream.prototype.cursorTo = function(x, y, cb) {
      return (readline ??= @getInternalField(@internalModuleRegistry, 35) || @createInternalModuleById(35)).cursorTo(this, x, y, cb);
    };
    WriteStream.prototype.getColorDepth = function(env = process.env) {
      if (env.FORCE_COLOR !== @undefined) {
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
      if (env.NODE_DISABLE_COLORS !== @undefined || env.NO_COLOR !== @undefined || env.TERM === "dumb") {
        return COLORS_2;
      }
      if (false) {
      }
      if (env.TMUX) {
        return COLORS_256;
      }
      if (env.CI) {
        if (["APPVEYOR", "BUILDKITE", "CIRCLECI", "DRONE", "GITHUB_ACTIONS", "GITLAB_CI", "TRAVIS"].some((sign) => (sign in env)) || env.CI_NAME === "codeship") {
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
        if (TERM_ENVS_REG_EXP.some((term) => term.test(termEnv))) {
          return COLORS_16;
        }
      }
      if (env.COLORTERM) {
        return COLORS_16;
      }
      return COLORS_2;
    };
    WriteStream.prototype.getWindowSize = function() {
      return [this.columns, this.rows];
    };
    WriteStream.prototype.hasColors = function(count, env) {
      if (env === @undefined && (count === @undefined || typeof count === "object" && count !== null)) {
        env = count;
        count = 16;
      } else {
        validateInteger(count, "count", 2);
      }
      return count <= 2 ** this.getColorDepth(env);
    };
    WriteStream.prototype.moveCursor = function(dx, dy, cb) {
      return (readline ??= @getInternalField(@internalModuleRegistry, 35) || @createInternalModuleById(35)).moveCursor(this, dx, dy, cb);
    };
    return Real;
  },
  enumerable: true,
  configurable: true
});
var validateInteger = (value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!NumberIsInteger(value))
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  if (value < min || value > max)
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
};
return { ReadStream, WriteStream, isatty }})
