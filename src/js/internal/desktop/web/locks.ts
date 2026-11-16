const idl = require("internal/desktop/web/idl");

const { error, internal, scope } = idl;

class Lock {
  #name: string;
  #mode: string;

  constructor(key: unknown = undefined, name = "", mode = "") {
    idl.illegal(key);
    this.#name = name;
    this.#mode = mode;
  }

  get name() {
    return this.#name;
  }
  get mode() {
    return this.#mode;
  }
}
idl.expose(Lock);

class LockManager {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  #check() {
    if (scope.disposed) throw error("InvalidStateError", "The document is not active.");
    if (scope.env.origin === "null") throw error("SecurityError", "Access to the Locks API is denied in this context.");
  }

  async request(name: string, options: any, callback: any = undefined) {
    idl.need(arguments.length, 2);
    name = `${name}`;
    if (arguments.length === 2) [options, callback] = [undefined, options];
    const { ifAvailable, mode: givenMode = "exclusive", signal: givenSignal, steal } = idl.dictionary(options);
    const mode = idl.oneOf(givenMode, ["shared", "exclusive"]);
    const signal = givenSignal === undefined ? undefined : idl.signalOf(givenSignal);
    idl.callable(callback);
    this.#check();
    if (name[0] === "-" || (steal && (ifAvailable || mode !== "exclusive")) || (signal && (steal || ifAvailable))) {
      throw error("NotSupportedError", "The name starts with '-', or the options do not go together.");
    }
    signal?.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers();
    let isGranted = false;
    const release = () => void (scope.cleanups.delete(release) && request.release());
    const request = scope.env.requestLock(name, mode, !!ifAvailable, !!steal, (state: string) =>
      idl.runTask(async () => {
        if (state === "stolen") {
          scope.cleanups.delete(release);
          return reject(error("AbortError", "Lock broken by another request with the 'steal' option."));
        }
        if (signal?.aborted) return;
        isGranted = true;
        try {
          resolve(await callback(state === "granted" ? new Lock(internal, name, mode) : null));
        } catch (thrown) {
          reject(thrown);
        }
        release();
      }),
    );
    scope.cleanups.add(release);
    signal?.addEventListener("abort", () => {
      if (isGranted) return;
      release();
      reject(signal.reason);
    });
    return promise;
  }

  async query() {
    this.#check();
    const copy = ({ clientId, mode, name }: any) => ({ clientId, mode, name });
    return idl.adopt(scope.env.queryLocks(), ({ held, pending }: any) => ({
      held: Array.from(held, copy),
      pending: Array.from(pending, copy),
    }));
  }
}
idl.expose(LockManager);

export default { Lock, LockManager };
