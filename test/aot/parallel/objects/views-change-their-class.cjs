// Captured variables of typed arrays, one of two classes: loops and functions read and store elements.
(function () {
var buffer = new ArrayBuffer(256, { maxByteLength: 2048 });
var h8 = new Int8Array(buffer);
var u8 = new Uint8Array(buffer);
var h16 = new Int16Array(buffer);
var u16 = new Uint16Array(buffer);
var h32 = new Int32Array(buffer);
var u32 = new Uint32Array(buffer);
var f32 = new Float32Array(buffer);
var f64 = new Float64Array(buffer);
var g_i = 0, g_f = 0, calls = 0, mode = 0, sink = [];
function leaf(p) { p = p | 0; return h32[p >> 2] | 0; }
function root(p) { var v = f32[p >> 2]; g_f = Math.sqrt(v); }
function sumOf(p) { var a = p >> 2; g_i = (h32[a] | 0) + (h32[a + 1] | 0) | 0; }
function between(v) { calls++; if (calls === 50) { h32 = new Float64Array(16); } }
function t0(p, q, n) { p = p | 0; q = q | 0; n = n | 0; var x = 0, y = 0, z = 0, i = 0; f32[p + 16 >> 2] = f32[p + 20 >> 2] < f32[p + 24 >> 2] ? f32[p + 20 >> 2] : f32[p + 24 >> 2]; y = y ^ h32[(x << 2) + p >> 2]; between(x); y = leaf(p) | 0; x = u16[((x & 63) << 1) + p >> 1] | 0; return [x, y, z]; }
function t1(p, q, n) { var x = 0, y = 0, z = 0, i = 0; for (; n; n = n - 1 | 0) { h32[p + 8 >> 2] = h32[p + 12 >> 2] | 0; y = y + ((x - +u8[(p + 0) >> 0] | 0) < (i << 3) ? (x ^ y) : x) | 0; h8[(x + 1) | 0] = (Math.imul((u16[(x + 3) | 0] | 0), 31) < x ? x : u8[((x << 0) + p) >> 0] * 0.5); p = p + 4 | 0; if (n < 0) break; } return [x, y, z]; }
function t2(p, q, n) { p = p | 0; q = q | 0; n = n | 0; var x = 0, y = 0, z = 0, i = 0; while (n-- > 0) { y = ((u8[p + -2 >> 0] | 0) >> 2) | 0; y = y + (u8[p + 12] | 0) + (u8[p + 13] | 0) + (u8[p + 14] | 0) + (u8[p + 15] | 0) | 0; y = y ^ h32[(x << 2) + p >> 2]; if ((x & 3) == 0) h16[((i << 1) + p + 1) >> 1] = y; root(p); z += g_f; q = q + 4 | 0; p = p + 4 | 0; i++; } return [x, y, z]; }
function t3(p, q, n) { p = p | 0; q = q | 0; n = n | 0; var x = 0, y = 0, z = 0, i = 0; h8[(p + 4 | 0) >> 0] = (h8[(p + 8) >> 0] | 0); { var b = h16[p + 2 >> 1] | 0; var a = h16[p + 0 >> 1] | 0; u16[q >> 1] = a; u16[(q + 2) >> 1] = b; y = y + a ^ b; } x = h32[p + 16 >> 2] | 0; y = y + ((u16[(p >> 1) + i | 0] | 0) + (y ^ x) | 0) | 0; { var b = h16[p + 6 >> 1] | 0; var a = h16[p + 4 >> 1] | 0; h16[q >> 1] = a; h16[(q + 2) >> 1] = b; y = y + a ^ b; } f32[p + 16 >> 2] = f32[p + 20 >> 2] < f32[p + 24 >> 2] ? f32[p + 20 >> 2] : f32[p + 24 >> 2]; f32[p + 0 >> 2] = f32[p + 4 >> 2] < f32[p + 8 >> 2] ? f32[p + 4 >> 2] : f32[p + 8 >> 2]; return [x, y, z]; }
function fill() { var s = 12345; for (var i = 0; i < u8.length; i++) { s = Math.imul(s, 1103515245) + 12345 | 0; if (typeof u8 === 'object') u8[i] = s >>> 16; } }
function state() { var h = 0, s = ''; [h8, u16, h32, f64].forEach(function (v) { try { for (var i = 0; i < Math.min(v.length, 400); i++) { var e = v[i]; h = Math.imul(h, 31) + (e !== e ? 7 : typeof e === 'number' ? e | 0 : String(e).length) | 0; } s += v.length + ','; } catch (e) { s += e.name; } }); return s + h + ' ' + g_i + ' ' + (g_f === g_f ? g_f : 'NaN') + ' ' + calls + ' ' + sink.length; }
var outs = [];
function show(v) { return v.map(function (x) { return Object.is(x, -0) ? '-0' : String(x); }).join(); }
fill();
[t0, t1, t2, t3].forEach(function (f, k) { [[0, 0, 3], [16, 32, 5], [8, 100, 9], [60, 4, 4], [3, 5, 3], [-4, 0, 3], [-16, 8, 4], [252, 0, 3], [256, 4, 3], [2147483640, 0, 2], [-2147483648, 0, 2], [1073741824, 8, 2], [100, -2, 3], [40, 254, 6], [1.5, 2.5, 3], [undefined, null, 2], ['8', '4', 2], [24, 24, 40]].forEach(function (a) { var o; try { o = show(f(a[0], a[1], a[2])); } catch (e) { o = e.name; } console.log(k, String(a), o, state()); }); fill(); });
})();
