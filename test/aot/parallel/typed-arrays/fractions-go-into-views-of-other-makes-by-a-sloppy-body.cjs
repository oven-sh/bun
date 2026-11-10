// No "use strict": the other form of the stub. Fractions and integers go through a function that knows nothing into views that begin in the middle of a buffer, lie on a shared buffer, follow a buffer that is resized, are detached, or are of a class below; the bytes on both sides of each view stay as they were.
// COUNT: operation:operationAOTPutByVal <= 100
var z = JSON.parse("0"), any = function (x) { return [x][z]; }, put = function (v, i, x) { v[i] = x; }, out = [];
var values = [0.5, 1.5, 2.5, -0.5, -1.5, 127.5, 128.5, 254.5, 255.5, 256.5, 300, -300, 32767.5, 32768.5, 65535.5, 65536.5, 2147483647.5, 2147483648.5, 4294967295.5, 4294967296.5, -2147483648.5, -2147483649.5, 1e10 + 0.5, -1e10 - 0.5, 9007199254740991, 1e19, -1e19, NaN, Infinity, -Infinity, -0, 5e-324];
var kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array];
for (var k = 0; k < kinds.length; k++) {
  var C = kinds[k], size = C.BYTES_PER_ELEMENT, whole = new ArrayBuffer(8 * size), all = new Uint8Array(whole); all.fill(170);
  var middle = new C(whole, 2 * size, 3), line = [];
  for (var n = 0; n < values.length; n++) { put(any(middle), any(n % 3), any(values[n])); line.push(middle[n % 3]); put(any(middle), any(3), any(values[n])); put(any(middle), any(-1), any(values[n])); }
  out.push(line.join(), Array.from(all.subarray(0, 2 * size)).join(""), Array.from(all.subarray(5 * size)).join(""));
  var shared = new C(new SharedArrayBuffer(4 * size)); for (n = 0; n < 12; n++) put(any(shared), any(n & 3), any(values[n] * 3)); out.push(Array.from(shared).join());
  var grows = new ArrayBuffer(2 * size, { maxByteLength: 6 * size }), follows = new C(grows); for (n = 0; n < 6; n++) { if (n === 2) grows.resize(5 * size); if (n === 4) grows.resize(3 * size); put(any(follows), any(n), any(values[n] + 7)); } out.push(Array.from(follows).join());
  var leaves = new C(4); structuredClone(leaves.buffer, { transfer: [leaves.buffer] }); put(any(leaves), any(0), any(1.5)); out.push(leaves.length);
  var Below = class extends C {}, below = new Below(3); for (n = 0; n < 9; n++) put(any(below), any(n % 3), any(values[n + 5])); out.push(Array.from(below).join());
}
var h = 7; for (var i = 0; i < out.length; i++) for (var c of String(out[i])) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; console.log(out.length, h, out.slice(14, 17).join(" | "));
