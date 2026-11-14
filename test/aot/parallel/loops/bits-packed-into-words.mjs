// words[i >> 5] |= bits: what is past the end has no bits, and the store appends.
// STATISTIC: UpdatedBitsReadPastEnd >= 6
const width = 8, log = [];
const show = a => { let t = a.length + ":"; for (let i = 0; i < a.length; i++) t += i in a ? a[i] + "," : "_,"; return t; };
let text = "";
for (let i = 0; i < 203; i++) text += String.fromCharCode(33 + (i * 7) % 190);
function little(s) { const words = Array(); const mask = (1 << width) - 1; for (let i = 0; i < s.length * width; i += width) words[i >> 5] |= (s.charCodeAt(i / width) & mask) << (i % 32); return words; }
function big(s) { const words = []; for (let i = 0; i < s.length; i++) words[i >>> 2] |= (s.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8); return words; }
function written(s) { const words = []; for (let i = 0; i < s.length; i++) words[i >> 2] = words[i >> 2] ^ (s.charCodeAt(i) << (i % 4 * 8)); return words; }
function gaps(s) { const words = []; for (let i = 0; i < s.length; i++) words[(i * 3) >> 1] |= s.charCodeAt(i) << (i & 15); return words; }
function down(s) { const words = [0, 0, 0]; for (let i = s.length - 1; i >= 0; i--) words[i >> 4] ^= s.charCodeAt(i) << (i & 7); return words; }
function negative(s) { const words = []; for (let i = -9; i < 30; i++) words[i >> 2] |= s.charCodeAt(i + 9) << (i & 7); return show(words) + words[-1] + " " + words[-3]; }
function alternating(s) { const words = [1, 2]; for (let i = 0; i < s.length; i++) words[i & 3] |= s.charCodeAt(i) << (i & 15); return words; }
function stored(s) { const words = []; for (let i = 0; i < s.length; i++) { words[i >> 2] |= s.charCodeAt(i); if (i === 41) words[10] = 0x10000; if (i === 90) words.length = 5; } return words; }
function valued(s, at) { const words = []; for (let i = 0; i < s.length; i++) words[i >> 2] |= i === at ? { valueOf() { words.push(77); log.push(words.length); return 3; } } : s.charCodeAt(i); return words; }
function thrown(s, at) { const words = []; try { for (let i = 0; i < s.length; i++) words[i >> 2] |= i === at ? { valueOf() { throw words.length; } } : s.charCodeAt(i); } catch (length) { return length + " " + show(words); } return show(words); }
function inherited(s) { const words = [1]; Object.setPrototypeOf(words, { 2: 0x0f00, get 3() { return 0xf0; }, set 3(value) { log.push("set3 " + value); }, get 4() { return 1; }, set 4(value) { log.push("set " + value); } }); for (let i = 0; i < s.length; i++) words[i >> 2] |= (s.charCodeAt(i) & 255) << (i % 4 * 8); return words; }
function frozen(s) { const words = Object.freeze([1, 2]); try { for (let i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i); } catch (e) { return e.constructor.name + show(words); } return show(words); }
function into(words, s) { for (let i = 0; i < s.length; i++) words[i >> 2] |= (s.charCodeAt(i) & 255) << (i % 4 * 8); return words; }
function fractions(s) { const words = [0.5, 1e10, , "9"]; for (let i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i); return words; }
console.log(show(little(text)), show(little("")), show(little("ab")));
console.log(show(big(text)), show(big("")), show(big("ab")));
console.log(show(written(text)), show(written("abcdefgh")));
console.log(show(gaps(text)), show(down(text)), show(alternating(text)), show(stored(text)));
console.log(negative(text), show(inherited(text.slice(0, 25))), frozen(text), show(fractions(text)));
console.log(show(into([], text)), show(into([7], text)), show(into([0.5, 1e10], text)), show(into(["q", undefined], text)), show(into([, 5], text)));
for (const at of [-1, 0, 40, 43, 202]) console.log(show(valued(text, at)), thrown(text, at));
let sum = 0;
for (let n = 0; n < 300; n++) { const words = little(text.slice(n % 50)); sum = (sum * 31 + words[n % words.length] + words.length) | 0; }
console.log(sum, log.join());
