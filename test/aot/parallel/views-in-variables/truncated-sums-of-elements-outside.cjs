// Sums of a few elements of views, some of which lie outside, cut to 32 bits.
var words, bytes, floats;
function init() {
  words = new Int32Array([2147483647, -2147483648, -1, 7, 0, 123456789]);
  bytes = new Uint8Array([250, 3, 0, 255]);
  floats = new Float32Array([0.5, NaN, 3e9]);
}
function two(i, j) { return (words[i] + words[j]) | 0; }
function less(i, j) { return (words[i] - words[j]) | 0; }
function three(i, j, k) { return (words[i] + words[j] + words[k]) | 0; }
function mixed(i, j, k) { return (words[i] - bytes[j] + words[k] + 5) | 0; }
function grouped(i, j, k) { return (words[i] - (bytes[j] - words[k])) ^ 3; }
function negated(i, j) { return (0 - words[i] - words[j]) >> 1; }
function unsigned(i, j) { return (words[i] + words[j]) >>> 0; }
function twice(i) { return (words[i] + words[i]) | 0; }
function kept(i, j) { var sum = words[i] + words[j]; return [sum | 0, sum]; }
function text(i, j) { return ("" + words[i] + words[j]) | 0; }
function fraction(i, j) { return (floats[i] + words[j] + words[i]) | 0; }
function changed(i, value) { words[i] = value; return (words[i] + words[i + 1] + bytes[i]) | 0; }
init();
var said = [];
for (var i = -1; i < 8; i++) {
  for (var j = -1; j < 8; j += 2) {
    said.push(two(i, j), less(i, j), three(i, j, i + 1), mixed(i, j, j), grouped(i, j, i), negated(i, j), unsigned(i, j), twice(i), kept(i, j).join("/"), text(i, j), fraction(i, j), changed(i, i * 1000003));
  }
}
console.log(said.join(" "));
