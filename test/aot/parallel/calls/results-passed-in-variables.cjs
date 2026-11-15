// STATISTIC: CallsInlined >= 4
var buffer = new ArrayBuffer(65536);
var heapFloat = new Float32Array(buffer);
var heap32 = new Int32Array(buffer);
var r_g0 = 0;
var f_g0 = 0;
function root(sp) {
  var value = heapFloat[sp >> 2];
  f_g0 = Math.sqrt(value);
}
function length2(sp) {
  var fp = sp >> 2;
  var r0 = heap32[fp] >> 2;
  var f0 = heapFloat[r0];
  var f1 = heapFloat[r0 + 1];
  f_g0 = f0 * f0 + f1 * f1;
}
function field(sp) {
  r_g0 = heap32[(heap32[sp >> 2] >> 2) + 2];
}
function normalize(sp) {
  var i7 = (sp - 16) | 0;
  var g0 = i7 >> 2;
  var r0 = heap32[sp >> 2];
  heap32[g0] = r0;
  length2(i7);
  var f0 = f_g0;
  heapFloat[g0] = f0;
  root(i7);
  f0 = 1 / f_g0;
  var r1 = r0 >> 2;
  heapFloat[r1] = heapFloat[r1] * f0;
  heapFloat[r1 + 1] = heapFloat[r1 + 1] * f0;
  heap32[g0] = r0;
  field(i7);
  heap32[r1 + 2] = (r_g0 + 1) | 0;
  f_g0 = f0;
}
function steps(sp, count) {
  for (var k = 0; k < count; k++) {
    heap32[(sp - 32) >> 2] = 1024 + (k % 100) * 12;
    normalize((sp - 32) | 0);
  }
}
for (var k = 0; k < 400; k++) heapFloat[256 + k] = (k * 7919) % 101 - 50;
for (var k = 0; k < 100; k++) heap32[256 + k * 3 + 2] = k;
for (var round = 0; round < 30; round++) {
  steps(32768, 100);
  if (round === 20) heapFloat[300] = 1e-30;
  if (round === 25) heapFloat[303] = -0;
}
var h = 0;
for (var k = 0; k < 400; k++) h = (Math.imul(h, 31) + heap32[256 + k]) | 0;
console.log(h, f_g0, r_g0, heapFloat[258], heapFloat[300], heap32[302]);
[-4, 65534, 65536, 1e9].forEach(function (sp) { root(sp); console.log(f_g0); length2(sp); console.log(f_g0); });
