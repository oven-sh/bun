type ShellInterpreter = any;
type Resolve = (value: ShellOutput) => void;

export function createBunShellTemplateFunction(ShellInterpreter) {
  class ShellOutput {
    stdout: Buffer;
    stderr: Buffer;
    exitCode: number;
    constructor(stdout: Buffer, stderr: Buffer, exitCode: number) {
      this.stdout = stdout;
      this.stderr = stderr;
      this.exitCode = exitCode;
    }
  }

  class ShellPromise extends Promise<ShellOutput> {
    #core: ShellInterpreter;
    #hasRun: boolean = false;
    constructor(core: ShellInterpreter) {
      var resolve, reject;

      super((res, rej) => {
        resolve = code =>
          res(new ShellOutput(new Buffer(core.getBufferedStdout()), new Buffer(core.getBufferedStderr()), code));

        reject = code =>
          rej(new ShellOutput(new Buffer(core.getBufferedStdout()), new Buffer(core.getBufferedStderr()), code));
      });

      this.#core = core;
      this.#hasRun = false;

      core.setResolve(resolve);
      core.setReject(reject);
    }

    get interpreter() {
      if (IS_BUN_DEVELOPMENT) {
        return this.#core;
      }
    }

    get stdin(): WritableStream {
      this.#run();
      return this.#core.stdin;
    }

    // For TransformStream
    get writable() {
      this.#run();
      return this.#core.stdin;
    }

    cwd(newCwd: string): this {
      this.#throwIfRunning();
      this.#core.setCwd(newCwd);
      return this;
    }

    env(newEnv: Record<string, string>): this {
      this.#throwIfRunning();
      this.#core.setEnv(newEnv);
      return this;
    }

    #run() {
      if (!this.#hasRun) {
        this.#hasRun = true;
        if (this.#core.isRunning()) return;
        this.#core.run();
      }
    }

    quiet(): this {
      this.#throwIfRunning();
      this.#core.setQuiet();
      return this;
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

  var BunShell = function BunShell() {
    const core = new ShellInterpreter(...arguments);

    // cwd must be set before env or else it will be injected into env as "PWD=/"
    if (defaultCwd) core.setCwd(defaultCwd);

    if (defaultEnv) core.setEnv(defaultEnv);

    return new ShellPromise(core);
  };

  var BunShellPrototype = {
    __proto__: null,
    Promise: ShellPromise,
    env: function env(newEnv: Record<string, string | undefined>) {
      if (typeof newEnv === "undefined" || newEnv === originalDefaultEnv) {
        defaultEnv = originalDefaultEnv;
      } else if (newEnv) {
        defaultEnv = Object.assign({}, newEnv);
      } else {
        throw new TypeError("env must be an object or undefined");
      }

      return this;
    },
    cwd: function cwd(newCwd: string | undefined) {
      if (typeof newCwd === "undefined" || typeof newCwd === "string") {
        if (newCwd === "" || newCwd === ".") {
          newCwd = undefined;
        }

        defaultCwd = newCwd;
      } else {
        throw new TypeError("cwd must be a string or undefined");
      }

      return this;
    },
  };

  if (IS_BUN_DEVELOPMENT) {
    BunShellPrototype.Interpreter = ShellInterpreter;
  }

  Object.setPrototypeOf(BunShell, BunShellPrototype);

  return BunShell;
}
