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
/* Output:
no function member undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function member number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function member object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function computed undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function computed number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function computed object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function variable undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function variable number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function variable object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function call undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function call number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function call object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function apply undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function apply number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function apply object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function reflect undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function reflect number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function reflect object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function bound undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function bound number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function bound object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function callback undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function callback number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function callback object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function last undefined ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function last number ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
no function last object ERR_INVALID_ARG_TYPE at unknown < at ::bunternal:: (internal) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:83:7)
sites   undefined [native code] true true false false number number < ::bunternal:: ::bunternal:: undefined internal false true false false number number < nextTick nextTick undefined [unknown] true true false false number number <   undefined frames-of-next-tick-itself.cjs false true false false number number
init hook member 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook member 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook member 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook member 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook member 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook member 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at member (frames-of-next-tick-itself.cjs:47:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook computed 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at computed (frames-of-next-tick-itself.cjs:50:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook variable 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at variable (frames-of-next-tick-itself.cjs:53:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook call 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at call (frames-of-next-tick-itself.cjs:56:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook apply 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at apply (frames-of-next-tick-itself.cjs:59:14) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook reflect 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at reflect (frames-of-next-tick-itself.cjs:62:13) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook bound 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at bound (frames-of-next-tick-itself.cjs:65:5) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook callback 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at each (frames-of-next-tick-itself.cjs:69:7) < at forEach (native) < at callback (frames-of-next-tick-itself.cjs:68:12) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 0 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 1 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 2 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7) | at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 3 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 4 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
init hook last 5 at init (frames-of-next-tick-itself.cjs:98:46) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:115:7)
sites below a hook init init undefined frames-of-next-tick-itself.cjs false false false false number number < nextTick nextTick undefined [unknown] true false false false number number <   undefined frames-of-next-tick-itself.cjs false false false false number number
getter at get (frames-of-next-tick-itself.cjs:133:40) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:137:9)
getter at get (frames-of-next-tick-itself.cjs:133:40) < at nextTick (native) < at <anonymous> (frames-of-next-tick-itself.cjs:138:1)
*/
