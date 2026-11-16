// Evaluated text reads own properties under symbols of objects that are tables of their own: literals of new names, objects that names come to and go from, of few and of hundreds of names and symbols, whose symbols have the hashes of one another's names.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const program = { collect: () => globalThis.Bun?.gc?.(true) };
const text = `
const lines = [];
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{}" : typeof v === "function" ? "f" : typeof v === "symbol" ? "s" : String(v);
const attempt = (name, f) => { let r; try { r = show(f()); } catch (e) { r = e?.name; } lines.push(name + " " + r); };
const read = (o, k) => o[k];
for (let turn = 0; turn < 3; turn++) {
  for (const n of [0, 1, 2, 3, 7, 8, 9, 30, 31, 64, 65, 100, 300, 1000]) attempt("symbols " + n, () => {
    const o = {}, ks = Array.from({ length: n }, (_, i) => i % 3 ? Symbol("k" + i) : Symbol());
    for (const [i, k] of ks.entries()) o[k] = i;
    let s = 0;
    for (const k of ks) s += read(o, k);
    for (let i = 0; i < n; i += 4) delete o[ks[i]];
    let missing = 0;
    for (const k of ks) if (read(o, k) === undefined) missing++; else s += o[k];
    for (let i = 0; i < n; i += 8) o[ks[i]] = "again" + i;
    return [s, missing, ks.slice(0, 20).map(k => read(o, k)), read(o, Symbol()), read(o, "k1")];
  });
  attempt("literals", () => { const r = []; for (let i = 0; i < 40; i++) { const k = Symbol("n" + i), o = { [k]: i, ["p" + i + "q"]: -i, [Symbol.iterator]: "it" }; r.push(read(o, k), read(o, Symbol.iterator), read(o, "p" + i + "q"), read(o, Symbol.for("n" + i))); } return r; });
  attempt("same texts", () => { const a = Symbol("x"), b = Symbol("x"), c = Symbol.for("x"), o = { x: 1, [a]: 2, [b]: 3, [c]: 4 }; return [read(o, "x"), read(o, a), read(o, b), read(o, c), read(o, Symbol("x"))]; });
  attempt("accessors", () => { const k = Symbol(), o = { get [k]() { return this.y; }, y: 5 }; const r = []; for (let i = 0; i < 6; i++) { r.push(read(o, k)); o.y++; } Object.defineProperty(o, k, { value: "plain", configurable: true }); r.push(read(o, k)); delete o[k]; r.push(read(o, k)); return r; });
  attempt("above", () => { const k = Symbol(), p = { [k]: "p" }, o = Object.create(p); for (let i = 0; i < 50; i++) o["m" + i] = i; const r = []; for (let i = 0; i < 9; i++) { r.push(read(o, k)); if (i === 2) o[k] = "own"; if (i === 4) delete o[k]; if (i === 6) p[k] = "changed"; } return r; });
  attempt("many objects", () => { const k = Symbol("shared"), l = []; for (let i = 0; i < 500; i++) { const o = { ["a" + i]: 1 }; o[k] = i; l.push(o); } let s = 0; for (const o of l) s += read(o, k); program.collect(); for (const o of l) s -= read(o, k) / 2; return s; });
  attempt("empty values", () => { const k = Symbol(), o = { [k]: undefined }, p = { [k]: null }; return [read(o, k), read(p, k), k in o, read({}, k)]; });
}
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
