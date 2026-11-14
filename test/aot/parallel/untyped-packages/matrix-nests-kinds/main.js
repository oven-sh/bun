// An untyped package and a program of it (kinds): rows as arrays, as typed arrays, flat; in-place transposes, determinants, convolution
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var types = [null, Float64Array, Int32Array, Uint8Array, null, Float32Array, Array, Int8Array];
for (var n = 2; n < 12; n++) { var T = types[n % types.length], a = lib.zeros(n, n, T === Array ? null : T), b = lib.zeros(n, n); for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { a[i][j] = (i * 7 + j * 3) % 11 - 2; b[i][j] = n % 3 ? i - j : (i + 1) / (j + 2); } var p = lib.multiply(a, b, T === Array ? null : T); say(n, T ? T.name : 'plain', lib.checksum(p), lib.determinant(b).toFixed(4), lib.checksum(lib.transpose(a)), lib.spiral(a).slice(0, 9).join(), lib.checksum(lib.multiply(p, a))); }
