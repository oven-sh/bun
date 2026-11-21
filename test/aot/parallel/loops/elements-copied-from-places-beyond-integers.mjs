// A loop that only copies elements may write any number beside its counter. What lies past the integers that a number holds exactly is no element of a list: a read there is undefined, a store there makes a named property.
// STATISTIC: ElementCopyLoopsHoisted >= 1
const box = {};
function unknown(value) { box[JSON.parse('"k"')] = value; return box[JSON.parse('"k"')]; }
const kernels = {
  near(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 2]; return to; },
  int32(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 2147483647]; return to; },
  pastInt32(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 2147483648]; return to; },
  pastIndices(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 4294967296]; return to; },
  lastExact(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 9007199254740991]; return to; },
  firstInexact(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 9007199254740992]; return to; },
  inexact(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 18014398509481984]; return to; },
  written(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[18014398509481984 + i]; return to; },
  taken(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i - 18014398509481984]; return to; },
  negative(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + -18014398509481984]; return to; },
  huge(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 1152921504606846976]; return to; },
  pastWords(from, to, n) { for (let i = 0; i < n; i++) to[i] = from[i + 9223372036854775808]; return to; },
  stored(from, to, n) { for (let i = 0; i < n; i++) to[i + 18014398509481984] = from[i]; return to; },
  same(from, to, n) { for (let i = 0; i < n; i++) from[i] = from[i + 18014398509481984]; return from; },
  backwards(from, to, n) { for (let i = n - 1; i >= 0; i--) to[i] = from[i + 18014398509481984]; return to; },
  backwardsStored(from, to, n) { for (let i = n; i > 0; i--) to[i + 18014398509481984] = from[i - 1]; return to; },
  filled(from, to, n) { for (let i = 0; i < n; i++) to[i + 18014398509481984] = n; return to; },
  both(from, to, n) { for (let i = 0; i < n; i++) to[i + 9007199254740992] = from[i + 9007199254740992]; return to; },
};
const shown = unknown(kernels);
const text = value => Object.keys(value).length + ":" + Array.prototype.join.call(value) + "/" + Object.keys(value).slice(-2) + "/" + Object.values(value).slice(-2);
const makers = {
  list: () => JSON.parse("[1,2,3,4,5,6,7,8]"),
  halves: () => JSON.parse("[1.5,2,3.5,4,5,6,7,8]"),
  texts: () => JSON.parse('["a","b","c","d","e","f","g","h"]'),
  bytes: () => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
  doubles: () => Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
  named: () => Object.assign([1, 2, 3, 4], { "18014398509481984": 5, "18014398509481988": 6, "9007199254740992": 7, "-18014398509481984": 8 }),
};
for (const name of Object.keys(kernels)) {
  for (const from of Object.keys(makers)) {
    for (const to of Object.keys(makers)) {
      const all = [];
      for (const n of [6, 3, 0]) all.push(text(shown[name](unknown(makers[from]()), unknown(makers[to]()), unknown(n))));
      console.log(name, from, to, all.join(" "));
    }
  }
}
