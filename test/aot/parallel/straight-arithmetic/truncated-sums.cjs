// Sums whose parts are read before and behind a place where straight code of doubles may give up.
(function () {
  const G = [];
  const H = [1.5, 2, 3, 4, 5, 6, 7, 8];
  const holder = (globalThis.holder = { init(words) { this.words = words; this.X = [words[0], words[3], 2, 3, 4, 5, 6, 7]; }, next() { return next.call(this); }, sums() { return sums.call(this); } });
  globalThis.fill = values => { for (let i = 0; i < values.length; i++) G[i] = values[i]; };
  globalThis.shared = H;
  function next() {
    const X = this.X;
    X[0] = 1;
    X[1] = 2;
    X[2] = (G[2] + (G[1] << 16) + (G[0] << 16)) | 0;
    X[3] = G[3] - 0;
    X[4] = G[4] - 0;
    X[5] = G[5] - 0;
    X[6] = G[0] - 0;
    X[7] = 1;
    return X.join();
  }
  function sums() {
    const X = this.X;
    X[0] = H[0] * 2 + H[1];
    const a = H[2] + (H[3] >> 1);
    X[1] = a * H[4] - H[5];
    const b = (a + H[6] + (H[7] << 2)) | 0;
    X[2] = H[1] / 2;
    X[3] = H[2] * H[3];
    X[4] = (b + a) | 0;
    X[5] = H[6] * 0.5;
    X[6] = -H[7];
    const c = (a + b + X[0]) | 0;
    return X.join() + ":" + a + ":" + b + ":" + c;
  }
})();
(function () {
var G = [];
var Cipher = globalThis.Cipher = Object.create({ init: function (key) { this._key = key; this._doReset(); },
  _doReset: function () { var K = this._key.words;
    var X = this._X = [K[0], (K[3] << 16) | (K[2] >>> 16), K[1], (K[0] << 16) | (K[3] >>> 16), K[2], (K[1] << 16) | (K[0] >>> 16), K[3], (K[2] << 16) | (K[1] >>> 16)];
    mixWords.call(this);
  },
});
function mixWords() {
  var X = this._X; 
  X[0] = 1;
  X[1] = 2;
  X[2] = (G[2] + (G[1] << 16) + (G[0] << 16)) | 0;
  X[3] = G[3] - 0;
  X[4] = G[4] - 0;
  X[5] = G[5] - 0; X[6] = G[0] - 0; X[7] = 1;
}
}());
const cipher = Object.create(globalThis.Cipher);
cipher.init({ words: [1, 0x7fffffff, -5, 0x12345678] });
const machine = Object.create(globalThis.holder);
machine.init([1, 0x7fffffff, -5, 0x12345678]);
const lines = [cipher._X.join()];
for (let k = 0; k < 6; k++) {
  lines.push(machine.next(), machine.sums());
  if (k === 1) globalThis.fill([1, 2, 3, 4, 5, 6]);
  if (k === 2) globalThis.fill([1.5, -2.5, 2 ** 31, NaN, -0, Infinity]);
  if (k === 3) globalThis.fill([1, "2", {}, undefined, null, true]);
  if (k === 2) globalThis.shared[3] = "9";
  if (k === 3) globalThis.shared[5] = undefined;
  if (k === 4) globalThis.shared.length = 2;
}
console.log(lines.join("\n"));
