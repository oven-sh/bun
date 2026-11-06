// `name in proxy` reads `has` off the handler and calls it with the target and the key; `proxy.name = value` reads `set` and calls it with the target, the key, the value and the receiver. Compiled code does both itself. Where there is no `has` trap it asks the target the same question. It asks the run time only where there is no `set` trap to call, where the answer is no boolean, or where the target may bind the answer.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const operations = ["InByIdAndCache", "InByValAndCache", "InByValGeneric", "PutById", "PutByIdSloppy", "PutByIdAndCache", "PutByVal", "PutByValAndCache", "PutByValAndCacheSloppy", "PutByValGeneric", "HasWithProxyTrap", "FinishHasThroughProxy", "SetWithProxyTrap", "FinishSetThroughProxy"];
const asked = () => operations.reduce((sum, name) => sum + count("operationAOT" + name), 0);
const hasWanted = object => "wanted" in object;
const hasOther = object => "other" in object;
const hasUnder = (object, key) => key in object;
const storeWanted = (object, value) => { object.wanted = value; };
const storeOther = (object, value) => { object.other = value; };
const storeUnder = (object, key, value) => { object[key] = value; };
const storeSloppy = new Function("object", "value", "object.wanted = value; return 'stored';");
const mark = Symbol("mark");

function attempt(label, work) {
  let answer;
  try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; }
  console.log(label + ": " + answer);
}

function measure(label, proxy, bound, report) {
  for (let i = 0; i < 40; i++) { hasWanted(proxy); hasOther(proxy); hasUnder(proxy, "wanted"); hasUnder(proxy, "other"); hasUnder(proxy, mark); storeWanted(proxy, i); storeOther(proxy, i); storeUnder(proxy, "wanted", i); storeUnder(proxy, mark, i); }
  const before = asked();
  let found = 0;
  for (let i = 0; i < 1000; i++) {
    if (hasWanted(proxy)) found++;
    if (hasOther(proxy)) found += 2;
    if (hasUnder(proxy, i & 1 ? "wanted" : "other")) found += 4;
    if (hasUnder(proxy, mark)) found += 8;
    storeWanted(proxy, i); storeOther(proxy, -i); storeUnder(proxy, i & 1 ? "wanted" : "other", i); storeUnder(proxy, mark, i);
  }
  console.log(label + ": " + found + " " + report() + " | " + (asked() - before <= bound));
}

class Handler {
  constructor() { this.asks = 0; this.stores = 0; }
  has(target, key) { this.asks++; return target[key] !== undefined; }
  set(target, key, value) { this.stores++; if (typeof key === "string") target[key] = value; return true; }
}
const ofClass = new Handler, behindClass = { wanted: 0, other: undefined };
const plain = { wanted: 0, other: undefined };
let log = 0;
measure("methods of a literal", new Proxy(plain, { has(target, key) { log++; return target[key] !== undefined; }, set(target, key, value, receiver) { log++; if (typeof key === "string") target[key] = value; return true; } }), 20, () => [log, plain.wanted, plain.other].join(" "));
measure("methods of a class", new Proxy(behindClass, ofClass), 20, () => [ofClass.asks, ofClass.stores, behindClass.wanted, behindClass.other].join(" "));
const kept = [];
measure("arrows", new Proxy({}, { has: (target, key) => key === "other", set: (target, key, value) => { kept[0] = value; return true; } }), 20, () => kept[0]);
const inherited = { stores: 0 };
measure("inherited traps", new Proxy({}, Object.create({ has() { return true; }, set() { inherited.stores++; return true; } })), 20, () => inherited.stores);
const passedOn = { wanted: 0 };
measure("no traps", new Proxy(passedOn, {}), 4020, () => [passedOn.wanted, passedOn.other, passedOn[mark]].join(" "));
measure("answers that are no booleans", new Proxy({}, { has() { return "yes"; }, set() { return 1; } }), 8020, () => "");
const sealed = Object.seal({ wanted: 0, other: 0, [mark]: 0 });
measure("a sealed target", new Proxy(sealed, { has(target, key) { return target[key] !== undefined; }, set(target, key, value) { target[key] = value; return true; } }), 8020, () => [sealed.wanted, sealed.other].join(" "));

const seen = [];
const watched = new Proxy({ held: 1 }, {
  name: "the handler",
  has(target, key) { seen.push("has", this.name, target.held, String(key), arguments.length); return false; },
  set(target, key, value, receiver) { seen.push("set", this.name, target.held, String(key), value, receiver === watched, arguments.length); return true; },
});
console.log(hasWanted(watched), storeWanted(watched, "stored"), storeUnder(watched, mark, "marked"), seen.join(" "));

