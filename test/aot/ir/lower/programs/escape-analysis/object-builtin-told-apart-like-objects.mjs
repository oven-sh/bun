// RUN: lower
// OPTIONS: builtin-modules

// One place in the program makes an object twice. Built-ins that compare, that keep keys or that check what a trap answers are given both, mostly by way of getters, iterators and traps.
import { EventEmitter } from "node:events";
class Point { constructor(x) { this.x = x; } }
function attempt(run) { try { return run(); } catch (e) { return "threw " + (e instanceof TypeError) + " " + e.constructor.name; } }
{
  function scene() {
    const say = (...words) => console.log("literal, proxy get trap against a fixed value:", ...words);
    const mk = () => ({ a: 1 });
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { get() { return mk(); } });
    say(attempt(() => typeof p.x));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, proxy describe trap against a fixed value:", ...words);
    const mk = () => ({ a: 1 });
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { getOwnPropertyDescriptor() { return { value: mk(), writable: false, enumerable: false, configurable: false }; } });
    say(attempt(() => typeof Object.getOwnPropertyDescriptor(p, "x")));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, proxy set trap against a fixed value:", ...words);
    const mk = () => ({ a: 1 });
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { set() { return true; } });
    say(attempt(() => Reflect.set(p, "x", mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, proxy define trap against a fixed value:", ...words);
    const mk = () => ({ a: 1 });
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { defineProperty() { return true; } });
    say(attempt(() => Reflect.defineProperty(p, "x", { value: mk() })));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, proxy prototype trap of a sealed target:", ...words);
    const mk = () => ({ a: 1 });
    const target = Object.preventExtensions(Object.create(mk()));
    const p = new Proxy(target, { getPrototypeOf() { return mk(); } });
    say(attempt(() => typeof Object.getPrototypeOf(p)));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, set from an iterator:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, set from a generator:", ...words);
    const mk = () => ({ a: 1 });
    function* steps() { yield mk(); yield mk(); }
    say(new Set(steps()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, set from a list:", ...words);
    const mk = () => ({ a: 1 });
    say(new Set([mk(), mk()]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, set by add:", ...words);
    const mk = () => ({ a: 1 });
    say(new Set().add(mk()).add(mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, map from an iterator:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: [mk(), n], done: false } : { value: undefined, done: true }; } }; } };
    say(new Map(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, map from pairs with getters:", ...words);
    const mk = () => ({ a: 1 });
    say(new Map([{ get 0() { return mk(); }, 1: 1 }, { get 0() { return mk(); }, 1: 2 }]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, map group by:", ...words);
    const mk = () => ({ a: 1 });
    say(Map.groupBy([1, 2], () => mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, weak set from an iterator:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new WeakSet(steps).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, weak map by set:", ...words);
    const mk = () => ({ a: 1 });
    say(new WeakMap().set(mk(), 1).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, union with a set-like:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const like = { size: 1, has() { return false; }, keys() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set([mk()]).union(like).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, array from an iterator, index of:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    const list = Array.from(steps);
    say(list.indexOf(list[1]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, array from an array-like with getters, a set of it:", ...words);
    const mk = () => ({ a: 1 });
    const list = Array.from({ length: 2, get 0() { return mk(); }, get 1() { return mk(); } });
    say(new Set(list).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, includes on an array-like with a getter:", ...words);
    const mk = () => ({ a: 1 });
    say(Array.prototype.includes.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, index of on an array-like with a getter:", ...words);
    const mk = () => ({ a: 1 });
    say(Array.prototype.indexOf.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, includes on a list:", ...words);
    const mk = () => ({ a: 1 });
    say([mk()].includes(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, mapped list, last index of:", ...words);
    const mk = () => ({ a: 1 });
    const list = [1, 2].map(() => mk());
    say(list.lastIndexOf(list[0]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, object is applied to an array-like with getters:", ...words);
    const mk = () => ({ a: 1 });
    say(Reflect.apply(Object.is, null, { length: 2, get 0() { return mk(); }, get 1() { return mk(); } }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, object is:", ...words);
    const mk = () => ({ a: 1 });
    say(Object.is(mk(), mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, object is spread from an iterator:", ...words);
    const mk = () => ({ a: 1 });
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(Object.is(...steps));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, strict equality of what getters return:", ...words);
    const mk = () => ({ a: 1 });
    const holder = { get a() { return mk(); } };
    say(holder.a === holder.a);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, strict equality of what reflect get returns:", ...words);
    const mk = () => ({ a: 1 });
    const holder = { get a() { return mk(); } };
    say(Reflect.get(holder, "a") === Reflect.get(holder, "a"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, strict equality of values of an object with getters:", ...words);
    const mk = () => ({ a: 1 });
    const [a, b] = Object.values({ get a() { return mk(); }, get b() { return mk(); } });
    say(a === b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, strict equality behind assign:", ...words);
    const mk = () => ({ a: 1 });
    const copy = Object.assign({}, { get a() { return mk(); }, get b() { return mk(); } });
    say(copy.a === copy.b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, is prototype of:", ...words);
    const mk = () => ({ a: 1 });
    say(Object.prototype.isPrototypeOf.call(mk(), Object.create(mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, listeners added twice:", ...words);
    const mk = () => ({ a: 1 });
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
    const say = (...words) => console.log("literal, listener removed by another:", ...words);
    const mk = () => ({ a: 1 });
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
    const say = (...words) => console.log("literal, emitter listener removed by another:", ...words);
    const mk = () => ({ a: 1 });
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
    const say = (...words) => console.log("literal, thenables resolved:", ...words);
    const mk = () => ({ a: 1 });
    Promise.all([{ then(resolve) { resolve(mk()); } }, { then(resolve) { resolve(mk()); } }]).then(([a, b]) => say(a === b, new Set([a, b]).size));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, sort keeps both:", ...words);
    const mk = () => ({ a: 1 });
    const list = [mk(), mk()].sort(() => 0);
    say(list[0] === list[1]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, json replacer sees what to-json returns:", ...words);
    const mk = () => ({ a: 1 });
    const seen = [];
    JSON.stringify([{ toJSON() { return mk(); } }, { toJSON() { return mk(); } }], (k, x) => (seen.push(x), x));
    say(seen.length, seen[1] === seen[2]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, weak ref:", ...words);
    const mk = () => ({ a: 1 });
    say(new WeakRef(mk()).deref() === mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, array of, find index:", ...words);
    const mk = () => ({ a: 1 });
    const list = Array.of(mk(), mk());
    const first = list[0];
    say(list.findLastIndex((x) => x === first));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, structure of cloned list:", ...words);
    const mk = () => ({ a: 1 });
    say(attempt(() => { const c = structuredClone([mk(), mk()]); return c[0] === c[1]; }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, own property of one is not on the other:", ...words);
    const mk = () => ({ a: 1 });
    const a = mk(), b = mk();
    Object.defineProperty(a, "mark", { get value() { return 1; } });
    say(Object.hasOwn(b, "mark"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, frozen one leaves the other:", ...words);
    const mk = () => ({ a: 1 });
    const a = mk(), b = mk();
    Object.freeze(a);
    say(Object.isFrozen(b));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, assign onto one leaves the other:", ...words);
    const mk = () => ({ a: 1 });
    const a = mk(), b = mk();
    Object.assign(a, { get mark() { return 1; } });
    say("mark" in b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("literal, prototype of one leaves the other:", ...words);
    const mk = () => ({ a: 1 });
    const a = mk(), b = mk();
    Object.setPrototypeOf(a, null);
    say(Object.getPrototypeOf(b) === null);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, proxy get trap against a fixed value:", ...words);
    const mk = () => [1, 2];
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { get() { return mk(); } });
    say(attempt(() => typeof p.x));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, proxy describe trap against a fixed value:", ...words);
    const mk = () => [1, 2];
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { getOwnPropertyDescriptor() { return { value: mk(), writable: false, enumerable: false, configurable: false }; } });
    say(attempt(() => typeof Object.getOwnPropertyDescriptor(p, "x")));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, proxy set trap against a fixed value:", ...words);
    const mk = () => [1, 2];
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { set() { return true; } });
    say(attempt(() => Reflect.set(p, "x", mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, proxy define trap against a fixed value:", ...words);
    const mk = () => [1, 2];
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { defineProperty() { return true; } });
    say(attempt(() => Reflect.defineProperty(p, "x", { value: mk() })));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, proxy prototype trap of a sealed target:", ...words);
    const mk = () => [1, 2];
    const target = Object.preventExtensions(Object.create(mk()));
    const p = new Proxy(target, { getPrototypeOf() { return mk(); } });
    say(attempt(() => typeof Object.getPrototypeOf(p)));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, set from an iterator:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, set from a generator:", ...words);
    const mk = () => [1, 2];
    function* steps() { yield mk(); yield mk(); }
    say(new Set(steps()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, set from a list:", ...words);
    const mk = () => [1, 2];
    say(new Set([mk(), mk()]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, set by add:", ...words);
    const mk = () => [1, 2];
    say(new Set().add(mk()).add(mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, map from an iterator:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: [mk(), n], done: false } : { value: undefined, done: true }; } }; } };
    say(new Map(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, map from pairs with getters:", ...words);
    const mk = () => [1, 2];
    say(new Map([{ get 0() { return mk(); }, 1: 1 }, { get 0() { return mk(); }, 1: 2 }]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, map group by:", ...words);
    const mk = () => [1, 2];
    say(Map.groupBy([1, 2], () => mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, weak set from an iterator:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new WeakSet(steps).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, weak map by set:", ...words);
    const mk = () => [1, 2];
    say(new WeakMap().set(mk(), 1).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, union with a set-like:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const like = { size: 1, has() { return false; }, keys() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set([mk()]).union(like).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, array from an iterator, index of:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    const list = Array.from(steps);
    say(list.indexOf(list[1]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, array from an array-like with getters, a set of it:", ...words);
    const mk = () => [1, 2];
    const list = Array.from({ length: 2, get 0() { return mk(); }, get 1() { return mk(); } });
    say(new Set(list).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, includes on an array-like with a getter:", ...words);
    const mk = () => [1, 2];
    say(Array.prototype.includes.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, index of on an array-like with a getter:", ...words);
    const mk = () => [1, 2];
    say(Array.prototype.indexOf.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, includes on a list:", ...words);
    const mk = () => [1, 2];
    say([mk()].includes(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, mapped list, last index of:", ...words);
    const mk = () => [1, 2];
    const list = [1, 2].map(() => mk());
    say(list.lastIndexOf(list[0]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, object is applied to an array-like with getters:", ...words);
    const mk = () => [1, 2];
    say(Reflect.apply(Object.is, null, { length: 2, get 0() { return mk(); }, get 1() { return mk(); } }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, object is:", ...words);
    const mk = () => [1, 2];
    say(Object.is(mk(), mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, object is spread from an iterator:", ...words);
    const mk = () => [1, 2];
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(Object.is(...steps));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, strict equality of what getters return:", ...words);
    const mk = () => [1, 2];
    const holder = { get a() { return mk(); } };
    say(holder.a === holder.a);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, strict equality of what reflect get returns:", ...words);
    const mk = () => [1, 2];
    const holder = { get a() { return mk(); } };
    say(Reflect.get(holder, "a") === Reflect.get(holder, "a"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, strict equality of values of an object with getters:", ...words);
    const mk = () => [1, 2];
    const [a, b] = Object.values({ get a() { return mk(); }, get b() { return mk(); } });
    say(a === b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, strict equality behind assign:", ...words);
    const mk = () => [1, 2];
    const copy = Object.assign({}, { get a() { return mk(); }, get b() { return mk(); } });
    say(copy.a === copy.b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, is prototype of:", ...words);
    const mk = () => [1, 2];
    say(Object.prototype.isPrototypeOf.call(mk(), Object.create(mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, listeners added twice:", ...words);
    const mk = () => [1, 2];
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
    const say = (...words) => console.log("array, listener removed by another:", ...words);
    const mk = () => [1, 2];
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
    const say = (...words) => console.log("array, emitter listener removed by another:", ...words);
    const mk = () => [1, 2];
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
    const say = (...words) => console.log("array, thenables resolved:", ...words);
    const mk = () => [1, 2];
    Promise.all([{ then(resolve) { resolve(mk()); } }, { then(resolve) { resolve(mk()); } }]).then(([a, b]) => say(a === b, new Set([a, b]).size));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, sort keeps both:", ...words);
    const mk = () => [1, 2];
    const list = [mk(), mk()].sort(() => 0);
    say(list[0] === list[1]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, json replacer sees what to-json returns:", ...words);
    const mk = () => [1, 2];
    const seen = [];
    JSON.stringify([{ toJSON() { return mk(); } }, { toJSON() { return mk(); } }], (k, x) => (seen.push(x), x));
    say(seen.length, seen[1] === seen[2]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, weak ref:", ...words);
    const mk = () => [1, 2];
    say(new WeakRef(mk()).deref() === mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, array of, find index:", ...words);
    const mk = () => [1, 2];
    const list = Array.of(mk(), mk());
    const first = list[0];
    say(list.findLastIndex((x) => x === first));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, structure of cloned list:", ...words);
    const mk = () => [1, 2];
    say(attempt(() => { const c = structuredClone([mk(), mk()]); return c[0] === c[1]; }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, own property of one is not on the other:", ...words);
    const mk = () => [1, 2];
    const a = mk(), b = mk();
    Object.defineProperty(a, "mark", { get value() { return 1; } });
    say(Object.hasOwn(b, "mark"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, frozen one leaves the other:", ...words);
    const mk = () => [1, 2];
    const a = mk(), b = mk();
    Object.freeze(a);
    say(Object.isFrozen(b));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, assign onto one leaves the other:", ...words);
    const mk = () => [1, 2];
    const a = mk(), b = mk();
    Object.assign(a, { get mark() { return 1; } });
    say("mark" in b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("array, prototype of one leaves the other:", ...words);
    const mk = () => [1, 2];
    const a = mk(), b = mk();
    Object.setPrototypeOf(a, null);
    say(Object.getPrototypeOf(b) === null);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, proxy get trap against a fixed value:", ...words);
    const mk = () => new Point(1);
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { get() { return mk(); } });
    say(attempt(() => typeof p.x));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, proxy describe trap against a fixed value:", ...words);
    const mk = () => new Point(1);
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { getOwnPropertyDescriptor() { return { value: mk(), writable: false, enumerable: false, configurable: false }; } });
    say(attempt(() => typeof Object.getOwnPropertyDescriptor(p, "x")));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, proxy set trap against a fixed value:", ...words);
    const mk = () => new Point(1);
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { set() { return true; } });
    say(attempt(() => Reflect.set(p, "x", mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, proxy define trap against a fixed value:", ...words);
    const mk = () => new Point(1);
    const target = Object.defineProperty({}, "x", { value: mk() });
    const p = new Proxy(target, { defineProperty() { return true; } });
    say(attempt(() => Reflect.defineProperty(p, "x", { value: mk() })));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, proxy prototype trap of a sealed target:", ...words);
    const mk = () => new Point(1);
    const target = Object.preventExtensions(Object.create(mk()));
    const p = new Proxy(target, { getPrototypeOf() { return mk(); } });
    say(attempt(() => typeof Object.getPrototypeOf(p)));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, set from an iterator:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, set from a generator:", ...words);
    const mk = () => new Point(1);
    function* steps() { yield mk(); yield mk(); }
    say(new Set(steps()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, set from a list:", ...words);
    const mk = () => new Point(1);
    say(new Set([mk(), mk()]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, set by add:", ...words);
    const mk = () => new Point(1);
    say(new Set().add(mk()).add(mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, map from an iterator:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: [mk(), n], done: false } : { value: undefined, done: true }; } }; } };
    say(new Map(steps).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, map from pairs with getters:", ...words);
    const mk = () => new Point(1);
    say(new Map([{ get 0() { return mk(); }, 1: 1 }, { get 0() { return mk(); }, 1: 2 }]).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, map group by:", ...words);
    const mk = () => new Point(1);
    say(Map.groupBy([1, 2], () => mk()).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, weak set from an iterator:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new WeakSet(steps).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, weak map by set:", ...words);
    const mk = () => new Point(1);
    say(new WeakMap().set(mk(), 1).has(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, union with a set-like:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const like = { size: 1, has() { return false; }, keys() { return { next() { return n++ < 1 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(new Set([mk()]).union(like).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, array from an iterator, index of:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    const list = Array.from(steps);
    say(list.indexOf(list[1]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, array from an array-like with getters, a set of it:", ...words);
    const mk = () => new Point(1);
    const list = Array.from({ length: 2, get 0() { return mk(); }, get 1() { return mk(); } });
    say(new Set(list).size);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, includes on an array-like with a getter:", ...words);
    const mk = () => new Point(1);
    say(Array.prototype.includes.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, index of on an array-like with a getter:", ...words);
    const mk = () => new Point(1);
    say(Array.prototype.indexOf.call({ length: 1, get 0() { return mk(); } }, mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, includes on a list:", ...words);
    const mk = () => new Point(1);
    say([mk()].includes(mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, mapped list, last index of:", ...words);
    const mk = () => new Point(1);
    const list = [1, 2].map(() => mk());
    say(list.lastIndexOf(list[0]));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, object is applied to an array-like with getters:", ...words);
    const mk = () => new Point(1);
    say(Reflect.apply(Object.is, null, { length: 2, get 0() { return mk(); }, get 1() { return mk(); } }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, object is:", ...words);
    const mk = () => new Point(1);
    say(Object.is(mk(), mk()));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, object is spread from an iterator:", ...words);
    const mk = () => new Point(1);
    let n = 0;
    const steps = { [Symbol.iterator]() { return { next() { return n++ < 2 ? { value: mk(), done: false } : { value: undefined, done: true }; } }; } };
    say(Object.is(...steps));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, strict equality of what getters return:", ...words);
    const mk = () => new Point(1);
    const holder = { get a() { return mk(); } };
    say(holder.a === holder.a);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, strict equality of what reflect get returns:", ...words);
    const mk = () => new Point(1);
    const holder = { get a() { return mk(); } };
    say(Reflect.get(holder, "a") === Reflect.get(holder, "a"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, strict equality of values of an object with getters:", ...words);
    const mk = () => new Point(1);
    const [a, b] = Object.values({ get a() { return mk(); }, get b() { return mk(); } });
    say(a === b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, strict equality behind assign:", ...words);
    const mk = () => new Point(1);
    const copy = Object.assign({}, { get a() { return mk(); }, get b() { return mk(); } });
    say(copy.a === copy.b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, is prototype of:", ...words);
    const mk = () => new Point(1);
    say(Object.prototype.isPrototypeOf.call(mk(), Object.create(mk())));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, listeners added twice:", ...words);
    const mk = () => new Point(1);
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
    const say = (...words) => console.log("instance, listener removed by another:", ...words);
    const mk = () => new Point(1);
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
    const say = (...words) => console.log("instance, emitter listener removed by another:", ...words);
    const mk = () => new Point(1);
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
    const say = (...words) => console.log("instance, thenables resolved:", ...words);
    const mk = () => new Point(1);
    Promise.all([{ then(resolve) { resolve(mk()); } }, { then(resolve) { resolve(mk()); } }]).then(([a, b]) => say(a === b, new Set([a, b]).size));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, sort keeps both:", ...words);
    const mk = () => new Point(1);
    const list = [mk(), mk()].sort(() => 0);
    say(list[0] === list[1]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, json replacer sees what to-json returns:", ...words);
    const mk = () => new Point(1);
    const seen = [];
    JSON.stringify([{ toJSON() { return mk(); } }, { toJSON() { return mk(); } }], (k, x) => (seen.push(x), x));
    say(seen.length, seen[1] === seen[2]);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, weak ref:", ...words);
    const mk = () => new Point(1);
    say(new WeakRef(mk()).deref() === mk());
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, array of, find index:", ...words);
    const mk = () => new Point(1);
    const list = Array.of(mk(), mk());
    const first = list[0];
    say(list.findLastIndex((x) => x === first));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, structure of cloned list:", ...words);
    const mk = () => new Point(1);
    say(attempt(() => { const c = structuredClone([mk(), mk()]); return c[0] === c[1]; }));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, own property of one is not on the other:", ...words);
    const mk = () => new Point(1);
    const a = mk(), b = mk();
    Object.defineProperty(a, "mark", { get value() { return 1; } });
    say(Object.hasOwn(b, "mark"));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, frozen one leaves the other:", ...words);
    const mk = () => new Point(1);
    const a = mk(), b = mk();
    Object.freeze(a);
    say(Object.isFrozen(b));
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, assign onto one leaves the other:", ...words);
    const mk = () => new Point(1);
    const a = mk(), b = mk();
    Object.assign(a, { get mark() { return 1; } });
    say("mark" in b);
  }
  scene();
}
{
  function scene() {
    const say = (...words) => console.log("instance, prototype of one leaves the other:", ...words);
    const mk = () => new Point(1);
    const a = mk(), b = mk();
    Object.setPrototypeOf(a, null);
    say(Object.getPrototypeOf(b) === null);
  }
  scene();
}

// GENERATED: attempt Point get set
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = String string="threw "
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="TypeError" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v8 = InstanceOf v3, v7 writtenExpression="e instanceof TypeError"
// CHECK-NEXT: v9 = Add v4, v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = PropGet v3 key="constructor"
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: v14 = Add v11, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="x"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Call v0 calleeName="mk"
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|[[L_3]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=undefined|null|[[f_6]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Call v0 calleeName="mk"
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|Array<number> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=undefined|null|[[f_9]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Call v0 calleeName="mk"
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|[[L_1]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
