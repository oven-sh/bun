const error = (what: string) => new Error(`${what} is not supported by bun:desktop/electron`);

const unsupported = {
  error,
  throws: (what: string) => () => {
    throw error(what);
  },
  constructs: (what: string) =>
    function () {
      throw error(what);
    },
  rejects: (what: string) => async () => {
    throw error(what);
  },
};

/** Methods that have nothing to act on: each is a function, or else what it returns. */
function inert<T extends object>(target: T, methods: Record<string, unknown>): T {
  for (const name in methods) {
    const method = methods[name];
    if (!(name in target)) target[name] = $isCallable(method) ? method : () => method;
  }
  return target;
}

/** A property for each pair of a getter and a setter method, as `resizable` is for `isResizable` and `setResizable`. */
function properties(prototype: object, names: Record<string, [getter: string, setter?: string]>) {
  for (const name in names) {
    const [getter, setter] = names[name];
    Object.defineProperty(prototype, name, {
      get() {
        return this[getter]();
      },
      set:
        setter === undefined
          ? undefined
          : function (this: any, value: unknown) {
              this[setter](value);
            },
      enumerable: true,
      configurable: true,
    });
  }
}

const tasks = require("internal/desktop/tasks");
/** A task that inherits no `AsyncLocalStorage` store, like a message from another process. */
const queueTask = (task: (...args: any[]) => void, a?: unknown, b?: unknown, c?: unknown, d?: unknown) =>
  void tasks.post(tasks.HOST, task, a, b, c, d);

export default { unsupported, inert, properties, queueTask };
