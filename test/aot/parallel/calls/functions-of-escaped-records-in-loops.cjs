// A record of functions that other code holds is read off a variable and called by name in loops. Its functions are replaced, deleted and redefined in the middle.
const modules = {};
function define(id, body) { const module_ = { exports: {} }; modules[id] = module_; body.call(module_.exports, name => modules[name].exports, module_, module_.exports); }
define("words", function (require_, module_, exports_) {
  const low = (h, l, s) => (h << (32 - s)) | (l >>> s);
  const high = (h, l, s) => (h >>> s) | (l << (32 - s));
  const swap = (h, l) => l;
  const sum3 = (a, b, c) => (a >>> 0) + (b >>> 0) + (c >>> 0);
  function add(ah, al, bh, bl) { const l = (al >>> 0) + (bl >>> 0); return { h: (ah + bh + ((l / 2 ** 32) | 0)) | 0, l: l | 0 }; }
  const words = { low, high, swap, sum3, add };
  exports_.default = words;
});
define("user", function (require_, module_, exports_) {
  const words_1 = require_("words");
  let calls = 0;
  exports_.run = function (rounds, change) {
    let a = 0x6a09e667 | 0, b = 0xf3bcc908 | 0, h = 0, l = 0;
    for (let i = 0; i < rounds; i++) {
      if (change && i === rounds >> 1) change(words_1.default, i);
      const s1 = words_1.default.high(a, b, 14) ^ words_1.default.high(a, b, 18) ^ words_1.default.swap(a, b);
      const s0 = words_1.default.low(a, b, 14) ^ words_1.default.low(a, b, 18) ^ words_1.default.swap(b, a);
      const t = words_1.default.sum3(s0, s1, i);
      ({ h, l } = words_1.default.add(h, l, s1, t | 0));
      a = (a + h) | 0; b = (b ^ l) | 0;
    }
    return [a, b, h, l, calls];
  };
  exports_.counted = function (f) { return function (...list) { calls++; return f.apply(this, list); }; };
});
globalThis.modules = modules;
const user = modules.user.exports, words = modules.words.exports.default, before = { ...words };
const changes = [
  undefined,
  w => { w.high = (h, l, s) => (h ^ l) >>> s; },
  w => { w.swap = user.counted(before.swap); },
  w => { Object.defineProperty(w, "low", { configurable: true, enumerable: true, get() { return before.high; } }); },
  w => { w.add = function (ah, al, bh, bl) { return { l: al ^ bl, h: ah ^ bh, of: this === w }; }; },
  w => { w.sum3 = Math.max; },
  w => { w.extra = 1; },
  () => { modules.words.exports.default = { ...before, high: before.low }; },
  () => { modules.words.exports.default = new Proxy(before, { get(target, key) { return target[key]; } }); },
  w => { Object.freeze(w); },
  w => { delete w.swap; },
  w => { w.low = null; },
];
for (const change of changes) {
  for (let turn = 0; turn < 3; turn++) {
    try { console.log(changes.indexOf(change), turn, user.run(40, turn === 1 ? change : undefined).join()); } catch (error) { console.log(changes.indexOf(change), turn, error.name); }
  }
  modules.words.exports.default = { ...before };
}
