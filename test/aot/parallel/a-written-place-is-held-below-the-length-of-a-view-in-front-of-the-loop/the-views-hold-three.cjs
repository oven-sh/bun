'use strict';
(function () {
  function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; }
  function scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  exports.add = add; exports.scale = scale; exports.dot = dot;
  Object.defineProperty(exports, 'version', { enumerable: true, get: function () { return 1; } });
})();
function keep(e) { return e; }
keep(exports);
const N = module.exports;
const out = new Float64Array(3), one = new Float64Array([1.5, 2.5, 3.5]), other = new Float64Array([0.5, 0.25, 4]);
function run(from) {
  one[0] = from & 7;
  let sum = 0;
  for (let i = 0; i < 100; i++) { N.add(out, one, other); N.scale(out, out, 0.5); sum += N.dot(out, one); }
  return sum;
}
globalThis.kept = run;
for (let turn = 0; turn < 4; turn++) console.log(run(turn));
