const some = () => [1, -0, 0.5, NaN, 2 ** 31, "s", undefined, {}];
globalThis.holes = a => [a.length, Object.keys(a).join(), ...Array.from(a, show)].join("|");
const twos = () => some().map((a, i, all) => [a, all[(i + 3) % all.length]]).concat(some().map(a => [a, a]));
check("(a, b) => holes([a, b])", twos);
check("(a, b) => holes([a, , b, ,])", twos);
check("(a, b) => { const t = [a, b, a]; t[1] = t[0]; t[4] = b; return [show(t[1]), show(t[2]), show(t[3]), holes(t)]; }", twos);
check("(a, b) => { const t = [a, b], u = [b, a]; t[0] = 7; globalThis.other = u; other[1] = 8; return [t[0], u[1], show(t[1]), show(u[0])]; }", twos);
check("(a, b) => { const t = [1, 2, 3]; const first = t[0]; if (a === b) t[0] = a; return [first, show(t[0]), t[2], t[3], holes(t)]; }", twos);
check("a => { const t = [0.5, 1.5]; return [t[1], t[2], t.length, t.includes(a)]; }", () => [[0.5], [1]]);
check("n => holes(new Array(n).fill(1, 1, 3).slice(0, 9)) + new Array(n).length", () => [0, 1, 2, 3, 4, 7, 64, 65, 900, 1100, 5000, 3.5, -1, "2", 8 / 2, 2 ** 32].map(n => [n]));
check("n => { const a = new Array(n); a[0] = 0.5; return [a[n - 1], n - 1 in a, a.length]; }", () => [1, 2, 3, 50, 2000, 2 ** 27].map(n => [n]));
check("() => holes(new Array(5)) + holes(new Array(0)) + holes(Array(64))", () => [[]]);

class Derived extends Array {}
const withConstructor = constructor => Object.assign([1, 2], { constructor });
check("a => { const r = Array.prototype.map.call(a, x => x); return [r.constructor.name, holes(r)]; }", () => [
  [1, 2], [0.5], ["a"], [], [1, , 2], Derived.of(1), withConstructor({ [Symbol.species]: Derived }), withConstructor(undefined), { length: 1, 0: 1 }, "ab",
  new Proxy(Derived.of(1), {}), /a/.exec("a"),
].map(a => [a]));

const iterables = () => [
  [1, 2], Array.of(1, 2), [0.5, 1], [1, , 2], [], "ab", new Set([1, 2]), new Uint8Array(2), (function () { return arguments; })(1, 2), Derived.of(1),
  Object.assign([1], { *[Symbol.iterator]() { yield 9; } }), 5, null,
].map(a => [a]);
check("a => holes([...a])", iterables);
check("a => { const r = [0, ...a, , ...a]; r[0] = 1; return holes(r); }", iterables);
check("a => { const r = [...a]; r[0] = 5; return [holes(r), a[0]]; }", iterables);
check("a => ((...r) => holes(r))(...a, 1)", iterables);
globalThis.all = function () { return [new.target === all, ...arguments].map(show).join(); };
for (const call of ["all(...a)", "all(7, ...a)", "all(7, 8, ...a)", "String(new all(...a))", "all.apply(null, a)", "Math.max(0, ...a)", "((x, ...r) => all(...r))(...a)", "(() => { 'use strict'; return all(1, ...a); })()"])
  check(`a => ${call}`, () => iterables().concat([[Array.from({ length: 300 }, (_, i) => i)], [Object.setPrototypeOf([1, , 3], Object.create(Array.prototype, { 1: { value: 2 } }))]]));
check("(f, a) => f(1, ...a)", () => [all, new Proxy(all, {}), all.bind(null, 0), class {}, 5].map(f => [f, Array.of(2, 3)]));
check("(a, f) => all(...a, f(a))", () => [a => 1, a => a.pop()].map(f => [Array.of(2, 3), f]));
check("(a, b) => { const f = (x, y, z) => show(x) + show(y) + show(z), t = [a, b]; return f(...t) + f(1, ...t) + f.apply(null, t) + holes([...t, ...t]); }", twos);
check("(a, b) => { const f = (x, y, z) => show(x) + show(y) + show(z), t = [a, b]; t[2] = 1; const u = [a, , b]; return f(...t) + f(...u); }", twos);
check("(a, b) => { const t = [a, b]; t.length = 1; const u = [a, b]; Object.setPrototypeOf(u, { *[Symbol.iterator]() { yield 3; } }); return holes([...t, ...u]); }", twos);

