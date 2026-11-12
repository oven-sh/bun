// Key schedules whose arrays append, over tables that only some iterations read; what stands between their making and their loops may touch them.
var lib = { cipher: {}, exception: { invalid: function (a) { this.message = a; } }, touch: null };
function fill() { var a = this.s[0], b = this.s[1], i, u, z = 7; for (i = 0; 256 > i; i++) for (u = 0; 5 > u; u++) { z = Math.imul(z, 1103515245) + 12345 | 0; a[u][i] = u === 4 ? i * 7 + 3 & 255 : z; b[u][i] = u === 4 ? (i * 183 + 220) & 255 : z << 7 ^ z >>> 25; } for (i = 0; 5 > i; i++) a[i] = a[i].slice(0), b[i] = b[i].slice(0); }
lib.cipher.block1 = function (a) {
  var b, c, d, e, f = this.s[0][4], g = this.s[1]; b = a.length; var h = 1;
  if (4 !== b && 6 !== b && 8 !== b) throw new lib.exception.invalid("size");
  this.b = [d = a.slice(0), e = []]; 
  for (a = b; a < 4 * b + 28; a++) { c = d[a - 1]; if (0 === a % b || 8 === b && 4 === a % b) c = f[c >>> 24] << 24 ^ f[c >> 16 & 255] << 16 ^ f[c >> 8 & 255] << 8 ^ f[c & 255], 0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7)); d[a] = d[a - b] ^ c; } 
  for (b = 0; a; b++, a--) c = d[b & 3 ? a : a - 4], e[b] = 4 >= a || 4 > b ? c : g[0][f[c >>> 24]] ^ g[1][f[c >> 16 & 255]] ^ g[2][f[c >> 8 & 255]] ^ g[3][f[c & 255]]; 
};
lib.cipher.block1.prototype = { s: [[[], [], [], [], []], [[], [], [], [], []]], fill: fill };
lib.cipher.block2 = function (a) {
  var b, c, d, e, f = this.s[0][4], g = this.s[1]; b = a.length; var h = 1;
  if (4 !== b && 6 !== b && 8 !== b) throw new lib.exception.invalid("size");
  this.b = [d = a.slice(0), e = []]; lib.touch && lib.touch(this, 0);
  for (a = b; a < 4 * b + 28; a++) { c = d[a - 1]; if (0 === a % b || 8 === b && 4 === a % b) c = f[c >>> 24] << 24 ^ f[c >> 16 & 255] << 16 ^ f[c >> 8 & 255] << 8 ^ f[c & 255], 0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7)); d[a] = d[a - b] ^ c; } 
  for (b = 0; a; b++, a--) c = d[b & 3 ? a : a - 4], e[b] = 4 >= a || 4 > b ? c : g[0][f[c >>> 24]] ^ g[1][f[c >> 16 & 255]] ^ g[2][f[c >> 8 & 255]] ^ g[3][f[c & 255]]; 
};
lib.cipher.block2.prototype = { s: [[[], [], [], [], []], [[], [], [], [], []]], fill: fill };
lib.cipher.block3 = function (a) {
  var b, c, d, e, f = this.s[0][4], g = this.s[1]; b = a.length; var h = 1;
  if (4 !== b && 6 !== b && 8 !== b) throw new lib.exception.invalid("size");
  this.b = [d = a.slice(0), e = []]; 
  for (a = b; a < 4 * b + 28; a++) { c = d[a - 1]; if (0 === a % b || 8 === b && 4 === a % b) c = f[c >>> 24] << 24 ^ f[c >> 16 & 255] << 16 ^ f[c >> 8 & 255] << 8 ^ f[c & 255], 0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7)); d[a] = d[a - b] ^ c; } lib.touch && lib.touch(this, 1);
  for (b = 0; a; b++, a--) c = d[b & 3 ? a : a - 4], e[b] = 4 >= a || 4 > b ? c : g[0][f[c >>> 24]] ^ g[1][f[c >> 16 & 255]] ^ g[2][f[c >> 8 & 255]] ^ g[3][f[c & 255]]; 
};
lib.cipher.block3.prototype = { s: [[[], [], [], [], []], [[], [], [], [], []]], fill: fill };
lib.cipher.block4 = function (a) {
  var b, c, d, e, f = this.s[0][4], g = this.s[1]; b = a.length; var h = 1;
  if (4 !== b && 6 !== b && 8 !== b) throw new lib.exception.invalid("size");
  this.b = [d = a.slice(0), e = []]; lib.touch && lib.touch(this, 0); f = this.s[0][4]; g = this.s[1];
  for (a = b; a < 4 * b + 28; a++) { c = d[a - 1]; if (0 === a % b || 8 === b && 4 === a % b) c = f[c >>> 24] << 24 ^ f[c >> 16 & 255] << 16 ^ f[c >> 8 & 255] << 8 ^ f[c & 255], 0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7)); d[a] = d[a - b] ^ c; } lib.touch && lib.touch(this, 1); f = this.s[0][4]; g = this.s[1];
  for (b = 0; a; b++, a--) c = d[b & 3 ? a : a - 4], e[b] = 4 >= a || 4 > b ? c : g[0][f[c >>> 24]] ^ g[1][f[c >> 16 & 255]] ^ g[2][f[c >> 8 & 255]] ^ g[3][f[c & 255]]; lib.touch && lib.touch(this, 2);
};
lib.cipher.block4.prototype = { s: [[[], [], [], [], []], [[], [], [], [], []]], fill: fill };
"undefined" !== typeof module && module.exports && (module.exports = lib);
const makers = [lib.cipher.block1, lib.cipher.block2, lib.cipher.block3, lib.cipher.block4];
for (const m of makers) m.prototype.fill();
function show(x) { if (!Array.isArray(x)) return typeof x; let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : typeof x[i] === "bigint" ? x[i] + "n" : String(x[i])) + " " : "- "; return s + x.length; }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) | 0; return h; }
const keys = [[1, 2, 3, 4], [0x9f216bee, 2, 0x8a8c089a, 0xe2872c3b], [1, 2, 3, 4, 5, 6], [0x36e755e, 0x7e07cfe, 0x36c41ccd, 0xb14c1bcd, 5, 6, 7, 8], [1.5, 2, 3, 4], [1, , 3, 4], [1, "2", 3, 4], [-0, NaN, 2 ** 53, 2 ** 32], [1n, 2n, 3n, 4n], Object.freeze([1, 2, 3, 4]), [undefined, null, 3, 4], [1, 2, 3], Int32Array.of(1, 2, 3, 4)];
const touches = [null, (o, w) => { o.b[1].push(9, 8); }, (o, w) => { o.b[0].length = 3; }, (o, w) => { o.b[1][2] = 5; }, (o, w) => { if (w === 1) o.b[0].push("x"); }, (o, w) => { Object.freeze(o.b[1]); }, (o, w) => { Object.freeze(o.b[0]); }, (o, w) => { Object.defineProperty(o.b[1], 3, { get() { return 1; }, set(v) { o.seen = v; }, configurable: true }); }, (o, w) => { o.b[1][0] = 1.5; }, (o, w) => { o.b[1][0] = "s"; }, (o, w) => { Object.setPrototypeOf(o.b[1], { set 2(v) { o.seen = v; } }); }, (o, w) => { o.b[0].push(1.25); }, (o, w) => { delete o.b[0][1]; }, (o, w) => { o.b[1].length = 70; }, (o, w) => { Object.defineProperty(o.b[1], "length", { writable: false }); }, (o, w) => { if (w === 1) throw new Error("touched"); },
  (o, w) => { const old = o.s; o.s = [[old[0][0], old[0][1], old[0][2], old[0][3], old[0][4].map(v => v + .5)], old[1]]; }, (o, w) => { const old = o.s; o.s = [old[0], [old[1][0], old[1][1].map(v => v >>> 0), old[1][2], Uint8Array.from(old[1][3])]]; }, (o, w) => { const old = o.s, f = old[0][4].slice(); delete f[7]; f[9] = "12"; o.s = [[0, 0, 0, 0, f], [old[1][0], old[1][1], undefined, old[1][3]]]; }];
let all = 0;
function run(m, k, w) { lib.touch = touches[w]; let o = null, r; try { o = new makers[m](keys[k]); r = "made"; } catch (e) { r = e.name || "thrown"; } const s = r + "|" + (o ? show(o.b[0]) + "|" + show(o.b[1]) + "|" + o.seen : ""); all = Math.imul(all, 17) + hash(s) | 0; return s; }
for (let k = 0; k < keys.length; k++) for (let w = 0; w < touches.length; w++) for (let m = 0; m < makers.length; m++) { const s = run(m, k, w); console.log(m, k, w, s.length, hash(s), s.slice(0, 60)); }
console.log(all);
