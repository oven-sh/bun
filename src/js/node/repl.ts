// Hardcoded module "node:repl"
const readline = require("node:readline");
const { inspect } = require("node:util");
const vm = require("node:vm");

const builtinModules = [
  "bun",
  "ffi",
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
  "test",
];

const REPL_MODE_SLOPPY = Symbol("repl-sloppy");
const REPL_MODE_STRICT = Symbol("repl-strict");

class Recoverable extends SyntaxError {
  err: Error;
  constructor(err: Error) {
    super(err.message);
    this.err = err;
  }
}

function isRecoverableError(e: unknown): boolean {
  if (!(e instanceof SyntaxError)) return false;
  const message = e.message;
  return (
    /Unexpected end of/.test(message) ||
    /Unterminated /.test(message) ||
    /Expected .+ but encountered end of/.test(message)
  );
}

// Use indirect access since `eval` is a reserved token in the builtin bundler
const indirectEval = globalThis["ev" + "al"];

function defaultEval(
  this: InstanceType<typeof REPLServer>,
  code: string,
  context: object,
  filename: string,
  callback: (err: Error | null, result?: unknown) => void,
) {
  let result;
  try {
    const trimmed = code.replace(/^\n+|\n+$/g, "");
    if (!trimmed) {
      callback.$call(this, null, undefined);
      return;
    }

    const useStrict = this.replMode === REPL_MODE_STRICT ? '"use strict"; ' + trimmed : trimmed;

    if (this.useGlobal) {
      result = indirectEval(useStrict);
    } else {
      result = vm.runInContext(useStrict, context, { filename });
    }
  } catch (e: any) {
    if (isRecoverableError(e)) {
      callback.$call(this, new Recoverable(e));
      return;
    }
    callback.$call(this, e);
    return;
  }
  callback.$call(this, null, result);
}

function defaultWriter(obj: unknown): string {
  return inspect(obj, defaultWriter.options);
}
defaultWriter.options = { showHidden: false, depth: 2, colors: false };

const defaultCommands: Record<
  string,
  { help: string; action: (this: InstanceType<typeof REPLServer>, text: string) => void }
> = {
  help: {
    help: "Print this help message",
    action(this: InstanceType<typeof REPLServer>) {
      const names = Object.keys(this.commands).sort();
      const longestName = names.reduce((max, name) => Math.max(max, name.length), 0);
      for (const name of names) {
        const cmd = this.commands[name];
        const padding = " ".repeat(longestName - name.length + 3);
        this.outputStream.write(`.${name}${padding}${cmd.help || ""}\n`);
      }
      this.displayPrompt();
    },
  },
  exit: {
    help: "Exit the REPL",
    action(this: InstanceType<typeof REPLServer>) {
      this.close();
    },
  },
  clear: {
    help: "Break, and also clear the local context",
    action(this: InstanceType<typeof REPLServer>) {
      this.clearBufferedCommand();
      if (!this.useGlobal) {
        this.outputStream.write("Clearing context...\n");
        this.context = vm.createContext(globalThis);
        this.emit("reset", this.context);
      }
      this.setPrompt(this._initialPrompt);
      this.displayPrompt();
    },
  },
  save: {
    help: "Save all evaluated commands in this REPL session to a file",
    action(this: InstanceType<typeof REPLServer>, file: string) {
      const fs = require("node:fs");
      try {
        fs.writeFileSync(file, this.lines.join("\n") + "\n");
        this.outputStream.write(`Session saved to: ${file}\n`);
      } catch (e: any) {
        this.outputStream.write(`Failed to save: ${e.message}\n`);
      }
      this.displayPrompt();
    },
  },
  load: {
    help: "Load JS from a file into the REPL session",
    action(this: InstanceType<typeof REPLServer>, file: string) {
      const fs = require("node:fs");
      try {
        const data = fs.readFileSync(file, "utf8");
        const lines = data.split("\n");
        for (const line of lines) {
          if (line) {
            this.write(line + "\n");
          }
        }
      } catch (e: any) {
        this.outputStream.write(`Failed to load: ${e.message}\n`);
      }
      this.displayPrompt();
    },
  },
  editor: {
    help: "Enter editor mode",
    action(this: InstanceType<typeof REPLServer>) {
      this.editorMode = true;
      this.outputStream.write("// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel)\n");
    },
  },
  break: {
    help: "Sometimes you get stuck, this gets you out",
    action(this: InstanceType<typeof REPLServer>) {
      this.clearBufferedCommand();
      this.setPrompt(this._initialPrompt);
      this.displayPrompt();
    },
  },
};

