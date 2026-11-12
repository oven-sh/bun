// A rare block makes a product again and divides it: the product is defined once there.
let digest = 0; const lines = [];
function note(x) { const s = String(x); for (let i = 0; i < s.length; i++) digest = (Math.imul(digest, 31) + s.charCodeAt(i)) | 0; if (lines.length < 12) lines.push(s.slice(0, 120)); }
function nz(x) { return x === 0n ? 3n : x; }
function other(a, b) { return a > b ? a - b : a + b; }
const M = (1n << 300n) - 1n;
const kept = []; const object = { value: 0n }; let last = () => 0n; let mixed;
function run(v0, v1, v2, v3, n) {
for (let i = 0; i < n; i++) {
if (v0 === v1) { kept.push(v3); } else { v3 = (((0xffffffffn) * v2) % nz(v2)); }
if (v1 === v2) { v3 = (((v1 & (0xffffffffffffffffn)) >> 45n) === (v0 - BigInt.asUintN(65, (-1n))) ? ((v3 % nz(v2)) & v2) : ((v0 - ((1n << 255n) - 19n)) - ((0n) * v2))); } else { v0 = (0xffffffffn); }
if (v0 > M || v0 < -M) v0 %= M;
if (v1 > M || v1 < -M) v1 %= M;
if (v2 > M || v2 < -M) v2 %= M;
if (v3 > M || v3 < -M) v3 %= M;
}
note(v0);
note(v1);
note(v2);
note(v3);
}
run(((1n << 200n) + 12345n), (0x10000000000000000n), (0xffffffffffffffffn), (0x10000000000000000n), 3);
try { run(1n, 1, 1, "a", 4); } catch (e) { note(e.name + e.message); }
for (const k of kept) note(k); note(object.value); note(last()); console.log(digest); console.log(lines.join("\n"));
