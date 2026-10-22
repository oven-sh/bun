"use strict";

const log = (globalThis.log = []);

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

attempt("pushes an array", () => { const a = (0, eval)("[5, 6]"); a.push(1); return a.length; });
attempt("pushes a subclass", () => { const a = (0, eval)("new (class extends Array { push(value) { log.push('Odd.push ' + value); return 42; } *[Symbol.iterator]() { log.push('Odd.iterator'); yield 'odd'; } })(5, 6)"); a.push(1); return a.length; });
attempt("pushes an array-like", () => { const a = (0, eval)("({ 0: 5, length: 7, push(value) { log.push('own push ' + value); return 'pushed'; }, [Symbol.iterator]() { log.push('own iterator'); return [8, 9][Symbol.iterator](); } })"); a.push(1); return a.length; });
attempt("pushes a proxy", () => { const a = (0, eval)("new Proxy([5, 6], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); a.push(1); return a.length; });
attempt("pushes a frozen array", () => { const a = (0, eval)("Object.freeze([5, 6])"); a.push(1); return a.length; });
attempt("pushes a string", () => { const a = (0, eval)("'ab'"); a.push(1); return a.length; });

attempt("iterates an array", () => { const a = (0, eval)("[5, 6]"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a subclass", () => { const a = (0, eval)("new (class extends Array { push(value) { log.push('Odd.push ' + value); return 42; } *[Symbol.iterator]() { log.push('Odd.iterator'); yield 'odd'; } })(5, 6)"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates an array-like", () => { const a = (0, eval)("({ 0: 5, length: 7, push(value) { log.push('own push ' + value); return 'pushed'; }, [Symbol.iterator]() { log.push('own iterator'); return [8, 9][Symbol.iterator](); } })"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a proxy", () => { const a = (0, eval)("new Proxy([5, 6], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a frozen array", () => { const a = (0, eval)("Object.freeze([5, 6])"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a string", () => { const a = (0, eval)("'ab'"); const seen = []; for (const x of a) seen.push(x); return seen; });

attempt("readsCharCode a string", () => { const s = (0, eval)("'abc'"); return s.charCodeAt(0); });
attempt("readsCharCode an object with charCodeAt", () => { const s = (0, eval)("({ charCodeAt(index) { log.push('own charCodeAt ' + index); return 'mine'; } })"); return s.charCodeAt(0); });
attempt("readsCharCode a String object with its own charCodeAt", () => { const s = (0, eval)("Object.assign(new String('xyz'), { charCodeAt: () => -1 })"); return s.charCodeAt(0); });
attempt("readsCharCode an array", () => { const s = (0, eval)("['abc']"); return s.charCodeAt(0); });
attempt("readsCharCode a number", () => { const s = (0, eval)("65"); return s.charCodeAt(0); });

attempt("truncates an integer", () => { const n = (0, eval)("7"); return n | 0; });
attempt("truncates a string", () => { const n = (0, eval)("'3'"); return n | 0; });
attempt("truncates an object with valueOf", () => { const n = (0, eval)("({ valueOf() { log.push('valueOf'); return 2 ** 31 + 0.5; }, toString() { log.push('toString'); return 'text'; } })"); return n | 0; });
attempt("truncates a bigint", () => { const n = (0, eval)("10n"); return n | 0; });
attempt("truncates the largest int32", () => { const n = (0, eval)("2147483647"); return n | 0; });
attempt("truncates minus zero", () => { const n = (0, eval)("-0"); return n | 0; });
attempt("truncates undefined", () => { const n = (0, eval)("undefined"); return n | 0; });

attempt("addsOne an integer", () => { const n = (0, eval)("7"); return n + 1; });
attempt("addsOne a string", () => { const n = (0, eval)("'3'"); return n + 1; });
attempt("addsOne an object with valueOf", () => { const n = (0, eval)("({ valueOf() { log.push('valueOf'); return 2 ** 31 + 0.5; }, toString() { log.push('toString'); return 'text'; } })"); return n + 1; });
attempt("addsOne a bigint", () => { const n = (0, eval)("10n"); return n + 1; });
attempt("addsOne the largest int32", () => { const n = (0, eval)("2147483647"); return n + 1; });
attempt("addsOne minus zero", () => { const n = (0, eval)("-0"); return n + 1; });
attempt("addsOne undefined", () => { const n = (0, eval)("undefined"); return n + 1; });

attempt("calls a function", () => { const f = (0, eval)("(x => x + 1)"); return f(1); });
attempt("calls a class", () => { const f = (0, eval)("(class Made { constructor(x) { log.push('constructed ' + x); } })"); return f(1); });
attempt("calls a callable proxy", () => { const f = (0, eval)("new Proxy(x => x + 2, { apply(target, self, list) { log.push('apply ' + list.length); return Reflect.apply(target, self, list); } })"); return f(1); });
attempt("calls a bound function", () => { const f = (0, eval)("(function (a, b) { return [this.tag, a, b]; }).bind({ tag: 'bound' }, 'first')"); return f(1); });
attempt("calls an object with call", () => { const f = (0, eval)("({ call() { log.push('call'); return 'called'; } })"); return f(1); });

attempt("addsMembers an object", () => { const o = (0, eval)("({ x: 1, y: 2 })"); return o.x + o.y; });
attempt("addsMembers accessors", () => { const o = (0, eval)("({ get x() { log.push('get x'); return 10; }, set x(value) { log.push('set x ' + value); }, get y() { log.push('get y'); return 20; } })"); return o.x + o.y; });
attempt("addsMembers a proxy", () => { const o = (0, eval)("new Proxy({ y: 2, x: 1 }, { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); return o.x + o.y; });
attempt("addsMembers a frozen object", () => { const o = (0, eval)("Object.freeze({ x: 5, y: 6 })"); return o.x + o.y; });
attempt("addsMembers texts in another order", () => { const o = (0, eval)("({ y: '2', x: '1' })"); return o.x + o.y; });
attempt("addsMembers inherited members", () => { const o = (0, eval)("Object.create({ x: 3, y: 4 })"); return o.x + o.y; });

attempt("storesMember an object", () => { const o = (0, eval)("({ x: 1, y: 2 })"); o.x = 1; return o; });
attempt("storesMember accessors", () => { const o = (0, eval)("({ get x() { log.push('get x'); return 10; }, set x(value) { log.push('set x ' + value); }, get y() { log.push('get y'); return 20; } })"); o.x = 1; return o; });
attempt("storesMember a proxy", () => { const o = (0, eval)("new Proxy({ y: 2, x: 1 }, { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); o.x = 1; return o; });
attempt("storesMember a frozen object", () => { const o = (0, eval)("Object.freeze({ x: 5, y: 6 })"); o.x = 1; return o; });
attempt("storesMember texts in another order", () => { const o = (0, eval)("({ y: '2', x: '1' })"); o.x = 1; return o; });
attempt("storesMember inherited members", () => { const o = (0, eval)("Object.create({ x: 3, y: 4 })"); o.x = 1; return o; });
