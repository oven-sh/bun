// The frame of process.nextTick itself is native code: below the error for a callback that is no function, below an init hook, below a getter that nextTick reads.
const { createHook } = require("node:async_hooks");

const framesOf = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/native:\d+:\d+/, "native")
        .replace(/internal:[^)]*/, "internal")
        .replace(/(\(|^at )[^ ()]*[\\/]/, "$1"),
    )
    .join(" < ");

function sitesOf(error) {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) =>
    sites
      .map(site =>
        [
          site.getFunctionName(),
          site.getMethodName(),
          site.getTypeName(),
          String(site.getFileName())
            .replace(/^internal:.*/, "internal")
            .replace(/^.*[\\/]/, ""),
          site.isNative(),
          site.isToplevel(),
          site.isConstructor(),
          site.isAsync(),
          typeof site.getLineNumber(),
          typeof site.getColumnNumber(),
        ].join(" "),
      )
      .join(" < ");
  const text = error.stack;
  Error.prepareStackTrace = before;
  return text;
}

const { nextTick } = process;
const bound = nextTick.bind(process);
const ways = {
  member(...args) {
    process.nextTick(...args);
  },
  computed(...args) {
    process["next" + "Tick"](...args);
  },
  variable(...args) {
    nextTick(...args);
  },
  call(...args) {
    nextTick.call(undefined, ...args);
  },
  apply(...args) {
    nextTick.apply(process, args);
  },
  reflect(...args) {
    Reflect.apply(nextTick, null, args);
  },
  bound(...args) {
    bound(...args);
  },
  callback(...args) {
    [args].forEach(function each(list) {
      nextTick(...list);
    });
  },
  last: (function () {
    "use strict";
    return function last(...args) {
      return process.nextTick(...args);
    };
  })(),
};

for (const [name, queue] of Object.entries(ways)) {
  for (const value of [undefined, 1, {}]) {
    try {
      queue(value, "passed");
    } catch (error) {
      console.log("no function", name, typeof value, error.code, framesOf(error.stack));
    }
  }
}
try {
  process.nextTick(null);
} catch (error) {
  console.log("sites", sitesOf(error));
}

let seen = [];
const hook = createHook({
  init(id, type) {
    if (type === "TickObject") seen.push(new Error());
  },
});
const second = createHook({
  init(id, type) {
    if (type !== "TickObject") return;
    const holder = {};
    Error.captureStackTrace(holder, nextTick);
    seen.push(holder);
  },
});
function ran() {}
for (const [name, queue] of Object.entries(ways)) {
  for (let count = 0; count <= 5; count++) {
    hook.enable();
    if (count === 2) second.enable();
    try {
      queue(ran, ...Array(count).fill(0));
    } finally {
      hook.disable();
      second.disable();
    }
    console.log("init hook", name, count, seen.map(error => framesOf(error.stack)).join(" | "));
    seen = [];
  }
}
hook.enable();
process.nextTick(ran);
hook.disable();
console.log("sites below a hook", sitesOf(seen[0]));

const exiting = Object.getOwnPropertyDescriptor(process, "_exiting");
Object.defineProperty(process, "_exiting", {
  configurable: true,
  get() {
    console.log("getter", framesOf(new Error().stack));
    return false;
  },
});
process.nextTick(ran);
nextTick(ran, 1, 2, 3, 4);
if (exiting) Object.defineProperty(process, "_exiting", exiting);
else delete process._exiting;
