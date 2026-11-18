// A view in a captured variable is tested, and its length and its vector are read, once for the accesses behind each other.
// STATISTIC: VectorsOfViewsRead >= 5
const make = function (global) {
  let buffer = new SharedArrayBuffer(64);
  let calls = 0;
  let words = new global.Uint32Array(buffer, 0, 4);
  function between(index) {
    calls++;
    if (index === 4) words[2] = 77;
    if (index === 4) {
      try {
        buffer.grow(128);
      } catch {}
    }
  }
  function store(count) {
    var sum = 0, last = 0;
    for (var index = 0; index < count; index++) {
      words[0] = (words[index & 7] | 0) + 1;
      words[index] = 1e10;
      between(index);
    }
    return sum + "," + last;
  }
  function mix(count, first, half) {
    var sum = 0, last = 0;
    var index = 0;
    do {
      between(index);
      if (words[last + 2] > 2) {
        words[index & 7] = 300;
        sum = sum + (+words[first - index] || 0);
      } else {
        sum = sum + (+words[index - 1] || 0);
      }
      try {
        between(index);
        if (index == 5) throw 1;
        sum = sum + (+words[0] || 0);
      } catch (error) {
        words[0] = undefined;
      }
      words[half] = index * 0.5;
      sum += words.length;
      index = (index + 1) | 0;
    } while ((index | 0) != (count | 0));
    return sum + "," + last;
  }
  return { store, mix, show: () => words.length + ":" + Array.prototype.slice.call(words, 0, 12).join() + " " + calls };
};
const made = make({ Uint32Array: Uint32Array });
console.log(made.store(9), made.show(), made.mix(9, 2, 3), made.show());
for (let round = 0; round < 30; round++) made.store(25);
console.log(made.mix(40, -1, 1), made.show());
