import type { inspect } from "node-inspect-extracted"; // Assuming this provides BufferEncoding

// Define interfaces locally as they are implemented here, not imported
interface ShellErrorInterface extends Error {
  info: { exitCode: number; stdout: Buffer; stderr: Buffer };
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  text(encoding?: BufferEncoding): string;
  json<T = any>(): T;
  arrayBuffer(): ArrayBuffer;
  bytes(): Uint8Array;
  blob(): Blob;
}

interface ShellOutputInterface {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  text(encoding?: BufferEncoding): string;
  json<T = any>(): T;
  arrayBuffer(): ArrayBuffer;
  bytes(): Uint8Array;
  blob(): Blob;
}

interface ShellPromiseInterface extends Promise<ShellOutputInterface> {
  cwd(newCwd?: string): this;
  env(newEnv: Record<string, string | undefined>): this;
  nothrow(): this;
  throws(doThrow?: boolean): this;
  quiet(): this;
  text(encoding?: BufferEncoding): Promise<string>;
  json<T = any>(): Promise<T>;
  lines(): AsyncGenerator<string, void, unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  blob(): Promise<Blob>;
  run(): this; // Added run method
}

function lazyBufferToHumanReadableString(this: Buffer) {
  return this.toString();
}

// @ts-ignore Class definitions moved before usage
class ShellOutput implements ShellOutputInterface {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;

  constructor(stdout: Buffer, stderr: Buffer, exitCode: number) {
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
    // Add toJSON directly to the output buffers, casting to any to allow string return type
    this.stdout.toJSON = lazyBufferToHumanReadableString as any;
    this.stderr.toJSON = lazyBufferToHumanReadableString as any;
  }

  text(encoding?: BufferEncoding): string {
    return this.stdout.toString(encoding);
  }

  json<T = any>(): T {
    return JSON.parse(this.stdout.toString());
  }

  arrayBuffer(): ArrayBuffer {
    // Return a slice representing the Buffer's view into the underlying ArrayBuffer
    // slice() creates a new ArrayBuffer, handling potential SharedArrayBuffer backing.
    const buffer = this.stdout.buffer as ArrayBuffer;
    return buffer.slice(
      this.stdout.byteOffset,
      this.stdout.byteOffset + this.stdout.byteLength,
    );
  }

  bytes(): Uint8Array {
    // Create a Uint8Array view over the correct segment of the underlying ArrayBuffer
    // This view shares the same buffer unless a copy is explicitly made.
    // To ensure a distinct Uint8Array, we create a new one.
    return new Uint8Array(this.stdout.buffer as ArrayBuffer, this.stdout.byteOffset, this.stdout.byteLength);
  }

  blob(): Blob {
    // Create a blob directly from the Uint8Array view for efficiency
    return new Blob([this.bytes()], { type: "application/octet-stream" }); // Provide a default type
  }
}

// @ts-ignore Class definitions moved before usage
class ShellError extends Error implements ShellErrorInterface {
  output?: ShellOutput = undefined; // Changed from private #output to public output
  info!: { exitCode: number; stdout: Buffer; stderr: Buffer }; // Use definite assignment assertion
  exitCode!: number; // Use definite assignment assertion
  stdout!: Buffer; // Use definite assignment assertion
  stderr!: Buffer; // Use definite assignment assertion

  constructor() {
    super("");
    // Properties will be initialized by `initialize`
    this.name = "ShellError"; // Set name in constructor
  }

  initialize(output: ShellOutput, code: number) {
    this.message = `Failed with exit code ${code}`;
    this.output = output;

    // Define info property non-enumerably
    Object.defineProperty(this, "info", {
      value: {
        exitCode: code,
        stderr: output.stderr,
        stdout: output.stdout,
      },
      writable: true,
      enumerable: false, // Keep it non-enumerable like before
      configurable: true,
    });

    // Add toJSON to the buffers within the info object, casting to any
    if (this.info.stdout) this.info.stdout.toJSON = lazyBufferToHumanReadableString as any;
    if (this.info.stderr) this.info.stderr.toJSON = lazyBufferToHumanReadableString as any;

    // Assign top-level properties
    this.stdout = output.stdout;
    this.stderr = output.stderr;
    this.exitCode = code;
  }

  text(encoding?: BufferEncoding): string {
    if (!this.output) return ""; // Handle case where output might not be initialized
    return this.output.text(encoding);
  }

  json<T = any>(): T {
    if (!this.output) throw new Error("Shell process did not produce output."); // Or return null/undefined
    return this.output.json();
  }

