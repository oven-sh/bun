// Hardcoded module "node:repl"
//
// A REPL library that you can include in your own code to get a runtime
// interface to your program.
//
// This is built on top of Bun's `node:readline`, `node:vm` and `util.inspect`.
// It does not implement the inspector-backed preview/completion or the
// domain-based error isolation that Node's internal REPL uses, but it provides
// a working `REPLServer` (an `Interface` subclass) with the documented public
// API surface: `start`, `writer`, `REPLServer`, `Recoverable`,
// `REPL_MODE_SLOPPY`, `REPL_MODE_STRICT`.
const { Interface } = require("node:readline");
const { Console } = require("node:console");
const vm = require("node:vm");
const util = require("node:util");
const { validateFunction } = require("internal/validators");

const { inspect } = util;
const { createContext } = vm;

const REPL_MODE_SLOPPY = Symbol("repl-sloppy");
const REPL_MODE_STRICT = Symbol("repl-strict");

const kBufferedCommandSymbol = Symbol("bufferedCommand");
const kLoadingSymbol = Symbol("loading");

const builtinModules = [
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

const writer = obj => inspect(obj, writer.options);
writer.options = { ...inspect.defaultOptions, showProxy: true };

// Format a thrown value for display. Errors raised from a `vm` context are not
// `instanceof Error` in this realm, so `util.inspect` renders them as an empty
// object; detect error-like values structurally and print their stack instead,
// prefixed with "Uncaught " to match Node's REPL.
function formatError(value, write) {
  const isErrorLike =
    value != null &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    "stack" in value;

  if (!isErrorLike) {
    return write(value);
  }

  let stack = typeof value.stack === "string" && value.stack.length > 0 ? value.stack : `${value.name}: ${value.message}`;

  // Drop the internal REPL/readline/events frames and the synthetic `repl:N`
  // location lines so only the user-relevant part of the trace is shown.
  stack = stack
    .split("\n")
    .filter(line => !/^\s*at .*(node:repl|node:readline|node:events|node:internal)/.test(line) && !/^repl:\d+$/.test(line))
    .join("\n")
    .trimEnd();

  return `Uncaught ${stack}`;
}

// `Recoverable` is thrown by the default eval to signal that the input is an
// incomplete (but potentially valid) expression, so the REPL keeps buffering
// lines instead of reporting a syntax error. It extends `SyntaxError` so that
// `err instanceof SyntaxError` keeps working, matching Node.
class Recoverable extends SyntaxError {
  err;
  constructor(err) {
    super();
    this.err = err;
  }
}

// Matches an input that looks like it begins with an object literal so we can
// wrap it in parentheses and evaluate it as an expression (mirrors Node).
const startsWithBraceRegExp = /^\s*{/;
const endsWithSemicolonRegExp = /;\s*$/;

function isObjectLiteral(code) {
  return startsWithBraceRegExp.test(code) && !endsWithSemicolonRegExp.test(code);
}

// JSC reports incomplete input with one of these parser messages. When the
// whole input only fails because the parser hit the end of the source (or an
// unterminated string/template/comment), more input could make it valid, so we
// treat it as recoverable and continue the multiline command.
const recoverableParserMessages = [
  "Unexpected end of script",
  "Unexpected EOF",
  "Multiline comment was not closed properly",
];

function isRecoverableError(e, code) {
  // For similar reasons as the default eval, wrap expressions starting with a
  // curly brace with a parenthesis. Only the open parenthesis is added here as
  // the point is to test for potentially valid but incomplete expressions.
  if (startsWithBraceRegExp.test(code) && isRecoverableError(e, `(${code}`)) {
    return true;
  }

  if (e == null || e.name !== "SyntaxError") {
    return false;
  }

  const message = String(e.message);
  for (let i = 0; i < recoverableParserMessages.length; i++) {
    if (message.indexOf(recoverableParserMessages[i]) !== -1) {
      return true;
    }
  }

  // A string constant closed by a line continuation (`"foo\<newline>`) reads as
  // unterminated to JSC but is completed by the next line.
  if (/\\(?:\r\n?|\n|\u2028|\u2029)\s*$/.test(code)) {
    return true;
  }

  return false;
}

function REPLServer(prompt, stream, eval_, useGlobal, ignoreUndefined, replMode) {
  if (!(this instanceof REPLServer)) {
    return new REPLServer(prompt, stream, eval_, useGlobal, ignoreUndefined, replMode);
  }

  let options;
  if (prompt !== null && typeof prompt === "object") {
    // An options object was given.
    options = { ...prompt };
    stream = options.stream || options.socket;
    // `eval` is a reserved identifier inside Bun builtins, so it must be
    // accessed via a string key here and wherever the property is read/written.
    eval_ = options["eval"];
    useGlobal = options.useGlobal;
    ignoreUndefined = options.ignoreUndefined;
    prompt = options.prompt;
    replMode = options.replMode;
  } else {
    options = {};
  }

  if (!options.input && !options.output) {
    // Legacy API, passing a 'stream'/'socket' option.
    // Use stdin and stdout as the default streams if none were given.
    stream ||= process;

    // We're given a duplex readable/writable Stream, like a `net.Socket`
    // or a custom object with 2 streams, or the `process` object.
    options.input = stream.stdin || stream;
    options.output = stream.stdout || stream;
  }

  if (options.terminal === undefined) {
    options.terminal = options.output.isTTY;
  }
  options.terminal = !!options.terminal;

  if (options.terminal && options.useColors === undefined) {
    options.useColors = !!(options.output.isTTY && process.env.NODE_DISABLE_COLORS === undefined);
  }

  this.input = options.input;
  this.output = options.output;
  this.allowBlockingCompletions = !!options.allowBlockingCompletions;
  this.useColors = !!options.useColors;
  this.useGlobal = !!useGlobal;
  this.ignoreUndefined = !!ignoreUndefined;
  this.replMode = replMode || REPL_MODE_SLOPPY;
  this.underscoreAssigned = false;
  this.last = undefined;
  this.underscoreErrAssigned = false;
  this.lastError = undefined;
  this.breakEvalOnSigint = !!options.breakEvalOnSigint;
  this.editorMode = false;

  if (this.breakEvalOnSigint && eval_) {
    // Allowing this would not reflect user expectations.
    throw $ERR_INVALID_ARG_VALUE("options.breakEvalOnSigint", this.breakEvalOnSigint, "cannot be used with a custom eval function");
  }

  const self = this;

  function defaultEval(code, context, file, cb) {
    let result;
    let err = null;
    let wrappedCmd = false;
    let awaitPromise = false;
    const input = code;

    if (isObjectLiteral(code)) {
      // Add parentheses to make sure `code` is parsed as an expression.
      code = `(${code.trim()})\n`;
      wrappedCmd = true;
    }

    // Support top-level await by wrapping the input in an async function when
    // it contains `await`. The wrapped value is returned so the result can be
    // awaited below.
    if (code.indexOf("await") !== -1) {
      const wrapped = wrapTopLevelAwait(code);
      if (wrapped !== null) {
        code = wrapped;
        wrappedCmd = true;
        awaitPromise = true;
      }
    }

    if (code === "\n") return cb(null);

    while (true) {
      let evalCode = code;
      if (self.replMode === REPL_MODE_STRICT && !/^\s*$/.test(evalCode)) {
        // "void 0" keeps the repl from returning "use strict" as the result
        // value for statements and declarations that don't return a value.
        evalCode = `'use strict'; void 0;\n${evalCode}`;
      }

      try {
        // JSC compiles `vm.Script` lazily, so a parse error is only raised once
        // the script runs. Because a SyntaxError is thrown before any of the
        // script's side effects, running it is how we detect (and recover from)
        // incomplete multiline input.
        const script = new vm.Script(evalCode, { filename: file, displayErrors: false });
        const scriptOptions = { displayErrors: false };
        if (self.useGlobal) {
          result = script.runInThisContext(scriptOptions);
        } else {
          result = script.runInContext(context, scriptOptions);
        }
      } catch (e) {
        if (e != null && e.name === "SyntaxError") {
          if (wrappedCmd) {
            // Unwrap and try again.
            wrappedCmd = false;
            awaitPromise = false;
            code = input;
            continue;
          }
          if (isRecoverableError(e, code)) err = new Recoverable(e);
          else err = e;
        } else {
          // A runtime error: report it as-is.
          err = e;
        }
      }
      break;
    }

    if (err) {
      return cb(err);
    }

    if (awaitPromise && result != null && typeof result.then === "function") {
      result.then(
        value => cb(null, value),
        e => cb(e),
      );
      return;
    }

    cb(null, result);
  }

  self["eval"] = eval_ || defaultEval;

  self.clearBufferedCommand();

  function completer(text, cb) {
    complete.$call(self, text, cb);
  }

  // All the parameters in the object are defining the "input" param of the
  // Interface constructor.
  Interface.$call(this, {
    input: options.input,
    output: options.output,
    completer: options.completer || completer,
    terminal: options.terminal,
    historySize: options.historySize,
    prompt,
  });

  self.resetContext();

  this.commands = { __proto__: null };
  defineDefaultCommands(this);

  // Figure out which "writer" function to use.
  self.writer = options.writer || writer;

  if (self.writer === writer) {
    // Conditionally turn on ANSI coloring.
    writer.options.colors = self.useColors;
  }

  function _parseREPLKeyword(keyword, rest) {
    const cmd = this.commands[keyword];
    if (cmd) {
      cmd.action.$call(this, rest);
      return true;
    }
    return false;
  }

  self.on("close", function emitExit() {
    self.emit("exit");
  });

  let sawSIGINT = false;
  self.on("SIGINT", function onSigInt() {
    const empty = self.line.length === 0;
    self.clearLine();

    const cmd = self[kBufferedCommandSymbol];
    if (!(cmd && cmd.length > 0) && empty) {
      if (sawSIGINT) {
        self.close();
        sawSIGINT = false;
        return;
      }
      self.output.write("(To exit, press Ctrl+C again or Ctrl+D or type .exit)\n");
      sawSIGINT = true;
    } else {
      sawSIGINT = false;
    }

    self.clearBufferedCommand();
    self.displayPrompt();
  });

  self.on("line", function onLine(cmd) {
    cmd ||= "";
    sawSIGINT = false;

    // Check REPL keywords and empty lines against a trimmed line input.
    const trimmedCmd = cmd.trim();

    // Check to see if a REPL keyword was used. If it returns true,
    // display next prompt and return.
    if (trimmedCmd) {
      if (
        trimmedCmd.charAt(0) === "." &&
        trimmedCmd.charAt(1) !== "." &&
        Number.isNaN(Number.parseFloat(trimmedCmd))
      ) {
        const matches = /^\.([^\s]+)\s*(.*)$/.exec(trimmedCmd);
        const keyword = matches?.[1];
        const rest = matches?.[2];
        if (_parseREPLKeyword.$call(self, keyword, rest) === true) {
          return;
        }
        if (!self[kBufferedCommandSymbol]) {
          self.output.write("Invalid REPL keyword\n");
          finish(null);
          return;
        }
      }
    }

    const evalCmd = self[kBufferedCommandSymbol] + cmd + "\n";

    self["eval"](evalCmd, self.context, "repl", finish);

    function finish(e, ret) {
      // If error was a SyntaxError for incomplete input, start/continue a
      // multiline command.
      if (e instanceof Recoverable) {
        self[kBufferedCommandSymbol] += cmd + "\n";
        self.displayPrompt();
        return;
      }

      // Clear buffer if no SyntaxErrors.
      self.clearBufferedCommand();

      if (e) {
        const error = e.err || e;
        if (!self.underscoreErrAssigned) {
          self.lastError = error;
        }
        let errStack = formatError(error, self.writer);
        if (!errStack.endsWith("\n")) errStack += "\n";
        self.output.write(errStack);
      } else if (arguments.length === 2 && (!self.ignoreUndefined || ret !== undefined)) {
        // If we got any output - print it (if no error).
        if (!self.underscoreAssigned) {
          self.last = ret;
        }
        self.output.write(self.writer(ret) + "\n");
      }

      // If the REPL server hasn't closed, display the prompt again.
      if (!self.closed) {
        self.displayPrompt();
      }
    }
  });

  self.displayPrompt();
}
// Make REPLServer a subclass of readline's Interface. `$toClass` is the builtin
// idiom for this; a top-level `Object.setPrototypeOf(REPLServer.prototype,
// Interface.prototype)` fails because property access on required classes isn't
// reliable at builtin module-evaluation time.
$toClass(REPLServer, "REPLServer", Interface);

// Prompt is a string to print on each line for the prompt,
// source is a stream to use for I/O, defaulting to stdin/stdout.
function start(prompt, source, eval_, useGlobal, ignoreUndefined, replMode) {
  return new REPLServer(prompt, source, eval_, useGlobal, ignoreUndefined, replMode);
}

REPLServer.prototype.clearBufferedCommand = function clearBufferedCommand() {
  this[kBufferedCommandSymbol] = "";
};

REPLServer.prototype.close = function close() {
  process.nextTick(() => Interface.prototype.close.$call(this));
};

REPLServer.prototype.createContext = function () {
  let context;
  if (this.useGlobal) {
    context = globalThis;
  } else {
    context = createContext();
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      // Only set properties that do not already exist as a global builtin.
      if (!(name in context)) {
        Object.defineProperty(context, name, {
          __proto__: null,
          ...Object.getOwnPropertyDescriptor(globalThis, name),
        });
      }
    }
    context.global = context;
    const _console = new Console(this.output);
    Object.defineProperty(context, "console", {
      __proto__: null,
      configurable: true,
      writable: true,
      value: _console,
    });
  }

  return context;
};

REPLServer.prototype.resetContext = function () {
  this.context = this.createContext();
  this.underscoreAssigned = false;
  this.underscoreErrAssigned = false;
  this.lines = [];
  this.lines.level = [];

  Object.defineProperty(this.context, "_", {
    __proto__: null,
    configurable: true,
    get: () => this.last,
    set: value => {
      this.last = value;
      if (!this.underscoreAssigned) {
        this.underscoreAssigned = true;
        this.output.write("Expression assignment to _ now disabled.\n");
      }
    },
  });

  Object.defineProperty(this.context, "_error", {
    __proto__: null,
    configurable: true,
    get: () => this.lastError,
    set: value => {
      this.lastError = value;
      if (!this.underscoreErrAssigned) {
        this.underscoreErrAssigned = true;
        this.output.write("Expression assignment to _error now disabled.\n");
      }
    },
  });

  // Allow REPL extensions to extend the new context.
  this.emit("reset", this.context);
};

REPLServer.prototype.displayPrompt = function (preserveCursor) {
  let prompt = this._initialPrompt;
  if (this[kBufferedCommandSymbol].length) {
    prompt = "... ";
  }

  // Do not overwrite `_initialPrompt` here.
  Interface.prototype.setPrompt.$call(this, prompt);
  this.prompt(preserveCursor);
};

// When invoked as an API method, overwrite _initialPrompt.
REPLServer.prototype.setPrompt = function setPrompt(prompt) {
  this._initialPrompt = prompt;
  Interface.prototype.setPrompt.$call(this, prompt);
};

REPLServer.prototype.complete = function () {
  this.completer.$apply(this, arguments);
};

REPLServer.prototype.defineCommand = function (keyword, cmd) {
  if (typeof cmd === "function") {
    cmd = { action: cmd };
  } else {
    validateFunction(cmd.action, "cmd.action");
  }
  this.commands[keyword] = cmd;
};

REPLServer.prototype.setupHistory = function setupHistory(historyConfig, cb) {
  // History persistence is not supported by Bun's node:repl yet. Call the
  // callback so consumers that rely on it do not hang.
  if (typeof historyConfig === "function") {
    cb = historyConfig;
  }
  if (typeof cb === "function") {
    process.nextTick(cb, null, this);
  }
};

// A minimal completer that completes against the keys of the REPL context and
// the global object. It does not do the property-walking completion Node's
// inspector-backed implementation provides, but it keeps `readline`'s tab
// handling and the `complete`/`completer` API working.
function complete(line, callback) {
  const match = /([a-zA-Z_$][\w$]*)$/.exec(line);
  const prefix = match ? match[1] : "";

  const completions = [];
  const seen = new Set();
  const add = name => {
    if (typeof name === "string" && name.startsWith(prefix) && !seen.has(name)) {
      seen.add(name);
      completions.push(name);
    }
  };

  try {
    const context = this.useGlobal ? globalThis : this.context;
    for (const name of Object.getOwnPropertyNames(context)) add(name);
  } catch {
    // Continue regardless of error.
  }
  for (const name of keywords) add(name);

  completions.sort();
  callback(null, [completions, prefix]);
}

const keywords = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
];