attempt("has is no function", () => hasWanted(new Proxy({}, { has: 1 })));
attempt("set is no function", () => storeWanted(new Proxy({}, { set: {} }), 1));
attempt("has is null", () => hasWanted(new Proxy({ wanted: 1 }, { has: null })));
attempt("set is undefined", () => { const target = {}; storeWanted(new Proxy(target, { set: undefined }), 1); return target.wanted; });
attempt("has throws", () => hasWanted(new Proxy({}, { has() { throw new RangeError("no"); } })));
attempt("set throws", () => storeWanted(new Proxy({}, { set() { throw new RangeError("no"); } }), 1));
attempt("host functions", () => { const target = {}; const proxy = new Proxy(target, { has: Reflect.has, set: Reflect.set }); storeWanted(proxy, 5); return hasWanted(proxy) + " " + hasOther(proxy) + " " + target.wanted; });
attempt("revoked, has", () => { const made = Proxy.revocable({}, { has() { return true; } }); made.revoke(); return hasWanted(made.proxy); });
attempt("revoked, set", () => { const made = Proxy.revocable({}, { set() { return true; } }); made.revoke(); return storeWanted(made.proxy, 1); });
attempt("set says no in strict code", () => storeWanted(new Proxy({}, { set() { return false; } }), 1));
attempt("set says nothing in strict code", () => storeWanted(new Proxy({}, { set() {} }), 1));
attempt("set says no under a symbol", () => storeUnder(new Proxy({}, { set() { return 0; } }), mark, 1));
attempt("set says no in sloppy code", () => storeSloppy(new Proxy({}, { set() { return false; } }), 1));
attempt("has says no of a property that cannot be configured", () => hasWanted(new Proxy(Object.freeze({ wanted: 1 }), { has() { return false; } })));
attempt("has says no of a property of a target that takes no more", () => hasWanted(new Proxy(Object.preventExtensions({ wanted: 1 }), { has() { return false; } })));
attempt("has says no of an absent name of a frozen target", () => hasOther(new Proxy(Object.freeze({ wanted: 1 }), { has() { return false; } })));
attempt("has says yes of an absent name of a frozen target", () => hasOther(new Proxy(Object.freeze({ wanted: 1 }), { has() { return true; } })));
attempt("set says yes above a frozen target, another value", () => storeWanted(new Proxy(Object.freeze({ wanted: 1 }), { set() { return true; } }), 2));
attempt("set says yes above a frozen target, the same value", () => storeWanted(new Proxy(Object.freeze({ wanted: 1 }), { set() { return true; } }), 1));
attempt("set says yes above a getter alone that cannot be configured", () => storeWanted(new Proxy(Object.defineProperty({}, "wanted", { get() { return 1; } }), { set() { return true; } }), 1));
attempt("the has trap freezes the target", () => hasWanted(new Proxy({ wanted: 1 }, { has(target) { Object.freeze(target); return false; } })));
attempt("the set trap freezes the target", () => storeWanted(new Proxy({ wanted: 1 }, { set(target) { Object.freeze(target); return true; } }), 2));
attempt("a setter of the target sees the proxy", () => { let same; const proxy = new Proxy({ set wanted(value) { same = this === proxy; } }, {}); storeWanted(proxy, 1); return same; });

let lookups = 0;
const behindGetters = new Proxy({}, { get has() { lookups++; return () => true; }, get set() { lookups += 10; return () => true; } });
attempt("traps behind getters", () => [hasWanted(behindGetters), storeWanted(behindGetters, 1), hasWanted(behindGetters), lookups].join(" "));
attempt("the getter of has revokes", () => { const made = Proxy.revocable({ wanted: 1 }, { get has() { made.revoke(); return (target, key) => key in target; } }); return hasWanted(made.proxy); });
attempt("the getter of set revokes and answers nothing", () => { const target = {}; const made = Proxy.revocable(target, { get set() { made.revoke(); } }); try { storeWanted(made.proxy, 7); } catch (error) { return error.constructor.name + " " + target.wanted; } return target.wanted; });
const asksOfHandler = [];
attempt("a proxy as the handler", () => { const proxy = new Proxy({ wanted: 1 }, new Proxy({}, { get(target, key) { asksOfHandler.push(key); } })); return [hasWanted(proxy), storeWanted(proxy, 2), asksOfHandler].join(" "); });
attempt("a proxy as the target", () => { const order = []; const inner = new Proxy({}, { has(target, key) { order.push("inner has"); return true; }, set(target, key, value) { order.push("inner set"); return true; } }); const outer = new Proxy(inner, { has(target, key) { order.push("outer has"); return key in target; }, set(target, key, value) { order.push("outer set"); target[key] = value; return true; } }); return [hasWanted(outer), storeWanted(outer, 1), order].join(" "); });
attempt("a proxy above the receiver", () => { const order = []; const below = Object.create(new Proxy({}, { has(target, key) { order.push("has " + key); return false; }, set(target, key, value, receiver) { order.push("set " + key + " " + (receiver === below)); return true; } })); return [hasWanted(below), storeWanted(below, 1), Object.keys(below).length, order].join(" "); });
attempt("a has trap that asks its own proxy", () => { const proxy = new Proxy({}, { has(target, key) { return key in proxy; } }); return hasWanted(proxy); });
attempt("a set trap that stores to its own proxy", () => { const proxy = new Proxy({}, { set(target, key, value) { proxy[key] = value; return true; } }); return storeWanted(proxy, 1); });

