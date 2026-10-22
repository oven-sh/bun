// Objects used as maps: {} and Object.create(null) filled through computed keys, deleted from, filled again, copied and enumerated. Own keys come out as in plain Bun: array indexes in ascending order, then strings in the order they were added, then symbols.
function listed(o) { const names = []; for (const name in o) names.push(name); return [Object.keys(o).join(), names.join(), Object.entries(o).map(([k, v]) => k + ":" + v).join(), JSON.stringify(o)].join(" | "); }
function counted(words) { const counts = {}; for (const word of words) counts[word] = Object.hasOwn(counts, word) ? counts[word] + 1 : 1; return counts; }
function grouped(words) { const groups = {}; for (const word of words) (groups[word.length] ??= []).push(word); return groups; }
function filled(target, keys) { for (const key of keys) target[key] = String(key).length; return target; }
function deletedAndAddedAgain() { const o = {}; for (const key of ["a", "b", "c", "d"]) o[key] = 1; delete o.b; delete o["d"]; o.b = 2; o.e = 3; const first = ["a"].join(""); delete o[first]; o[first] = 4; return o; }
function literalThenKeys(first, second) { const o = { a: 1, b: 2 }; o[first] = 3; o[second] = 4; delete o.a; o.a = 5; return o; }
function copied(source) { const target = {}; for (const key of Object.keys(source)) target[key] = source[key]; return target; }
function many(count) { const o = {}; for (let i = 0; i < count; i++) o["k" + i] = i; for (let i = 0; i < count; i += 3) delete o["k" + i]; for (let i = 0; i < count; i += 6) o["k" + i] = -i; return o; }
function withSymbols() { const o = {}, local = Symbol("local"); o[local] = 1; o.x = 2; o[Symbol.for("shared")] = 3; o[1] = 4; return Reflect.ownKeys(o).map(String).join(); }
const words = "the quick brown fox jumps over the lazy dog and the quick cat".split(" ");
const strings = ["b", "10", "a", "2", "-1", "1.5", "01", "4294967294", "4294967295", "", "2"], numbers = [3, 1.5, -1, 2 ** 32, 1e21, NaN, 1, 0];
const inherited = ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "length"];
console.log(listed(counted(words))); console.log(listed(grouped(words))); console.log(listed(filled({}, strings))); console.log(listed(filled(Object.create(null), strings))); console.log(listed(filled({}, numbers)));
console.log(Object.keys(filled({}, inherited)).join(), Object.keys(filled(Object.create(null), inherited)).join());
console.log(listed(deletedAndAddedAgain())); console.log(listed(literalThenKeys("c", "0"))); console.log(listed(literalThenKeys("b", "z")));
console.log(listed(copied(filled({}, strings))), listed(copied(counted(words))) === listed(counted(words)));
{ const o = many(3000), keys = Object.keys(o); let sum = 0; for (const key in o) sum += o[key]; console.log(keys.length, keys.slice(0, 6).join(), keys.slice(-6).join(), sum, "k3" in o, "k6" in o, o.k1, o["k" + 2999]); }
{ const o = counted(words); console.log("the" in o, "cow" in o, o["cow"], delete o.cow, delete o.the, "the" in o, Object.keys(o).length); }
console.log(withSymbols());
