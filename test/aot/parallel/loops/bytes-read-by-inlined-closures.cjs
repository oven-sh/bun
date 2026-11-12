// A closure inlined into a loop reads elements of a value that nobody proves: bytes in one call, an array, a string, an object in others. The loop does not speculate that it is an array.
// STATISTIC: InlineeRowsSpeculatedAsArrays = 0
const escaped = {};
function block(data, start, size) { return typeof data.subarray === "function" ? data.subarray(start, start + size).length : data.length; }
escaped.hashes = function (data, level, state) {
  const length = state.end || data.length;
  const mask = (1 << level) - 1;
  const previous = state.previous || new Uint16Array(64), head = state.head || new Uint16Array(mask + 1);
  const first = Math.ceil(level / 3), second = 2 * first;
  const hash = function (i) { return (data[i] ^ (data[i + 1] << first) ^ (data[i + 2] << second)) & mask; };
  let found = 0, sum = 0, i = state.start || 0;
  for (; i + 2 < length; ++i) {
    const value = hash(i);
    const place = i & 63, last = head[value];
    previous[place] = last;
    head[value] = place;
    if (found > 900) {
      found -= block(data, i, 16);
      for (let j = 0; j < 8; ++j) previous[j] = 0;
    }
    let distance = (place - last) & 63;
    if (length - i > 2 && value == hash(i - distance)) {
      const farthest = Math.min(63, i);
      let chain = 4;
      while (distance <= farthest && --chain && place != last) {
        if (data[i] == data[i - distance]) found += distance;
        distance += ((previous[(i - distance) & 63]) & 31) + 1;
      }
    }
    sum = (sum * 31 + value) | 0;
  }
  return [found, sum, previous[5]].join();
};
const [name] = JSON.parse('["hashes"]');
const call = escaped[name];
const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * i + (i >> 3)) % 17);
for (let i = 0; i < 5; i++) console.log(call(bytes, 6, { start: i }), call(bytes.subarray(i, 50), 8, {}));
console.log(call([...bytes], 6, {}), call(Array.from(bytes, b => b + 0.5), 7, { start: 1 }), call([...bytes].map(String), 6, { start: 2 }));
console.log(call("a string is read by its characters", 6, {}), call({ length: 9, 0: 1, 1: 2, 3: 7, 5: -1 }, 6, {}));
console.log(call(new Float64Array([1.5, 2, NaN, -0, 2 ** 31, 2 ** 53, 1.5, 2, NaN]), 6, {}), call([1, , 3, , 5, , 1, , 3, , 5], 6, {}));
const changing = [...bytes.subarray(0, 40)];
Object.defineProperty(changing, 20, { get() { changing.length = 30; return 4; } });
console.log(call(changing, 6, {}), changing.length);
try { console.log(call({ length: 5, get 3() { throw new RangeError("third"); } }, 6, {})); } catch (error) { console.log(error.message); }
const buffer = new ArrayBuffer(64, { maxByteLength: 128 }), tracking = new Uint8Array(buffer);
tracking.set(bytes.subarray(0, 64));
console.log(call(tracking, 6, {})); buffer.resize(32); console.log(call(tracking, 6, { end: 60 })); buffer.resize(128); console.log(call(tracking, 6, {}));
if (typeof buffer.transfer === "function") { buffer.transfer(); console.log(call(tracking, 6, { end: 9 })); }
