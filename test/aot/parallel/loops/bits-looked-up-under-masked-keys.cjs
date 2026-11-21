// Bits are looked up under masked keys, over and over: lists of int32s, of doubles, with holes, of boxed values, mixed, and lists that change between two runs.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
held[name("mix")] = function mix(list, count, seed) { let word = seed | 0; for (let k = 0; k < count; k++) word = (word >>> 4) ^ list[(word ^ k) & 15]; return word; };
held[name("pair")] = function pair(list, other, count) { let low = 0, high = -1; for (let k = 0; k < count; k++) { low ^= list[k & 15] & other[(k * 3) & 15]; high &= ~list[high & 15]; } return low + "," + high; };
held[name("shift")] = function shift(list, count) { let sum = 0; for (let k = 0; k < count; k++) sum = (sum + (list[k & 15] >> (k & 7))) | 0; return sum; };
held[name("count")] = function count(list, turns) { let set = 0; for (let k = 0; k < turns; k++) if (list[(k * 5) & 15] & (1 << (k & 31))) set++; return set; };
const base = () => Array.from({ length: 16 }, (_, k) => Math.imul(k + 3, 0x01000193) ^ k << 24);
const makers = {
  ints: base, doubles: () => base().map(value => value + 0.25), unsigned: () => base().map(value => value >>> 0), holes: () => { const list = base(); delete list[5]; delete list[14]; return list; }, texts: () => base().map(String), mixed: () => base().map((value, k) => [value, value + 0.5, String(value), k % 2 === 0, null, undefined][k % 6]),
  short: () => base().slice(0, 7), long: () => base().concat(base()), view: () => Int32Array.from(base()), bytes: () => Uint8ClampedArray.from(base()), half: () => Float32Array.from(base()), alike: () => Object.assign({ length: 16 }, base()), text: () => "0123456789abcdef", nan: () => base().map((value, k) => (k % 4 ? value : NaN)), infinite: () => base().map((value, k) => (k % 4 ? value : k % 8 ? Infinity : -Infinity)), zero: () => base().map(() => -0), converts: () => Object.assign(base(), { 9: { valueOf: () => 1234 } }), throws: () => Object.assign(base(), { 13: { valueOf() { throw new EvalError("no"); } } }), above: () => { const list = base(); delete list[2]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 2: 42 }); return list; },
};
const changes = [list => { list[3] = 7; }, list => { list[4] = 0.5; }, list => { list[6] = "12"; }, list => { delete list[8]; }, list => { list.length = 10; }, list => { list[1] = { valueOf: () => -1 }; }, list => { Object.freeze(list); }, list => { list[20] = 1; }];
const attempt = f => { try { return String(f()); } catch (error) { return error.constructor.name; } };
const lines = [];
for (let round = 0; round < 3; round++) for (const kind of Object.keys(makers)) {
  const list = makers[kind]();
  const all = () => [attempt(() => held[name("mix")](list, 40, round)), attempt(() => held[name("pair")](list, list, 33)), attempt(() => held[name("pair")](base(), list, 20)), attempt(() => held[name("shift")](list, 37)), attempt(() => held[name("count")](list, 50))].join(" ");
  lines.push(round + " " + kind + " " + all());
  if (typeof list === "object" && Array.isArray(list)) for (const change of changes) { try { change(list); } catch (error) { lines.push(error.constructor.name); } lines.push(all()); }
}
console.log(lines.join("\n"));
