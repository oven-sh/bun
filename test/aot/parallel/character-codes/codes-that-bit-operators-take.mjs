// STATISTIC: CharacterCodesReadForBits >= 3
// Character codes that bit operators alone take: outside of the text they are NaN, which counts as nothing. Positions that are quotients are cut to whole numbers.
function pack(text, n) { const words = []; for (let i = 0; i < n; i++) words[i] = text.charCodeAt(i * 2) << 16 | text.charCodeAt(i * 2 + 1); return words; }
function nibbles(text, n) { let x = 0; for (let i = 0; i < n; i++) x = x << 4 ^ (text.charCodeAt(i / 2) >> (i & 1 ? 0 : 4) & 15) ^ x >>> 28; return x; }
function mixed(text, from, n) { let h = 5; for (let i = from; i < from + n; i++) h = (h << 5) - h ^ text.charCodeAt(i) & 255; return h; }
function either(text, i) { return text.charCodeAt(i) | 0; }
function flags(text, n) { let x = ~0; for (let i = n; i-- > -2;) x ^= ~text.charCodeAt(i) | text.charCodeAt(i + .75) << 3; return x >>> 0; }
function compared(text, n) { let c = 0; for (let i = 0; i < n; i++) { const code = text.charCodeAt(i); if ((code & 1) === 0) c++; if (code !== code) c += 100; } return c; }
const texts = ['', 'a', 'plain text of sixteen', 'wide €\u{1f600}￿\u0000', 'x'.repeat(33) + '\xe9', 'ro' + 'pe'.repeat(20), String.fromCharCode(0, 128, 255, 256, 65535)];
for (const text of texts) {
  console.log(text.length, pack(text, 12).join(), nibbles(text, 9), nibbles(text, 100), mixed(text, 0, text.length), mixed(text, -3, 60), flags(text, 7), compared(text, 5));
  for (const i of [-1, -0, 0, .9, 1.5, -.5, 21, 2 ** 31, 2 ** 32, 1e300, NaN, Infinity, undefined, null, '1', true]) console.log(String(i), either(text, i), mixed(text, typeof i === 'number' && i < 100 && i > -5 ? i : 2, 3));
}
for (const other of [null, 7, ['a'], { charCodeAt(i) { return i * 3.5; } }]) {
  for (const f of [() => pack(other, 3).join(), () => nibbles(other, 3), () => either(other, 1)]) { try { console.log(f()); } catch (e) { console.log(e.constructor.name); } }
}
