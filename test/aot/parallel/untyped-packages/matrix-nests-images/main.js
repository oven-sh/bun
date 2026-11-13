// An untyped package and a program of it (images): rows as arrays, as typed arrays, flat; in-place transposes, determinants, convolution
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (var k = 0; k < 9; k++) { var w = 5 + k, h = 4 + k % 3, I = [Float64Array, Uint8Array, Int16Array, Uint8ClampedArray, Array][k % 5], img = new I(w * h); for (var i = 0; i < w * h; i++) img[i] = (i * i + k) % 37 + (k % 2 ? 0.5 : 0); var kernels = [[0, 1, 0, 1, -4, 1, 0, 1, 0], [1, 2, 1, 2, 4, 2, 1, 2, 1], [0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1], [1]]; kernels.forEach(function (q, n) { var out = lib.convolve(img, w, h, q); var s = 0; for (var i = 0; i < out.length; i++) s += out[i] * (i % 7 + 1); say(k, n, I.name, s.toFixed(3), Array.prototype.slice.call(out, 0, 6).map(function (x) { return +x.toFixed(2); }).join()); }); }
