var buffer, heap32, heapFloat, heapU16;
function initHeap() {
  buffer = new ArrayBuffer(8192);
  heap32 = new Int32Array(buffer);
  heapFloat = new Float32Array(buffer);
  heapU16 = new Uint16Array(buffer);
}
function reset() {
  var x = 777;
  for (var i = 0; i < heap32.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    heap32[i] = x >> 8;
  }
}
function hash() {
  var h = 0;
  for (var i = 0; i < heap32.length; i++) h = (Math.imul(h, 31) + heap32[i]) | 0;
  return h;
}
function twoBeside(sp) {
  var r = heap32[sp >> 2] >> 2;
  var a = heap32[r + 3];
  heap32[r + 1] = (a + 1) | 0;
  return a;
}
function below(sp) {
  var r = heap32[sp >> 2] >> 2;
  var a = heap32[r - 2];
  var b = heap32[r - 5];
  heap32[r - 3] = (a ^ b) | 0;
  return (a + b) | 0;
}
function fractions(sp) {
  var r = heap32[sp >> 2] >> 2;
  var f0 = heapFloat[r + 4] + heapFloat[r];
  var f1 = heapFloat[r + 5] + heapFloat[r + 1];
  heapFloat[r + 8] = f0 * 0.5;
  heapFloat[r + 9] = f1 * 0.5;
  return heap32[r + 8] >> 20;
}
function halves(sp) {
  var r = heap32[sp >> 2] >> 1;
  heapU16[r + 24] = (heapU16[r + 24] + 1) | 0;
  heapU16[r + 27] = (heapU16[r + 27] - 1) | 0;
  return heapU16[r + 26];
}
function every(p) {
  var h = 0;
  heap32[2000] = p;
  h = (Math.imul(h, 33) + twoBeside(8000)) | 0;
  heap32[2000] = p;
  h = (Math.imul(h, 33) + below(8000)) | 0;
  heap32[2000] = p;
  h = (Math.imul(h, 33) + halves(8000)) | 0;
  heap32[2000] = p;
  heap32[(p >> 2) + 0] = 1065353216;
  heap32[(p >> 2) + 1] = 1073741824;
  heap32[(p >> 2) + 4] = 1082130432;
  heap32[(p >> 2) + 5] = -1082130432;
  h = (Math.imul(h, 33) + fractions(8000)) | 0;
  return h;
}
initHeap();
reset();
for (var k = 0; k < 60; k++) if (k % 5 === 0) console.log(every(64 + k * 120), hash()); else every(64 + k * 120);
reset();
var ends = [0, 4, 8, 12, 20, 8188, 8184, 8180, 8172, 8160, 8192, -4, -8, -20, 2147483644, -2147483648];
for (var k = 0; k < ends.length; k++) console.log(ends[k], every(ends[k]), hash());
