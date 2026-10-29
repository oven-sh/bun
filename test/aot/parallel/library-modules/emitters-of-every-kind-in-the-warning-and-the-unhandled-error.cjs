// The warning for too many listeners names the emitter, and the error for an "error" event that nobody hears prints what was emitted. Both are asked for with values of every kind.
const { EventEmitter } = require("node:events");
const custom = Symbol.for("nodejs.util.inspect.custom");

EventEmitter.defaultMaxListeners = 1;

const heard = [];
process.removeAllListeners("warning");
process.on("warning", warning => heard.push(warning.message));

function hide(target) {
  Object.defineProperty(target, "_events", { value: undefined, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(target, "_eventsCount", { value: 0, writable: true, configurable: true, enumerable: false });
  return target;
}

const lines = [];
const unheard = [];
function provoke(label, make) {
  try {
    new EventEmitter().emit("error", make());
  } catch (error) {
    unheard.push(label + ": " + (error && error.code) + " " + JSON.stringify(error && error.message));
  }
  for (const hidden of [false, true]) {
    const name = label + (hidden ? " (no own keys)" : "");
    try {
      const target = hidden ? hide(make()) : make();
      EventEmitter.prototype.on.call(target, "x", () => {});
      EventEmitter.prototype.on.call(target, "x", () => {});
      lines.push(name);
    } catch (error) {
      lines.push(name + " THREW " + (error && error.name) + ": " + (error && error.message));
    }
  }
}

class Named extends EventEmitter {}
class Deep extends Named {}
const Anonymous = (() => class extends EventEmitter {})();
class NameThrows extends EventEmitter {
  static get name() {
    throw new Error("the name of the class was read");
  }
}
class NameIsNumber extends EventEmitter {
  static name = 7;
}
class NameIsEmpty extends EventEmitter {
  static name = "";
}
class NeverAnInstance extends EventEmitter {
  static [Symbol.hasInstance]() {
    return false;
  }
}
class InstanceTestThrows extends EventEmitter {
  static [Symbol.hasInstance]() {
    throw new Error("the instance test ran");
  }
}

provoke("an emitter", () => new EventEmitter());
provoke("a class below", () => new Named());
provoke("two classes below", () => new Deep());
provoke("an anonymous class", () => new Anonymous());
provoke("a class whose name throws", () => new NameThrows());
provoke("a class whose name is a number", () => new NameIsNumber());
provoke("a class whose name is empty", () => new NameIsEmpty());
provoke("a class that owns no instance", () => new NeverAnInstance());
provoke("a class whose instance test throws", () => new InstanceTestThrows());
provoke("a plain object", () => ({}));
provoke("a plain object with a member", () => ({ a: 1 }));
provoke("an heir of the prototype", () => Object.create(EventEmitter.prototype));
provoke("an heir of an emitter", () => Object.create(new EventEmitter()));
provoke("an heir of an emitter that listens", () => Object.create(new EventEmitter().on("x", () => {})));
provoke("the prototype itself", () =>
  Object.create(EventEmitter.prototype, { constructor: { value: function Own() {} } }),
);
provoke("no prototype", () => Object.create(null));
provoke("no prototype, a tag", () => Object.assign(Object.create(null), { [Symbol.toStringTag]: "Tagged" }));
provoke("no prototype, a hidden tag", () => Object.create(null, { [Symbol.toStringTag]: { value: "Tagged" } }));
provoke("no prototype two levels up", () => Object.create(Object.create(null)));
provoke("no prototype three levels up", () => Object.create(Object.create(Object.create(null))));
provoke("no prototype above a constructor without a name", () =>
  Object.create(Object.create(null, { constructor: { value: (() => function () {})() } })),
);

provoke("an own tag", () => Object.assign(new Named(), { [Symbol.toStringTag]: "Tagged" }));
provoke("a hidden own tag", () => Object.defineProperty(new Named(), Symbol.toStringTag, { value: "Tagged" }));
provoke(
  "an inherited tag",
  () =>
    new (class Tagged extends EventEmitter {
      get [Symbol.toStringTag]() {
        return "Inherited";
      }
    })(),
);
provoke(
  "a tag like the name",
  () =>
    new (class Same extends EventEmitter {
      get [Symbol.toStringTag]() {
        return "Same";
      }
    })(),
);
provoke("an empty tag", () => Object.defineProperty(new Named(), Symbol.toStringTag, { value: "" }));
provoke("a tag that is a number", () => Object.defineProperty(new Named(), Symbol.toStringTag, { value: 5 }));
provoke("a tag that throws", () =>
  Object.defineProperty(new Named(), Symbol.toStringTag, {
    get() {
      throw new Error("the tag was read");
    },
  }),
);
provoke("a plain object with a hidden tag", () => Object.defineProperty({}, Symbol.toStringTag, { value: "Tagged" }));

provoke("a printer that answers a text", () => Object.assign(new Named(), { [custom]: () => "<printed>" }));
provoke("a printer that answers lines", () => Object.assign(new Named(), { [custom]: () => "one\ntwo" }));
provoke("a printer that answers an object", () => Object.assign(new Named(), { [custom]: () => ({ a: { b: 1 } }) }));
provoke("a printer that answers a number", () => Object.assign(new Named(), { [custom]: () => -0 }));
provoke("a printer that answers nothing", () => Object.assign(new Named(), { [custom]: () => undefined }));
provoke("a printer that answers its receiver", () =>
  Object.assign(new Named(), {
    [custom]() {
      return this;
    },
  }),
);
provoke("a printer that throws", () =>
  Object.assign(new Named(), {
    [custom]() {
      throw new Error("the printer ran");
    },
  }),
);
provoke("a printer that shows its operands", () =>
  Object.assign(new Named(), {
    [custom](depth, options, inspect) {
      return [
        arguments.length,
        depth,
        Object.keys(options).join(),
        options.depth,
        options.colors,
        options.stylize("s", "special"),
        Object.getPrototypeOf(options) === Object.prototype,
        typeof inspect,
        inspect === require("node:util").inspect,
        inspect({ a: { b: { c: {} } } }, options),
      ].join(" | ");
    },
  }),
);
provoke(
  "an inherited printer",
  () =>
    new (class Printed extends EventEmitter {
      [custom]() {
        return "<inherited>";
      }
    })(),
);
provoke("a hidden printer", () => Object.defineProperty(new Named(), custom, { value: () => "<hidden>" }));
provoke("a printer that is no function", () => Object.assign(new Named(), { [custom]: "text" }));
provoke("a printer behind a getter that throws", () =>
  Object.defineProperty(new Named(), custom, {
    get() {
      throw new Error("the printer was read");
    },
  }),
);
let reads = 0;
provoke("a printer behind a getter that counts", () =>
  Object.defineProperty(new Named(), custom, {
    get() {
      reads++;
      return () => "read " + reads;
    },
  }),
);
provoke("a prototype object with a printer", () => {
  function Own() {}
  Own.prototype = Object.create(EventEmitter.prototype, { constructor: { value: Own } });
  Own.prototype[custom] = () => "<of the prototype>";
  return Own.prototype;
});
provoke("no prototype, a printer", () =>
  Object.assign(Object.create(null), {
    [custom](depth, options) {
      return [Object.getPrototypeOf(options), Object.keys(options).join(), options.stylize("s", "special")].join(" | ");
    },
  }),
);

provoke("a proxy", () => new Proxy(new Named(), {}));
provoke("a proxy of a proxy", () => new Proxy(new Proxy(new Named(), {}), {}));
provoke("a proxy of a plain object", () => new Proxy({}, {}));
provoke("a proxy whose target holds null under 0", () => new Proxy(Object.assign(new Named(), { 0: null }), {}));
provoke(
  "a proxy with a printer",
  () =>
    new Proxy(
      Object.assign(new Named(), {
        [custom](depth, options) {
          return [Object.getPrototypeOf(options), Object.keys(options).join()].join(" | ");
        },
      }),
      {},
    ),
);
const trapped = [];
provoke(
  "a proxy that tells what is asked",
  () =>
    new Proxy(new Named(), {
      get(target, key, receiver) {
        trapped.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
      has(target, key) {
        trapped.push("has " + String(key));
        return Reflect.has(target, key);
      },
      ownKeys(target) {
        trapped.push("ownKeys");
        return Reflect.ownKeys(target);
      },
      getPrototypeOf(target) {
        trapped.push("getPrototypeOf");
        return Reflect.getPrototypeOf(target);
      },
      getOwnPropertyDescriptor(target, key) {
        trapped.push("describe " + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }),
);
provoke("a proxy of a function", () => new Proxy(function target() {}, {}));
provoke("an heir of a proxy", () => Object.create(new Proxy(new Named(), {})));

provoke("a function", () => function named() {});
provoke("a function without a name", () => (() => function () {})());
provoke("an arrow", () => (() => () => {})());
provoke("a class", () => class Klass {});
provoke("a class below a class", () => class Lower extends Named {});
provoke("an async function", () => async function later() {});
provoke("a generator function", () => function* steps() {});
provoke("a function whose name is an object", () =>
  Object.defineProperty(function f() {}, "name", { value: { a: 1 } }),
);
provoke("a function without a prototype", () => Object.setPrototypeOf(function bare() {}, null));
provoke("a bound function", () => function bound() {}.bind(null));

provoke("a list", () => []);
provoke("a list of two", () => [1, 2]);
provoke("a class below Array", () => new (class List extends Array {})());
provoke("a list below the emitter", () => Object.setPrototypeOf([], EventEmitter.prototype));
provoke("a list without a prototype", () => Object.setPrototypeOf([], null));
provoke("bytes", () => new Uint8Array(0));
provoke("two bytes", () => new Uint8Array(2));
provoke("a buffer", () => Buffer.alloc(0));
provoke("bytes without a prototype", () => Object.setPrototypeOf(new Uint8Array(0), null));
provoke("a map", () => new Map());
provoke("a map of one", () => new Map([[1, 2]]));
provoke("a map below the emitter", () => Object.setPrototypeOf(new Map(), EventEmitter.prototype));
provoke("a map without a prototype", () => Object.setPrototypeOf(new Map(), null));
provoke("a set", () => new Set());
provoke("a set of one", () => new Set([1]));
provoke("a set without a prototype", () => Object.setPrototypeOf(new Set(), null));
provoke("the entries of a map", () => new Map([[1, 2]]).entries());
provoke("the values of a set", () => new Set([1]).values());
provoke("the values of a list", () => [1].values());
provoke("a generator", () => (function* () {})());
provoke("an object that can be walked", () => Object.assign(new Named(), { *[Symbol.iterator]() {} }));
provoke("arguments", () =>
  (function () {
    return arguments;
  })(),
);
provoke("arguments of two", () =>
  (function () {
    return arguments;
  })(1, 2),
);

provoke("a pattern", () => /a+/gi);
provoke("a pattern below the emitter", () => Object.setPrototypeOf(/a+/gi, EventEmitter.prototype));
provoke("a pattern without a prototype", () => Object.setPrototypeOf(/a+/gi, null));
provoke("a class below RegExp", () => new (class Pattern extends RegExp {})("b"));
provoke("a date", () => new Date(0));
provoke("no date", () => new Date(NaN));
provoke("a date below the emitter", () => Object.setPrototypeOf(new Date(0), EventEmitter.prototype));
provoke("a date without a prototype", () => Object.setPrototypeOf(new Date(0), null));

function withoutFrames(error) {
  error.stack = String(error.stack).split("\n    at")[0];
  return error;
}
provoke("an error", () => withoutFrames(new Error("failed")));
provoke("a type error", () => withoutFrames(new TypeError("failed")));
provoke("a class below Error", () => withoutFrames(new (class Failure extends Error {})("failed")));
provoke("an error with a cause", () => withoutFrames(new Error("failed", { cause: 1 })));
provoke("several errors", () => withoutFrames(new AggregateError([1], "failed")));
provoke("an error without a stack", () => Object.defineProperty(new Error("failed"), "stack", { value: undefined }));
provoke("an error whose stack throws", () =>
  Object.defineProperty(new Error("failed"), "stack", {
    get() {
      throw new Error("the stack was read");
    },
  }),
);
provoke("an error whose name throws", () =>
  Object.defineProperty(withoutFrames(new Error("failed")), "name", {
    get() {
      throw new Error("the name was read");
    },
  }),
);
provoke("an error without a prototype", () => Object.setPrototypeOf(withoutFrames(new Error("failed")), null));
provoke("an heir of Error.prototype", () => Object.create(Error.prototype));
provoke("an heir of Error.prototype with a stack", () =>
  Object.assign(Object.create(Error.prototype), { stack: "Error: made\n    at nowhere" }),
);

provoke("memory", () => new ArrayBuffer(2));
provoke("shared memory", () => new SharedArrayBuffer(2));
provoke("a view", () => new DataView(new ArrayBuffer(2)));
provoke("a promise", () => Promise.resolve(1));
provoke("a weak map", () => new WeakMap());
provoke("a weak set", () => new WeakSet());
provoke("a weak reference", () => new WeakRef({}));
provoke("a number object", () => new Number(-0));
provoke("a large number object", () => new Number(1234567.5));
provoke("a text object", () => new String("it's"));
provoke(
  "a long text object",
  () => new String("line one of a text that is long\nline two of a text that is long\nline three of the same text"),
);
provoke("an empty text object", () => new String(""));
provoke("a text object with control characters", () => new String("\x00\x1b\n\t'\"`\\\u{1F600}\ud800"));
provoke("a boolean object", () => new Boolean(false));
provoke("a big number object", () => Object(12345678901234567890n));
provoke("a symbol object", () => Object(Symbol("s")));
provoke("a number object below the emitter", () => Object.setPrototypeOf(new Number(1), EventEmitter.prototype));
provoke("a text object without a prototype", () => Object.setPrototypeOf(new String("ab"), null));
provoke("a class below String", () => new (class Text extends String {})("ab"));

provoke("an own constructor that is no function", () => Object.assign(new Named(), { constructor: 5 }));
provoke("an own constructor of another class", () => Object.assign(new Named(), { constructor: Map }));
provoke("an own constructor of its class", () => Object.assign(new Named(), { constructor: EventEmitter }));
provoke("a constructor behind a getter", () =>
  Object.defineProperty(new Named(), "constructor", {
    get() {
      throw new Error("the constructor was read");
    },
  }),
);
provoke("symbol keys alone", () => hide({ [Symbol("shown")]: 1 }));
provoke("hidden symbol keys alone", () => hide(Object.defineProperty({}, Symbol("hidden"), { value: 1 })));
provoke("a frozen object", () => Object.freeze(new Named()));
provoke("an object that takes no more", () => Object.preventExtensions({}));
provoke("a URL", () => new URL("http://localhost/"));
provoke("search parameters", () => new URLSearchParams("a=1"));
provoke("an abort signal", () => new AbortController().signal);
provoke("a text decoder", () => new TextDecoder());
provoke("a number", () => 5);
provoke("a text", () => "text");

setImmediate(() => {
  let next = 0;
  for (const line of lines)
    console.log(line.includes(" THREW ") ? line : line + ": " + JSON.stringify(cut(heard[next++])));
  console.log("left over:", heard.length - next);
  console.log("reads of the printer:", reads);
  console.log(trapped.join(", "));
  for (const line of unheard) console.log(line);
});

function cut(message) {
  if (typeof message !== "string") return message;
  return message.slice(
    "Possible EventEmitter memory leak detected. 2 x listeners added to ".length,
    message.indexOf(". MaxListeners is "),
  );
}
