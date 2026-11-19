// Remainders of which only the low word is taken: the dividend is an integer, a fraction, -0, negative, beyond 2 ** 53, infinite or no number.
const show = value => (Object.is(value, -0) ? "-0" : String(value));
const dividends = [0, -0, 1, -1, 255, 256, 257, -256, -257, 1023.75, -1023.75, 0.5, -0.5, 2147483647, 2147483648, -2147483648, 4294967295, 4294967296, -4294967297, 9007199254740991, 9007199254740993, -9007199254740991, 1e17, 1e21, -1e21, 2 ** 63, -(2 ** 63), 1e300, NaN, Infinity, -Infinity];

function bytes(start, step, count) {
  const view = new Uint8Array(count);
  let value = start;
  for (let index = 0; index < count; ++index) view[index] = (index + value) % 256;
  return view.join() + " " + show(value + step);
}
function words(start, divisor) {
  const view = new Int16Array(12);
  for (let index = 0; index < 12; index++) view[index] = (start - index) % divisor;
  return view.join();
}
function clamped(start) {
  const view = new Uint8ClampedArray(6), floats = new Float32Array(6);
  for (let index = 0; index < 6; index++) {
    view[index] = (start + index) % 300;
    floats[index] = (start + index) % 300;
  }
  return view.join() + " " + floats.join();
}
function bitwise(start, divisor) {
  let sum = 0;
  for (let index = 0; index < 5; index++) {
    sum ^= (start + index) % 256 | 0;
    sum += ~((start * index) % 1000);
    sum = (sum + (((start + index) % divisor) >>> 1)) | 0;
    sum ^= ((index - start) % 65536) & 4095;
  }
  return sum;
}
function unsigned(start) {
  let sum = 0;
  for (let index = 0; index < 4; index++) sum += ((start + index) % 4294967296) >>> 0;
  return sum;
}
function kept(start) {
  let text = "";
  for (let index = 0; index < 3; index++) {
    const rest = (start + index) % 256;
    text += show(rest) + "/" + (rest | 0) + " ";
  }
  return text;
}
function stored(start, view) {
  for (let index = 0; index < 20; index++) view[index] = (index * start) % 251;
  return view.join();
}
for (const dividend of dividends) {
  console.log(show(dividend), bytes(dividend, 1, 5), "|", words(dividend, 1000), "|", clamped(dividend), "|", bitwise(dividend, 7), bitwise(dividend, -7), bitwise(dividend, 0.75), "|", unsigned(dividend), "|", kept(dividend), "|", stored(dividend, new Int8Array(8)), stored(dividend, new Uint32Array(4)), stored(dividend, new Float64Array(3)), stored(dividend, [1, 2]));
}
function* contents() {
  let counter = 1;
  while (true) {
    const size = ((counter * 1192.18851371) | 0) % 64;
    counter++;
    const view = new Uint8Array(size);
    for (let index = 0; index < size; ++index) view[index] = (index + counter) % 256;
    yield view;
  }
}
let hash = 0, number = 0;
for (const view of contents()) {
  for (const byte of view) hash = (hash * 31 + byte) | 0;
  if (++number === 300) break;
}
console.log(hash);