function place(error) {
  return String(error.stack).split("\n").filter(line => /compiled-code-reads-and-calls/.test(line)).slice(0, 3).map(line => (/(\d+:\d+)\)?$/.exec(line) || [, "?"])[1]).join(" < ");
}
for (const access of [hasWanted, object => storeWanted(object, 2)]) {
  try { access(new Proxy({}, { has() { throw new Error("thrown by has"); }, set() { throw new Error("thrown by set"); } })); } catch (error) { console.log(error.message, "at", place(error)); }
  try { access(new Proxy(Object.freeze({ wanted: 1 }), { has() { return false; }, set() { return true; } })); } catch (error) { console.log(error.constructor.name, "at", place(error)); }
}
// Env: JSC_aotCountsPath=/dev/null
/* Output:
methods of a literal: 7000 8360 999 -999 | true
methods of a class: 7000 4200 4160 999 -999 | true
arrows: 4000 999 | true
inherited traps: 15000 4160 | true
no traps: 15000 999 -999 999 | true
answers that are no booleans: 15000  | true
a sealed target: 15000 999 -999 | true
false undefined undefined has the handler 1 wanted 2 set the handler 1 wanted stored true 4 set the handler 1 Symbol(mark) marked true 4
has is no function: threw TypeError: 'has' property of a Proxy's handler should be callable
set is no function: threw TypeError: 'set' property of a Proxy's handler should be callable
has is null: true
set is undefined: 1
has throws: threw RangeError: no
set throws: threw RangeError: no
host functions: true false 5
revoked, has: threw TypeError: Proxy has already been revoked. No more operations are allowed to be performed on it
revoked, set: threw TypeError: Proxy has already been revoked. No more operations are allowed to be performed on it
set says no in strict code: threw TypeError: Proxy object's 'set' trap returned falsy value for property 'wanted'
set says nothing in strict code: threw TypeError: Proxy object's 'set' trap returned falsy value for property 'wanted'
set says no under a symbol: threw TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol(mark)'
set says no in sloppy code: stored
has says no of a property that cannot be configured: threw TypeError: Proxy 'has' must return 'true' for non-configurable properties
has says no of a property of a target that takes no more: threw TypeError: Proxy 'has' must return 'true' for a non-extensible 'target' object with a configurable property
has says no of an absent name of a frozen target: false
has says yes of an absent name of a frozen target: true
set says yes above a frozen target, another value: threw TypeError: Proxy handler's 'set' on a non-configurable and non-writable property on 'target' should either return false or be the same value already on the 'target'
set says yes above a frozen target, the same value: undefined
set says yes above a getter alone that cannot be configured: threw TypeError: Proxy handler's 'set' method on a non-configurable accessor property without a setter should return false
the has trap freezes the target: threw TypeError: Proxy 'has' must return 'true' for non-configurable properties
the set trap freezes the target: threw TypeError: Proxy handler's 'set' on a non-configurable and non-writable property on 'target' should either return false or be the same value already on the 'target'
a setter of the target sees the proxy: true
traps behind getters: true  true 12
the getter of has revokes: true
the getter of set revokes and answers nothing: TypeError undefined
a proxy as the handler: true  has,set,getOwnPropertyDescriptor,defineProperty
a proxy as the target: true  outer has,inner has,outer set,inner set
a proxy above the receiver: false  0 has wanted,set wanted true
a has trap that asks its own proxy: threw RangeError: Maximum call stack size exceeded.
a set trap that stores to its own proxy: threw RangeError: Maximum call stack size exceeded.
thrown by has at 102:50 < 5:41 < 102:9
TypeError at 5:41 < 103:9
thrown by set at 102:95 < 8:42 < 102:9
TypeError at 8:42 < 103:9
*/
