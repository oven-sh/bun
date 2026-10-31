// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function messageOf(error: Error): unknown {
  return error.message;
}
function causeOf(error: Error): unknown {
  return error.cause;
}
function setMessage(error: Error, message: string): void {
  error.message = message;
}
function setCause(error: Error, cause: unknown): void {
  error.cause = cause;
}
function describe(label: string, error: Error): void {
  attempt(label + ", message", () => messageOf(error));
  attempt(label + ", message again", () => messageOf(error));
  attempt(label + ", cause", () => causeOf(error));
  attempt(label + ", has", () =>
    [Object.hasOwn(error, "message"), Object.hasOwn(error, "cause"), "message" in error, "cause" in error].join(),
  );
  attempt(label + ", descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(error, "message")));
  attempt(label + ", as a string", () => String(error));
  attempt(label + ", keys", () => Object.keys(error).join());
  attempt(label + ", stack", () => (typeof error.stack === "string" ? error.stack.split("\n")[0] : typeof error.stack));
}
const cases: [string, () => Error][] = [
  ["a message", () => new Error("boom")],
  ["no message", () => new Error()],
  ["an undefined message", () => new Error(undefined)],
  ["an empty message", () => new Error("")],
  ["a number message", () => new Error(5 as any)],
  [
    "an object message",
    () =>
      new Error({
        toString() {
          return "converted";
        },
      } as any),
  ],
  ["a message and a cause", () => new Error("boom", { cause: "why" })],
  ["a cause but no message", () => new Error(undefined, { cause: "why" })],
  ["an undefined cause", () => new Error("boom", { cause: undefined })],
  ["options without a cause", () => new Error("boom", {})],
  ["an inherited cause option", () => new Error("boom", Object.create({ cause: "inherited" }))],
  ["called without new", () => Error("called")],
  [
    "a deleted message",
    () =>
      (() => {
        const error = new Error("boom");
        delete (error as any).message;
        return error;
      })(),
  ],
  [
    "a message deleted and set again",
    () =>
      (() => {
        const error = new Error("boom", { cause: "why" });
        delete (error as any).message;
        error.message = "again";
        return error;
      })(),
  ],
  [
    "a reassigned message",
    () =>
      (() => {
        const error = new Error("boom");
        error.message = "reassigned";
        return error;
      })(),
  ],
  [
    "a message set later",
    () =>
      (() => {
        const error = new Error();
        error.message = "set later";
        return error;
      })(),
  ],
  [
    "a cause set later",
    () =>
      (() => {
        const error = new Error("boom");
        error.cause = "set later";
        return error;
      })(),
  ],
  [
    "a cause set before the message",
    () =>
      (() => {
        const error = new Error();
        error.cause = "first";
        error.message = "second";
        return error;
      })(),
  ],
  [
    "another property set before the message",
    () =>
      (() => {
        const error = new Error();
        (error as any).code = "E_FIRST";
        error.message = "second";
        return error;
      })(),
  ],
  [
    "a getter for the message",
    () =>
      Object.defineProperty(new Error("boom"), "message", {
        get() {
          return "computed";
        },
        configurable: true,
      }),
  ],
  [
    "a getter for a missing message",
    () =>
      Object.defineProperty(new Error(), "message", {
        get() {
          return "computed";
        },
        configurable: true,
      }),
  ],
  ["a read-only message", () => Object.defineProperty(new Error("boom"), "message", { writable: false })],
  ["an enumerable message", () => Object.defineProperty(new Error("boom"), "message", { enumerable: true })],
  ["frozen", () => Object.freeze(new Error("boom", { cause: "why" }))],
  ["a subclass", () => new (class Failure extends Error {})("boom")],
  ["a subclass, no message", () => new (class Failure extends Error {})()],
  [
    "a subclass with a message field",
    () =>
      new (class Failure extends Error {
        override message = "field";
      })("boom"),
  ],
  [
    "a subclass with a message field, no message",
    () =>
      new (class Failure extends Error {
        override message = "field";
      })(),
  ],
  [
    "a subclass with another field",
    () =>
      new (class Failure extends Error {
        code = "E_FIELD";
      })("boom"),
  ],
  [
    "a subclass whose constructor sets the message",
    () =>
      new (class Failure extends Error {
        constructor() {
          super();
          this.message = "set by the constructor";
        }
      })(),
  ],
  [
    "a subclass that forwards a cause",
    () =>
      new (class Failure extends Error {
        constructor(message: string, cause: unknown) {
          super(message, { cause });
        }
      })("boom", "why"),
  ],
  [
    "a subclass with a message getter on its prototype",
    () =>
      (() => {
        class Failure extends Error {}
        Object.defineProperty(Failure.prototype, "message", {
          get() {
            return "from the prototype";
          },
          configurable: true,
        });
        return new Failure();
      })(),
  ],
  [
    "a subclass with a message getter on its prototype, and a message",
    () =>
      (() => {
        class Failure extends Error {}
        Object.defineProperty(Failure.prototype, "message", {
          get() {
            return "from the prototype";
          },
          configurable: true,
        });
        return new Failure("boom");
      })(),
  ],
  ["TypeError", () => new TypeError("boom")],
  ["RangeError, no message", () => new RangeError()],
  ["AggregateError", () => new AggregateError([new Error("inner")], "boom", { cause: "why" })],
  ["DOMException", () => new DOMException("boom", "AbortError") as unknown as Error],
  [
    "a JSON.parse error",
    () =>
      (() => {
        try {
          JSON.parse("{");
        } catch (error) {
          return error as Error;
        }
        return new Error("not reached");
      })(),
  ],
  [
    "a file system error",
    () =>
      (() => {
        try {
          require("node:fs").readFileSync("/no/such/file");
        } catch (error) {
          return error as Error;
        }
        return new Error("not reached");
      })(),
  ],
  ["a structured clone", () => structuredClone(new Error("boom", { cause: "why" }))],
  ["a different new.target", () => Reflect.construct(Error, ["boom"], class Other {})],
  ["a null prototype", () => Object.setPrototypeOf(new Error("boom"), null)],
  ["Object.create(Error.prototype)", () => Object.create(Error.prototype)],
  ["an error-like object", () => ({ name: "Lookalike", message: "from a plain object" })],
  [
    "a plain object with a captured stack",
    () =>
      (() => {
        const target = { name: "Plain", message: "from a plain object" };
        Error.captureStackTrace(target);
        return target;
      })(),
  ],
  [
    "a proxy for an error",
    () =>
      new Proxy(new Error("boom"), {
        get(target, key, receiver) {
          return key === "message" ? "trapped" : Reflect.get(target, key, receiver);
        },
      }),
  ],
];
for (const [name, make] of cases) {
  describe(name, make());
  const reassigned = make();
  attempt(name + ", set the message", () => setMessage(reassigned, "set afterwards"));
  describe(name + ", after setting the message", reassigned);
  const removed = make();
  attempt(name + ", delete the message", () => delete (removed as any).message);
  describe(name + ", after deleting the message", removed);
  const caused = make();
  attempt(name + ", set the cause", () => setCause(caused, "set afterwards"));
  describe(name + ", after setting the cause", caused);
}
export {};
