// The position of a read is a number that no iteration changes: it is checked for an int32 in a loop that is unrolled.
const make = function (types) {
  const buffer = new SharedArrayBuffer(64);
  const bytes = new types.Uint8ClampedArray(buffer, 8, 3);
  let words = new types.Uint32Array(buffer, 0);
  let calls = 0;
  function change(n) { calls++; if (n === 20) { try { buffer.resize(16); } catch { } } if (n === 3) words = [1, 2, 3]; }
  function read(n, position, stored) {
    let sum = 0, bits = 0, i = 0;
    do {
      for (let j = 0; j < 3; j++) { bits = words[position] | 0; sum = sum + (+bytes[i] || 0); }
      if (i == 3) { words[stored] = i; sum = sum + (+words[i & 7] || 0); } else change(i);
      i = i + 1 | 0;
    } while ((i | 0) != (n | 0));
    return sum + "," + bits;
  }
  return { read, dump() { return calls + ":" + bytes.length + ":" + Array.prototype.slice.call(words, 0, 12).join(); } };
};
const lists = make({ Uint32Array: Uint32Array, Uint8ClampedArray: Uint8ClampedArray });
console.log(lists.read(40, 1.5, 1));
for (let k = 0; k < 9; k++) console.log(lists.read(25, 1, 2), lists.read(7, k, k & 3), lists.read(5, k - 4, 0), lists.read(5, 4294967296 + k, 1));
console.log(lists.read(9, -0, 1), lists.read(9, NaN, 1), lists.read(9, 2147483648, 1), lists.dump());
