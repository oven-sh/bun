// STATISTIC: ElementPairsCopiedAsWords >= 4
var buffer, heap8, heap16, heapU16, heap32;
function initHeap() {
  buffer = new ArrayBuffer(4096);
  heap8 = new Int8Array(buffer);
  heap16 = new Int16Array(buffer);
  heapU16 = new Uint16Array(buffer);
  heap32 = new Int32Array(buffer);
}
function reset() {
  var x = 12345;
  for (var i = 0; i < heap32.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    heap32[i] = x;
  }
}
function hash() {
  var h = 0;
  for (var i = 0; i < heap32.length; i++) h = (Math.imul(h, 31) + heap32[i]) | 0;
  return h;
}
function exchange(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var a = heapU16[(p + -2) >> 1];
  var b = heapU16[p >> 1];
  var c = heapU16[(p + -4) >> 1];
  var d = heapU16[(p + -6) >> 1];
  heap16[(p + -2) >> 1] = d;
  heap16[p >> 1] = c;
  heap16[(p + -6) >> 1] = a;
  heap16[(p + -4) >> 1] = b;
  return a;
}
function overlapping(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var a = heap16[p >> 1];
  var b = heap16[(p + 2) >> 1];
  heap16[(p + 2) >> 1] = a;
  heap16[(p + 4) >> 1] = b;
  return (a - b) | 0;
}
function reversed(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var a = heapU16[p >> 1];
  var b = heapU16[(p + 2) >> 1];
  heap16[p >> 1] = b;
  heap16[(p + 2) >> 1] = a;
  return (a + b) | 0;
}
function upperFirst(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var q = (heap32[(sp >> 2) + 1] + 2) | 0;
  var b = heap16[(p + 2) >> 1];
  var a = heap16[p >> 1];
  heapU16[(q + 2) >> 1] = b;
  heapU16[q >> 1] = a;
  return (b * 3 + a) | 0;
}
function writtenBetween(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var q = (heap32[(sp >> 2) + 1] + 2) | 0;
  var a = heapU16[p >> 1];
  heap16[(q + 2) >> 1] = 77;
  var b = heapU16[(p + 2) >> 1];
  heap16[q >> 1] = a;
  heap16[(q + 2) >> 1] = b;
  return (a ^ b) | 0;
}
function readBetween(sp) {
  var p = (heap32[sp >> 2] + 2) | 0;
  var q = (heap32[(sp >> 2) + 1] + 2) | 0;
  var a = heapU16[p >> 1];
  var b = heapU16[(p + 2) >> 1];
  heap16[q >> 1] = a;
  var c = heapU16[(p + 2) >> 1];
  heap16[(q + 2) >> 1] = b;
  return c | 0;
}
function sink(sp) {
  var moves = 0;
  var p = (heap32[sp >> 2] + 2) | 0;
  while (true) {
    var bit = heap8[p + -6] & 1;
    var a = heapU16[(p + -2) >> 1];
    var b = heapU16[p >> 1];
    var c = heapU16[(p + -4) >> 1];
    var d = heapU16[(p + -6) >> 1];
    heap16[(p + -2) >> 1] = d;
    heap16[p >> 1] = c;
    heap16[(p + -6) >> 1] = a;
    heap16[(p + -4) >> 1] = b;
    moves = (moves + bit + 2) | 0;
    if (a >= heapU16[(p + -10) >> 1] || p < 24) return (moves + a) | 0;
    p = (p + -4) | 0;
  }
}
function place(p, q) {
  heap32[1000] = p;
  heap32[1001] = q;
}
function every(p, q) {
  var h = 0;
  place(p, q);
  h = (Math.imul(h, 33) + exchange(4000)) | 0;
  place(p, q);
  h = (Math.imul(h, 33) + overlapping(4000)) | 0;
  place(p, q);
  h = (Math.imul(h, 33) + reversed(4000)) | 0;
  place(p, q);
  h = (Math.imul(h, 33) + upperFirst(4000)) | 0;
  place(p, q);
  h = (Math.imul(h, 33) + writtenBetween(4000)) | 0;
  place(p, q);
  h = (Math.imul(h, 33) + readBetween(4000)) | 0;
  place((p + 300) | 0, q);
  h = (Math.imul(h, 33) + sink(4000)) | 0;
  return h;
}
initHeap();
for (var round = 0; round < 40; round++) {
  reset();
  var h = 0;
  for (var k = 0; k < 20; k++) {
    var p = 100 + ((k * 37 + round * 11) % 900) * 2;
    h = (Math.imul(h, 31) + every(p + (k & 1), k % 3 ? p + (k - 9) * 2 : 2400)) | 0;
  }
  if (round % 4 === 0) console.log(h, hash());
}
reset();
var ends = [0, 1, 2, 4, 6, 4090, 4092, 4094, 4096, 4098, -2, -4, 8192, 2147483640, -2147483648];
for (var k = 0; k < ends.length; k++) console.log(ends[k], every(ends[k], 64), every(64, ends[k]), hash());
