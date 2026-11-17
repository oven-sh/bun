// The way as written of a straight arm meets the arm's exits at several points. Sums that are truncated are built again of their terms, and a term from before a point does not dominate what follows.
(function () {
var G = [], C_ = [];
var Cipher = globalThis.Cipher = Object.create({
  init: function (key) { this._key = key; this._b = 0; this.reset(); },
  reset: function () {
    var K = this._key.words;
    this._X = [K[0], (K[3] << 16) | (K[2] >>> 16), K[1], (K[0] << 16) | (K[3] >>> 16), K[2], (K[1] << 16) | (K[0] >>> 16), K[3], (K[2] << 16) | (K[1] >>> 16)];
    this._C = [(K[2] << 16) | (K[2] >>> 16), (K[0] & 0xffff0000) | (K[1] & 0x0000ffff), K[3], K[1], K[0], K[2], K[1], (K[3] & 0xffff0000) | (K[0] & 0x0000ffff)];
    few.call(this); many.call(this); step.call(this);
  },
});
globalThis.run = { few: few, many: many, step: step, fill: fill };
function fill(values) { G.length = 0; for (var i = 0; i < values.length; i++) { if (i in values) G[i] = values[i] | 0; } }
function few() {
  var X = this._X;
  X[0] = 1; X[1] = 2;
  X[2] = (G[2] + (G[1] << 16) + (G[0] << 16)) | 0;
  X[3] = G[3] | 0; X[4] = G[4] | 0; X[5] = G[5] | 0;
}
function many() {
  var X = this._X;
  X[0] = (G[0] + ((G[7] << 16) | (G[7] >>> 16)) + ((G[6] << 16) | (G[6] >>> 16))) | 0;
  X[1] = G[1] | 0;
  X[2] = (G[2] + ((G[1] << 16) | (G[1] >>> 16)) + ((G[0] << 16) | (G[0] >>> 16))) | 0;
  X[3] = (G[3] - ((G[2] << 8) | (G[2] >>> 24)) - G[1]) | 0;
  X[4] = (G[4] + X[3] + X[2]) >>> 0; X[5] = (X[4] + X[0] + G[5]) | 0;
}
function step() {
  var X = this._X; var C = this._C;
  for (var i = 0; i < 8; i++) { C_[i] = C[i]; }
  C[0] = (C[0] + 0x4d34d34d + this._b) | 0;
  C[1] = (C[1] + 0xd34d34d3 + ((C[0] >>> 0) < (C_[0] >>> 0) ? 1 : 0)) | 0;
  C[7] = (C[7] + 0xd34d34d3 + ((C[1] >>> 0) < (C_[6] >>> 0) ? 1 : 0)) | 0;
  this._b = (C[7] >>> 0) < (C_[7] >>> 0) ? 1 : 0;
  for (var i = 0; i < 8; i++) { var gx = X[i] + C[i]; var ga = gx & 0xffff; var gb = gx >>> 16; G[i] = (((((ga * ga) >>> 17) + ga * gb) >>> 15) + gb * gb) ^ (((gx & 0xffff0000) * gx) | 0); }
  X[0] = (G[0] + ((G[7] << 16) | (G[7] >>> 16)) + ((G[6] << 16) | (G[6] >>> 16))) | 0;
  X[1] = (G[1] + ((G[0] << 8) | (G[0] >>> 24)) + G[7]) | 0;
  X[2] = (G[2] + ((G[1] << 16) | (G[1] >>> 16)) + ((G[0] << 16) | (G[0] >>> 16))) | 0;
  X[3] = (G[3] + ((G[2] << 8) | (G[2] >>> 24)) + G[1]) | 0;
  X[4] = (G[4] + ((G[3] << 16) | (G[3] >>> 16)) + ((G[2] << 16) | (G[2] >>> 16))) | 0;
  X[5] = (G[5] + ((G[4] << 8) | (G[4] >>> 24)) + G[3]) | 0;
  X[6] = (G[6] + ((G[5] << 16) | (G[5] >>> 16)) + ((G[4] << 16) | (G[4] >>> 16))) | 0;
  X[7] = (G[7] + ((G[6] << 8) | (G[6] >>> 24)) + G[5]) | 0;
}
}());
const cipher = Object.create(globalThis.Cipher); cipher.init({ words: [1, 0x7fffffff, -5, 0x12345678] });
let total = 0;
for (let k = 0; k < 60; k++) { globalThis.run[k % 3 ? "step" : k & 1 ? "few" : "many"].call(cipher); total = (total * 31 + cipher._X[k & 7]) | 0; }
console.log(total, cipher._X.join());
const show = v => typeof v === "object" ? "object" : Object.is(v, -0) ? "-0" : String(v);
const fills = { full: [1, 2, 3, 4, 5, 6, 7, 8], wide: [2147483647, -2147483648, 2147483647, 65535, -1, 2, 3, 4], holes: [1, , 3, , 5, , 7, 8], short: [1, 2, 3], empty: [], first: [, , , , , , , 9] };
const targets = { integers: () => [1, 2, 3, 4, 5, 6, 7, 8], doubles: () => [1.5, 2.5, -0, NaN, 5, 6, 7, 8], mixed: () => [1, "2", 3, null, 5, , 7, {}], bytes: () => new Uint8Array(8), floats: () => new Float64Array(8), short: () => [1], record: () => ({ length: 8 }), frozen: () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]) };
for (const name in fills) for (const target in targets) for (const which of ["few", "many", "step"]) {
  globalThis.run.fill(fills[name]);
  const object = { _X: targets[target](), _C: targets[target === "frozen" ? "integers" : target](), _b: 1 };
  let said = ""; try { globalThis.run[which].call(object); } catch (error) { said = error.name + " "; }
  console.log(name, target, which, said + Array.from(object._X, show).join(), object._b);
}
