// Loops that read the length of functions: declared, arrows, classes, methods, bound, with a length of their own, deleted, replaced by a getter, native, behind a proxy.
function total(list) { let h = 0; for (let x = 0; x < list.length; x++) h += list[x].length; return h; }
function arity(list) { let h = 0; for (let x = 0; x < list.length; x++) if (list[x].length > 2) h += x; return h; }
function nested(d) { let h = 0; for (let k = 0; k < 3; k++) for (let x = 0; x < d.list.length; x++) h += d.list[x].length; return h; }
const show = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const own = (f, v) => Object.defineProperty(f, "length", { value: v, configurable: true });
const makers = {
  arrows: n => Array.from({ length: n }, (_, i) => i & 1 ? (a, b) => a : (a, b, c) => b),
  declared: n => Array.from({ length: n }, () => function (a, b = 2, c) { return a; }),
  rest: n => Array.from({ length: n }, () => (...all) => all),
  classes: n => Array.from({ length: n }, () => class { constructor(a, b, c, d) { this.a = a; } }),
  methods: n => Array.from({ length: n }, () => ({ m(a, b) { return a; } }).m),
  bound: n => Array.from({ length: n }, (_, i) => ((a, b, c) => a).bind(null, ...[1, 2].slice(0, i % 3))),
  native: n => Array.from({ length: n }, (_, i) => [Math.max, parseInt, JSON.stringify][i % 3]),
  own: n => Array.from({ length: n }, (_, i) => own((a, b) => a, i)),
  fraction: n => Array.from({ length: n }, () => own(() => 1, 2.5)),
  text: n => Array.from({ length: n }, () => own(() => 1, "7")),
  deleted: n => Array.from({ length: n }, () => { const f = (a, b, c) => a; delete f.length; return f; }),
  getter: n => Array.from({ length: n }, () => Object.defineProperty((a, b) => a, "length", { get() { return 5; } })),
  proxy: n => Array.from({ length: n }, () => new Proxy((a, b, c) => a, {})),
  generators: n => Array.from({ length: n }, (_, i) => i & 1 ? function* (a, b) { yield a; } : async (a, b, c) => a),
  many: n => Array.from({ length: n }, () => new Function(...Array.from({ length: 300 }, (_, i) => "p" + i), "return 1")),
  mixed: n => Array.from({ length: n }, (_, i) => [(a, b) => a, [1, 2, 3], "text", new Uint8Array(4), Buffer.from("ab"), { length: 6 }, (function () { return arguments; })(1, 2)][i % 7]),
  late: n => Array.from({ length: n }, (_, i) => i + 2 < n ? (a, b) => a : new Float64Array(3)),
};
for (const [name, make] of Object.entries(makers)) for (const n of [0, 1, 9]) {
  const list = make(n);
  console.log(name, n, show(() => total(list)), show(() => arity(list)), show(() => nested({ list })), show(() => total(list)));
}
const changed = makers.arrows(6);
console.log(total(changed));
own(changed[2], 40); delete changed[4].length; changed[5].more = 1;
console.log(total(changed), arity(changed), nested({ list: changed }));
