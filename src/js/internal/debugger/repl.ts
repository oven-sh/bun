// Minimal REPL used by the `node inspect` CLI port (internal/debugger/*).
//
// Bun does not implement node:repl yet, so this provides just the subset of
// the REPLServer surface that lib/internal/debugger/inspect_repl.js relies on:
// Repl.start() with a custom evaluator, an assignable `context`/`history`,
// setPrompt/displayPrompt/pause/resume, dot-commands via defineCommand
// (".exit", ".interrupt"), and "SIGINT"/"exit" events. Input is consumed line
// by line via node:readline; line editing and completion are not supported.
"use strict";

const { EventEmitter } = require("node:events");
const readline = require("node:readline");
const util = require("node:util");
const vm = require("node:vm");

class ReplInterface extends EventEmitter {
  input;
  output;
  context;
  // Not named `eval`: JSC's builtin parser rejects that identifier, and the
  // release build minifies `this["eval"]` down to `this.eval`.
  evalFn;
  history = [];
  ignoreUndefined = false;
  useColors = false;
  commands = { __proto__: null };
  closed = false;
  #prompt = "> ";
  #rl;

  constructor(options) {
    super();
    this.input = options.input;
    this.output = options.output;
    this.#prompt = options.prompt ?? "> ";
    this.evalFn = options.evalFn;
    this.ignoreUndefined = !!options.ignoreUndefined;
    this.useColors = options.useColors ?? !!options.output?.isTTY;
    // useGlobal: false — evaluate control commands in a fresh vm context, like
    // node's REPL does, so `cont`/`next`/… resolve to the getters installed by
    // initializeContext() rather than this process's globals.
    this.context = vm.createContext({});

    this.defineCommand("exit", {
      help: "Exit the REPL",
      action: () => this.close(),
    });

    this.#rl = readline.createInterface({
      input: this.input,
      terminal: false,
    });
    this.#rl.on("line", line => this.#onLine(line));
    this.#rl.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.emit("exit");
      }
    });
    this.#rl.on("SIGINT", () => this.#onSigint());

    this.displayPrompt();
  }

  defineCommand(keyword, cmd) {
    this.commands[keyword] = typeof cmd === "function" ? { action: cmd } : cmd;
  }

  setPrompt(prompt) {
    this.#prompt = prompt;
  }

  getPrompt() {
    return this.#prompt;
  }

  displayPrompt(_preserveCursor?) {
    if (this.closed) return;
    this.output.write(this.#prompt);
  }

  pause() {
    this.#rl.pause();
  }

  resume() {
    this.#rl.resume();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.#rl.close();
    this.emit("exit");
  }

  listenerCountSigint() {
    return this.listenerCount("SIGINT");
  }

  #onSigint() {
    if (this.listenerCount("SIGINT") > 0) {
      this.emit("SIGINT");
    } else {
      this.output.write("\n");
      this.displayPrompt();
    }
  }

  #onLine(line) {
    if (this.closed) return;
    const trimmed = line.trim();

    if (trimmed.startsWith(".") && !trimmed.startsWith("..") && trimmed !== ".") {
      const match = /^\.([^\s]+)\s*(.*)$/.exec(trimmed);
      const keyword = match?.[1];
      const rest = match?.[2] ?? "";
      const command = keyword !== undefined ? this.commands[keyword] : undefined;
      if (command) {
        // The action is responsible for re-displaying the prompt (matching
        // node's REPL); printing another one here races the test harness's
        // prompt detection.
        command.action.$call(this, rest);
      } else {
        this.output.write(`Invalid REPL keyword\n`);
        this.displayPrompt();
      }
      return;
    }

    // Match node's REPL, which hands the line to `eval` with its trailing
    // newline — the debugger uses a bare "\n" to mean "repeat last command".
    const evalFn = this.evalFn;
    try {
      evalFn.$call(this, `${line}\n`, this.context, "repl", (error, result) => {
        this.#finishEval(error, result);
      });
    } catch (error) {
      this.#finishEval(error, undefined);
    }
  }

  #finishEval(error, result) {
    if (this.closed) return;
    if (error) {
      this.output.write(`${this.#formatError(error)}\n`);
    } else if (!(this.ignoreUndefined && result === undefined)) {
      this.output.write(`${util.inspect(result, { colors: this.useColors })}\n`);
    }
    this.displayPrompt();
  }

  // Node's REPL renders internal errors as "Name [ERR_CODE]: message" (the
  // code is baked into the error's stack there). Recreate that shape here so
  // output matches what `node inspect` prints.
  #formatError(error) {
    if (!(error instanceof Error)) {
      return `Uncaught ${util.inspect(error, { colors: this.useColors })}`;
    }
    const code = typeof error.code === "string" && error.code.startsWith("ERR_") ? ` [${error.code}]` : "";
    const head = `${error.name}${code}: ${error.message}`;
    const stack = typeof error.stack === "string" ? error.stack : "";
    const newline = stack.indexOf("\n");
    const frames = newline === -1 ? "" : stack.slice(newline);
    return `Uncaught ${head}${frames}`;
  }
}

function start(options) {
  return new ReplInterface(options);
}

export default { start };
