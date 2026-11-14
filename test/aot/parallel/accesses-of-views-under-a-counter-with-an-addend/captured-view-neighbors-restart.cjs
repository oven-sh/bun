// Many neighbors in a view of a captured variable are checked once in an iteration that could restart.
// STATISTIC: ViewAccessGroupsChecked >= 2
const make = function (global, buffer) {
  var bytes = new global.Uint8Array(buffer);
  var words = new global.Int32Array(buffer);
  var calls = 0;
  function between(index) {
    calls++;
    if (index === 5) structuredClone(buffer, { transfer: [buffer] });
  }
  function chain(p, count) {
    p = p | 0;
    count = count | 0;
    var x = 0, i = 0;
    do {
      x = (words[p + 4 >> 2] | 0) + (words[p + 8 >> 2] | 0) + (words[p + 12 >> 2] | 0) + (words[p + 20 >> 2] | 0) + x | 0;
      bytes[i] = x;
      between(i);
      i = i + 1 | 0;
    } while ((i | 0) != (count | 0));
    return x;
  }
  return { chain, fill() { for (var i = 0; i < 16; i++) words[i] = Math.imul(i, 2654435761); }, show: () => words.length + ":" + Array.prototype.slice.call(words, 0, 16).join() + " " + calls };
};
const made = make({ Uint8Array: Uint8Array, Int32Array: Int32Array }, new ArrayBuffer(64));
made.fill();
console.log(made.chain(8, 4), made.show(), made.chain(44, 4), made.show(), made.chain(-8, 3), made.chain(2147483640, 2), made.chain(2, 3), made.show());
console.log(made.chain(8, 12), made.show());
const growing = make({ Uint8Array: Uint8Array, Int32Array: Int32Array }, new ArrayBuffer(32, { maxByteLength: 64 }));
growing.fill();
console.log(growing.chain(0, 4), growing.chain(16, 3), growing.show());
