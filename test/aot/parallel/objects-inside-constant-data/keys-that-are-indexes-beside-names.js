function see(o) { return Object.keys(o).join() + "~" + JSON.stringify({ ...o }) + "~" + JSON.stringify(o) + "~" + (() => { let s = ""; for (const k in o) s += k + ";"; return s; })(); }
function one() { const o = { codes: { 404: "missing", name: "http" }, zoom: { "1.5": "big", label: "z" } }; return see(o.codes) + " | " + see(o.zoom); }
function two() { const o = { codes: { name: "http", 404: "missing" }, zoom: { label: "z", "-1.5": "big", more: 1 } }; return Object.keys(o.codes).join() + "~" + JSON.stringify({ ...o.codes }) + " | " + Object.keys(o.zoom).join() + "~" + JSON.stringify({ ...o.zoom }); }
function three() { const o = { inner: { a: 1, ["__proto__"]: 5, b: 2 } }; return Object.keys(o.inner).join() + "~" + JSON.stringify({ ...o.inner }) + "~" + Object.getOwnPropertyNames(o.inner).length; }
function four({ style } = {}) { return Object.keys(style).join() + "~" + JSON.stringify({ ...style }); }
function five() { const o = { inner: { 1: "x", a: 1 } }; const c = { ...o.inner }; o.inner.z = 3; return Object.keys(c).join() + "~" + Object.keys(o.inner).join() + "~" + ("1" in o.inner) + "~" + o.inner[1]; }
function run(n) { const seen = []; for (let i = 0; i < n; i++) for (const s of [one(), two(), three(), four({ style: { bold: true, 7: "seven", "2.5": "x" } }), five()]) if (!seen.includes(s)) seen.push(s); return seen.join("\n"); }
console.log(run(300));
