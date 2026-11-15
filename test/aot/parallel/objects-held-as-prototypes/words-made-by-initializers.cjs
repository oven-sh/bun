// STATISTIC: SpeculatedClassesOfInitializersIgnored >= 1
// `x.init.apply(x, ..)` runs a constructor function on objects that it did not construct: the fields that it stores say nothing of their class. A loop that guessed the class of `new Word.init(..)` left its version in the first iteration.
var create = Object.create;
var Base = {
  extend: function (overrides) {
    var subtype = create(this); if (overrides) subtype.mixIn(overrides);
    if (!subtype.hasOwnProperty("init") || this.init === subtype.init) subtype.init = function () { subtype.$super.init.apply(this, arguments); };
    subtype.init.prototype = subtype; subtype.$super = this; return subtype;
  },
  create: function () { var instance = this.extend(); instance.init.apply(instance, arguments); return instance; },
  init: function () { }, mixIn: function (properties) { for (var p in properties) { if (properties.hasOwnProperty(p)) this[p] = properties[p]; } },
};
var Word = Base.extend({ init: function (high, low) { this.high = high; this.low = low; } });
globalThis.lib = { Word: Word, Base: Base };
var W = []; (function () { for (var i = 0; i < 16; i++) W[i] = globalThis.lib.Word.create(); }());
var K = []; for (var k = 0; k < 16; k++) K[k] = globalThis.lib.Word.create((k * 0x428a2f98) >>> 0, (k * 0xd728ae22) >>> 0);
globalThis.hash = {
  block: function (H, n) {
    var ah = H[0].high, al = H[0].low, bh = H[1].high, bl = H[1].low;
    for (var i = 0; i < n; i++) {
      var Wi = W[i & 15], x = W[(i + 14) & 15], Ki = K[i & 15];
      if (i < 16) { Wi.high = (ah ^ i) | 0; Wi.low = (bl + i) | 0; } else { var h = x.high, l = x.low, g = ((h >>> 1) | (l << 31)) ^ (h >>> 7); Wi.low = g + Wi.low; Wi.high = g + Wi.high + ((Wi.low >>> 0) < (g >>> 0) ? 1 : 0); }
      var t = (ah & bh) + Ki.high + Wi.high, u = (al ^ bl) + Ki.low + Wi.low; bh = ah; bl = al; ah = t | 0; al = u | 0;
    }
    H[0].high = H[0].high + ah; H[0].low = H[0].low + al; return [ah, al, bh, bl];
  },
};
var total = 0; const H = [new globalThis.lib.Word.init(0x6a09e667, 0xf3bcc908), new globalThis.lib.Word.init(0xbb67ae85, 0x84caa73b)];
for (var turn = 0; turn < 40; turn++) { const r = globalThis.hash.block(H, 48); total = (total * 31 + r[0] + r[3]) | 0; }
console.log(total, H[0].high, H[0].low, Object.keys(W[3]).join(), Object.keys(H[0]).join(), H[0] instanceof Word.init, Word.isPrototypeOf(W[3]));
const kinds = { constructed: () => new Word.init(5, 6), created: () => Word.create(7, 8), literal: () => JSON.parse('{"high":9,"low":10}'), below: () => create(Word.create(11, 12)), accessor: () => Object.defineProperty(JSON.parse('{"low":14}'), "high", { get() { return 13; }, set(v) { this.seen = v; }, configurable: true }), doubles: () => new Word.init(1.5, 2.5), strings: () => new Word.init("1", "2"), empty: () => new Word.init(), frozen: () => Object.freeze(Word.create(1, 2)), object: () => new Word.init({ valueOf() { return 3; } }, 4) };
for (const a in kinds) for (const b in kinds) {
  W[2] = kinds[a](); K[3] = kinds[b](); W[9] = kinds[b](); let said;
  try { said = globalThis.hash.block([kinds[a](), kinds[b]()], 40).join(); } catch (error) { said = error.name; }
  console.log(a, b, said, String(W[2].high), String(W[2].low), String(W[9].seen));
}
var Parent = function (v) { this.value = v; }; Parent.prototype.get = function () { return this.value; };
var Child = function (v) { Parent.call(this, v); this.own = 1; }; Child.prototype = create(Parent.prototype);
var sum = 0; const parents = []; for (var i = 0; i < 30; i++) parents.push(i & 1 ? new Parent(i) : new Child(i)); for (var r = 0; r < 20; r++) for (const p of parents) sum += p.value + p.get(); console.log(sum);
