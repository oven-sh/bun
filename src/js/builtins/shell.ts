type ShellInterpreter = any;
type ShellOutput = undefined;
type Resolve = (value: ShellOutput) => void;

export function shellTemplateFunction(strings: TemplateStringsArray) {
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
  let resolve_: Resolve;
  let reject_: Resolve;
  const promise = new ShellPromise((resolve, reject) => {
    resolve_ = resolve;
    reject_ = reject;
  });
  // const core = new Bun.ShellInterpreter(strings, ...expressions);
  const core = new Bun.ShellInterpreter(...arguments);
  promise._bind(core, resolve_, reject_);
  // setImmediate(() => /* promise.isHalted  || */ promise.run());
  setTimeout(() => promise.run(), 0);
  return promise;
}
