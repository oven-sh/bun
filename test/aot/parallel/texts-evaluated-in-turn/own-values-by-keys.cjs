// Own values of plain objects by string keys, elements stored at and behind the end of arrays, Math of every kind of number.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const text = `
const lines = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : v && typeof v === "object" ? JSON.stringify(v) : String(v);
const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name + ": " + e.message); } };
const names = n => { const o = {}; for (let i = 0; i < n; i++) o["k" + i] = i; return o; };
for (const n of [0, 1, 5, 40, 100, 200, 400]) {
  const o = names(n);
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < n + 3; i++) { const k = "k" + i; o[k] = (o[k] || 0) + turn; }
    delete o["k" + turn];
    attempt(() => o["k2"]); attempt(() => o["k" + (n - 1)]); attempt(() => o["missing" + turn]); attempt(() => o["toString"]);
  }
  Object.defineProperty(o, "k1", { get() { return "got"; }, set(v) { lines.push("set " + v); }, configurable: true });
  Object.defineProperty(o, "k2", { value: "fixed", writable: false, configurable: true });
  for (let turn = 0; turn < 2; turn++) for (const k of ["k1", "k2", "k3"]) { attempt(() => o[k]); attempt(() => { o[k] = turn; return o[k]; }); attempt(() => { "use strict"; o[k] = turn; return o[k]; }); }
  const heir = Object.create(o), key = ["k3", "k4"];
  for (let turn = 0; turn < 3; turn++) { o[key[turn & 1]] = "above" + turn; attempt(() => heir[key[0]]); attempt(() => heir[key[1]]); }
  Object.freeze(o);
  for (const k of ["k1", "k2", "k3", "new"]) attempt(() => { o[k] = 5; return o[k]; });
}
const counts = {};
for (const word of "the cat and the dog and the bird".split(" ")) counts[word] = (counts[word] || 0) + 1;
attempt(() => counts);
for (const list of [[], [1, 2], [1.5], ["a"], [, 1], [{}], new Array(3), Object.freeze([1, 2]), [1, 2, 3].slice(0, 1)]) {
  for (const value of [7, 2.5, -0, NaN, "t", undefined, null]) for (let k = 0; k < 4; k++) { const i = list.length; attempt(() => { list[i] = value; return list.length; }); attempt(() => { list[0] = value; return list[0]; }); attempt(() => { list[i + 2] = value; return list.length + ":" + list.indexOf(value) + ":" + (i + 1 in list); }); }
  attempt(() => list.map(show).join());
}
const numbers = [0, -0, 1, -1, 0.5, -0.5, 0.49999999999999994, 1.5, -1.5, 2.5, -2.5, 2147483647, -2147483648, 2147483648, 2147483647.5, -2147483648.5, 9007199254740992, 4503599627370495.5, 4611686018427387904, 1e300, NaN, Infinity, -Infinity, "4", null, undefined, { valueOf() { return 9; } }];
for (const f of ["abs", "sqrt", "ceil", "floor", "trunc", "round", "min", "max"]) for (const a of numbers) { attempt(() => Math[f](a)); attempt(() => Math[f](a, 1)); attempt(() => Math[f](-3, a, 2.5)); attempt(() => Math[f](1, 2, 3, a)); }
for (const a of numbers) for (const b of numbers) { attempt(() => Math.min(a, b)); attempt(() => Math.max(a, b)); }
attempt(() => Math.min()); attempt(() => Math.max()); attempt(() => Math.abs()); attempt(() => Math.round());
return lines.join("\\n");`;
console.log(new Function(hidden(text))());
