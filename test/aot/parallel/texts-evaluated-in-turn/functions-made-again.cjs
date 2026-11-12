// Evaluated text is interpreted in an executable: functions of every kind that are made again and again, in loops, calls and recursion, over other scopes each time, with collections between, and what they are afterwards: names, lengths, prototypes, properties, constructors, strictness.
const { edenGC, fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.compiledCall = (f, ...list) => f(...list);
const text = strict => `(function () { ${strict}
  const lines = [], show = x => typeof x === "function" ? "F " + x.name + x.length : typeof x === "object" && x ? "{" + Object.getOwnPropertyNames(x) + "}" : String(x);
  const attempt = f => { try { return show(f()); } catch (error) { return error.name; } };
  const made = [];
  const makers = [
    i => function named(a, b) { return [i, a, this === undefined, arguments.length]; }, i => function () { return i; }, i => (a, b = 2) => [i, a, b].join(), i => ({ method(a) { return [i, a]; } }).method, i => ({ get g() { return i; } }), i => class Made { constructor(a) { this.i = i + a; } m() { return this.i; } static s = i; },
    i => { function declared(a) { return i + (a ?? 0); } return declared; }, i => { let c = i; return { up: () => ++c, read: () => c }; }, i => async function later() { return i; }, i => function* steps() { yield i; }, i => async () => i, i => (function again(n) { return n ? again(n - 1) : i; }), i => [x => x + i, function (x) { return x - i; }],
    i => { const f = function () { return f.count = (f.count | 0) + i; }; return f; }, i => function (a, ...rest) { return [this === undefined, rest.length, i]; }, i => function (a) { "use strict"; return [this === undefined, i]; }, i => new Function("a", "return a + " + i % 3), i => (a => b => c => [a, b, c, i].join())(1)(2), i => { var f = function () { return typeof f; }; return f; }, i => Object.assign(() => i, { own: i }), i => (function () { return () => [this === undefined || this === globalThis, arguments.length, i]; })(1, 2),
  ];
  for (let i = 0; i < 40; i++) {
    for (let k = 0; k < makers.length; k++) {
      const f = makers[k](i); made.push(f);
      if (i % 8 === 7) lines.push(k + " " + (typeof f === "function" ? [f.name, f.length, Object.getOwnPropertyNames(f).join("|"), "prototype" in f, attempt(() => f(5, 6, 7)), attempt(() => new f(1)), attempt(() => compiledCall(f, 2)), attempt(() => Object.getPrototypeOf(f) === Function.prototype), attempt(() => { f.added = i; return f.added + Object.keys(f).join(); }), attempt(() => f.call(null, 1)), attempt(() => f.bind(1).name), attempt(() => f.caller), attempt(() => f.arguments)].join(" ; ") : Object.keys(f).join() + attempt(() => f.up && f.up() + f.read()) + attempt(() => f.g) + attempt(() => f[0] && f[0](1) + f[1](1))));
    }
    if (i === 12) collect(); if (i === 20) collectYoung();
  }
  for (let k = 0; k < made.length; k += 97) lines.push(show(made[k]) + attempt(() => made[k](3)));
  const tree = d => d ? [() => d, tree(d - 1), function () { return d; }] : () => "leaf";
  for (let t = 0; t < 3; t++) lines.push(JSON.stringify(tree(6), (key, value) => typeof value === "function" ? value() : value));
  let sum = 0; for (let i = 0; i < 300; i++) { const add = x => x + i; function twice(f) { return x => f(f(x)); } sum += twice(add)(1); if (i % 100 === 50) collectYoung(); }
  const list = [3, 1, 2]; for (let i = 0; i < 20; i++) lines.push(list.map(x => x * i).filter(x => x > i).sort((a, b) => a - b).reduce((a, b) => a + b, sum));
  return lines.join("\\n");
})`;
for (const strict of ["", '"use strict";']) console.log((0, eval)(text(strict))());
