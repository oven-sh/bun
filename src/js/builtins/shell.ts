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
      if (this.#hasRun) throw new Error('Shell is already running')
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

  var BunShell = function BunShell() {
    const core = new ShellInterpreter(...arguments);
    core.setEnv(process.env);
    return new ShellPromise(core);
  };

  BunShell.Promise = ShellPromise;

  if (IS_BUN_DEVELOPMENT) {
    BunShell.Interpreter = ShellInterpreter;
  }

  return BunShell;
}
