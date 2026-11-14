let traps = 0;
function make(tag) { return class { constructor() { this.tag = tag; } }; }
const First = make(1), Second = make(2);
class A {} class B extends A {} class C extends B {} class D extends C {}
class Failure extends TypeError {}
function Old() { this.old = 1; }
const proxy = target => new Proxy(target, { getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); } });
const values = [new First(), new Second(), new A(), new B(), new C(), new D(), new Failure("f"), new TypeError("t"), new Error("e"), new Old(), {}, [], new Map(), new Uint8Array(1), new ArrayBuffer(1), Buffer.from("b"),
  Object.create(null), Object.create(Object.create(null)), Object.create(new D()), Object.setPrototypeOf({ x: 1 }, Map.prototype), proxy(new D()), proxy({}), proxy([]), () => 1, A, "text", 1, 1n, Symbol("s"), null, undefined, true];
function many(test, name) { const r = []; for (let t = 0; t < 3; t++) for (let i = 0; i < values.length; i++) r.push(test(values[i]) ? 1 : 0); console.log(name, r.join(""), traps); }
function loop(name) { let s = ""; for (const v of values) { s += (v instanceof A ? 1 : 0) + "" + (v instanceof D ? 1 : 0) + (v instanceof First ? 1 : 0) + (v instanceof Error ? 1 : 0) + (v instanceof Failure ? 1 : 0) + (v instanceof Map ? 1 : 0) + (v instanceof Uint8Array ? 1 : 0) + (v instanceof Object ? 1 : 0) + (v instanceof Old ? 1 : 0) + (v instanceof Function ? 1 : 0) + " "; } console.log(name, s, traps); }
for (const [name, test] of [["A", v => v instanceof A], ["D", v => v instanceof D], ["Error", v => v instanceof Error], ["Array", v => v instanceof Array], ["ArrayBuffer", v => v instanceof ArrayBuffer], ["Buffer", v => v instanceof Buffer], ["Second", v => v instanceof Second]]) many(test, name);
loop("before");
Object.setPrototypeOf(C.prototype, Second.prototype);
loop("relinked");
Object.setPrototypeOf(values[10], D.prototype); Object.setPrototypeOf(values[2], null);
loop("values relinked");
