const lines = [];
function describe(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(describe).join() + "]" : "{" + Object.keys(value).join() + "}";
  return typeof value + ":" + String(value);
}
function show(name, list) {
  const parts = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? describe(list[i]) : "-");
  lines.push(name + ": " + parts.join(" "));
}

const members = new Set([{ a: 1 }, "text", undefined, 3]);
const table = new Map([["k", { v: 1 }], [undefined, undefined]]);
show("set", Array.from(members));
show("set values", Array.from(members.values()));
show("set entries", Array.from(members.entries()));
show("map", Array.from(table));
show("map keys", Array.from(table.keys()));
show("map values", Array.from(table.values()));
show("text", Array.from("a\u{1F600}b"));
show("text iterator", Array.from("xy"[Symbol.iterator]()));
show("list with a hole", Array.from([1, , 3]));
show("list iterator", Array.from([1, , 3].keys()));
show("like a list", Array.from({ length: 3, 0: "first", 2: "third" }));
show("nothing to go over", Array.from({}));
show("number", Array.from(5));

const ownSteps = new Set([1, 2]);
ownSteps[Symbol.iterator] = function* () { yield "own"; yield undefined; };
show("set with steps of its own", Array.from(ownSteps));
class Doubled extends Set { *[Symbol.iterator]() { for (const value of super.values()) { yield value; yield value; } } }
show("class below Set", Array.from(new Doubled(["d"])));
const steppedOnce = table.keys();
steppedOnce.next();
show("iterator that has taken a step", Array.from(steppedOnce));
const nextOfItsOwn = members.values();
nextOfItsOwn.next = function () { return { done: true }; };
show("iterator with a next of its own", Array.from(nextOfItsOwn));
const grows = new Set([1]);
show("set that grows while it is mapped", Array.from(grows, value => { if (value < 3) grows.add(value + 1); return value * 10; }));
class Stack extends Array {}
lines.push("class below Array: " + (Stack.from(members) instanceof Stack) + " " + Stack.from(members).length);
lines.push("another receiver: " + describe(Array.from.call(function (length) { this.given = length; }, new Set(["x"]))));

function firstField(list) { return list[0].a; }
lines.push("field of the first: " + firstField(Array.from(new Set([{ a: 41 }]))));

const counts = [];
counts.push(members.size, table.size, "abc".length, [1, 2].length);
counts.push("abc".indexOf("c"), "abc".indexOf("z"), "abcabc".lastIndexOf("b"), "abc".search(/c/), "abc".search(/z/));
counts.push([5, 6].indexOf(6), [5, 6].indexOf(7), [5, 6].lastIndexOf(5), [5, 6].findIndex(value => value > 5), [5, 6].findLastIndex(value => value > 9));
counts.push([].push(1, 2, 3), [1].unshift(0), "a".localeCompare("b"), "b".localeCompare("a"), "a".localeCompare("a"));
counts.push("a".codePointAt(0), Math.clz32(1), Math.clz32(0), Math.imul(65536, 65536), Math.imul(-1, 5));
counts.push(new Uint8Array(3).length, new Uint8Array(3).byteLength, new ArrayBuffer(7).byteLength, new Float64Array(2).byteOffset, new Uint8Array([9, 8]).indexOf(8));
const view = new DataView(new ArrayBuffer(8));
view.setInt32(0, -1);
counts.push(view.getInt8(0), view.getUint8(0), view.getInt16(0), view.getUint16(0), view.getInt32(0), view.getUint32(0));
show("counts", counts);
let sum = 0;
for (let i = 0; i < counts.length; i++) sum += counts[i];
lines.push("sum " + sum + " " + counts.every(Number.isInteger) + " " + counts.map(count => Object.is(count, -0)).includes(true));
const kept = new Set(counts);
const byCount = new Map(counts.map(count => [count, count / 2]));
lines.push("kept " + kept.size + " " + kept.has(-1) + " " + kept.has(4294967295) + " " + byCount.get(3) + " " + byCount.get(-1));
const indexes = [];
["x", "y", "z"].forEach((text, index, all) => { indexes.push(index / all.length); });
show("indexes", indexes);
show("indexes of a typed array", Array.from(new Uint8Array(3), (value, index) => index - 0.5));
show("indexes of reduce", ["x", "y"].reduce((list, text, index) => { list.push(index * 1.5); return list; }, []));
lines.push("what is no integer: " + "abc".charCodeAt(9) + " " + "abc".codePointAt(9) + " " + new Date(NaN).getFullYear() + " " + [].length / 0 + " " + Math.round(-0.2));
console.log(lines.join("\n"));
