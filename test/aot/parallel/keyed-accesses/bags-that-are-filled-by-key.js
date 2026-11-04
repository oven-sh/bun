// A record that lists no name and is filled by key is an ordinary object, not a compiled object without a slot. Whatever can be seen of it is as in plain Bun: the order of its keys, elements under indexes and under
// their texts, what stands above it, symbols, freezing, accessors, `__proto__`, copies. A literal that lists an element (`{ 1: "one" }`) lists no name either.
const report = value => console.log(typeof value === "string" ? JSON.stringify(value) : String(value));
function keysOf(object) { let text = ""; for (const key in object) text += key + ";"; return text; }
function counted(words) { const counts = {}; for (let index = 0; index < words.length; index++) { const word = words[index]; counts[word] = (counts[word] || 0) + 1; } return counts; }
const counts = counted(["b", "a", "b", "10", "2", "c", "a", "b"]);
report(keysOf(counts));
report(counts.b);
report(counts["a"]);
report(counts[10]);
report(counts.missing);
report("b" in counts);
report("missing" in counts);
report("toString" in counts);
report(typeof counts.toString);
report(Object.hasOwn(counts, "b"));
report(Object.hasOwn(counts, "toString"));
report(delete counts.b);
report(keysOf(counts));
counts.b = "again";
report(keysOf(counts));
report(Object.getPrototypeOf(counts) === Object.prototype);
function fresh(turn) { const made = {}; for (let index = 0; index < 8; index++) made["k" + ((turn + index) % 11)] = index; return made; }
let all = "";
for (let turn = 0; turn < 30; turn++) all += keysOf(fresh(turn)).length + ",";
report(all);
const many = {};
for (let index = 0; index < 300; index++) many["name" + index] = index;
let sum = 0;
for (const key in many) sum += many[key];
report(sum);
report(many.name299);
const state = { cache: {}, hits: 0 };
function remember(key, value) { if (key in state.cache) state.hits++; state.cache[key] = value; return state.cache[key]; }
report(remember("x", 1));
report(remember("x", 2));
report(remember("y", 3));
report(state.hits);
report(keysOf(state.cache));
const above = { inherited: "from above", set trapped(value) { this.caught = value; } };
function below(key, value) { const made = { __proto__: above }; made[key] = value; return made; }
const heir = below("own", 1);
report(heir.inherited);
report(heir.own);
report(keysOf(heir));
const caught = below("trapped", 5);
report(caught.caught);
report(Object.hasOwn(caught, "trapped"));
report(Object.getPrototypeOf(heir) === above);
const mark = Symbol("mark");
function marked(key) { const made = {}; made[key] = "under a symbol"; return made; }
const withSymbol = marked(mark);
report(withSymbol[mark]);
report(keysOf(withSymbol));
report(Object.getOwnPropertySymbols(withSymbol).length);
function frozen(key) { const made = {}; made[key] = 1; Object.freeze(made); let threw = false; try { (function () { "use strict"; made[key] = 2; })(); } catch (error) { threw = error instanceof TypeError; } return threw + ":" + made[key]; }
report(frozen("held"));
function defined(key) { const made = {}; made[key] = 1; Object.defineProperty(made, key, { get() { return "by a getter"; }, enumerable: false, configurable: true }); return made[key] + ":" + keysOf(made); }
report(defined("seen"));
function proto(key) { const made = {}; made[key] = above; return made.inherited + ":" + Object.hasOwn(made, "__proto__"); }
report(proto("__proto__"));
function numbers() { const made = {}; for (let index = 5; index >= 0; index--) made[index] = index * 2; made["-1"] = "minus"; made["1.5"] = "half"; return keysOf(made) + made[3]; }
report(numbers());
function same(first, second) { return first === second; }
report(same(fresh(1), fresh(1)));
function json(key) { const made = {}; made[key] = [1, { deep: key }]; return JSON.stringify(made); }
report(json("outer"));
function spread(key) { const made = {}; made[key] = 1; const copy = { ...made, more: 2 }; return keysOf(copy); }
report(spread("first"));
function assigned(key) { const made = {}; made[key] = 1; return keysOf(Object.assign(made, { more: 2 })); }
report(assigned("first"));
function either(flag, key) { const made = flag ? {} : { listed: 0 }; made[key] = 1; return keysOf(made) + made.listed; }
report(either(true, "k"));
report(either(false, "k"));
class Holder { constructor() { this.table = {}; } put(key, value) { this.table[key] = value; return this; } get(key) { return this.table[key]; } }
const holder = new Holder().put("one", 1).put("two", 2);
report(holder.get("one") + holder.get("two"));
report(holder.get("three"));
report(keysOf(holder.table));
const settings = { cache: {}, first: { a: 1, b: 2, c: 3, d: 4 }, second: { a: 5, b: 6, c: 7, d: 8 }, third: { a: 9, b: 10, c: 11, d: 12 }, fourth: { a: 13, b: 14, c: 15, d: 16 }, fifth: { a: 17, b: 18, c: 19, d: 20 }, sixth: { a: 21, b: 22, c: 23, d: 24 }, seventh: { a: 25, b: 26, c: 27, d: 28 }, eighth: { a: 29, b: 30, c: 31, d: 32 } };
function keep(key, value) { settings.cache[key] = value; return keysOf(settings.cache); }
report(keysOf(settings.cache));
report(keep("one", 1));
report(keep("two", 2));
report(settings.eighth.d + settings.cache.two);
function last(words) { let made; for (let index = 0; index < words.length; index++) { made = {}; made[words[index]] = index; } return keysOf(made); }
report(last(["a", "b", "c"]));
function listsAnIndex(key) { const made = { 1: "one" }; made[key] = "stored"; return keysOf(made) + made[1]; }
report(listsAnIndex(0));
report(listsAnIndex("4294967294"));
report(listsAnIndex("4294967295"));
report(listsAnIndex("a"));
function listsAnIndexOfValue(value, key) { const made = { 1: value }; made[key] = "stored"; return keysOf(made) + made[1]; }
report(listsAnIndexOfValue("one", 0));
report(listsAnIndexOfValue("one", "4294967294"));
report(listsAnIndexOfValue("one", "a"));
const names = { 1: "one", 2: "two", 3: "three" };
function nameOf(number) { return names[number]; }
function rename(number, name) { names[number] = name; }
report(nameOf(2));
rename(2, "zwei");
rename(0, "null");
report(nameOf(2) + keysOf(names));
function underTextsOfIndexes() { const made = {}; made["3"] = "c"; made["1"] = "a"; made["b"] = "name"; made["2"] = "b"; made["01"] = "no index"; return keysOf(made) + made[3] + made[1]; }
report(underTextsOfIndexes());
report(JSON.stringify(Object.fromEntries([["b", 1], ["a", 2], ["1", 3], ["b", 4]])));
report(JSON.stringify(["x", "y", "x"].reduce((all, each) => { all[each] = (all[each] || 0) + 1; return all; }, {})));
report(JSON.stringify(Object.groupBy([1, 2, 3, 4], each => (each % 2 ? "odd" : "even"))));
report(JSON.stringify(Object.entries(counted(["q", "p", "q"]))));
report(Object.keys(fresh(3)).join());
report(Reflect.ownKeys(marked(mark)).length);
report(structuredClone(counted(["deep"])).deep);
const byMap = new Map(Object.entries(counted(["m", "n", "m"])));
report(byMap.get("m") + byMap.size);
report("end");