function REPLServer(this: any, options?: string | Record<string, any>, ...rest: any[]) {
  if (!(this instanceof REPLServer)) {
    return new (REPLServer as any)(options, ...rest);
  }

  if (typeof options === "string") {
    options = { prompt: options };
  }
  options = options || {};

  // Handle the `stream` shorthand for both input and output
  const input = options.input || options.stream || process.stdin;
  const output = options.output || options.stream || process.stdout;
  const prompt = options.prompt !== undefined ? options.prompt : "> ";
  const terminal = options.terminal !== undefined ? options.terminal : !!output.isTTY;
  const useColors =
    options.useColors !== undefined
      ? options.useColors
      : terminal && typeof output.hasColors === "function"
        ? output.hasColors()
        : false;
  const useGlobal = options.useGlobal !== undefined ? options.useGlobal : false;
  const ignoreUndefined = options.ignoreUndefined || false;
  const replMode = options.replMode || REPL_MODE_SLOPPY;
  const breakEvalOnSigint = options.breakEvalOnSigint || false;
  const preview = options.preview !== undefined ? options.preview : true;
  const evalFn = options["ev" + "al"] || defaultEval;
  const writer = options.writer || defaultWriter;
  const completer = options.completer || undefined;

  // Store REPL properties
  this.useColors = useColors;
  this.useGlobal = useGlobal;
  this.ignoreUndefined = ignoreUndefined;
  this.replMode = replMode;
  this.breakEvalOnSigint = breakEvalOnSigint;
  this.preview = preview;
  // Per-instance writer to avoid mutating shared defaultWriter.options
  if (useColors && writer === defaultWriter) {
    const instanceOptions = { ...defaultWriter.options, colors: true };
    this.writer = function (obj: unknown) {
      return inspect(obj, instanceOptions);
    };
    this.writer.options = instanceOptions;
  } else {
    this.writer = writer;
  }
  this._eval = evalFn;

  // Underscore tracking
  this.last = undefined;
  this.lastError = undefined;
  this.underscoreAssigned = false;
  this.underscoreErrAssigned = false;

  // Multi-line buffer
  this._bufferedCommand = "";
  this.lines = [];
  this.editorMode = false;

  // Commands registry
  this.commands = Object.create(null);

  // Input/output references
  this.inputStream = input;
  this.outputStream = output;

  // Builtin modules list
  this._builtinLibs = builtinModules;
  this.builtinModules = builtinModules;

  // Initialize context
  if (useGlobal) {
    this.context = globalThis;
  } else {
    this.context = vm.createContext(globalThis);
  }

  const savedPrompt = prompt;
  this._initialPrompt = prompt;

  // Initialize readline.Interface
  readline.Interface.$call(this, {
    input,
    output,
    prompt,
    terminal,
    completer,
    historySize: options.historySize ?? 1000,
  });

  // Register default commands
  for (const name of Object.keys(defaultCommands)) {
    this.defineCommand(name, defaultCommands[name]);
  }

  // Handle line events for the eval loop
  this.on("line", (line: string) => {
    // Check for REPL commands (lines starting with .)
    const trimmedLine = line.trim();
    if (trimmedLine.charAt(0) === "." && !this.editorMode) {
      const matches = trimmedLine.match(/^\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(.*)?$/);
      if (matches) {
        const keyword = matches[1];
        const rest = matches[2] || "";
        if (this.commands[keyword]) {
          this.commands[keyword].action.$call(this, rest);
          return;
        }
        this.outputStream.write("Invalid REPL keyword\n");
        this.displayPrompt();
        return;
      }
    }

    // Editor mode: collect lines until Ctrl+D
    if (this.editorMode) {
      this._bufferedCommand += line + "\n";
      return;
    }

    // Empty line: silently re-prompt without printing "undefined"
    if (!trimmedLine && !this._bufferedCommand) {
      this.prompt();
      return;
    }

    this.lines.push(line);
    this._bufferedCommand += line + "\n";

    this._eval.$call(this, this._bufferedCommand, this.context, "repl", (err: any, result: unknown) => {
      if (err) {
        if (err instanceof Recoverable) {
          // Multi-line: wait for more input
          this.setPrompt("... ");
          this.prompt();
          return;
        }
        // Print error
        if (err instanceof Error) {
          if (err.stack) {
            this.outputStream.write(err.stack + "\n");
          } else {
            this.outputStream.write(String(err) + "\n");
          }
        } else {
          this.outputStream.write("Thrown: ");
          this.outputStream.write(this.writer(err) + "\n");
        }
        this.lastError = err;
        if (!this.underscoreErrAssigned) {
          if (this.useGlobal) {
            globalThis._error = err;
          } else {
            this.context._error = err;
          }
        }
      } else {
        this.last = result;
        if (!this.underscoreAssigned) {
          if (this.useGlobal) {
            globalThis._ = result;
          } else {
            this.context._ = result;
          }
        }
        if (result !== undefined || !this.ignoreUndefined) {
          this.outputStream.write(this.writer(result) + "\n");
        }
      }
      this._bufferedCommand = "";
      this.setPrompt(savedPrompt);
      this.prompt();
    });
  });

  this.on("close", () => {
    // If in editor mode, evaluate the buffered content before exiting
    if (this.editorMode && this._bufferedCommand.length > 0) {
      this.editorMode = false;
      const code = this._bufferedCommand;
      // Record editor lines for .save
      const editorLines = code.split("\n").filter(Boolean);
      for (const l of editorLines) this.lines.push(l);
      this._bufferedCommand = "";
      this._eval.$call(this, code, this.context, "repl", (err: any, result: unknown) => {
        if (err) {
          if (err instanceof Error) {
            this.outputStream.write((err.stack || String(err)) + "\n");
          } else {
            this.outputStream.write("Thrown: " + this.writer(err) + "\n");
          }
          this.lastError = err;
          if (!this.underscoreErrAssigned) {
            if (this.useGlobal) {
              globalThis._error = err;
            } else {
              this.context._error = err;
            }
          }
        } else {
          this.last = result;
          if (!this.underscoreAssigned) {
            if (this.useGlobal) {
              globalThis._ = result;
            } else {
              this.context._ = result;
            }
          }
          if (result !== undefined || !this.ignoreUndefined) {
            this.outputStream.write(this.writer(result) + "\n");
          }
        }
        this.emit("exit");
      });
      return;
    }
    this.emit("exit");
  });

  // Handle Ctrl+C with double-press tracking
  this._sawSigint = false;
  this.on("SIGINT", () => {
    if (this.editorMode) {
      this.editorMode = false;
      this._sawSigint = false;
      this.clearBufferedCommand();
      this.outputStream.write("\n");
      this.setPrompt(savedPrompt);
      this.prompt();
    } else if (this._bufferedCommand.length > 0) {
      this._sawSigint = false;
      this.clearBufferedCommand();
      this.outputStream.write("\n");
      this.setPrompt(savedPrompt);
      this.prompt();
    } else if (this._sawSigint) {
      this.close();
    } else {
      this._sawSigint = true;
      this.outputStream.write("\n(To exit, press Ctrl+C again or Ctrl+D or type .exit)\n");
      this.prompt();
    }
  });

  // Reset double-Ctrl+C tracking on any line input
  this.on("line", () => {
    this._sawSigint = false;
  });

  // Display initial prompt
  this.setPrompt(savedPrompt);
  this.prompt();
}