const counts = () => [[], [1], [1, "b"], [0.5, 2, 3], Array.from({ length: 40 }, (_, i) => i), Array.from({ length: 1500 }, (_, i) => i)];
for (const f of [
  "function (...r) { return holes(r.slice(0, 5)) + r.length + r.at(-1); }",
  "function (a, b, ...r) { r[r.length] = a; return r.length + show(r[0]); }",
  "function (a, b = 5, c = a) { return [a, b, c]; }",
  "function (a, b) { return [arguments.length, arguments[0], arguments[1], arguments[2], arguments[-1], arguments[a]]; }",
  "function () { let s = ''; for (let i = 0; i < arguments.length && i < 9; i++) s += arguments[i]; return s; }",
  "function () { let s = ''; for (let i = 0; i < 4; i++) { s += arguments[i]; if (i === 1) globalThis.kept = arguments; } return s + kept.length; }",
  "function (a) { 'use strict'; a = 9; const all = arguments; return [a, all.length, all[0], all[all.length - 1], Object.keys(all).length, typeof all[Symbol.iterator]]; }",
  "function (a, b) { a = 9; arguments[1] = 8; return [a, b, arguments[0], arguments.length, arguments.callee.length, Array.from(arguments).at(-1)]; }",
  "function (a, b) { const get = () => a; arguments[0] = 7; b = 6; return [get(), arguments[1], arguments.length, Array.from(arguments).at(-1)]; }",
  "function (a) { if (a === 1) Object.defineProperty(arguments, 'length', { value: 7 }); return arguments.length + show(arguments[0]); }",
]) {
  check(f, counts);
  check(`(a, b, c) => { const f = ${f}; return [f(), f(a), f(a, b), f(a, b, c)]; }`, () => counts().slice(0, 4));
}

const three = (x, y, z) => show(x) + show(y) + show(z);
for (const change of ["", "a = 7", "arguments[1] = 8", "arguments.length = 1", "delete arguments[0]", "arguments[Symbol.iterator] = function* () { yield 9; }", "g(arguments)"]) {
  for (const mode of ["", "'use strict';"]) {
    const f = `function (a, b) { ${mode} const g = x => (x[0] = 6); ${change}; return three.apply(null, arguments) + three(...arguments) + holes([].slice.call(arguments, 1)) + holes([].slice.call(arguments, -3, 2)) + arguments[0] + arguments.length; }`;
    check(`(a, b, c) => { const three = ${three}, f = ${f}; return [f(), f(a), f(a, b, c)]; }`, () => [[1, 2, 3]]);
  }
}
check("(a, b) => holes(new Array(a, b)) + holes(Array(a, b, a))", twos);
check("n => { const a = new Float32Array(n), b = new Uint8Array(n), c = new BigInt64Array(n); return [a.length, a[n - 1], b.join('').length, show(c[0]), b.buffer.byteLength, a.byteOffset]; }",
  () => [0, 1, 7, 17, 1000, 1001, -1, 1.5, "2", undefined, [1, 2]].map(n => [n]));
check("a => [new Map().set(a, 1).size, new Set(undefined).add(a).add(1).size, new Map(null).size, new Set([a]).size]", singles);

// Arrays that are made once a prototype has a setter for an index. This has to be last.
{
  const makers = ["a => [a]", "a => [1]", "a => []", "a => new Array(a)", "(...r) => r", "function () { 'use strict'; return arguments; }", "a => [...[a]]", "a => [a].map(x => x)"].map(it => (0, eval)(`(${it})`));
  for (let i = 0; i < 100; i++) for (const make of makers) make(1)[0] = 1;
  let calls = 0;
  Object.defineProperty(Object.prototype, 3, { set() { calls++; }, configurable: true });
  for (const make of makers) make(1)[3] = 1;
  if (calls !== makers.length) throw new Error(`${calls} calls of the setter`);
}
