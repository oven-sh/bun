type ShellInterpreter = any;
type Resolve = (value: ShellOutput) => void;

export function shellTemplateFunction(strings: TemplateStringsArray) {
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
    _resolve: Resolve = () => {};
    _reject: Resolve = () => {};
    _core: ShellInterpreter;

    // sdfdf
    _bind(core: ShellInterpreter, resolve: Resolve, reject: Resolve) {
      core.setResolve(resolve);
      core.setReject(reject);
      this._core = core;
      this._resolve = resolve;
      this._reject = reject;
    }

    get stdin(): WritableStream {
      this.run();
      return this._core.stdin;
    }

    cwd(newCwd: string): this {
      this._core.setCwd(newCwd);
      return this;
    }

    env(newEnv: Record<string, string>): this {
      this._core.setEnv(newEnv);
      return this;
    }

    run() {
      if (this._core.isRunning()) return;
      console.log("Running");
      this._core.run();
    }

    then(onfulfilled, onrejected) {
      // if (this.isHalted && !this.child) {
      //   throw new Error("The process is halted!");
      // }
      return super.then(onfulfilled, onrejected);
    }
  }

  // console.log("Expressions", expressions, typeof expressions);
  const core = new Bun.ShellInterpreter(...arguments);
  core.setEnv(process.env);
  let resolve_: Resolve;
  let reject_: Resolve;
  const promise = new ShellPromise((res, rej) => {
    resolve_ = code =>
      res(new ShellOutput(Buffer.from(core.getBufferedStdout()), Buffer.from(core.getBufferedStderr()), code));

    reject_ = code =>
      rej(new ShellOutput(Buffer.from(core.getBufferedStdout()), Buffer.from(core.getBufferedStderr()), code));
  });
  // const core = new Bun.ShellInterpreter(strings, ...expressions);
  promise._bind(core, resolve_, reject_);
  // setImmediate(() => /* promise.isHalted  || */ promise.run());
  setTimeout(() => promise.run(), 0);
  return promise;
}
