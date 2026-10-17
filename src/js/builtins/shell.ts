// Mirrors `OutputMode` in src/runtime/shell/ParsedShellScript.rs.
const enum OutputMode {
  Capture = 1,
  Inherit = 2,
}

export function createBunShellTemplateFunction(createShellInterpreter_, createParsedShellScript_) {
  const createShellInterpreter = createShellInterpreter_ as (
    resolve: (code: number, stdout: Buffer, stderr: Buffer, inherited: boolean) => void,
    reject: (error: unknown) => void,
    args: $ZigGeneratedClasses.ParsedShellScript,
  ) => $ZigGeneratedClasses.ShellInterpreter;
  const createParsedShellScript = createParsedShellScript_ as (
    raw: string,
    args: string[],
  ) => $ZigGeneratedClasses.ParsedShellScript;

  function lazyBufferToHumanReadableString(this: Buffer) {
    return this.toString();
  }

  function throwNotBuffered(): never {
    throw new Error("output is not buffered when inheritStdio() is used");
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

    initialize(output: ShellOutput, code: number, inherited: boolean) {
      this.message = `Failed with exit code ${code}`;
      this.#output = output;
      this.name = "ShellError";

      if (inherited) {
        // Nothing was buffered, so `stdout` and `stderr` throw here as they do on the output.
        Object.defineProperty(this, "info", {
          value: { exitCode: code },
          writable: true,
          enumerable: false,
          configurable: true,
        });
        Object.defineProperty(this, "stdout", { get: throwNotBuffered, enumerable: false, configurable: true });
        Object.defineProperty(this, "stderr", { get: throwNotBuffered, enumerable: false, configurable: true });
        this.exitCode = code;
        return;
      }

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

  // The output of a script that ran with `inheritStdio()`. Nothing was buffered, so `stdout`
  // and `stderr` throw, and so does each reader it gets from `ShellOutput.prototype`.
  const InheritedShellOutput = class ShellOutput {
    exitCode: number;

    constructor(exitCode: number) {
      this.exitCode = exitCode;
    }

    get stdout(): Buffer {
      throwNotBuffered();
    }

    get stderr(): Buffer {
      throwNotBuffered();
    }
  };
  Object.setPrototypeOf(InheritedShellOutput.prototype, ShellOutput.prototype);

  class ShellPromise extends Promise<ShellOutput> {
    #args: $ZigGeneratedClasses.ParsedShellScript | undefined = undefined;
    #hasRun: boolean = false;
    #throws: boolean = true;
    #resolve: (code: number, stdout: Buffer, stderr: Buffer, inherited: boolean) => void;
    #reject: (error: unknown) => void;

    constructor(args: $ZigGeneratedClasses.ParsedShellScript, throws: boolean) {
      // Create the error immediately so it captures the stacktrace at the point
      // of the shell script's invocation. Just creating the error should be
      // relatively cheap, the costly work is actually computing the stacktrace
      // (`computeErrorInfo()` in ZigGlobalObject.cpp)
      let potentialError: ShellError | undefined = new ShellError();
      let resolve, reject;

      super((res, rej) => {
        resolve = (code, stdout, stderr, inherited) => {
          const out: ShellOutput = inherited
            ? (new InheritedShellOutput(code) as ShellOutput)
            : new ShellOutput(stdout, stderr, code);
          if (this.#throws && code !== 0) {
            potentialError!.initialize(out, code, inherited);
            rej(potentialError);
          } else {
            // Set to undefined to hint to the GC that this is unused so it can
            // potentially GC it earlier
            potentialError = undefined;
            res(out);
          }
        };
        // Only for a JS error raised by the interpreter itself; exit codes go through `resolve`.
        reject = error => {
          potentialError = undefined;
          rej(error);
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

        // `then()` calls this, so a setup failure must reject, not throw.
        try {
          let interp = createShellInterpreter(this.#resolve, this.#reject, this.#args!);
          this.#args = undefined;
          interp.run();
        } catch (e) {
          this.#args = undefined;
          this.#reject(e);
        }
      }
    }

    #quiet(isQuiet: boolean = true): this {
      this.#throwIfRunning();
      this.#args!.setOutputMode(OutputMode.Capture, isQuiet);
      return this;
    }

    quiet(isQuiet: boolean | undefined): this {
      return this.#quiet(isQuiet ?? true);
    }

    inheritStdio(isInherit: boolean | undefined): this {
      this.#throwIfRunning();
      this.#args!.setOutputMode(OutputMode.Inherit, isInherit ?? true);
      return this;
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

    then<TResult1 = ShellOutput, TResult2 = never>(
      onfulfilled?: ((value: ShellOutput) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
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

  class ShellPrototype {
    [cwdSymbol]: string | undefined;
    [envSymbol]: Record<string, string | undefined> | undefined;
    [throwsSymbol]: boolean = true;

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

  var BunShell = function BunShell(first, ...rest) {
    if (first?.raw === undefined) throw new Error("Please use '$' as a tagged template function: $`cmd arg1 arg2`");
    const parsed_shell_script = createParsedShellScript(first.raw, rest);

    const cwd = BunShell[cwdSymbol];
    const env = BunShell[envSymbol];
    const throws = BunShell[throwsSymbol];

    // cwd must be set before env or else it will be injected into env as "PWD=/"
    if (cwd) parsed_shell_script.setCwd(cwd);
    if (env) parsed_shell_script.setEnv(env);

    return new ShellPromise(parsed_shell_script, throws);
  };

  function Shell() {
    if (!new.target) {
      throw new TypeError("Class constructor Shell cannot be invoked without 'new'");
    }

    var Shell = function Shell(first, ...rest) {
      if (first?.raw === undefined) throw new Error("Please use '$' as a tagged template function: $`cmd arg1 arg2`");
      const parsed_shell_script = createParsedShellScript(first.raw, rest);

      const cwd = Shell[cwdSymbol];
      const env = Shell[envSymbol];
      const throws = Shell[throwsSymbol];

      // cwd must be set before env or else it will be injected into env as "PWD=/"
      if (cwd) parsed_shell_script.setCwd(cwd);
      if (env) parsed_shell_script.setEnv(env);

      return new ShellPromise(parsed_shell_script, throws);
    };

    const prototype = new.target.prototype;
    Object.setPrototypeOf(Shell, $isObject(prototype) ? prototype : ShellPrototype.prototype);
    Object.defineProperty(Shell, "name", { value: "Shell", configurable: true, enumerable: true });

    Shell[cwdSymbol] = defaultCwd;
    Shell[envSymbol] = defaultEnv;
    Shell[throwsSymbol] = true;

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
