// Only the low bits of a remainder by a power of two are taken: as many bits as the power leaves, fewer, more. The dividend is any number.
const show = value => (Object.is(value, -0) ? "-0" : String(value));
const dividends = [0, -0, 1, -1, 127, 128, 255, 256, 257, -127, -128, -129, -256, -257, 65535, 65536, -65537, 1023.75, -1023.75, 0.5, -0.5, 2147483647, 2147483648, -2147483649, 4294967295, 4294967296, -4294967297, 9007199254740991, 9007199254740992, -9007199254740993, 2 ** 53 + 4, 2 ** 60 + 2 ** 9, 2 ** 62, 2 ** 63, -(2 ** 63), 2 ** 63 + 2 ** 11, 2 ** 64, 1e21, -1e21, 2 ** 80, 1e300, Number.MAX_VALUE, 5e-324, NaN, Infinity, -Infinity];
function bytes(start, view) {
  for (let index = 0; index < view.length; index++) view[index] = (start + index) % 256;
  return view.join();
}
function bytesBeyond(start, view) {
  for (let index = 0; index < view.length; index++) view[index] = (start - index) % 65536;
  return view.join();
}
function bytesBelow(start, view) {
  for (let index = 0; index < view.length; index++) view[index] = (start * (index + 1)) % 128;
  return view.join();
}
function words(start, view) {
  for (let index = 0; index < view.length; index++) view[index] = (start + index) % 4294967296;
  return view.join();
}
function integers(start) {
  let sum = 0;
  for (let index = 0; index < 4; index++) {
    sum ^= (start + index) % 4294967296 | 0;
    sum += ((start - index) % 4294967296) >>> 1;
    sum ^= ~((start * index) % 4294967296);
    sum ^= (start + index) % 2147483648 | 0;
    sum += ((start + index) % 8589934592) & 255;
  }
  return sum;
}
function unsigned(start) {
  let text = "";
  for (let index = 0; index < 3; index++) text += (((start + index) % 4294967296) >>> 0) + " " + (((start + index) % 65536) >>> 0) + " ";
  return text;
}
function counted(limit) {
  const view = new Uint8Array(limit);
  let counter = 1;
  for (let round = 0; round < 3; round++) {
    counter++;
    for (let index = 0; index < limit; ++index) view[index] = (index + counter) % 256;
    counter *= 1.5;
  }
  return view.join();
}
for (const dividend of dividends) {
  console.log(show(dividend), "|", bytes(dividend, new Uint8Array(4)), bytes(dividend, new Int8Array(4)), bytes(dividend, new Uint8ClampedArray(4)), bytes(dividend, new Int16Array(3)), bytes(dividend, new Float32Array(2)), "|", bytesBeyond(dividend, new Uint8Array(3)), bytesBeyond(dividend, new Uint16Array(3)), bytesBeyond(dividend, new Int16Array(3)), bytesBeyond(dividend, new Int32Array(3)), "|", bytesBelow(dividend, new Uint8Array(3)), bytesBelow(dividend, new Int8Array(3)), "|", words(dividend, new Uint32Array(3)), words(dividend, new Int32Array(3)), words(dividend, new Int8Array(3)), words(dividend, new Float64Array(2)), "|", integers(dividend), "|", unsigned(dividend));
}
console.log(counted(300));
