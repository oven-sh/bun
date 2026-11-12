// An untyped package and a program of it (texts): text packed by prefix codes, by dictionaries and by runs; all three unpacked again
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const texts = ['', 'a', 'aaaa', 'abracadabra', 'TOBEORNOTTOBEORTOBEORNOT', 'the rain in spain falls mainly on the plain, the rain in spain', 'x'.repeat(70) + 'yx', 'é and ü: éüéü', '01'.repeat(30), 'mississippi river ' + 'mississippi']; for (let n = 0; n < 3; n++) texts.forEach((t, i) => { t = n ? t + t.slice(0, n * 5) : t; const h = lib.huffman(t), l = lib.lzw(t), z = lib.lz77(t), r = lib.rle(t), b = lib.bwt(t); say(n, i, h.bits.bytes.length, h.bits.n, [...h.codes].slice(0, 6).map(c => c.join('')).join(), lib.unhuffman(h) === t, l.length, l.slice(0, 8).join(), lib.unlzw(l) === t, JSON.stringify(z.slice(0, 12)), lib.unlz77(z) === t, r.length, lib.unrle(r) === t, JSON.stringify(b.slice(0, 20)), lib.unbwt(b) === t); }); try { lib.unlzw([65, 999]); } catch (e) { say(e.message); } say(lib.mtf('bananaaa').join(), lib.mtf(lib.bwt('abracadabra')).join());
