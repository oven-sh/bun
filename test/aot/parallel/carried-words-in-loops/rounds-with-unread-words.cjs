// Rounds of which some words are read by nobody, or behind the loop alone.
"use strict";
function fill(n, f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const word = i => Math.imul(i + 1, 0x9e3779b9) | 0;
function captured(w, k, s, stop) { let A = 0x2a30db0b, B = s[1] | 0, C = 4, D = 6, E = s[4] | 0, F = s[5], G = s[6], t = 0; for (var i = 0; i < 64; ++i) { t = (A << 21 | A >>> 11) + (A & C ^ B & (C ^ A)) + G + w[i + 13 & 15] + k[i] | 0; w[i & 15] = t; if (i === stop) A = "x"; G = F; F = E; E = D << 16 | D >>> 16; D = C; C = B; B = A; A = t; } const c = () => [A, B, C, D, E, F, G]; return c().concat([t]); }
function unread(w, k, s) { let A = s[0], B = s[1], C = s[2], D = s[3], E = s[4], F = s[5], G = s[6]; for (let i = 0; i < 64; i++) { const t = (A << 5 ^ A >>> 27 ^ A >>> 3) + (A & B ^ C & (A ^ B)) + w[i & 15] + k[i] | 0; G = F; F = E; E = D; D = C; C = B; B = A; A = t; } return [A, B, C]; }
function last(w, k, s) { let A = s[0] | 0, B = s[1] | 0, C = s[2] | 0, D = s[3] | 0, E = 0, F = 0; for (let i = 0; i < 64; i++) { const t = (A << 7 ^ A >>> 25 ^ B >>> 2 ^ B << 30) + (C ^ A & (B ^ C)) + D + w[i & 15] + k[i] | 0; F = E; E = D; D = C; C = B; B = A; A = t; } return F; }
function first(w, k, s) { let A = s[0], B = s[1], C = s[2], D = s[3], E = s[4]; for (let i = 0; i < 64; i++) { const t = (A ^ A << 13 ^ A >>> 19 ^ B << 2 ^ C >>> 7) + w[i + 1 & 15] + k[i & 31] | 0; w[i & 15] = t; E = D; D = C; C = B; B = A; A = t; } return w; }
const states = [() => fill(8, word), () => fill(8, i => word(i) >>> 0), () => fill(8, i => i * 1.5), () => fill(8, i => 1099511627776 + i), () => [1, 2], () => fill(8, i => i & 1 ? "7" : i), () => new Int32Array(fill(8, word))];
const blocks = [() => fill(16, word), () => { const a = fill(16, word); a[9] = 1099511627776 + 5; return a; }, () => { const a = fill(16, word); delete a[3]; return a; }, () => new Uint32Array(fill(16, word)), () => fill(16, i => i / 2), () => fill(5, word)];
for (const f of [captured, unread, last, first]) for (const s of states) for (const w of blocks) console.log(f.name, JSON.stringify(f(w(), fill(64, i => word(i * 3)), s(), 5)), JSON.stringify(f(w(), fill(64, word), s(), 99)));
