// A read through a proxy reads `get` off the handler and calls it with the target, the key and the receiver. Compiled code does both itself. Where there is no trap it reads a data property of the target itself. It asks the run time only for what is no function, for an accessor of the target, or where the target may bind the answer.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const operations = ["GetById", "GetByIdAndCache", "GetByVal", "GetByValAndCache", "GetGeneric", "GetByValGeneric", "GetWithProxyTrap", "ValidateAnswerOfProxyTrap"];
const asked = () => operations.reduce((sum, name) => sum + count("operationAOT" + name), 0);
const readWanted = object => object.wanted;
const readOther = object => object.other;
const readUnder = (object, key) => object[key];
const callWanted = object => object.wanted();
const mark = Symbol("mark");

function attempt(label, work) {
  let answer;
  try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; }
  console.log(label + ": " + answer);
}

function measure(label, proxy, bound) {
  for (let i = 0; i < 40; i++) { readWanted(proxy); readOther(proxy); readUnder(proxy, "wanted"); readUnder(proxy, mark); }
  const before = asked();
  let text = "";
  for (let i = 0; i < 1000; i++) text = [readWanted(proxy), readOther(proxy), readUnder(proxy, i & 1 ? "wanted" : "other"), readUnder(proxy, mark)].map(String).join(" ");
  console.log(label + ": " + text + " | " + (asked() - before <= bound));
}

class Handler { constructor() { this.reads = 0; } get(target, key) { this.reads++; return typeof key === "symbol" ? "a symbol" : key.length; } }
const ofClass = new Handler;
let seen = 0;
measure("a method of a literal", new Proxy({}, { get(target, key, receiver) { seen++; return typeof key; } }), 20);
measure("an arrow", new Proxy({}, { get: (target, key) => typeof key === "symbol" ? "marked" : key }), 20);
measure("a method of a class", new Proxy({}, ofClass), 20);
measure("an inherited trap", new Proxy({}, Object.create({ get(target, key) { return "inherited"; } })), 20);
measure("a bound function", new Proxy({}, { get: function (first, target, key) { return first + typeof key; }.bind(null, "bound ") }), 20);
measure("the target answers", new Proxy({ wanted: 1, other: 2, [mark]: 3 }, { get(target, key) { return target[key]; } }), 20);
measure("an array as the target", new Proxy([1, 2], { get(target, key) { return target.length; } }), 20);
measure("a function as the target", new Proxy(function () {}, { get(target, key) { return typeof target; } }), 4020);
measure("no trap", new Proxy({ wanted: "passed on", [mark]: "marked" }, {}), 60);
measure("only another trap", new Proxy({ wanted: "passed on", other: 2 }, { set() { return true; } }), 60);
measure("no trap, and a getter of the target", new Proxy({ get wanted() { return typeof this; }, other: 1 }, {}), 4020);
measure("a frozen target that agrees", new Proxy(Object.freeze({ wanted: 1, other: 2 }), { get(target, key) { return target[key]; } }), 4020);
console.log(seen, ofClass.reads);

const receivers = [];
const watched = new Proxy({ held: 1 }, { get(target, key, receiver) { receivers.push(receiver === watched, this.name, target.held); return key; }, name: "the handler" });
console.log(readWanted(watched), readUnder(watched, "other"), receivers.join(" "));
const called = new Proxy({}, { get(target, key) { return function () { return this === called; }; } });
console.log(callWanted(called), callWanted(called));

attempt("the trap is no function", () => readWanted(new Proxy({}, { get: 1 })));
attempt("the trap is an object", () => readWanted(new Proxy({}, { get: {} })));
attempt("the trap is null", () => readWanted(new Proxy({ wanted: "of the target" }, { get: null })));
attempt("the trap is undefined", () => readWanted(new Proxy({ wanted: "of the target" }, { get: undefined })));
attempt("the trap throws", () => readWanted(new Proxy({}, { get() { throw new RangeError("no"); } })));
attempt("a host function", () => readWanted(new Proxy({ wanted: "by Reflect.get" }, { get: Reflect.get })));
attempt("a callable proxy as the trap", () => readWanted(new Proxy({}, { get: new Proxy(function (target, key) { return "through two: " + key; }, {}) })));
attempt("revoked", () => { const made = Proxy.revocable({}, { get() { return 1; } }); made.revoke(); return readWanted(made.proxy); });
attempt("a frozen target, another value", () => readWanted(new Proxy(Object.freeze({ wanted: 1 }), { get() { return 2; } })));
attempt("a frozen target, an absent name", () => readOther(new Proxy(Object.freeze({ wanted: 1 }), { get() { return 2; } })));
attempt("a setter alone that cannot be configured", () => readWanted(new Proxy(Object.defineProperty({}, "wanted", { set(value) {} }), { get() { return 2; } })));
attempt("the trap freezes the target", () => readWanted(new Proxy({ wanted: 1 }, { get(target) { Object.freeze(target); return 2; } })));
attempt("a getter of the target sees the proxy", () => { const proxy = new Proxy({ get wanted() { return this === proxy; } }, {}); return readWanted(proxy); });

let lookups = 0;
const behindGetter = new Proxy({}, { get get() { lookups++; return (target, key) => key + " after " + lookups; } });
attempt("a trap behind a getter", () => readWanted(behindGetter) + ", " + readWanted(behindGetter));
attempt("the getter of the trap throws", () => readWanted(new Proxy({}, { get get() { throw new SyntaxError("no trap"); } })));
attempt("the getter of the trap revokes", () => {
  const made = Proxy.revocable({ wanted: "of the old target" }, { get get() { made.revoke(); return (target, key) => target[key]; } });
  return readWanted(made.proxy);
});
attempt("the getter of the trap revokes and answers nothing", () => {
  const made = Proxy.revocable({ wanted: "of the old target" }, { get get() { made.revoke(); } });
  return readWanted(made.proxy);
});
attempt("the trap revokes above a frozen target", () => {
  const made = Proxy.revocable(Object.freeze({ wanted: 1 }), { get() { made.revoke(); return 2; } });
  return readWanted(made.proxy);
});
const asksOfHandler = [];
attempt("a proxy as the handler", () => readWanted(new Proxy({ wanted: "passed on" }, new Proxy({}, { get(target, key) { asksOfHandler.push(key); } }))) + " " + asksOfHandler);
attempt("a proxy as the target", () => readWanted(new Proxy(new Proxy({}, { get(target, key) { return "inner " + key; } }), { get(target, key) { return "outer " + target[key]; } })));
attempt("a proxy above the receiver", () => { const below = Object.create(new Proxy({}, { get(target, key, receiver) { return receiver === below; } })); return readWanted(below); });
attempt("a trap that reads its own proxy", () => { const proxy = new Proxy({}, { get(target, key) { return proxy[key]; } }); return readWanted(proxy); });

function place(error) {
  return String(error.stack).split("\n").filter(line => /compiled-code-reads-and-calls/.test(line)).slice(0, 3).map(line => (/(\d+:\d+)\)?$/.exec(line) || [, "?"])[1]).join(" < ");
}
for (const reader of [readWanted, readOther]) {
  try { reader(new Proxy({}, { get() { throw new Error("thrown by the trap"); } })); } catch (error) { console.log(error.message, "at", place(error)); }
  try { reader(new Proxy(Object.freeze({ wanted: 1, other: 1 }), { get() { return 2; } })); } catch (error) { console.log(error.constructor.name, "at", place(error)); }
}
