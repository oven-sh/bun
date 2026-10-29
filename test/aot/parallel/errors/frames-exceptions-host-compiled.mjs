// Prints the own properties and the frames of the DOMException objects that host functions make: the reason of an aborted signal and what atob, structuredClone and a timeout throw, made in a tail call, by a
// constructor, a getter, call, apply and bind, below callbacks of built-in functions, in getters and methods that built-in functions call, in async functions and generators and under limits of the stack trace.
const file = /[^ @()]*frames-exceptions-host-compiled\.mjs(:\d+:\d+)?/g;
function describe(exception) {
  const own = Object.getOwnPropertyNames(exception).join(",");
  const stack = Object.getOwnPropertyDescriptor(exception, "stack");
  return [
    exception.constructor.name,
    exception.name,
    own,
    typeof stack?.value,
    stack?.enumerable + "," + stack?.writable + "," + stack?.configurable,
    typeof exception.line + "," + typeof exception.column,
    String(exception.sourceURL).replace(file, "file"),
    String(exception.stack).replace(file, "file").split("\n").join(" < "),
  ].join(" | ");
}
function show(name, run) {
  try {
    console.log(name, "|", describe(run()));
  } catch (exception) {
    console.log(name, "| thrown |", describe(exception));
  }
}
let kept;
function reasonOfAbort() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal.reason;
}
function reasonInTailCall() {
  return AbortSignal.abort().reason;
}
function outer() {
  const reason = reasonOfAbort();
  kept = reason;
  return reason;
}
function decode(text) {
  const decoded = atob(text);
  kept = decoded;
  return decoded;
}
function clone(value) {
  const copy = structuredClone(value);
  kept = copy;
  return copy;
}
class Holder {
  constructor() {
    this.reason = reasonOfAbort();
    this.controller = new AbortController();
    this.controller.abort();
  }
  get reasonNow() {
    const controller = new AbortController();
    controller.abort();
    return controller.signal.reason;
  }
  static make() {
    const made = new Holder();
    kept = made;
    return made;
  }
}
function deep(n) {
  if (n === 0) return reasonOfAbort();
  const reason = deep(n - 1);
  kept = reason;
  return reason;
}
function* steps() {
  yield reasonOfAbort();
  const controller = new AbortController();
  controller.abort();
  yield controller.signal.reason;
}
async function later() {
  const first = reasonOfAbort();
  await null;
  const second = reasonOfAbort();
  return [first, second];
}
async function laterBelow() {
  const both = await later();
  kept = both;
  return both;
}

show("abort", reasonOfAbort);
show("tail call", reasonInTailCall);
show("two frames", outer);
show("atob", () => decode("*"));
show("clone", () => clone(() => 1));
show("constructor", () => new Holder().reason);
show("constructor itself", () => new Holder().controller.signal.reason);
show("static", () => Holder.make().reason);
show("getter", () => new Holder().reasonNow);
show("deep", () => deep(30));
show("call", () => reasonOfAbort.call(null));
show("apply", () => Reflect.apply(reasonOfAbort, null, []));
show("bind", () => reasonOfAbort.bind(null)());
show("abort called", () => {
  const controller = new AbortController();
  controller.abort.call(controller);
  return controller.signal.reason;
});
show("abort bound", () => {
  const controller = new AbortController();
  const abort = controller.abort.bind(controller);
  abort();
  return controller.signal.reason;
});
show("abort as a callback", () => {
  const controller = new AbortController();
  [undefined].forEach(controller.abort, controller);
  return controller.signal.reason;
});
const readByBuiltIns = {
  assign: holder => Object.assign({}, holder),
  "define property": holder => Object.defineProperty({}, "a", holder),
  "define properties": holder => Object.defineProperties({}, { a: holder }),
  entries: holder => Object.entries(holder),
  stringify: holder => JSON.stringify(holder),
};
for (const [name, read] of Object.entries(readByBuiltIns)) {
  show("tail call in a getter, " + name, () =>
    read({
      get value() {
        return atob("*");
      },
    }),
  );
  show("kept in a getter, " + name, () =>
    read({
      get value() {
        const decoded = atob("*");
        kept = decoded;
        return decoded;
      },
    }),
  );
  show("abort in a tail call in a getter, " + name, () => {
    const controller = new AbortController();
    read({
      get value() {
        return controller.abort();
      },
    });
    return controller.signal.reason;
  });
}
show("tail call in toJSON", () =>
  JSON.stringify({
    toJSON() {
      return structuredClone(() => 1);
    },
  }),
);
show("tail call in valueOf", () =>
  Math.max({
    valueOf() {
      return atob("*");
    },
  }),
);
show("tail call in toString", () =>
  "a".concat({
    toString() {
      return atob("*");
    },
  }),
);
show("tail call in a comparison", () => [2, 1].sort(() => atob("*")));
for (const limit of [1, 2, 3]) {
  const before = Error.stackTraceLimit;
  Error.stackTraceLimit = limit;
  show("tail call in a getter, limit " + limit, () =>
    Object.assign(
      {},
      {
        get value() {
          return atob("*");
        },
      },
    ),
  );
  Error.stackTraceLimit = before;
}
show("map", () => [1].map(() => reasonOfAbort())[0]);
show("sort", () => {
  let reason;
  [2, 1].sort(() => ((reason = reasonOfAbort()), 0));
  kept = reason;
  return reason;
});
show("listener", () => {
  const outerController = new AbortController();
  let reason;
  outerController.signal.addEventListener("abort", () => {
    reason = reasonOfAbort();
  });
  outerController.abort();
  kept = reason;
  return reason;
});
show("generator", () => steps().next().value);
show("generator, second step", () => {
  const all = [...steps()];
  return all[1];
});
show("made by new", () => new DOMException("text", "AbortError"));
for (const limit of [0, 1, 2, 3, 100]) {
  const before = Error.stackTraceLimit;
  Error.stackTraceLimit = limit;
  show("limit " + limit, () => deep(4));
  Error.stackTraceLimit = before;
}
{
  const before = Error.stackTraceLimit;
  delete Error.stackTraceLimit;
  show("no limit property", outer);
  Error.stackTraceLimit = before;
}
function named() {
  const reason = reasonOfAbort();
  kept = reason;
  return reason;
}
named.displayName = "shown";
show("display name", named);
for (const [index, reason] of (await laterBelow()).entries()) show("async " + index, () => reason);
await new Promise(resolve =>
  setTimeout(() => {
    show("timer", outer);
    resolve();
  }, 1),
);
try {
  await new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(1);
    signal.addEventListener("abort", () => reject(signal.reason));
  });
} catch (exception) {
  console.log("timeout |", describe(exception));
}
show("top level", () => 0 || reasonOfAbort());