  arrayBuffer(): ArrayBuffer {
    if (!this.output) return new ArrayBuffer(0);
    // Return a slice representing the Buffer's view into the underlying ArrayBuffer
    // slice() creates a new ArrayBuffer, handling potential SharedArrayBuffer backing.
    const buffer = this.output.stdout.buffer as ArrayBuffer;
    return buffer.slice(
      this.output.stdout.byteOffset,
      this.output.stdout.byteOffset + this.output.stdout.byteLength,
    );
  }

  bytes(): Uint8Array {
    if (!this.output) return new Uint8Array(0);
    return this.output.bytes();
  }

  blob(): Blob {
    if (!this.output) return new Blob();
    return this.output.blob();
  }
}

// @ts-ignore Class definitions moved before usage
class ShellPromise extends Promise<ShellOutput> implements ShellPromiseInterface {
  #args: $ZigGeneratedClasses.ParsedShellScript | undefined = undefined;
  #hasRun: boolean = false;
  #throws: boolean = true;
  #resolvePromise!: (value: ShellOutput | PromiseLike<ShellOutput>) => void;
  #rejectPromise!: (reason?: any) => void;

  constructor(args: $ZigGeneratedClasses.ParsedShellScript, throws: boolean) {
    let resolvePromise!: (value: ShellOutput | PromiseLike<ShellOutput>) => void;
    let rejectPromise!: (reason?: any) => void;

    super((res, rej) => {
      resolvePromise = res;
      rejectPromise = rej;
    });

    this.#resolvePromise = resolvePromise;
    this.#rejectPromise = rejectPromise;
    this.#throws = throws;
    this.#args = args;
    this.#hasRun = false;
  }

  cwd(newCwd?: string): this {
    this.#throwIfRunning();
    const effectiveCwd = typeof newCwd === "undefined" || newCwd === "." || newCwd === "" || newCwd === "./" ? defaultCwd : newCwd;
    if (this.#args) {
      this.#args.setCwd(effectiveCwd);
    }
    return this;
  }

  env(newEnv: Record<string, string | undefined>): this {
    this.#throwIfRunning();
    const effectiveEnv = typeof newEnv === "undefined" ? defaultEnv : newEnv;
    if (this.#args) {
      this.#args.setEnv(effectiveEnv);
    }
    return this;
  }

  #run() {
    if (!this.#hasRun) {
      if (!this.#args) {
        // Already ran or initialized incorrectly
        throw new Error("ShellPromise arguments are missing.");
      }
      this.#hasRun = true;
      const potentialError: ShellError | undefined = this.#throws ? new ShellError() : undefined;

      const internalResolve = (code: number, stdout: Buffer, stderr: Buffer) => {
        const out = new ShellOutput(stdout, stderr, code);
        if (this.#throws && code !== 0) {
          potentialError!.initialize(out, code);
          this.#rejectPromise(potentialError);
        } else {
          this.#resolvePromise(out);
        }
      };

      const internalReject = (code: number, stdout: Buffer, stderr: Buffer) => {
        const errorToReject = potentialError || new ShellError(); // Reuse or create error
        errorToReject.initialize(new ShellOutput(stdout, stderr, code), code);
        this.#rejectPromise(errorToReject);
      };

      try {
        let interp = createShellInterpreter(internalResolve, internalReject, this.#args);
        this.#args = undefined; // Release reference once passed to interpreter
        interp.run();
      } catch (err) {
        // Catch synchronous errors during interpreter creation/run setup
        this.#rejectPromise(err);
      }
    }
  }

