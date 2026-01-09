// Note: ShellTraceFlags interface documents the permission flag values returned
// by $.trace operations. These are intentionally not exported as runtime values
// to keep the trace API simple - users compare against numeric constants directly.
// The values mirror standard Unix open(2) and access(2) flags.

interface ShellTraceOperation {
  /** Permission flags (octal integer, can be combined with |) */
  flags: number;
  /** Working directory at time of operation */
  cwd: string;
  /** Absolute path that would be accessed (for file/execute operations) */
  path?: string;
  /** Command name (for execute operations) */
  command?: string;
  /** Accumulated environment variables at this point in execution */
  env?: Record<string, string>;
  /** Which standard stream is being redirected: "stdin", "stdout", or "stderr" */
  stream?: "stdin" | "stdout" | "stderr";
  /** Command arguments for external commands (excluding command name) */
  args?: string[];
  /** True if operation contains non-statically-analyzable values (command substitution, $1, etc.) */
  dynamic?: true;
}

interface ShellTraceResult {
  operations: ShellTraceOperation[];
  cwd: string;
  success: boolean;
  error: string | null;
}

export function createBunShellTemplateFunction(createShellInterpreter_, createParsedShellScript_, traceShellScript_) {
  const createShellInterpreter = createShellInterpreter_ as (
    resolve: (code: number, stdout: Buffer, stderr: Buffer) => void,
    reject: (code: number, stdout: Buffer, stderr: Buffer) => void,
    args: $ZigGeneratedClasses.ParsedShellScript,
  ) => $ZigGeneratedClasses.ShellInterpreter;
  const createParsedShellScript = createParsedShellScript_ as (
    raw: string,
    args: string[],
  ) => $ZigGeneratedClasses.ParsedShellScript;
  const traceShellScript = traceShellScript_ as (args: $ZigGeneratedClasses.ParsedShellScript) => ShellTraceResult;

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

    initialize(output: ShellOutput, code: number) {
      this.message = `Failed with exit code ${code}`;
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
    #signal?: AbortSignal; // Store the abort signal
    #abortedByUs: boolean = false; // Tracks if OUR abort listener fired
    #resolve: (code: number, stdout: Buffer, stderr: Buffer) => void;
    #reject: (code: number, stdout: Buffer, stderr: Buffer) => void;

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

          // Check if operation was aborted by our signal.
          // We check BOTH conditions:
          // 1. #abortedByUs - our abort listener fired (definitively know our signal caused it)
          // 2. code >= 128 - process was killed by a signal (sanity check)
          //
          // This avoids false positives where:
          // - The signal fires after normal completion (code would be 0 or small)
          // - The process was killed by something else (Ctrl+C) but signal wasn't ours
          //
          // Exit code 128+N indicates the process was killed by signal N.
          // SIGTERM (15) -> 143, SIGKILL (9) -> 137
          const wasAborted = this.#abortedByUs && code >= 128;

          if (wasAborted) {
            if (this.#throws) {
              // Reject with the signal's reason, or a default AbortError
              const reason = this.#signal!.reason ?? new DOMException("The operation was aborted.", "AbortError");
              rej(reason);
            } else {
              // nothrow mode: resolve normally with the exit code
              potentialError = undefined;
              res(out);
            }
            return;
          }

          // Normal (non-abort) exit handling (existing code)
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
        reject = (code, stdout, stderr) => {
          potentialError!.initialize(new ShellOutput(stdout, stderr, code), code);
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
        newCwd = defaultCwd;
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

        // Handle already-aborted signals entirely in JS
        // This avoids spawning anything and immediately settles the promise
        if (this.#signal?.aborted) {
          // Simulate a process killed by SIGTERM (exit code 128 + 15 = 143)
          // The resolve callback will see #abortedByUs=true and code>=128,
          // then reject with AbortError (or resolve if .nothrow() was used)
          this.#resolve(128 + 15, Buffer.alloc(0), Buffer.alloc(0));
          return;
        }

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

    signal(sig: AbortSignal): this {
      this.#throwIfRunning();
      this.#signal = sig;

      // Track when our signal fires - this definitively tells us the abort
      // was triggered by our signal, not some other termination cause
      if (sig.aborted) {
        // Signal is already aborted - handle entirely in JS
        // We'll short-circuit in #run() and never spawn anything
        this.#abortedByUs = true;
        // Don't pass to Zig - we'll handle it in #run()
      } else {
        // Listen for future abort
        sig.addEventListener(
          "abort",
          () => {
            this.#abortedByUs = true;
          },
          { once: true },
        );
        // Pass signal to ParsedShellScript so Zig can access it
        this.#args!.setSignal(sig);
      }

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
          newCwd = defaultCwd;
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

  // Trace function - analyzes shell script without running it
  function trace(first, ...rest): ShellTraceResult {
    if (first?.raw === undefined)
      throw new Error("Please use '$.trace' as a tagged template function: $.trace`cmd arg1 arg2`");
    const parsed_shell_script = createParsedShellScript(first.raw, rest);

    const cwd = BunShell[cwdSymbol];
    const env = BunShell[envSymbol];

    // cwd must be set before env or else it will be injected into env as "PWD=/"
    if (cwd) parsed_shell_script.setCwd(cwd);
    if (env) parsed_shell_script.setEnv(env);

    return traceShellScript(parsed_shell_script);
  }

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
    trace: {
      value: trace,
      enumerable: true,
    },
  });

  return BunShell;
}
