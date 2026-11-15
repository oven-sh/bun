// Dictionaries of text made at run time that loops list again and again: unchanged, changed between the listings and under way, listed in nested loops, read and stored to by name, by key and by compiled code in between.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const program = { collect: () => globalThis.Bun?.gc?.(true), read: o => o.k5 + "," + o.a, byKey: (o, k) => o[k], store: (o, k, v) => { o[k] = v; }, list: o => { let s = ""; for (const k in o) s += k + o[k]; return s; } };
const text = `
const lines = [], fill = (o, n) => { for (let i = 0; i < n; i++) o["k" + i] = i; return o; }, thin = (o, n) => { for (const k of Object.keys(o).slice(n)) delete o[k]; return o; }; let h = 5381; const note = s => { for (let i = 0; i < s.length; i++) h = h * 33 + s.charCodeAt(i) | 0; return s.length + ":" + h; };
const makers = { named: () => Object.defineProperty({ a: 1, b: "two", k5: 5 }, "__id", { value: 7, writable: true, configurable: true }), namedMany: () => Object.defineProperty(fill({ a: 0 }, 30), "__id", { value: 8, configurable: true }), thinned: () => thin(fill({ a: 1 }, 160), 9), filled: () => fill({ a: 1 }, 170), heir: () => Object.assign(Object.defineProperty(Object.create({ up: 1, a: "above" }), "__id", { value: 1, configurable: true }), { a: 2, k5: 3 }), bare: () => thin(fill(Object.create(null), 150), 12), accessor: () => Object.defineProperty(Object.defineProperty({ a: 1, k5: 2 }, "__id", { value: 1, configurable: true }), "got", { get() { return this.a + "got"; }, enumerable: true, configurable: true }), elements: () => Object.assign(Object.defineProperty({ a: 1 }, "__id", { value: 1, configurable: true }), { 3: "three", 1: "one" }) };
const listed = o => { let s = ""; for (const k in o) s += k + "=" + o[k] + ";"; return s; }, owned = o => { let s = ""; for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) s += k + o[k]; return s; }, readA = o => o.a + "" + o.k5 + o.__id + o.nowhere, storeA = (o, v) => { o.a = v; };
for (let turn = 0; turn < 4; turn++) for (const [mn, make] of Object.entries(makers)) {
  const o = make(), p = make(); let s = "";
  for (let i = 0; i < 24; i++) {
    s += listed(o); if (i % 3 === 0) s += owned(o); s += readA(o); storeA(o, i); s += program.read(o) + program.byKey(o, "b") + program.byKey(o, "k" + i);
    if (i === 5) o.added = i; if (i === 8) delete o.k5; if (i === 11) o["late" + i] = i; if (i === 13) Object.defineProperty(o, "a", { enumerable: false }); if (i === 15) Object.defineProperty(o, "a", { enumerable: true }); if (i === 17) program.store(o, "compiled", i); if (i === 19) for (const k in o) if (k.startsWith("k")) delete o[k]; if (i === 21) Object.setPrototypeOf(o, { up2: 1 });
    if (turn === 1 && i === 9) program.collect(); s += program.list(p).length;
  }
  for (let i = 0; i < 5; i++) { for (const k in p) { for (const l in p) { if (l === "b" && i === 2) p.inner = k; s += l; if (s.length % 7 === 0) p.a = i; } if (i === 3 && k === "a") delete p.k5; if (i === 4) p["w" + k.length] = 1; s += k + p[k]; if (s.length > 90000) break; } }
  lines.push(mn + " " + note(s) + " " + s.slice(-50).replace(/\\n/g, ""));
}
const all = []; for (let i = 0; i < 60; i++) all.push(Object.defineProperty({ a: i, b: { i }, ["n" + i % 5]: i }, "__id", { value: i })); let sum = 0; for (let t = 0; t < 40; t++) for (const o of all) { for (const k in o) sum = sum * 3 + (k === "b" ? o[k].i : o[k]) | 0; sum += o.__id + o.a; } lines.push("all " + sum);
return lines.length + "\\n" + lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