  #quiet(): this {
    this.#throwIfRunning();
    if (this.#args) {
      this.#args.setQuiet();
    }
    return this;
  }

  quiet(): this {
    return this.#quiet();
  }

  nothrow(): this {
    // Allow changing config even if running? Original code threw. Let's allow it.
    // this.#throwIfRunning();
    this.#throws = false;
    return this;
  }

  throws(doThrow: boolean | undefined = true): this {
    // Allow changing config even if running? Original code threw. Let's allow it.
    // this.#throwIfRunning();
    this.#throws = !!doThrow;
    return this;
  }

  async text(encoding?: BufferEncoding): Promise<string> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });
    return output.text(encoding);
  }

  async json<T = any>(): Promise<T> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });
    return output.json();
  }

  async *lines(): AsyncGenerator<string, void, unknown> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });

    const text = output.stdout.toString();
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        const line = text.substring(start, text[i - 1] === '\r' ? i - 1 : i);
        yield line;
        start = i + 1;
      }
    }
    if (start < text.length) {
      yield text.substring(start);
    }
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });
    return output.arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });
    return output.bytes();
  }

  async blob(): Promise<Blob> {
    this.#run();
    const output = await this.catch(err => {
      if (err instanceof ShellError && err.output) return err.output; // Use public output
      throw err;
    });
    return output.blob();
  }

  #throwIfRunning() {
    if (this.#hasRun) throw new Error("Shell is already running and cannot be reconfigured");
  }

  run(): this {
    this.#run();
    return this;
  }

  // Ensure run is called for promise methods
  then<TResult1 = ShellOutput, TResult2 = never>(
    onfulfilled?: ((value: ShellOutput) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    this.#run();
    return super.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<ShellOutput | TResult> {
    this.#run();
    return super.catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<ShellOutput> {
    this.#run();
    return super.finally(onfinally);
  }

  static get [Symbol.species]() {
    return Promise;
  }
}

// Define the public interface for the returned function to satisfy TS4060
// This interface describes the callable function returned by createBunShellTemplateFunction,
// including its static methods and properties, but excluding internal symbols.
interface BunShellCallable {
  (first: TemplateStringsArray | { raw: readonly string[] }, ...rest: any[]): ShellPromiseInterface;
  env(newEnv: Record<string, string | undefined>): this;
  cwd(newCwd: string | undefined): this;
  nothrow(): this;
  throws(doThrow?: boolean): this; // Make doThrow optional
  Shell: ShellConstructor;
  ShellPromise: typeof ShellPromise; // Use typeof for the class constructor
  ShellError: typeof ShellError;   // Use typeof for the class constructor
}

// Define the Shell constructor interface
interface ShellConstructor {
  new (): BunShellCallable; // Constructor returns an object conforming to BunShellCallable
  prototype: ShellPrototypeMethods; // Static prototype property
  // Add static methods inherited from ShellPrototype
  env(newEnv: Record<string, string | undefined>): this;
  cwd(newCwd: string | undefined): this;
  nothrow(): this;
  throws(doThrow?: boolean): this;
}

// Define the methods available on the prototype (shared by BunShell and Shell instances)
interface ShellPrototypeMethods {
  env(newEnv: Record<string, string | undefined>): this;
  cwd(newCwd: string | undefined): this;
  nothrow(): this;
  throws(doThrow?: boolean): this;
}

// Declare these globals here as they are used before assignment within the function
var createShellInterpreter: (
  resolve: (code: number, stdout: Buffer, stderr: Buffer) => void,
  reject: (code: number, stdout: Buffer, stderr: Buffer) => void,
  args: $ZigGeneratedClasses.ParsedShellScript,
) => $ZigGeneratedClasses.ShellInterpreter;

var defaultCwd: string;
var defaultEnv: Record<string, string | undefined>;

export function createBunShellTemplateFunction(
  createShellInterpreter_: unknown,
  createParsedShellScript_: unknown,
): BunShellCallable /* Add return type annotation */ {
  // Assign to the outer scope variables
  createShellInterpreter = createShellInterpreter_ as (
    resolve: (code: number, stdout: Buffer, stderr: Buffer) => void,
    reject: (code: number, stdout: Buffer, stderr: Buffer) => void,
    args: $ZigGeneratedClasses.ParsedShellScript,
  ) => $ZigGeneratedClasses.ShellInterpreter;
  const createParsedShellScript = createParsedShellScript_ as (
    raw: readonly string[], // Changed from string to readonly string[]
    args: any[], // Changed from string[] to any[] to match usage
  ) => $ZigGeneratedClasses.ParsedShellScript;

  defaultEnv = process.env || {};
  const originalDefaultEnv = defaultEnv;
  defaultCwd = process.cwd(); // Ensure defaultCwd is initialized

  const cwdSymbol = Symbol("cwd");
  const envSymbol = Symbol("env");
  const throwsSymbol = Symbol("throws");

  // @ts-ignore // TS thinks ShellPrototype is already defined globally
  class ShellPrototype implements ShellPrototypeMethods {
    // These properties will exist on the function objects (BunShell, Shell constructor, Shell instances)
    [cwdSymbol]: string | undefined;
    [envSymbol]: Record<string, string | undefined> | undefined;
    [throwsSymbol]: boolean = true;

    env(newEnv: Record<string, string | undefined> | undefined): this {
      if (typeof newEnv === "undefined" || Object.is(newEnv, originalDefaultEnv)) {
        this[envSymbol] = defaultEnv; // Use the original defaultEnv object
      } else if (newEnv && typeof newEnv === "object") {
        this[envSymbol] = { ...newEnv }; // Shallow copy
      } else {
        throw new TypeError("env must be an object or undefined");
      }
      return this;
    }

    cwd(newCwd: string | undefined): this {
      if (typeof newCwd === "undefined" || newCwd === null) {
        this[cwdSymbol] = undefined; // Reset to default behavior
      } else if (typeof newCwd === "string") {
        this[cwdSymbol] = (newCwd === "." || newCwd === "" || newCwd === "./") ? undefined : newCwd;
      } else {
        throw new TypeError("cwd must be a string or undefined");
      }
      return this;
    }

    nothrow(): this {
      this[throwsSymbol] = false;
      return this;
    }

    throws(doThrow: boolean | undefined = true): this {
      this[throwsSymbol] = !!doThrow;
      return this;
    }
  }

  // Main exported function ($)
  var BunShell = function BunShell(
    first: TemplateStringsArray | { raw: readonly string[] },
    ...rest: any[]
  ): ShellPromise {
    if (!first || !("raw" in first) || !Array.isArray(first.raw)) {
      throw new Error("Please use '$' as a tagged template function: $`cmd arg1 arg2`");
    }
    // Pass raw string array and interpolated args
    const parsed_shell_script = createParsedShellScript(first.raw, rest);

    // Read config from the BunShell function object itself
    const cwd_config = (BunShell as any)[cwdSymbol];
    const env_config = (BunShell as any)[envSymbol];
    const throws_config = (BunShell as any)[throwsSymbol];

    const effective_cwd = cwd_config === undefined ? defaultCwd : cwd_config;
    parsed_shell_script.setCwd(effective_cwd);

    const effective_env = env_config === undefined ? defaultEnv : env_config;
    parsed_shell_script.setEnv(effective_env);

    return new ShellPromise(parsed_shell_script, throws_config);
  } as any; // Start as any to attach properties and prototype

  // Initialize state on the BunShell function object
  BunShell[cwdSymbol] = undefined;
  BunShell[envSymbol] = defaultEnv;
  BunShell[throwsSymbol] = true;

  // Set prototype for BunShell to inherit methods like .env(), .cwd()
  Object.setPrototypeOf(BunShell, ShellPrototype.prototype);

  // Define the Shell constructor function (new Shell())
  // @ts-ignore // TS thinks Shell is already defined globally
  function Shell() {
    if (!new.target) {
      throw new TypeError("Class constructor Shell cannot be invoked without 'new'");
    }

    // Create the function that will be returned by `new Shell()`
    var ShellInstanceFunc = function ShellInstance(
      first: TemplateStringsArray | { raw: readonly string[] },
      ...rest: any[]
    ): ShellPromise {
      if (!first || !("raw" in first) || !Array.isArray(first.raw)) {
        throw new Error("Please use '$' as a tagged template function: $`cmd arg1 arg2`");
      }
      const parsed_shell_script = createParsedShellScript(first.raw, rest);

      // Read config from the ShellInstanceFunc object itself
      const cwd_config = (ShellInstanceFunc as any)[cwdSymbol];
      const env_config = (ShellInstanceFunc as any)[envSymbol];
      const throws_config = (ShellInstanceFunc as any)[throwsSymbol];

      const effective_cwd = cwd_config === undefined ? defaultCwd : cwd_config;
      parsed_shell_script.setCwd(effective_cwd);

      const effective_env = env_config === undefined ? defaultEnv : env_config;
      parsed_shell_script.setEnv(effective_env);

      return new ShellPromise(parsed_shell_script, throws_config);
    } as any; // Start as any

    // Set prototype for the instance function to inherit methods
    Object.setPrototypeOf(ShellInstanceFunc, ShellPrototype.prototype);
    Object.defineProperty(ShellInstanceFunc, "name", { value: "Shell", configurable: true, enumerable: false });

    // Initialize state for this specific Shell instance function
    ShellInstanceFunc[cwdSymbol] = undefined;
    ShellInstanceFunc[envSymbol] = defaultEnv;
    ShellInstanceFunc[throwsSymbol] = true;

    return ShellInstanceFunc as BunShellCallable; // Cast the returned function instance
  }

  // Configure the Shell constructor itself
  Shell.prototype = ShellPrototype.prototype;
  Object.setPrototypeOf(Shell, ShellPrototype.prototype); // Shell constructor inherits static methods

  // Initialize state for the Shell constructor function itself
  (Shell as any)[cwdSymbol] = undefined;
  (Shell as any)[envSymbol] = defaultEnv;
  (Shell as any)[throwsSymbol] = true;

  // Assign static properties to BunShell
  Object.defineProperties(BunShell, {
    Shell: {
      value: Shell as unknown as ShellConstructor, // Cast Shell constructor type
      enumerable: true,
      configurable: true,
      writable: true,
    },
    ShellPromise: {
      value: ShellPromise,
      enumerable: true,
      configurable: true,
      writable: true,
    },
    ShellError: {
      value: ShellError,
      enumerable: true,
      configurable: true,
      writable: true,
    },
  });

  // Final cast to the public interface to hide internal symbols
  return BunShell as BunShellCallable;
}