// The place that reads getters of one function also meets a Proxy as the receiver, a Proxy in the chain, objects of the host with native accessors, functions, arrays, and bound and
// native functions as getters. A second place meets getters of many kinds.
function getterFor(label) { return function () { return label + "|" + (this === undefined ? "undefined" : this.tag); }; }
function make(label) {
  const made = Object.create(null);
  Object.defineProperty(made, "seen", { get: getterFor(label), configurable: true });
  made.tag = "tag of " + label;
  return made;
}
function read(value) { return value.seen; }
function readOdd(value) { return value.odd; }
function readRevoked(value) { return value.seen; }
function readOther(value) { return value.seen; }
function readHost(value) { return value.seen; }
const log = [];
const plain = make("plain");
for (let i = 0; i < 40; i++) read(plain);
log.push(read(plain));
const traps = [];
const proxy = new Proxy(plain, { get(target, key, receiver) { traps.push(String(key) + (receiver === proxy ? " proxy" : receiver === below ? " below" : " other")); return Reflect.get(target, key, receiver); } });
const below = Object.create(proxy); below.tag = "below the proxy";
log.push(read(proxy), read(below), traps.join(","));
const transparent = new Proxy(plain, {});
log.push(read(transparent));
const revocable = Proxy.revocable(plain, {}); revocable.revoke();
try { readRevoked(revocable.proxy); } catch (error) { log.push(error.constructor.name); }
const withGetter = (name, getter) => { const made = { tag: "literal" }; Object.defineProperty(made, name, { get: getter, configurable: true }); return made; };
log.push(readOther(withGetter("seen", getterFor("bound").bind({ tag: "bound this" }))), readOther(withGetter("seen", getterFor("not bound"))));
log.push(typeof readOther(withGetter("seen", Array.prototype.keys)).next, String(readOther(withGetter("seen", Object.prototype.toString))));
function callable() {} callable.tag = "function"; Object.defineProperty(callable, "seen", { get: getterFor("on a function") });
const list = [1]; list.tag = "array"; Object.defineProperty(list, "seen", { get: getterFor("on an array") });
log.push(readHost(callable), readHost(list), String(readHost(new Map())), String(readHost(new URL("https://example.com/"))), String(readHost(process)), String(readHost(globalThis)));
Object.defineProperty(globalThis, "seen", { get: getterFor("on the global object"), configurable: true });
globalThis.tag = "global";
log.push(readHost(globalThis), seen);
delete globalThis.seen; delete globalThis.tag;
log.push(readOdd(withGetter("odd", async function () { return 1; })) instanceof Promise, typeof readOdd(withGetter("odd", function* () { yield 1; })).next);
log.push(readOdd(withGetter("odd", () => "arrow")), readOdd(withGetter("odd", class { static make() { return "static"; } }.make)));
try { readOdd(withGetter("odd", class Constructed {})); } catch (error) { log.push(error.constructor.name); }
console.log(log.join("\n"));
