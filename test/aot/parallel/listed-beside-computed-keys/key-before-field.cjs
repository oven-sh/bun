
const state = { red: 1, z: 2 }; const names = ["red", "blue", "z", "y", "0", "w", "__proto__", "constructor"]; let kept = [];
function show(o) { let r = ""; for (const k in o) r += k + "=" + String(o[k]) + ";"; return r + "|" + Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + (o.z === undefined) + ("y" in o); }
function make(k, m, num, i) { const o = { [k]: i, z: i };  return o; }
for (let t = 0; t < 4; t++) for (let i = 0; i < names.length; i++) for (let j = 0; j < names.length; j++) { const o = make(names[i], names[j], t, i); kept.push(o); if (t === 3) console.log(names[i], names[j], show(o)); }
function loop(n) { let s = 0; for (let i = 0; i < n; i++) { const k = names[i & 3], m = names[(i + 1) & 3], num = i & 1; const o = { [k]: i, z: i };  s += Object.keys(o).length * 3 + (typeof o.z === "number" ? o.z : 0) + (o[k] === i ? 1 : 0); kept[i & 7] = o; } return s; }
console.log(loop(50)); console.log(kept.slice(0, 8).map(show).join("\n"));
