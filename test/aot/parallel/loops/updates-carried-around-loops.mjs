// words[i >> 5] |= bits: the header of the loop has parameters for the last key and for what was stored under it.
const show = a => { let t = a.length + ":"; for (let i = 0; i < a.length; i++) t += i in a ? a[i] + "," : "_,"; return t; };
let text = "";
for (let i = 0; i < 1003; i++) text += String.fromCharCode(33 + (i * 11) % 90);
function packed(s) { const words = []; for (let i = 0; i < s.length * 8; i += 8) words[i >> 5] |= (s.charCodeAt(i / 8) & 255) << (i % 32); return words; }
function mixed(s) { const words = []; for (let i = 0; i < s.length; i++) words[i >> 3] = (words[i >> 3] << 3) ^ s.charCodeAt(i); return words; }
function returning(s) { const words = []; for (let i = 0; i < s.length; i++) words[(i >> 2) % 5] ^= s.charCodeAt(i) << (i & 7); return words; }
function skipping(s) { const words = []; for (let i = 0; i < s.length; i++) { if (i % 7 === 3) continue; words[i >> 2] |= s.charCodeAt(i) << (i % 4 * 8); } return words; }
function beside(s) { const words = [], others = [5, 6, 7]; for (let i = 0; i < s.length; i++) { words[i >> 2] |= s.charCodeAt(i) << (i % 4 * 8); others[i % 3] ^= words.length; } return words.concat(others); }
function same(s) { const words = [0, 0], alias = words; for (let i = 0; i < s.length; i++) { words[i & 1] |= s.charCodeAt(i) << (i & 7); alias[0] = i; } return words; }
function negative(s) { const words = []; for (let i = -6; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i + 6); return show(words) + words[-1] + words[-2]; }
console.log(show(packed(text)), show(packed("")), show(packed("abc")));
console.log(show(mixed(text)), show(mixed("abc")));
console.log(show(returning(text)), show(returning("abc")));
console.log(show(skipping(text)), show(beside(text)), show(same(text)), negative(text));
let sum = 0;
for (let n = 0; n < 200; n++) { const t = text.slice(n), a = packed(t), b = mixed(t), c = returning(t); sum = (sum * 31 + a[n % a.length] + b[n % b.length] + c[n % c.length]) | 0; }
console.log(sum);
