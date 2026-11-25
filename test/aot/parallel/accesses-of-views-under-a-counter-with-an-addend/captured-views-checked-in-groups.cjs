// Accesses to a view in a captured variable, at constant distances from one number, are checked once. Where the check fails they run as written.
// STATISTIC: ViewAccessGroupsChecked >= 4
const make = function (global, buffer) {
  var bytes = new global.Int8Array(buffer);
  var halves = new global.Uint16Array(buffer);
  var words = new global.Int32Array(buffer);
  var calls = 0;
  function between(index) {
    calls++;
    if (index === 5) structuredClone(buffer, { transfer: [buffer] });
  }
  function step(p, q) {
    p = p | 0;
    q = q | 0;
    var x = 0, y = 0, k = 0;
    k = p + 8 | 0;
    words[p >> 2] = (words[k >> 2] | 0) + 1 | 0;
    words[p + 4 >> 2] = words[(p + 12 | 0) >> 2] | 0;
    words[k + 8 >> 2] = words[p + 2 >> 2] | 0;
    x = (bytes[q + 1 | 0] | 0) + (bytes[q + 2 | 0] | 0) + (bytes[(q + 1 | 0) + 2 | 0] | 0) | 0;
    y = (halves[p + 2 >> 1] | 0) + (halves[p + 4 >> 1] | 0) + (halves[p - 2 >> 1] | 0) | 0;
    return x + "," + y;
  }
  function chain(p, count) {
    p = p | 0;
    count = count | 0;
    var x = 0, i = 0;
    do {
      x = (words[p + 4 >> 2] | 0) + (words[p + 8 >> 2] | 0) + (words[p + 12 >> 2] | 0) + x | 0;
      words[p + 16 >> 2] = x;
      if (x >>> 0 > 100) words[p + 4 >> 2] = i;
      between(i);
      i = i + 1 | 0;
    } while ((i | 0) != (count | 0));
    return x;
  }
  return { step, chain, show: () => words.length + ":" + Array.prototype.slice.call(words, 0, 16).join() + " " + calls };
};
const made = make({ Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array }, new ArrayBuffer(64));
for (let index = 0; index < 16; index++) console.log(made.step(index * 4, index + 3), made.show());
for (const [p, q] of [[0, -2], [-4, -3], [-8, 60], [52, 62], [60, 63], [2, 2147483646], [2147483640, 2147483647], [2147483647, -2147483648], [-2147483648, 0], [3, 5]]) console.log(p, q, made.step(p, q), made.show());
console.log(made.chain(8, 4), made.show(), made.chain(44, 4), made.show(), made.chain(-8, 3), made.show());
console.log(made.chain(8, 12), made.show(), made.step(4, 4), made.show());
const growing = make({ Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array }, new ArrayBuffer(32, { maxByteLength: 64 }));
console.log(growing.step(0, 2), growing.step(16, 30), growing.show());
