function row(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": threw " + e.name); } }
const S = a => JSON.stringify(a).replace(/(?:null,){50,}/g, run => "null x " + run.length / 5 + ",") + " " + a.length + " " + Object.keys(a).join("");
let junk = []; function garbage() { for (let i = 0; i < 200; i++) junk.push({ i, s: "g" + i, a: [i] }); if (junk.length > 3000) junk = []; }
const cmp = (x, y) => { const p = typeof x === "object" ? x.v : x, q = typeof y === "object" ? y.v : y; return p < q ? -1 : p > q ? 1 : 0; };
function comparisons(mk) { let n = 0; mk().sort((x, y) => (n++, cmp(x, y))); return n; }
const KINDS = {
  "int32s, a literal": () => [5, 3, 4, 1, 2], "int32s, built": () => { const a = []; for (const v of [5, 3, 4, 1, 2]) a.push(v); return a; },
  "doubles, a literal": () => [5.5, 3.5, 4.5, 1.5, 2.5], "doubles, built": () => { const a = []; for (const v of [5.5, 3.5, 4.5, 1.5, 2.5]) a.push(v); return a; },
  "texts, a literal": () => ["e", "c", "d", "a", "b"], "objects": () => [5, 3, 4, 1, 2].map(v => ({ v })), "mixed numbers": () => [5, 3.5, 4, 1.5, 2],
  "in order already": () => [1, 2, 3, 4, 5], "with undefined and a hole": () => [5, undefined, 3, , 1],
};
const DEEDS = {
  "nothing": a => {}, "frozen": a => Object.freeze(a), "sealed": a => Object.seal(a), "not extensible": a => Object.preventExtensions(a),
  "shrunk to 2": a => { a.length = 2; }, "shrunk to 0": a => { a.length = 0; }, "shrunk to 1": a => { a.length = 1; }, "grown": a => { a.push(9, 9, 9); }, "grown far": a => { a.length = 50; },
  "emptied and refilled": a => { const n = a.length; a.length = 0; for (let i = 0; i < n; i++) a.push(0); }, "filled with 0": a => a.fill(0), "filled with texts": a => a.fill("t"), "filled with doubles": a => a.fill(0.5), "filled with objects": a => a.fill({ v: 0 }),
  "one double stored": a => { a[1] = 0.5; }, "one text stored": a => { a[1] = "t"; }, "NaN stored": a => { a[1] = NaN; }, "undefined stored": a => { a[1] = undefined; }, "a hole made": a => { delete a[1]; }, "a hole at 0": a => { delete a[0]; },
  "made sparse": a => { a[100000] = 1; }, "element 2 read-only": a => Object.defineProperty(a, 2, { writable: false }), "element 0 read-only": a => Object.defineProperty(a, 0, { writable: false }),
  "element 2 an accessor": a => { let v = "acc"; Object.defineProperty(a, 2, { get() { return v; }, set(x) { v = "set:" + JSON.stringify(x); }, enumerable: true }); },
  "length read-only": a => Object.defineProperty(a, "length", { writable: false }), "a property of its own": a => { a.extra = 1; }, "another prototype": a => Object.setPrototypeOf(a, { __proto__: Array.prototype, tag: 1 }),
  "sorted again, the other way": a => a.sort((x, y) => cmp(y, x)), "reversed": a => a.reverse(), "spliced": a => a.splice(1, 2), "unshifted": a => a.unshift(7), "shifted": a => a.shift(), "copyWithin": a => a.copyWithin(0, 2),
};
for (const k in KINDS) for (const d in DEEDS) {
  const total = comparisons(KINDS[k]);
  row(k + ", " + d + ", in the last comparison", () => { const a = KINDS[k](); let n = 0; const r = a.sort((x, y) => { const c = cmp(x, y); if (++n === total) DEEDS[d](a); return c; }); return S(a) + (r === a); });
}
for (const k of ["int32s, a literal", "doubles, built", "objects", "texts, a literal"]) for (const d in DEEDS) {
  const total = comparisons(KINDS[k]);
  row(k + ", " + d + ", in the valueOf of the last", () => { const a = KINDS[k](); let n = 0; a.sort((x, y) => { const c = cmp(x, y), last = ++n === total; return { valueOf() { if (last) DEEDS[d](a); return c; } }; }); return S(a); });
  row(k + ", " + d + ", in a setter on element 0", () => { const a = KINDS[k](); let n = 0, got = []; a.sort((x, y) => { const c = cmp(x, y); if (++n === total) Object.defineProperty(a, 0, { get() { return "g0"; }, set(v) { got.push(JSON.stringify(v)); Object.defineProperty(a, 0, { value: v, writable: true, enumerable: true, configurable: true }); DEEDS[d](a); }, configurable: true, enumerable: true }); return c; }); return S(a) + " " + got.join(); });
}
// the barrier: only sort's own array holds the elements while garbage is made; the array is old
for (const n of [8, 64, 500]) for (const way of ["filled with 0", "shrunk and grown", "left alone"]) row("the elements live on, " + n + ", " + way, () => {
  const a = []; for (let i = 0; i < n; i++) a.push(0); for (let i = 0; i < 6; i++) garbage(); if (typeof gc === "function") gc();          // `a` is old now
  for (let i = 0; i < n; i++) a[i] = { v: (i * 7919) % n, tag: "t" + i };                                                                  // its elements are young
  let c = 0; a.sort((x, y) => { if (++c === 1) { if (way === "filled with 0") a.fill(0); else if (way === "shrunk and grown") { a.length = 0; a.length = n; a.fill(null); } } if (c % 5 === 0) garbage(); return x.v - y.v; });
  for (let i = 0; i < 10; i++) garbage(); if (typeof gc === "function") gc(); for (let i = 0; i < 10; i++) garbage();
  let ok = 0; for (let i = 0; i < n; i++) if (a[i] && a[i].v === i && a[i].tag === "t" + a[i].tag.slice(1)) ok++; return ok + " of " + n; });
row("hot", () => { let t = 0; for (let q = 0; q < 300; q++) { const a = [5, 3, 4, 1, 2, q]; a.sort((x, y) => x - y); t += a[0] + a[5]; } return t; });
row("a literal sorted twice is a fresh literal each time", () => { const f = () => [3, 1, 2]; const x = f().sort((p, q) => p - q); const y = f(); return S(x) + " " + S(y); });