// Wrap an input that uses top-level `await` in an async IIFE so it can be
// evaluated and awaited. Declarations (`const`/`let`/`var`) are hoisted onto
// the context via an assignment so they persist across REPL turns, mirroring
// Node's top-level-await handling for the common cases. Returns `null` when the
// input cannot be wrapped (e.g. it is not a valid expression/statement), in
// which case the caller evaluates it unwrapped.
function wrapTopLevelAwait(code) {
  const trimmed = code.trim();
  if (trimmed === "") return null;

  // Declarations: evaluate the initializer inside the async wrapper, then
  // assign the result to the context so it outlives this turn.
  const declMatch = /^(var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=([\s\S]*)$/.exec(trimmed);
  if (declMatch) {
    const name = declMatch[2];
    const init = declMatch[3].replace(/;\s*$/, "");
    return `(async () => { void (${name} = (${init})); return ${name}; })()`;
  }

  return `(async () => { return (${trimmed.replace(/;\s*$/, "")}); })()`;
}

function _turnOnEditorMode(repl) {
  repl.editorMode = true;
  Interface.prototype.setPrompt.$call(repl, "");
}

function _turnOffEditorMode(repl) {
  repl.editorMode = false;
  repl.setPrompt(repl._initialPrompt);
}

function defineDefaultCommands(repl) {
  repl.defineCommand("break", {
    help: "Sometimes you get stuck, this gets you out",
    action: function () {
      this.clearBufferedCommand();
      this.displayPrompt();
    },
  });

  let clearMessage;
  if (repl.useGlobal) {
    clearMessage = "Alias for .break";
  } else {
    clearMessage = "Break, and also clear the local context";
  }
  repl.defineCommand("clear", {
    help: clearMessage,
    action: function () {
      this.clearBufferedCommand();
      if (!this.useGlobal) {
        this.output.write("Clearing context...\n");
        this.resetContext();
      }
      this.displayPrompt();
    },
  });

  repl.defineCommand("exit", {
    help: "Exit the REPL",
    action: function () {
      this.close();
    },
  });

  repl.defineCommand("help", {
    help: "Print this help message",
    action: function () {
      const names = Object.keys(this.commands).sort();
      const longestNameLength = names.reduce((max, name) => Math.max(max, name.length), 0);
      for (const name of names) {
        const cmd = this.commands[name];
        const spaces = " ".repeat(longestNameLength - name.length + 3);
        const line = `.${name}${cmd.help ? spaces + cmd.help : ""}\n`;
        this.output.write(line);
      }
      this.output.write("\nPress Ctrl+C to abort current expression, Ctrl+D to exit the REPL\n");
      this.displayPrompt();
    },
  });

  repl.defineCommand("save", {
    help: "Save all evaluated commands in this REPL session to a file",
    action: function (file) {
      try {
        if (file === "") {
          throw $ERR_MISSING_ARGS("file");
        }
        require("node:fs").writeFileSync(file, this.lines.join("\n"));
        this.output.write(`Session saved to: ${file}\n`);
      } catch {
        this.output.write(`Failed to save: ${file}\n`);
      }
      this.displayPrompt();
    },
  });

  repl.defineCommand("load", {
    help: "Load JS from a file into the REPL session",
    action: function (file) {
      try {
        if (file === "") {
          throw $ERR_MISSING_ARGS("file");
        }
        const fs = require("node:fs");
        const stats = fs.statSync(file);
        if (stats && stats.isFile()) {
          _turnOnEditorMode(this);
          this[kLoadingSymbol] = true;
          const data = fs.readFileSync(file, "utf8");
          this.write(data);
          this[kLoadingSymbol] = false;
          _turnOffEditorMode(this);
          this.write("\n");
        } else {
          this.output.write(`Failed to load: ${file} is not a valid file\n`);
        }
      } catch {
        this.output.write(`Failed to load: ${file}\n`);
      }
      this.displayPrompt();
    },
  });

  if (repl.terminal) {
    repl.defineCommand("editor", {
      help: "Enter editor mode",
      action() {
        _turnOnEditorMode(this);
        this.output.write("// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel)\n");
      },
    });
  }
}

const replModuleExports = {
  start,
  writer,
  REPLServer,
  REPL_MODE_SLOPPY,
  REPL_MODE_STRICT,
  Recoverable,
};

Object.defineProperty(replModuleExports, "builtinModules", {
  __proto__: null,
  get: () => builtinModules,
  set: () => {},
  enumerable: false,
  configurable: true,
});

Object.defineProperty(replModuleExports, "_builtinLibs", {
  __proto__: null,
  get: () => builtinModules,
  set: () => {},
  enumerable: false,
  configurable: true,
});

export default replModuleExports;
