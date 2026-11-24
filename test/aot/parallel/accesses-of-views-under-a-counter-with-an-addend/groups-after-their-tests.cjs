var a, b, c, buf, plain = 7, log = [], turns = 0;
function uint(v) { if (v >= 0) return v; return v + 4294967296; }
function init() { buf = new ArrayBuffer(512); a = new Int16Array(buf); b = new Int16Array(buf, 8); c = new Uint8ClampedArray(buf); for (var i = 0; i < 24; i++) a[i] = i * 7 - 9; }
function change(k) { try { if (k == 3) { new Uint8Array(buf); log.push(buf.byteLength, b.byteOffset, c.buffer.byteLength); } if (k == 9) { c = new Uint8ClampedArray([5, 6, 7]); } } catch (e) { log.push("c" + e.name); } }
function straight(p) { var r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0; r4 = (r1 + a[p + 1]) | 0; b[p - 4] = uint(r2); return [r0, r1, r2, r3, r4]; }
function shifted(sp) { var r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0, p = sp >> 2; c[(p + 1) | 0] = r3 + 1; r4 = a[p - 4]; r3 = c[(sp + 5) | 0]; r0 = a[sp & 3]; c[sp] = r1; r4 = (r3 + a[(sp + 35) >> 1]) | 0; return [r0, r1, r2, r3, r4]; }
var table = [function (k) { turns++; change(turns & 7); }, function (k) { plain = k; }];
function loop(p) { var r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0; for (var i = 0; i < 12; i++) { b[p] = (change(turns), 5); c[(p + -1) | 0] = -1; r3 = c[(p + -1) | 0]; b[(p + 4) >> 1] = (r0 + r1) | 0; b[p] = (turns++, 5); c[p + 2] = a[p - 1]; c[p + 5] = 3;  p = (p + 8) | 0; if (r4 > 1e9) break; } return [r0, r1, r2, r3, r4, p]; }
function walk(p) { var r0 = 0, r1 = 1, r2 = 0, r3 = 0, r4 = 0, left = 14; while (true) { r0 = a[p - 2]; if ((r0 & 1) == 0) { b[p] = (turns++, 5); r4 = a[(p + 34) >> 1]; r4 = a[p + 17]; r4 = b[p + 3]; r3 = a[(p + -2) >> 1]; if (c[p + 17] == 0) { a[(p + 6) >> 1] = r3 * 0.5; if (uint(r3) < uint(r0)) { r3 = b[(p + -2) >> 1]; r4 = (r1 + a[(p + 0) >> 1]) | 0; b[(p + 10) >> 1] = r3 * 0.5; b[p + 3] = a[(p + -4) >> 1]; a[(p + 10) >> 1] = r2; r4 = (r3 + c[(p + 17) | 0]) | 0; } else { r4 = a[p - 4]; c[p + 5] = (r0 + r1) | 0; r4 = (r1 + a[(p + -1) >> 1]) | 0; } } r4 = b[(p + 0) >> 1]; } else { a[p - 4] = 255; r2 = a[p & 15]; if (a[(p + 2) >> 1] == 0) { r2 = a[(p + 11) >> 1]; c[p - 2] = a[p & 3]; } r4 = c[(p + -2) | 0]; c[p - 1] = r3; if (a[p & 3] == 0) { a[p - 4] = 255; b[p] = (turns++, 5); if (c[p + 5] == 0) { r4 = c[(p + 3) | 0]; c[p] = r4; a[p - 4] = r2; } r4 = (r2 + a[p & 31]) | 0; } change(turns); }  if (--left == 0) break; p = (p + 4) | 0; r3 = a[p]; } return [r0, r1, r2, r3, r4, p]; }
function show(v) { return v.map(function (x) { return Object.is(x, -0) ? "-0" : String(x); }).join(","); }
function state() { return [a, b, c].map(function (v) { try { return typeof v == "object" && v ? v.constructor.name + v.length + ":" + Array.prototype.slice.call(v, 0, 30).join(",") : String(v); } catch (e) { return e.name; } }).join(" | "); }
init();
var out = [], places = [-1048576, 128, -2147483648, 508, 0, 1, -1, 63, 512, 1048576, 2147483647];
for (var t = 0; t < 20; t++) for (var f of [loop, straight, walk, shifted]) { var p = places[(t * 5 + turns) % places.length]; turns++; try { out.push(f.name + show(f(p))); } catch (e) { out.push(f.name + e.name); } if (t == 3) { change(3); out.push(state()); } if (t == 4) { try { init(); } catch (e) { out.push(e.name); } } }
out.push(state(), log.join(","), plain, turns);
console.log(out.join("\n"));
