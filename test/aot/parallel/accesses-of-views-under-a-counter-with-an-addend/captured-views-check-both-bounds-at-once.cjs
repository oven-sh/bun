// Where an iteration may restart, one comparison shows that a position is neither negative nor past the view.
// STATISTIC: PositionsCheckedAtOnce >= 4
(function () {
var buffer = new ArrayBuffer(4096);
var w32 = new Int32Array(buffer);
var u32 = new Uint32Array(buffer);
var b8 = new Int8Array(buffer);
var h16 = new Int16Array(buffer);
var u16 = new Uint16Array(buffer);
var log = [], seed = 5;
for (var i = 0; i < 4096; i++) {
    seed = seed * 1103515245 + 12345 & 2147483647; new Uint8Array(buffer)[i] = seed >> 16; }
function f0(p, q, x, m, n) {
    p = p | 0; q = q | 0;
    x = x | 0; m = m | 0; n = n | 0; var s = 0, t = 1, y = x & 63, k = 0;
    for (; n; n = n - 1 | 0) {
    w32[x & 31] = 171;
    s = s * 3 + (w32[(((x) << 2) + (((u16[p & 7] | 0) | 0)) | 0) >> 2] | 0) | 0;
    u16[((q) + ((t) << 1)) >> 1] = x;
    for (k = 0; k < 4; k = k + 1 | 0) {
    if ((h16[(((((x) << 1) + ((16)) | 0)) >> 1) | 0] | 0) == s) {
    s = s * 3 + (u16[(((x & m) << 2) + (p + q | 0)) >> 2] | 0) | 0; } else {
    s = s * 3 + (u32[(((y & 31) << 2) + ((q)) | 0) >> 2] | 0) | 0; } t = u32[(((p + q | 0 | 0)) + ((y) << 2)) >> 2] | 0;
    s = s * 3 + (h16[((x + 1) << 31) + ((p - 4 | 0 | 0)) >> 1] | 0) | 0; } x = x + 2 | 0; } return s + t | 0; }
function f1(p, q, x, m, n) {
     var s = 0, t = 1, y = x & 63, k = 0;
    while ((n = n - 1 | 0) >= 0) {
    u32[(((-1) << 2) + ((0)) | 0) >> 2] = s;
    h16[((y & 31) << 4) + ((w32[1] | 0)) + 4 >> 1] = y;
    x = x + q | 0; } return s + t | 0; }
function f2(p, q, x, m, n) {
    p = p | 0; q = q | 0;
    x = x | 0; m = m | 0; n = n | 0; var s = 0, t = 1, y = x & 63, k = 0;
    while ((n = n - 1 | 0) >= 0) {
    s = s * 3 + (w32[(((((u16[y & 7]) << 2) + ((p)) | 0)) >> 2) | 0] | 0) | 0;
    for (k = 0; k < 4; k = k + 1 | 0) {
    if ((u16[(((y & 31) << 1) + (q)) >> 1] | 0) < 0) {
    s = s * 3 + (u16[((((t) << 1) + (p + 8 | 0)) >> 1) | 0] | 0) | 0;
    s = s * 3 + (u32[(((((-1) << 30) + (p + q | 0) | 0)) >> 2) | 0] | 0) | 0; } else {
    s = s * 3 + (u16[((q) + ((x + 1 | 0) << 1)) >> 1] | 0) | 0; } t = b8[p + x | 0] | 0;
    u16[x & 31] = u16[((((u32[x & 7] | 0)) << 1) + ((h16[1] | 0))) >> 1] ^ s; } x = x + 0 | 0; } return s + t | 0; }
var ends = [0, 1, 2, 3, 4, 7, 8, 63, 64, 255, 256, 511, 512, 1023, 1024, -1, -2, -3, -4, -8, -512, 2147483647, 2147483646, 2147483640, -2147483648, -2147483647, 1073741823, 1073741824, -1073741824, -1073741825, 536870911, 536870912, -536870912, 268435456, 268435455, -268435456];
for (var a = 0; a < ends.length; a++) for (var b = 0; b < ends.length; b += 1) {
  log.push(f0(ends[a] - (ends[b] << 2) | 0, ends[b], ends[b] & 63, -1, 2));
  log.push(f1(8, 1, ends[b] & 63, -1, 6));
  log.push(f2(ends[a] - (ends[b] << 2) | 0, 1, ends[b] & 63, -1, 2));
}
var h = 0;
    for (var i = 0; i < log.length; i++) h = h * 31 + (log[i] | 0) | 0;
console.log(h, log.length, log.slice(0, 40).join(), log.slice(-40).join());
console.log(Array.prototype.join.call(new Uint8Array(buffer)));
})();
