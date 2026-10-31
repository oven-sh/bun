// Keys, values, entries, copies, rest patterns and for-in over a value of no known layout: every record of the program is a candidate for what it is.
// The records here have what a walk over plain string fields must not take for one: symbols, accessors, index keys, names of Object.prototype, fields deleted, redefined or added later.
const log = [];
const sides = [
  ['a method under a symbol', Object.assign(() => 0, { [Symbol.dispose]() { return 1; } })],
  ['a field under a symbol', { [Symbol('tag')]: 1, plain: 2 }],
  ['a registered symbol', { [Symbol.for('app.key')]: 1, a: 2 }],
  ['a getter', { get a() { log.push('get a'); return 1; }, b: 2 }],
  ['a setter alone', { set a(v) { log.push('set a'); }, b: 2 }],
  ['index keys', { 2: 'two', 0: 'zero', a: 1, 1: 'one' }],
  ['names of Object.prototype', { toString: 1, hasOwnProperty: 2, constructor: 3, __proto__: null }],
  ['an own __proto__', { ['__proto__']: 5, valueOf: 6 }],
  ['a deleted field', (() => { const o = { a: 1, b: 2, c: 3 }; delete o.b; return o; })()],
  ['a field made not enumerable', Object.defineProperty({ a: 1, b: 2 }, 'a', { value: 9, enumerable: false })],
  ['a field made a getter', Object.defineProperty({ a: 1, b: 2 }, 'b', { get() { log.push('get b'); return 7; }, enumerable: true, configurable: true })],
  ['frozen', Object.freeze({ a: 1, b: { c: 2 } })],
  ['sealed', Object.seal({ a: 1, b: 2 })],
  ['an instance with a field added by a store', (() => { class P { constructor() { this.x = 1; } m() {} static s = 4; } const o = new P(); o.added = 2; return o; })()],
  ['an instance with a private name and a symbol method', new (class { #p = 1; [Symbol.iterator]() { return [][Symbol.iterator](); } y = 2; get p() { return this.#p; } })()],
  ['a proxy', new Proxy({ a: 1, b: 2 }, { ownKeys(t) { log.push('ownKeys'); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push('descriptor ' + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { log.push('get ' + String(k)); return t[k]; } })],
  ['an array with a name', Object.assign([1, 2], { extra: 3 })],
  ['no prototype', (() => { const o = Object.create(null); o.a = 1; o[Symbol.toStringTag] = 'T'; return o; })()],
  ['an inherited name', (() => { const o = Object.create({ inherited: 1 }); o.own = 2; return o; })()],
  ['a function with fields', Object.assign(function () {}, { a: 1 })],
];
function show(value) {
  return JSON.stringify(value, (key, held) => (typeof held === "symbol" ? String(held) : typeof held === "function" ? "function" : held));
}
function walk(o, name) {
  log.push(name + " | keys " + Object.keys(o).join());
  log.push(name + " | values " + show(Object.values(o)));
  log.push(name + " | entries " + show(Object.entries(o)));
  const assigned = Object.assign({}, o);
  log.push(name + " | assign " + show(assigned) + " " + Object.getOwnPropertySymbols(assigned).length);
  const spread = { ...o };
  log.push(name + " | spread " + show(spread) + " " + Object.getOwnPropertySymbols(spread).length);
  log.push(name + " | spread between " + show({ a: "first", ...o, z: "last" }));
  const { a, 0: zero, ...rest } = o;
  log.push(name + " | rest " + show([a, zero, rest]) + " " + Object.getOwnPropertySymbols(rest).length);
  const seen = [];
  for (const key in o) seen.push(key);
  log.push(name + " | for-in " + seen.join());
  log.push(name + " | own " + Reflect.ownKeys(o).map(String).join());
}
for (let turn = 0; turn < 300; turn++) {
  if (turn) log.length = 0;
  walk(JSON.parse('{"0":0,"1":1,"a":"x","toString":"mine"}'), "parsed");
  for (const [name, side] of sides) walk(side, name);
}
console.log(log.join("\n"));
