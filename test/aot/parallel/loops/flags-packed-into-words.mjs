// STATISTIC: UpdatedBitsReadPastEnd >= 6
// Bits are put into, taken out of and turned over in words of a list by the place they stand for: what is past the end of the list holds no bits, and the store appends it.
const show = list => Array.from(list, v => (v === undefined ? "_" : typeof v === "string" ? JSON.stringify(v) : String(v))).join(",") + "/" + list.length;
function put(words, places) { for (let n = 0; n < places.length; n++) { const place = places[n]; words[place >> 5] |= 1 << (place & 31); } return words; }
function turned(words, places) { for (let n = 0; n < places.length; n++) { const place = places[n] | 0; words[place >> 4] ^= 1 << (place & 15); } return words; }
function taken(words, places) { for (let n = 0; n < places.length; n++) { words[places[n] >> 5] &= ~(1 << (places[n] & 31)); } return words; }
function ranges(words, first, last) { for (let place = first; place < last; place++) words[place >> 5] |= 1 << (place & 31); return words; }
function wide(words, values, width) { for (let n = 0, at = 0; n < values.length; n++, at += width) words[at >> 5] |= values[n] << (at & 31); return words; }
function letters(words, text) { for (let n = 0; n < text.length; n++) words[n >> 2] |= (text.charCodeAt(n) & 63) << (18 - 6 * (n & 3)); return words; }
function everyOther(words, count) { for (let n = 0; n < count; n++) { if (n & 1) words[n >> 3] ^= n << (n & 7); else words[n >> 3] |= 1; } return words; }
function down(words, count) { for (let n = count - 1; n >= 0; n--) words[(count - 1 - n) >> 5] |= (n % 3 === 0 ? 1 : 0) << (n & 31); return words; }
const places = [0, 1, 31, 32, 33, 64, 70, 95, 96, 200, 5, 64, 31], near = Array.from({ length: 150 }, (_, i) => i * 2);
const ways = [["put", w => put(w, places)], ["near", w => put(w, near)], ["turned", w => turned(w, places)], ["taken", w => taken(w, places)], ["ranges", w => ranges(w, 3, 140)], ["wide", w => wide(w, [1, 7, 255, -1, 300, 5, 9, 2 ** 31, 1.75], 8)], ["letters", w => letters(w, "Words of six bits, four to each word.")], ["other", w => everyOther(w, 60)], ["down", w => down(w, 90)]];
for (const [name, way] of ways) {
  let last; for (let k = 0; k < 5; k++) last = way([]);
  console.log(name, show(last));
  console.log(name, show(way([0, 0, 0, 0, 0, 0, 0])), show(way([-1, 5])), show(way([1.5, 2 ** 33, NaN, -0])), show(way(["3", null, true, undefined])), show(way([, 1, , 2])));
  console.log(name, show(way(new Int32Array(4))), show(way(new Uint8Array(3))), show(way(new Array(3))), show(way(Object.assign([1], { name: 1 }))));
  const short = [1, 2, 3]; short.length = 1; console.log(name, show(way(short)));
  const object = way({ length: 2, 0: 1 }); console.log(name, JSON.stringify(object));
  for (const end of [Object.freeze, Object.seal, Object.preventExtensions]) { try { console.log(name, show(way(end([1, 2])))); } catch (error) { console.log(name, error.constructor.name); } }
}
// What lies on the way up answers for what is past the end.
class Words extends Array { get 3() { return 1 << 9; } set 3(v) { Words.stored = v; } }
console.log(show(ranges(Words.from([1]), 0, 120)), Words.stored);
console.log(show(put([1], [-1, -33, 3])), show(put([1], [0.5, 33.9, 2 ** 32 + 2])), show(put([0], ["32", true, null])));
try { put([1n], [0]); } catch (error) { console.log(error.constructor.name); }
