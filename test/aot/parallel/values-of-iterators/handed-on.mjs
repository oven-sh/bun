// What a built-in iterator hands out is what its collection holds, whoever takes it: a list, a set, a map, a promise; an iterator with a next of its own hands out what that returns.
class Vector { constructor(x) { this.x = x; } add(other) { return this.x + other.x; } }
const lines = [];
function say(...values) { lines.push(values.join(" ")); }
const map = new Map([[1, new Vector(1)], [2, new Vector(2)]]);
const set = new Set([new Vector(3), new Vector(4)]);
const list = [new Vector(5), new Vector(6)];
function total(vectors) { let sum = 0; for (const vector of vectors) sum += vector.add(vector); return sum; }
say("map values", total(Array.from(map.values())), total([...map.values()]), total(new Set(map.values())));
say("map keys", Array.from(map.keys()).join(), new Set(map.keys()).size);
say("map entries", Array.from(map.entries()).map(([key, vector]) => key + vector.x).join(), total(new Map(map.entries()).values()));
say("set", total(Array.from(set.values())), total(new Set(set.keys())), Array.from(set.entries()).map(([one, other]) => one === other).join());
say("list", total(Array.from(list.values())), Array.from(list.keys()).join(), Array.from(list.entries()).map(([index, vector]) => index + vector.x).join());
say("mapped", Array.from(map.values(), vector => vector.x * 2).join());
for (const vector of Array.from(map.values())) vector.x = "t" + vector.x;
say("stored", Array.from(map.values(), vector => vector.x + 1).join());
const own = set.values();
own.next = function () { return this.done ? { done: true } : (this.done = true, { value: new Vector(70), done: false }); };
say("own next", total(Array.from(own)));
const other = list.values();
other[Symbol.iterator] = function () { return [new Vector(80)][Symbol.iterator](); };
say("own iterator", total(Array.from(other)), total(new Set(other)));
const under = list.values();
under["ne" + (process.argv[9] ?? "xt")] = () => ({ done: true, value: 1 });
say("own next under a key", Array.from(under).length);
const half = list[Symbol.iterator]();
half.next();
say("half", total(Array.from(half)));
say("text", Array.from("ab"[Symbol.iterator]()).join());
say("matches", Array.from("a1b2".matchAll(/[a-z](\d)/g), match => match[1]).join());
function* generate() { yield new Vector(1); yield new Vector(2); }
say("generator", total(Array.from(generate())), total(new Set(generate())));
const promised = await Promise.all(list.values());
say("promised", total(promised));
const weak = new WeakSet(list.values());
say("weak", weak.has(list[0]), weak.has(new Vector(5)));
say("typed", Array.from(new Uint8Array([1, 2]).values()).join(), Array.from(new Uint8Array([3, 4]).entries()).join());
const changed = new Map([[1, new Vector(1)]]);
const walked = changed.values();
changed.set(2, new Vector("late"));
say("late", Array.from(walked, vector => vector.x + 1).join());
let count = 0;
for (let turn = 0; turn < 200; turn++) count += total(Array.from(new Map([[turn, new Vector(turn)]]).values()));
say("turns", count);
console.log(lines.join("\n"));
