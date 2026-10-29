// A function that looks at the object another function returned and then returns it hands it on in registers too.
// IR= 0 readsInspected PropGet| = New(Plain)?Object 
// IR= 2 readsInspected ResultAt
// IR= 0 readsAfterWork PropGet| = New(Plain)?Object 
// IR= 2 readsAfterWork ResultAt
// IR= 0 readsInspectedTwice  = New(Plain)?Object 
// IR= 2 readsInspectedTwice ResultAt
// IR= 3 inspects Results
// IR= 2 inspectsTwice Results
let noise = 0;
function pad(k) { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function pads() { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12); pad(13); pad(14); pad(15); pad(16); pad(17); pad(18); }
function names(e) { return (e.stack ?? "").split("\n").map(line => line.trim().replace(/^at /, "").split(/[ @(]/)[0]).filter(name => /^(base|inspects|inspectsTwice|stacks)$/.test(name)).join(">"); }
const kept = [];
let last;
function base(i) { pads(); if (i === 1003) throw new Error("base"); if (i % 3 === 0) return { type: 1, value: "indexed " + i }; return { type: 0, value: i + noise }; }
function inspects(i) { pads(); const found = base(i); if (found.type === 1) return found; if (i % 7 === 0) return { type: 2, value: [found.value] }; return found; }
function inspectsTwice(i) { pads(); const found = inspects(i); if (found.type === 2) return { type: 3, value: found.value.length }; return found; }
function readsAfterOtherWork(i) { pads(); const found = base(i); pads(); kept.length = 0; const seen = found.value; pads(); if (typeof seen === "string") return found; return { type: 9, value: seen }; }
function dropsOnSomePaths(i) { pads(); const found = base(i); if (i & 1) return { type: -1, value: null }; return found; }
function keepsFirst(i) { pads(); const found = base(i); kept.push(found); return found; }
function compares(i) { pads(); const found = base(i); const same = found === last; last = found; if (same) return { type: 8, value: 0 }; return found; }
function writes(i) { pads(); const found = base(i); found.value = "written"; return found; }
function adds(i) { pads(); const found = base(i); found.extra = i; return found; }
function passes(i) { pads(); const found = base(i); if (Object.keys(found).length !== 2) return { type: 7, value: 0 }; return found; }
function readsWhatIsNotThere(i) { pads(); const found = base(i); if (found.missing !== undefined) return { type: 6, value: 0 }; return found; }
function inTry(i) { pads(); try { const found = base(i); if (found.type === 1) return found; return { type: 5, value: found.value }; } catch (e) { return { type: 4, value: e.message }; } finally { noise = (noise + 1) % 1000003; } }
function eitherOfTwo(i) { pads(); const a = base(i), b = base(i + 1); return a.type ? a : b; }
function capturedByClosure(i) { pads(); const found = base(i); kept.push(() => found.value); return found; }

function reads(f, n) { let out = ""; for (let i = 0; i < n; i++) { const r = f(i); out += r.type + ":" + r.value + ";"; } return out; }
function readsInspected(n) { let out = ""; for (let i = 0; i < n; i++) { const r = inspects(i); if (r.type !== 0) out += r.value; else out += r.value % 10; } return out; }
function readsInspectedTwice(n) { let t = 0; for (let i = 0; i < n; i++) { const { type, value } = inspectsTwice(i); t = (t + type * 7 + String(value).length) | 0; } return t; }
function readsAfterWork(n) { let t = 0; for (let i = 0; i < n; i++) { const r = readsAfterOtherWork(i); t = (t + r.type + String(r.value).length) | 0; } return t; }
function identity() { const a = inspects(3), b = inspects(3), c = a; const k = keepsFirst(5); return [a === b, a === c, kept[kept.length - 1] === k, Object.keys(a).join(), JSON.stringify(inspectsTwice(7))].join(); }
function stacks() { try { return "" + inspectsTwice(1003).type; } catch (e) { return names(e); } }

console.log(readsInspected(24));
console.log(readsInspectedTwice(24), readsAfterWork(24), identity(), stacks());
for (const f of [inspects, inspectsTwice, readsAfterOtherWork, dropsOnSomePaths, keepsFirst, compares, writes, adds, passes, readsWhatIsNotThere, inTry, eitherOfTwo, capturedByClosure]) console.log(f.name, reads(f, 9));
console.log(inTry(1003).value, adds(4).extra, kept.length, typeof kept[kept.length - 1]);
