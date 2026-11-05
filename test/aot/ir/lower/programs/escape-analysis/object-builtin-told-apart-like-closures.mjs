// RUN: lower
// OPTIONS: builtin-modules

// One place in the program makes a function twice. Built-ins that compare, that keep keys or that check what a trap answers are given both, mostly by way of getters, iterators and traps.
import { EventEmitter } from "node:events";
class Point { constructor(x) { this.x = x; } }
function attempt(run) { try { return run(); } catch (e) { return "threw " + (e instanceof TypeError) + " " + e.constructor.name; } }
{
  function scene() {
    const say = (...words) => console.log("arrow, proxy get trap against a fixed value:", ...words);
    const mk = () => () => 1;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { get() { return mk(); } });
    say(attempt(() => typeof p.x));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, proxy describe trap against a fixed value:", ...words);
    const mk = () => () => 1;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { getOwnPropertyDescriptor() { return { value: mk(), writable: false, enumerable: false, configurable: false }; } });
    say(attempt(() => typeof Object.getOwnPropertyDescriptor(p, "x")));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, proxy set trap against a fixed value:", ...words);
    const mk = () => () => 1;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { set() { return true; } });
    say(attempt(() => Reflect.set(p, "x", mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, proxy define trap against a fixed value:", ...words);
    const mk = () => () => 1;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { defineProperty() { return true; } });
    say(attempt(() => Reflect.defineProperty(p, "x", { value: mk() })));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, proxy prototype trap of a sealed target:", ...words);
    const mk = () => () => 1;
    const target = Object.preventExtensions(Object.create(mk()));
    const p = new Proxy(target, { getPrototypeOf() { return mk(); } });
    say(attempt(() => typeof Object.getPrototypeOf(p)));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, set from an iterator:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, set from a generator:", ...words);
    const mk = () => () => 1;
    function* steps() { yield mk(); yield mk(); }
    say(new Set(steps()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, set from a list:", ...words);
    const mk = () => () => 1;
    say(new Set([mk(), mk()]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, set by add:", ...words);
    const mk = () => () => 1;
    say(new Set().add(mk()).add(mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, map from an iterator:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: [mk(), n], done: false } : { value: undefined, done: true }; } }; } };
    say(new Map(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, map from pairs with getters:", ...words);
    const mk = () => () => 1;
    say(new Map([{ get 0() { return mk(); }, 1: 1 }, { get 0() { return mk(); }, 1: 2 }]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, map group by:", ...words);
    const mk = () => () => 1;
    say(Map.groupBy([1, 2], () => mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, weak set from an iterator:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new WeakSet(steps).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, weak map by set:", ...words);
    const mk = () => () => 1;
    say(new WeakMap().set(mk(), 1).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, union with a set-like:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const like = { size: 1, has() { return false; }, keys() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set([mk()]).union(like).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, array from an iterator, index of:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    const list = Array.from(steps);
    say(list.indexOf(list[1]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, array from an array-like with getters, a set of it:", ...words);
    const mk = () => () => 1;
    const list = Array.from({ length: 2, get 0() { return mk(); }, get 1() { return mk(); } });
    say(new Set(list).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, includes on an array-like with a getter:", ...words);
    const mk = () => () => 1;
    say(Array.prototype.includes.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, index of on an array-like with a getter:", ...words);
    const mk = () => () => 1;
    say(Array.prototype.indexOf.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, includes on a list:", ...words);
    const mk = () => () => 1;
    say([mk()].includes(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, mapped list, last index of:", ...words);
    const mk = () => () => 1;
    const list = [1, 2].map(() => mk());
    say(list.lastIndexOf(list[0]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, object is applied to an array-like with getters:", ...words);
    const mk = () => () => 1;
    say(Reflect.apply(Object.is, null, { length: 2, get 0() { return mk(); }, get 1() { return mk(); } }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, object is:", ...words);
    const mk = () => () => 1;
    say(Object.is(mk(), mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, object is spread from an iterator:", ...words);
    const mk = () => () => 1;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(Object.is(...steps));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, strict equality of what getters return:", ...words);
    const mk = () => () => 1;
    const holder = { get a() { return mk(); } };
    say(holder.a === holder.a);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, strict equality of what reflect get returns:", ...words);
    const mk = () => () => 1;
    const holder = { get a() { return mk(); } };
    say(Reflect.get(holder, "a") === Reflect.get(holder, "a"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, strict equality of values of an object with getters:", ...words);
    const mk = () => () => 1;
    const [a, b] = Object.values({ get a() { return mk(); }, get b() { return mk(); } });
    say(a === b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, strict equality behind assign:", ...words);
    const mk = () => () => 1;
    const copy = Object.assign({}, { get a() { return mk(); }, get b() { return mk(); } });
    say(copy.a === copy.b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, is prototype of:", ...words);
    const mk = () => () => 1;
    say(Object.prototype.isPrototypeOf.call(mk(), Object.create(mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, listeners added twice:", ...words);
    const mk = () => () => 1;
    let ran = 0;
    const target = new EventTarget();
    const listen = () => (typeof mk() === "function" ? () => { ran++; } : { handleEvent() { ran++; } });
    target.addEventListener("x", listen());
    target.addEventListener("x", listen());
    target.dispatchEvent(new Event("x"));
    say(ran);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, listener removed by another:", ...words);
    const mk = () => () => 1;
    let ran = 0;
    const target = new EventTarget();
    const listen = () => (typeof mk() === "function" ? () => { ran++; } : { handleEvent() { ran++; } });
    target.addEventListener("x", listen());
    target.removeEventListener("x", listen());
    target.dispatchEvent(new Event("x"));
    say(ran);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, emitter listener removed by another:", ...words);
    const mk = () => () => 1;
    let ran = 0;
    const emitter = new EventEmitter();
    const listen = () => () => { ran++; };
    emitter.on("x", listen());
    emitter.off("x", listen());
    emitter.emit("x");
    say(ran, typeof mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, thenables resolved:", ...words);
    const mk = () => () => 1;
    Promise.all([{ then(resolve) { resolve(mk()); } }, { then(resolve) { resolve(mk()); } }]).then(([a, b]) => say(a === b, new Set([a, b]).size));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, sort keeps both:", ...words);
    const mk = () => () => 1;
    const list = [mk(), mk()].sort(() => 0);
    say(list[0] === list[1]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, json replacer sees what to-json returns:", ...words);
    const mk = () => () => 1;
    const seen = [];
    JSON.stringify([{ toJSON() { return mk(); } }, { toJSON() { return mk(); } }], (k, x) => (seen.push(x), x));
    say(seen.length, seen[1] === seen[2]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, weak ref:", ...words);
    const mk = () => () => 1;
    say(new WeakRef(mk()).deref() === mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, array of, find index:", ...words);
    const mk = () => () => 1;
    const list = Array.of(mk(), mk());
    const first = list[0];
    say(list.findLastIndex((x) => x === first));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, structure of cloned list:", ...words);
    const mk = () => () => 1;
    say(attempt(() => { const c = structuredClone([mk(), mk()]); return c[0] === c[1]; }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, own property of one is not on the other:", ...words);
    const mk = () => () => 1;
    const a = mk(), b = mk();
    Object.defineProperty(a, "mark", { get value() { return 1; } });
    say(Object.hasOwn(b, "mark"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, frozen one leaves the other:", ...words);
    const mk = () => () => 1;
    const a = mk(), b = mk();
    Object.freeze(a);
    say(Object.isFrozen(b));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, assign onto one leaves the other:", ...words);
    const mk = () => () => 1;
    const a = mk(), b = mk();
    Object.assign(a, { get mark() { return 1; } });
    say("mark" in b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("arrow, prototype of one leaves the other:", ...words);
    const mk = () => () => 1;
    const a = mk(), b = mk();
    Object.setPrototypeOf(a, null);
    say(Object.getPrototypeOf(b) === null);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, proxy get trap against a fixed value:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { get() { return mk(); } });
    say(attempt(() => typeof p.x));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, proxy describe trap against a fixed value:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { getOwnPropertyDescriptor() { return { value: mk(), writable: false, enumerable: false, configurable: false }; } });
    say(attempt(() => typeof Object.getOwnPropertyDescriptor(p, "x")));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, proxy set trap against a fixed value:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { set() { return true; } });
    say(attempt(() => Reflect.set(p, "x", mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, proxy define trap against a fixed value:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { defineProperty() { return true; } });
    say(attempt(() => Reflect.defineProperty(p, "x", { value: mk() })));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, proxy prototype trap of a sealed target:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const target = Object.preventExtensions(Object.create(mk()));
    const p = new Proxy(target, { getPrototypeOf() { return mk(); } });
    say(attempt(() => typeof Object.getPrototypeOf(p)));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, set from an iterator:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, set from a generator:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    function* steps() { yield mk(); yield mk(); }
    say(new Set(steps()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, set from a list:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(new Set([mk(), mk()]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, set by add:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(new Set().add(mk()).add(mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, map from an iterator:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: [mk(), n], done: false } : { value: undefined, done: true }; } }; } };
    say(new Map(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, map from pairs with getters:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(new Map([{ get 0() { return mk(); }, 1: 1 }, { get 0() { return mk(); }, 1: 2 }]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, map group by:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Map.groupBy([1, 2], () => mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, weak set from an iterator:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new WeakSet(steps).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, weak map by set:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(new WeakMap().set(mk(), 1).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, union with a set-like:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const like = { size: 1, has() { return false; }, keys() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set([mk()]).union(like).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, array from an iterator, index of:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    const list = Array.from(steps);
    say(list.indexOf(list[1]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, array from an array-like with getters, a set of it:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const list = Array.from({ length: 2, get 0() { return mk(); }, get 1() { return mk(); } });
    say(new Set(list).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, includes on an array-like with a getter:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Array.prototype.includes.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, index of on an array-like with a getter:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Array.prototype.indexOf.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, includes on a list:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say([mk()].includes(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, mapped list, last index of:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const list = [1, 2].map(() => mk());
    say(list.lastIndexOf(list[0]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, object is applied to an array-like with getters:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Reflect.apply(Object.is, null, { length: 2, get 0() { return mk(); }, get 1() { return mk(); } }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, object is:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Object.is(mk(), mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, object is spread from an iterator:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(Object.is(...steps));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, strict equality of what getters return:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const holder = { get a() { return mk(); } };
    say(holder.a === holder.a);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, strict equality of what reflect get returns:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const holder = { get a() { return mk(); } };
    say(Reflect.get(holder, "a") === Reflect.get(holder, "a"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, strict equality of values of an object with getters:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const [a, b] = Object.values({ get a() { return mk(); }, get b() { return mk(); } });
    say(a === b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, strict equality behind assign:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const copy = Object.assign({}, { get a() { return mk(); }, get b() { return mk(); } });
    say(copy.a === copy.b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, is prototype of:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(Object.prototype.isPrototypeOf.call(mk(), Object.create(mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, listeners added twice:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let ran = 0;
    const target = new EventTarget();
    const listen = () => (typeof mk() === "function" ? () => { ran++; } : { handleEvent() { ran++; } });
    target.addEventListener("x", listen());
    target.addEventListener("x", listen());
    target.dispatchEvent(new Event("x"));
    say(ran);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, listener removed by another:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let ran = 0;
    const target = new EventTarget();
    const listen = () => (typeof mk() === "function" ? () => { ran++; } : { handleEvent() { ran++; } });
    target.addEventListener("x", listen());
    target.removeEventListener("x", listen());
    target.dispatchEvent(new Event("x"));
    say(ran);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, emitter listener removed by another:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    let ran = 0;
    const emitter = new EventEmitter();
    const listen = () => () => { ran++; };
    emitter.on("x", listen());
    emitter.off("x", listen());
    emitter.emit("x");
    say(ran, typeof mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, thenables resolved:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    Promise.all([{ then(resolve) { resolve(mk()); } }, { then(resolve) { resolve(mk()); } }]).then(([a, b]) => say(a === b, new Set([a, b]).size));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, sort keeps both:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const list = [mk(), mk()].sort(() => 0);
    say(list[0] === list[1]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, json replacer sees what to-json returns:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const seen = [];
    JSON.stringify([{ toJSON() { return mk(); } }, { toJSON() { return mk(); } }], (k, x) => (seen.push(x), x));
    say(seen.length, seen[1] === seen[2]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, weak ref:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(new WeakRef(mk()).deref() === mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, array of, find index:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const list = Array.of(mk(), mk());
    const first = list[0];
    say(list.findLastIndex((x) => x === first));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, structure of cloned list:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    say(attempt(() => { const c = structuredClone([mk(), mk()]); return c[0] === c[1]; }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, own property of one is not on the other:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const a = mk(), b = mk();
    Object.defineProperty(a, "mark", { get value() { return 1; } });
    say(Object.hasOwn(b, "mark"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, frozen one leaves the other:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const a = mk(), b = mk();
    Object.freeze(a);
    say(Object.isFrozen(b));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, assign onto one leaves the other:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const a = mk(), b = mk();
    Object.assign(a, { get mark() { return 1; } });
    say("mark" in b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("method, prototype of one leaves the other:", ...words);
    const mk = () => ({ m() { return 1; } }).m;
    const a = mk(), b = mk();
    Object.setPrototypeOf(a, null);
    say(Object.getPrototypeOf(b) === null);
  }
  scene();
}

// GENERATED: attempt steps
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: Return v1
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v2 = CatchValue
// CHECK-NEXT: v3 = String string="threw "
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="TypeError" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v7 = InstanceOf v2, v6
// CHECK-NEXT: v8 = Add v3, v7
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = PropGet v2 key="constructor"
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=anything variableName="mk"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Call v0 calleeName="mk"
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Call v0 calleeName="mk"
// CHECK-NEXT: v9 = Yield v8
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=anything variableName="mk"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Call v0 calleeName="mk"
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Call v0 calleeName="mk"
// CHECK-NEXT: v9 = Yield v8
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
