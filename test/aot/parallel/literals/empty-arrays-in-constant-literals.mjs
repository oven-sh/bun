// Empty arrays in constant literals of many members: each evaluation makes its own, whatever is stored into them.
const out = [];
const held = new Map(); const get = k => held.get(k);
held.set("flags", () => ({ empty: false, tokens: [], input: [], overflow: -2, left: 0, nothing: null, month: undefined, format: "f", user: false, iso: false, parts: [], era: null, meridiem: null, rfc: false, weekday: 1.5, last: [] }));
held.set("nested", () => ({ a: 1, b: 2, c: 3, d: { x: [], y: { z: [], w: 7 }, v: [[], [[]], [1, []]] }, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: [], l: [], m: 13, n: 14, o: 15, p: 16 }));
held.set("rows", () => [[], [], [], [1], ["a"], [], [], [], [0.5], [], [], [], [], [], [], [], [], {}]);
held.set("only", () => [[[], []], [[], []], [[], []], [[], []], [[], []], [[], []]]);
const text = x => JSON.stringify(x, (k, v) => v === undefined ? "undefined" : v);
for (let round = 0; round < 3; round++) {
  for (const name of held.keys()) {
    const one = get(name)(), two = get(name)();
    out.push(name + " " + text(one));
    const arrays = [], seen = new Set();
    (function walk(v) { if (v === null || typeof v !== "object") return; if (seen.has(v)) out.push("shared"); seen.add(v); if (Array.isArray(v)) arrays.push(v); for (const k of Object.keys(v)) walk(v[k]); })(one);
    (function walk(v) { if (v === null || typeof v !== "object") return; if (seen.has(v)) out.push("shared with the first"); for (const k of Object.keys(v)) walk(v[k]); })(two);
    let n = 0;
    for (const a of arrays) { const before = a.length; switch (n++ % 8) { case 0: a.push(n); break; case 1: a.push(0.5); break; case 2: a.push("s"); break; case 3: a[3] = n; break; case 4: a.length = 5; break; case 5: a.unshift(undefined); break; case 6: a[10000] = 1; a.length = 2; break; default: Object.freeze(a); try { a.push(1); } catch (e) { out.push(e.constructor.name); } } out.push(before + ">" + a.length + ":" + Object.keys(a).join()); }
    out.push(text(one).length + " " + text(two));
  }
}
let total = 0;
for (let i = 0; i < 20000; i++) { const f = get("flags")(); f.tokens.push(i); if (f.input.length || f.parts.length || f.last.length) out.push("not empty " + i); total += f.tokens[0] + f.overflow; }
out.push(total, Array.isArray(get("flags")().last), Object.getPrototypeOf(get("flags")().parts) === Array.prototype, get("flags")().parts.concat([1], get("flags")().input).length);
console.log(out.join("\n"));