$toClass(REPLServer, "REPLServer", readline.Interface);

REPLServer.prototype.defineCommand = function defineCommand(
  keyword: string,
  cmd: { help?: string; action: Function } | Function,
) {
  if (typeof cmd === "function") {
    cmd = { action: cmd };
  }
  this.commands[keyword] = cmd;
};

REPLServer.prototype.displayPrompt = function displayPrompt(preserveCursor?: boolean) {
  this.prompt(preserveCursor);
};

REPLServer.prototype.clearBufferedCommand = function clearBufferedCommand() {
  this._bufferedCommand = "";
};

REPLServer.prototype.setupHistory = function setupHistory(
  historyFile: string,
  callback: (err: Error | null, repl: any) => void,
) {
  if (historyFile) {
    const fs = require("node:fs");
    try {
      const data = fs.readFileSync(historyFile, "utf8");
      if (data) {
        const lines = data.split(/[\n\r]+/).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          this.history.push(lines[i]);
        }
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
  }
  if (typeof callback === "function") {
    callback.$call(this, null, this);
  }
};

REPLServer.prototype.createContext = function createContext() {
  if (this.useGlobal) {
    this.context = globalThis;
  } else {
    this.context = vm.createContext(globalThis);
  }
  return this.context;
};

function start(options?: string | Record<string, any>) {
  return new (REPLServer as any)(options);
}

export default {
  start,
  REPLServer,
  Recoverable,
  REPL_MODE_SLOPPY,
  REPL_MODE_STRICT,
  builtinModules,
  writer: defaultWriter,
  _builtinLibs: builtinModules,
};
