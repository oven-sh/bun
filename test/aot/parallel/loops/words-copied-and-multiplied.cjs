// A window of words is copied out of a longer list and is read for its bits and as numbers, too: what is absent there makes NaN.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
held[name("window")] = function window(list, from, count) { const words = []; let bits = 0, product = 1; for (let k = 0; k < count; k++) { words[k] = list[from + k]; bits ^= words[k] << (k & 3); product = product * 0.5 + words[k] * 1.5; } return bits + "," + product; };
held[name("again")] = function again(list, from, count) { const words = new Array(count); for (let k = 0; k < count; k++) words[k] = list[from + k]; let bits = 0, sum = 0; for (let k = 0; k < count; k++) { bits |= words[k] & 15; sum += words[k] * k; } return bits + "," + sum; };
held[name("blocks")] = function blocks(list, size) { const words = []; let bits = 5, sum = 0; for (let from = 0; from < list.length; from += size) { for (let k = 0; k < size; k++) { words[k] = list[from + k]; bits = (bits << 3 | bits >>> 29) + (words[k] | 0) | 0; } sum = sum / 2 + words[0] * words[size - 1]; } return bits + "," + sum; };
const base = count => Array.from({ length: count }, (_, k) => Math.imul(k + 1, 0x5bd1e995) >> (k & 7));
const makers = {
  whole: () => base(24), hole: () => { const list = base(24); delete list[9]; return list; }, doubles: () => base(24).map(value => value / 4), short: () => base(13), absent: () => Object.assign(base(24), { 7: undefined }), nulls: () => Object.assign(base(24), { 7: null, 8: false }), texts: () => Object.assign(base(24), { 5: "17", 6: "x" }), view: () => Int32Array.from(base(24)), single: () => Float32Array.from(base(20)),
  nan: () => Object.assign(base(24), { 3: NaN, 12: -0 }), alike: () => Object.assign({ length: 16 }, base(16)), word: () => "3141592653589793", none: () => [], above: () => { const list = base(24); delete list[10]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 10: 2.5 }); return list; }, converts: () => Object.assign(base(24), { 4: { valueOf: () => 6 } }), big: () => Object.assign(base(24), { 4: 2 ** 33 + 5 }), bigInt: () => Object.assign(base(24), { 4: 5n }),
};
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const lines = [];
for (let round = 0; round < 3; round++) for (const kind of Object.keys(makers)) {
  const line = [round, kind];
  for (const [from, count] of [[0, 16], [3, 8], [8, 16], [20, 8], [-2, 5], [0, 0]]) line.push(attempt(() => held[name("window")](makers[kind](), from, count)), attempt(() => held[name("again")](makers[kind](), from, count)));
  for (const size of [1, 4, 8, 5]) line.push(attempt(() => held[name("blocks")](makers[kind](), size)));
  lines.push(line.join(" "));
}
console.log(lines.join("\n"));
