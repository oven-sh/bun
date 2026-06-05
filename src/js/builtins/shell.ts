export function createBunShellTemplateFunction(createShellInterpreter_, createParsedShellScript_) {
  const createShellInterpreter = createShellInterpreter_ as (
    resolve: (code: number, stdout: Buffer, stderr: Buffer) => void,
    reject: (code: number, stdout: Buffer, stderr: Buffer) => void,
    args: $ZigGeneratedClasses.ParsedShellScript,
  ) => $ZigGeneratedClasses.ShellInterpreter;
  const createParsedShellScript = createParsedShellScript_ as (
    raw: string,
    args: string[],
  ) => $ZigGeneratedClasses.ParsedShellScript;

  function lazyBufferToHumanReadableString(this: Buffer) {
    return this.toString();
  }

  class ShellError extends Error {
    #output?: ShellOutput = undefined;
    info;
    exitCode;
    stdout;
    stderr;

    constructor() {
      super("");
    }

    initialize(output: ShellOutput, code: number, message?: string) {
      this.message = message !== undefined ? message : `Failed with exit code ${code}`;
      this.#output = output;
      this.name = "ShellError";

      // We previously added this so that errors would display the "info" property
      // We fixed that, but now it displays both.
      Object.defineProperty(this, "info", {
        value: {
          exitCode: code,
          stderr: output.stderr,
          stdout: output.stdout,
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });

      this.info.stdout.toJSON = lazyBufferToHumanReadableString;
      this.info.stderr.toJSON = lazyBufferToHumanReadableString;

      this.stdout = output.stdout;
      this.stderr = output.stderr;
      this.exitCode = code;
    }

    text(encoding) {
      return this.#output!.text(encoding);
    }

    json() {
      return this.#output!.json();
    }

    arrayBuffer() {
      return this.#output!.arrayBuffer();
    }

    bytes() {
      return this.#output!.bytes();
    }

    blob() {
      return this.#output!.blob();
    }
  }

  class ShellOutput {
    stdout: Buffer;
    stderr: Buffer;
    exitCode: number;

    constructor(stdout: Buffer, stderr: Buffer, exitCode: number) {
      this.stdout = stdout;
      this.stderr = stderr;
      this.exitCode = exitCode;
    }

    text(encoding) {
      return this.stdout.toString(encoding);
    }

    json() {
      return JSON.parse(this.stdout.toString());
    }

    arrayBuffer() {
      return this.stdout.buffer;
    }

    bytes() {
      return new Uint8Array(this.arrayBuffer());
    }

    blob() {
      return new Blob([this.stdout]);
    }
  }

  class ShellPromise extends Promise<ShellOutput> {
    #args: $ZigGeneratedClasses.ParsedShellScript | undefined = undefined;
    #hasRun: boolean = false;
    #throws: boolean = true;
    #resolve: (code: number, stdout: Buffer, stderr: Buffer) => void;
    #reject: (code: number, stdout: Buffer, stderr: Buffer, message?: string) => void;

    constructor(args: $ZigGeneratedClasses.ParsedShellScript, throws: boolean) {
      // Create the error immediately so it captures the stacktrace at the point
      // of the shell script's invocation. Just creating the error should be
      // relatively cheap, the costly work is actually computing the stacktrace
      // (`computeErrorInfo()` in ZigGlobalObject.cpp)
      let potentialError: ShellError | undefined = new ShellError();
      let resolve, reject;

      super((res, rej) => {
        resolve = (code, stdout, stderr) => {
          const out = new ShellOutput(stdout, stderr, code);
          if (this.#throws && code !== 0) {
            potentialError!.initialize(out, code);
            rej(potentialError);
          } else {
            // Set to undefined to hint to the GC that this is unused so it can
            // potentially GC it earlier
            potentialError = undefined;
            res(out);
          }
        };
        reject = (code, stdout, stderr, message) => {
          potentialError!.initialize(new ShellOutput(stdout, stderr, code), code, message);
          rej(potentialError);
        };
      });

      this.#throws = throws;
      this.#args = args;
      this.#hasRun = false;
      this.#resolve = resolve;
      this.#reject = reject;

      // this.#immediate = setImmediate(autoStartShell, this).unref();
    }

    cwd(newCwd?: string): this {
      this.#throwIfRunning();
      if (typeof newCwd === "undefined" || newCwd === "." || newCwd === "" || newCwd === "./") {
        newCwd = defaultCwd ?? process.cwd();
      }
      this.#args!.setCwd(newCwd);
      return this;
    }

    env(newEnv: Record<string, string | undefined>): this {
      this.#throwIfRunning();
      if (typeof newEnv === "undefined") {
        newEnv = defaultEnv;
      }

      this.#args!.setEnv(newEnv);
      return this;
    }

    #run() {
      if (!this.#hasRun) {
        this.#hasRun = true;

        let interp = createShellInterpreter(this.#resolve, this.#reject, this.#args!);
        this.#args = undefined;
        interp.run();
      }
    }

    #quiet(isQuiet: boolean = true): this {
      this.#throwIfRunning();
      this.#args!.setQuiet(isQuiet);
      return this;
    }

    quiet(isQuiet: boolean | undefined): this {
      return this.#quiet(isQuiet ?? true);
    }

    nothrow(): this {
      this.#throws = false;
      return this;
    }

    throws(doThrow: boolean | undefined): this {
      this.#throws = !!doThrow;
      return this;
    }

    async text(encoding) {
      const { stdout } = (await this.#quiet(true)) as ShellOutput;
      return stdout.toString(encoding);
    }

    async json() {
      const { stdout } = (await this.#quiet(true)) as ShellOutput;
      return JSON.parse(stdout.toString());
    }

    async *lines() {
      const { stdout } = (await this.#quiet(true)) as ShellOutput;

      if (process.platform === "win32") {
        yield* stdout.toString().split(/\r?\n/);
      } else {
        yield* stdout.toString().split("\n");
      }
    }

    async arrayBuffer() {
      const { stdout } = (await this.#quiet(true)) as ShellOutput;
      return stdout.buffer;
    }

    async bytes() {
      return this.arrayBuffer().then(x => new Uint8Array(x));
    }

    async blob() {
      const { stdout } = (await this.#quiet(true)) as ShellOutput;
      return new Blob([stdout]);
    }

    #throwIfRunning() {
      if (this.#hasRun) throw new Error("Shell is already running");
    }

    run(): this {
      this.#run();
      return this;
    }

    then(onfulfilled, onrejected) {
      this.#run();

      return super.then(onfulfilled, onrejected);
    }

    static get [Symbol.species]() {
      return Promise;
    }
  }

  var defaultEnv = process.env || {};
  const originalDefaultEnv = defaultEnv;
  var defaultCwd: string | undefined = undefined;

  const cwdSymbol = Symbol("cwd");
  const envSymbol = Symbol("env");
  const throwsSymbol = Symbol("throws");
  const sandboxSymbol = Symbol("sandbox");

  function validateStringArray(value, what: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!$isJSArray(value)) {
      throw new TypeError(`$.sandbox: ${what} must be an array of strings`);
    }
    const out: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== "string") {
        throw new TypeError(`$.sandbox: ${what} must be an array of strings`);
      }
      out.push(item);
    }
    return out;
  }

  function validatePathArray(value, what: string): string[] | undefined {
    const paths = validateStringArray(value, what);
    if (paths === undefined) return undefined;
    const { isAbsolute } = require("node:path");
    for (const path of paths) {
      if (path.length === 0 || !isAbsolute(path)) {
        throw new TypeError(`$.sandbox: ${what} paths must be absolute, got ${JSON.stringify(path)}`);
      }
      if (path.includes("\0")) {
        throw new TypeError(`$.sandbox: ${what} paths must not contain NUL bytes`);
      }
    }
    return paths;
  }

  function validateLimit(value, what: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new TypeError(`$.sandbox: ${what} must be a positive integer`);
    }
    return value;
  }

  function validateKeys(object, allowed: string[], what: string) {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) {
        throw new TypeError(`$.sandbox: unknown option '${what}${key}'`);
      }
    }
  }

  // Validates the `$.sandbox()` options object and deep-copies it into a
  // frozen, null-prototype policy object (later mutation of the caller's
  // object must not affect the sandbox). The native side
  // (`ParsedShellScript.setSandbox`) re-validates, including builtin names
  // in commands.allow/deny, which only it knows.
  function normalizeSandboxOptions(options) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("$.sandbox: expected an options object");
    }
    validateKeys(options, ["commands", "fs", "network", "limits"], "");

    const normalized: Record<string, any> = { __proto__: null };

    const commands = options.commands;
    if (commands !== undefined) {
      if (typeof commands !== "object" || commands === null) {
        throw new TypeError("$.sandbox: commands must be an object");
      }
      validateKeys(commands, ["allow", "deny"], "commands.");
      normalized.commands = Object.freeze({
        __proto__: null,
        allow: validateStringArray(commands.allow, "commands.allow"),
        deny: validateStringArray(commands.deny, "commands.deny"),
      });
    }

    const fs = options.fs;
    if (fs !== undefined) {
      if (typeof fs !== "object" || fs === null) {
        throw new TypeError("$.sandbox: fs must be an object");
      }
      validateKeys(fs, ["read", "write"], "fs.");
      normalized.fs = Object.freeze({
        __proto__: null,
        read: validatePathArray(fs.read, "fs.read"),
        write: validatePathArray(fs.write, "fs.write"),
      });
    }

    const network = options.network;
    if (network !== undefined) {
      if (typeof network !== "boolean") {
        throw new TypeError("$.sandbox: network must be a boolean");
      }
      if (network) {
        throw new TypeError(
          "$.sandbox: network access cannot be enabled yet; sandboxed shells run only builtin commands, none of which perform network I/O. The only supported value is false.",
        );
      }
      normalized.network = false;
    }

    const limits = options.limits;
    if (limits !== undefined) {
      if (typeof limits !== "object" || limits === null) {
        throw new TypeError("$.sandbox: limits must be an object");
      }
      validateKeys(limits, ["timeout", "maxOutputBytes"], "limits.");
      normalized.limits = Object.freeze({
        __proto__: null,
        timeout: validateLimit(limits.timeout, "limits.timeout"),
        maxOutputBytes: validateLimit(limits.maxOutputBytes, "limits.maxOutputBytes"),
      });
    }

    return Object.freeze(normalized);
  }

  class ShellPrototype {
    [cwdSymbol]: string | undefined;
    [envSymbol]: Record<string, string | undefined> | undefined;
    [throwsSymbol]: boolean = true;
    [sandboxSymbol]: object | undefined;

    sandbox(options) {
      if (this[sandboxSymbol]) {
        throw new Error("$.sandbox: this shell is already sandboxed; derive a new sandbox from an unsandboxed shell");
      }
      const normalized = normalizeSandboxOptions(options);

      var Shell = function Shell(first, ...rest) {
        return runShellTemplate(Shell, first, rest);
      };
      Object.setPrototypeOf(Shell, ShellPrototype.prototype);
      Object.defineProperty(Shell, "name", { value: "Shell", configurable: true, enumerable: true });
      Shell[cwdSymbol] = this[cwdSymbol];
      Shell[envSymbol] = this[envSymbol];
      Shell[throwsSymbol] = this[throwsSymbol];
      Shell[sandboxSymbol] = normalized;
      return Shell;
    }

    env(newEnv: Record<string, string | undefined>) {
      if (typeof newEnv === "undefined" || newEnv === originalDefaultEnv) {
        this[envSymbol] = originalDefaultEnv;
      } else if (newEnv) {
        this[envSymbol] = Object.assign({}, newEnv);
      } else {
        throw new TypeError("env must be an object or undefined");
      }

      return this;
    }

    cwd(newCwd: string | undefined) {
      if (typeof newCwd === "undefined" || typeof newCwd === "string") {
        if (newCwd === "." || newCwd === "" || newCwd === "./") {
          newCwd = defaultCwd ?? process.cwd();
        }

        this[cwdSymbol] = newCwd;
      } else {
        throw new TypeError("cwd must be a string or undefined");
      }

      return this;
    }

    nothrow() {
      this[throwsSymbol] = false;
      return this;
    }

    throws(doThrow: boolean | undefined) {
      this[throwsSymbol] = !!doThrow;
      return this;
    }
  }

  // Shared tagged-template body for `Bun.$`, `new $.Shell()` instances, and
  // `$.sandbox()` shells: `shell` is the template function itself, carrying
  // its configuration under the symbol keys.
  function runShellTemplate(shell, first, rest: any[]) {
    if (first?.raw === undefined) throw new Error("Please use '$' as a tagged template function: $`cmd arg1 arg2`");
    const parsed_shell_script = createParsedShellScript(first.raw, rest);

    const cwd = shell[cwdSymbol];
    const env = shell[envSymbol];
    const throws = shell[throwsSymbol];
    const sandbox = shell[sandboxSymbol];

    // cwd must be set before env or else it will be injected into env as "PWD=/"
    if (cwd) parsed_shell_script.setCwd(cwd);
    if (env) parsed_shell_script.setEnv(env);
    if (sandbox) parsed_shell_script.setSandbox(sandbox);

    return new ShellPromise(parsed_shell_script, throws);
  }

  var BunShell = function BunShell(first, ...rest) {
    return runShellTemplate(BunShell, first, rest);
  };

  function Shell() {
    if (!new.target) {
      throw new TypeError("Class constructor Shell cannot be invoked without 'new'");
    }

    var Shell = function Shell(first, ...rest) {
      return runShellTemplate(Shell, first, rest);
    };

    Object.setPrototypeOf(Shell, ShellPrototype.prototype);
    Object.defineProperty(Shell, "name", { value: "Shell", configurable: true, enumerable: true });

    return Shell;
  }

  Shell.prototype = ShellPrototype.prototype;
  Object.setPrototypeOf(Shell, ShellPrototype);
  Object.setPrototypeOf(BunShell, ShellPrototype.prototype);

  BunShell[cwdSymbol] = defaultCwd;
  BunShell[envSymbol] = defaultEnv;
  BunShell[throwsSymbol] = true;

  Object.defineProperties(BunShell, {
    Shell: {
      value: Shell,
      enumerable: true,
    },
    ShellPromise: {
      value: ShellPromise,
      enumerable: true,
    },
    ShellError: {
      value: ShellError,
      enumerable: true,
    },
  });

  return BunShell;
}
