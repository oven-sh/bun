// STATISTIC: BodiesVersionedByArrayKind >= 2
// A parameter holds a string in some calls and an array or bytes in others.
"use strict";
const out = [];
function code(h, i) {
  return typeof h === "string" ? h.charCodeAt(i) : h[i];
}
function hash(h) {
  let s = 5381;
  for (let i = 0; i < h.length; i++) s = (Math.imul(s, 33) ^ code(h, i)) | 0;
  return s;
}
function count(h, wanted) {
  let n = 0;
  for (let i = 0; i <= h.length; i++) if (h[i] === wanted) n++;
  return n;
}
function ends(h, depth) {
  return depth > 0 ? ends(h, depth - 1) : String(h[0]) + String(h[h.length - 1]) + String(h[h.length]) + h.length;
}
function find(h, what) {
  return h.indexOf(what) * 10 + (h.includes(what) ? 1 : 0) + h.slice(1, 3).length + h.lastIndexOf(what);
}
const bytes = text => new Uint8Array(Array.from(text, c => c.charCodeAt(0) & 255));
let rope = "rope";
for (let i = 0; i < 4; i++) rope = rope + String(i) + rope;
const texts = ["hello", "", "a", "héllo ☃", rope, rope.slice(3, 40), "x".repeat(50)];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    out.push([hash(text), hash(bytes(text)), count(text, "l"), count(Array.from(text), "l"), ends(text, 2), ends(Array.from(text), 2)].join(" "));
    out.push([find(text, "l"), find(Array.from(text), "l"), find(Array.from(text), "lo")].join(" "));
  }
}
for (const line of out) console.log(line);
