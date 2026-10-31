// A store through a proxy without a set trap, and Reflect.set(target, key, value, proxy) in a set trap, end in a definition on the proxy: it asks its handler for getOwnPropertyDescriptor and defineProperty and hands both on to the target where the handler has neither.
const log = [];
function attempt(label, work) { let said; try { said = JSON.stringify(work()); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const strictly = (object, key, value) => { "use strict"; object[key] = value; return object[key]; };
const loosely = new Function("object", "key", "value", "object[key] = value; return object[key];");
const forwarding = () => ({ set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } });
const makers = {
  "no trap": () => ({}),
  "only get": () => ({ get(target, key, receiver) { return Reflect.get(target, key, receiver); } }),
  "set hands on": forwarding,
  "a describing trap": () => ({ getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } }),
  "a defining trap": () => ({ defineProperty(target, key, descriptor) { log.push("define " + String(key) + " " + Object.keys(descriptor).join()); return Reflect.defineProperty(target, key, descriptor); } }),
  "a defining trap that refuses": () => ({ defineProperty(target, key) { log.push("refuse " + String(key)); return false; } }),
  "both, behind set": () => ({ ...forwarding(), getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); }, defineProperty(target, key, descriptor) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); } }),
  "traps that are undefined": () => ({ set: undefined, getOwnPropertyDescriptor: undefined, defineProperty: null }),
  "a trap that is no function": () => ({ defineProperty: 1 }),
  "traps above the handler": () => Object.create({ defineProperty(target, key, descriptor) { log.push("define above " + String(key)); return Reflect.defineProperty(target, key, descriptor); } }),
  "a getter for a trap": () => ({ get defineProperty() { log.push("read defineProperty"); return undefined; } }),
  "a handler that is a proxy": () => new Proxy({}, { get(target, key) { log.push("handler." + String(key)); return undefined; } }),
  "a handler of a class": () => new (class { constructor() { this.stores = 0; } set(target, key, value, receiver) { this.stores++; return Reflect.set(target, key, value, receiver); } }),
  "a handler without a prototype": () => Object.create(null),
};
const mark = Symbol("mark");
for (let round = 0; round < 3; round++) {
  for (const [name, make] of Object.entries(makers)) {
    attempt(name, () => { const target = { alpha: 1, beta: "two", [mark]: 0 }; const proxy = new Proxy(target, make()); proxy.alpha = round; proxy.beta = "b" + round; proxy[mark] = round; return [target, target[mark], proxy.alpha]; });
    attempt(name + ", another kind of value", () => { const target = { alpha: 1, beta: "two" }; const proxy = new Proxy(target, make()); proxy.alpha = "text"; proxy.beta = { round }; proxy.alpha = 0.5; proxy.beta = undefined; return [target, Object.keys(target)]; });
    attempt(name + ", a new name", () => { const target = { alpha: 1 }; const proxy = new Proxy(target, make()); proxy.gamma = round; proxy["delta" + round] = 1; proxy[0] = "zero"; return [target, Object.keys(target)]; });
    attempt(name + ", under a key", () => { const target = { alpha: 1, beta: 2 }; const proxy = new Proxy(target, make()); return [strictly(proxy, "alpha", round), loosely(proxy, "beta", round), target]; });
    attempt(name + ", read only", () => { const target = { alpha: 1, beta: 2 }; Object.defineProperty(target, "alpha", { writable: false }); const proxy = new Proxy(target, make()); const said = [loosely(proxy, "alpha", 9), Reflect.set(proxy, "alpha", 9)]; try { strictly(proxy, "alpha", 9); } catch (error) { said.push(error.constructor.name + ": " + error.message); } return [said, target]; });
    attempt(name + ", frozen", () => { const target = Object.freeze({ alpha: 1 }); const proxy = new Proxy(target, make()); const said = [loosely(proxy, "alpha", 9), loosely(proxy, "beta", 9)]; for (const key of ["alpha", "beta"]) try { strictly(proxy, key, 9); } catch (error) { said.push(error.constructor.name + ": " + error.message); } return [said, target]; });
    attempt(name + ", sealed and not extensible", () => [Object.seal, Object.preventExtensions].map(fix => { const target = fix({ alpha: 1 }); const proxy = new Proxy(target, make()); const said = [loosely(proxy, "alpha", round), loosely(proxy, "beta", 9)]; try { strictly(proxy, "beta", 9); } catch (error) { said.push(error.constructor.name + ": " + error.message); } return [said, target]; }));
    attempt(name + ", an accessor", () => { const seen = []; const target = { alpha: 1, get beta() { return "got"; }, set beta(value) { seen.push(this === proxy ? "the proxy" : this === target ? "the target" : "another", value); } }; const proxy = new Proxy(target, make()); proxy.beta = round; return [seen, target.alpha]; });
    attempt(name + ", a setter above the target", () => { const seen = []; const target = Object.create({ set alpha(value) { seen.push(this === proxy ? "the proxy" : "another", value); } }); const proxy = new Proxy(target, make()); proxy.alpha = round; return [seen, Object.keys(target)]; });
    attempt(name + ", deleted and stored again", () => { const target = { alpha: 1, beta: 2 }; const proxy = new Proxy(target, make()); delete target.alpha; proxy.alpha = round; proxy.beta = round; return [target, Object.keys(target)]; });
    attempt(name + ", not enumerable", () => { const target = { alpha: 1, beta: 2 }; Object.defineProperty(target, "alpha", { enumerable: false }); const proxy = new Proxy(target, make()); proxy.alpha = round; return [target, target.alpha, Object.getOwnPropertyDescriptor(target, "alpha")]; });
    attempt(name + ", below the proxy", () => { const target = { alpha: 1 }; const below = Object.create(new Proxy(target, make())); below.alpha = round; return [target, Object.keys(below), below.alpha]; });
    attempt(name + ", a proxy of a proxy", () => { const target = { alpha: 1 }; const proxy = new Proxy(new Proxy(target, make()), make()); proxy.alpha = round; return target; });
  }
  attempt("for the proxy of another object", () => { const target = { alpha: 1 }, other = { alpha: "other" }; const said = Reflect.set(target, "alpha", round, new Proxy(other, {})); return [said, target, other]; });
  attempt("for another object", () => { const target = { alpha: 1 }, other = { alpha: "other" }, empty = {}; return [Reflect.set(target, "alpha", round, other), Reflect.set(target, "alpha", round, empty), Reflect.set(target, "alpha", round, 1), target, other, empty]; });
  attempt("for a proxy that is revoked", () => { const target = { alpha: 1 }; const { proxy, revoke } = Proxy.revocable(target, {}); proxy.alpha = 2; revoke(); const said = []; try { Reflect.set(target, "alpha", 3, proxy); } catch (error) { said.push(error.constructor.name + ": " + error.message); } try { proxy.alpha = 4; } catch (error) { said.push(error.constructor.name + ": " + error.message); } return [said, target]; });
  attempt("the traps come late", () => { const target = { alpha: 1 }, handler = {}; const proxy = new Proxy(target, handler); for (let i = 0; i < 20; i++) proxy.alpha = i; handler.defineProperty = (t, key, descriptor) => { log.push("define " + key); return Reflect.defineProperty(t, key, descriptor); }; proxy.alpha = "late"; delete handler.defineProperty; proxy.alpha = "gone"; handler.getOwnPropertyDescriptor = (t, key) => { log.push("describe " + key); return Reflect.getOwnPropertyDescriptor(t, key); }; proxy.alpha = "later"; return target; });
  attempt("the traps come late above the handler", () => { const target = { alpha: 1 }, above = {}, handler = Object.create(above); const proxy = new Proxy(target, handler); for (let i = 0; i < 20; i++) proxy.alpha = i; above.defineProperty = (t, key, descriptor) => { log.push("define " + key); return Reflect.defineProperty(t, key, descriptor); }; proxy.alpha = "late"; Object.setPrototypeOf(handler, null); proxy.alpha = "cut off"; return target; });
  attempt("one handler, many targets", () => { const handler = forwarding(); const targets = [{ alpha: 1 }, { alpha: "a", beta: 2 }, { beta: 1, alpha: null }, [1], new Map, function () { }, new (class { alpha = 1; })]; for (const target of targets) new Proxy(target, handler).alpha = round; log.length = 0; return targets.map(target => target.alpha); });
}
let sum = 0;
const busy = new Proxy({ alpha: 1, beta: 2 }, {}), reactive = new Proxy({ alpha: 1, beta: 2 }, { set(target, key, value, receiver) { sum++; return Reflect.set(target, key, value, receiver); } });
for (let i = 0; i < 30000; i++) { busy.alpha = i; busy.beta = i + 0.5; reactive.alpha = i; reactive.beta = "b"; sum += busy.alpha + reactive.alpha; }
console.log(sum, busy.beta, reactive.beta);
