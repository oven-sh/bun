// STATISTIC: HalvesAddedAsWords >= 5
// Two words are added by their halves, the carry of the lower ones beside the upper ones: the sum of two words is one addition. Halves of other widths, carries that are lost and numbers that are no words stay as they are written.
let shown = 0;
const say = (...all) => { console.log(all.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(" ")); shown++; };
const words = [0, 1, -1, 0xffff, 0x10000, 0x7fffffff, -0x80000000, 0x12345678, -0x12345678, 0xfffe, 0x8000, -0x8000, 0x7fff8000];

// A checksum of words: the halves of the sum so far beside the halves of the next one.
function checksum(list) {
  let sum = 1;
  for (let i = 0; i < list.length; i++) {
    const low = (sum & 0xffff) + (list[i] & 0xffff);
    sum = ((sum >>> 16) + (list[i] >>> 16) + (low >>> 16)) << 16 | low & 0xffff;
  }
  return sum;
}
// A constant is added by its halves.
function stepped(word, turns) {
  for (let t = 0; t < turns; t++) {
    const low = (word & 0xffff) + 0x7c15, high = (low >> 16) + (word >> 16) + 0x1e37;
    word = (low & 0xffff) | (high << 16);
  }
  return word;
}
function eachBeside(left, right, sums) {
  for (let i = 0; i < left.length; i++) {
    const a = left[i] | 0, b = right[i] | 0, low = (b & 0xffff) + (a & 0xffff);
    sums[i] = (low & 0xffff) | (((a >> 16) + (low >>> 16) + (b >> 16)) << 16);
  }
  return sums;
}
class Clock {
  constructor(now) { this.now = now; }
  after(ticks) {
    const low = (this.now & 0xffff) + (ticks & 0xffff), carry = low >> 16;
    this.now = ((this.now >> 16) + (ticks >> 16) + carry) << 16 | (low & 0xffff);
    return this;
  }
}
for (const a of words) { say(checksum([a, 5, -7, a]), stepped(a, 1), stepped(a, 9)); }
say(eachBeside(words, words.slice().reverse(), []).join());
say(eachBeside(Int32Array.from(words), Int32Array.from(words).reverse(), new Int32Array(words.length)).join());
for (const t of words) say(new Clock(77).after(t).after(t).now);
// Looks like it and is not: fifteen bits, a carry of another sum, no carry, a sum that is no word.
function fifteen(a, b) { const low = (a & 0x7fff) + (b & 0x7fff); return ((a >> 15) + (b >> 15) + (low >> 15)) << 15 | low & 0x7fff; }
function lost(a, b) { const low = (a & 0xffff) + (b & 0xffff); return ((a >> 16) + (b >> 16)) << 16 | low & 0xffff; }
function other(a, b, c) { const low = (a & 0xffff) + (b & 0xffff), off = (a & 0xffff) + (c & 0xffff); return ((a >> 16) + (b >> 16) + (off >> 16)) << 16 | low & 0xffff; }
function whole(a, b) { const low = (a & 0xffff) + (b & 0xffff); return ((a >> 16) + (b >> 16) + (low >> 16)) * 65536 + (low & 0xffff); }
for (let k = 0; k < 3; k++) for (const a of words) say(fifteen(a, k), lost(a, 0xffff), other(a, 0xffff, k), whole(a, 0x10001), whole(a, -k));
for (const odd of [2 ** 40 + 3, 1.75, -1.5, NaN, Infinity, "12", null, undefined, true, 2 ** 31]) say(checksum([odd, 1]), stepped(odd, 2), eachBeside([odd], [0xffff], [])[0], new Clock(odd).after(0xffff).now);
let order = ""; const loud = n => ({ valueOf() { order += n; return n; } });
say(new Clock(loud(1)).after(loud(2)).now, order); try { checksum([1n]); } catch (error) { say(error.constructor.name); }
say(shown);
