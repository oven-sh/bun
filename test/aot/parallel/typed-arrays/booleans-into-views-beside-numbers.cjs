// Booleans of every make go into views in sight, beside numbers, nothing and texts, by index and by for-of, inside and beyond.
"use strict";
const out = [], made = [new Int8Array(6), new Uint8Array(6), new Int16Array(6), new Uint16Array(6), new Int32Array(6), new Uint32Array(6), new Float32Array(6), new Float64Array(6)];
const bytes = new Uint8Array(40), small = new Int8Array(8), floats = new Float64Array(8), singles = new Float32Array(8), clamped = new Uint8ClampedArray(8), big = new BigInt64Array(4), words = new Int32Array(8);
function sieve(n) { bytes.fill(0); let c = 0; for (let i = 2; i < n; i++) { if (bytes[i]) continue; c++; for (let j = i * i; j < n; j += i) bytes[j] = true; } return c; }
function compare(k) { for (let i = -1; i < 9; i++) { small[i] = i > k; words[i] = i !== k; floats[i] = !i; singles[i] = i === k; clamped[i] = i < k; } return [small, words, floats, singles, clamped].map(v => [...v].join("")).join(); }
function mixed(k) { for (let i = 0; i < 8; i++) { small[i] = i & 1 ? i > k : i; floats[i] = i & 1 ? undefined : i < k; words[i] = i & 2 ? null : !(i & 1); singles[i] = i & 1 ? "2" : true; } return [small, floats, words, singles].map(v => [...v].join("")).join(); }
function visited(list) { const seen = new Uint8Array(16); let n = 0; for (const x of list) { if (!seen[x]) n++; seen[x] = true; seen[x + 8] = false; } return n + [...seen].join(""); }
for (let t = 0; t < 30; t++) { const line = [sieve(40), compare(t & 7), mixed(t & 7), visited([1, 2, 2, 7, 3, 1, t & 7])]; try { big[0] = true; line.push(big[0]); big[1] = undefined; } catch (e) { line.push(e.name); } if (t % 7 === 0) out.push(line.join(";")); }
for (const v of made) { for (let i = 0; i < 7; i++) v[i] = i & 1 ? true : i > 2; const r = (v[0] = true); v[1] += true; v[2] = v[2] || false; v[3] = -true; v[4] = -0 < 0; out.push([...v].join() + r + Object.is(v[4], 0)); }
console.log(out.join("\n"));
