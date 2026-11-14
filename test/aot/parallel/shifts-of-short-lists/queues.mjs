// Queues of 1 to 40 elements: of objects, texts, integers, fractions and mixed kinds, with holes, behind collections, and lists that something else has changed.
const kinds = [i => ({ v: i }), i => "t" + i, i => i, i => i + 0.5, i => (i % 3 ? i : "m" + i), i => (i % 2 ? i + 0.25 : i)];
const show = v => v === undefined ? "u" : typeof v === "object" ? "o" + v.v : String(v);
let junk; const lines = [];
function turn(q, make, n) { let out = ""; for (let i = 0; i < n; i++) { out += show(q.shift()); q.push(make(i)); } return out + q.length; }
function drain(q) { let out = ""; while (q.length) out += show(q.shift()) + q.length; return out + show(q.shift()); }
function holes(n) { const q = new Array(n); q[n - 1] = 7; let out = ""; for (let i = 0; i < 4; i++) out += show(q.shift()) + (0 in q) + q.length; return out; }
for (let round = 0; round < 12; round++) {
  for (const make of kinds) {
    for (const n of [1, 2, 3, 4, 5, 9, 10, 16, 17, 31, 32, 33, 40]) {
      const q = []; for (let i = 0; i < n; i++) q.push(make(i));
      const held = q.slice(); lines.push(turn(q, make, n + 5), drain(q), held.length, show(held[n - 1]));
      const frozen = Object.freeze([make(1), make(2)]); try { frozen.shift(); } catch (error) { lines.push(error.name); }
      const named = [make(1), make(2), make(3)]; named.extra = 1; lines.push(show(named.shift()) + named.length + named.extra);
    }
    lines.push(holes(5), holes(33));
  }
  for (let i = 0; i < 4000; i++) junk = [i, junk && i];
}
let hash = 0; for (const line of lines) for (const c of String(line)) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(lines.length, hash, lines.slice(0, 8).join(" "));
