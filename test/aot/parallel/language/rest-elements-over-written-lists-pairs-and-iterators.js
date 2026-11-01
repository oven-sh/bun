// A rest element takes every place from its own on, so it holds what all of them hold.
function say(name, list) {
  console.log(name, list.length, list.map(item => typeof item + ":" + String(item)).join(" "));
}
const seed = Number(process.argv.length);
{ const [...all] = ["x", 1]; say("written, all", all); console.log(all[1] + 1, all[0].length); }
{ const [first, ...others] = ["x", 1, true]; say("written, one ahead", others); console.log(first.length, others[0] + 1, !others[1]); }
{ const [first, second, ...others] = ["x", 1, true, null, { o: 1 }.o]; say("written, two ahead", others); console.log(first.length + second); }
{ const [first, second, ...others] = ["x", 1]; say("written, nothing left", others); console.log(others[0]); }
{ const [, ...others] = [seed, "y", 2.5]; say("written, a gap ahead", others); console.log(others[0].length, others[1] * 2); }
{ const [...[a, b, c]] = ["x", 1]; console.log("a pattern in the rest", typeof a, typeof b, typeof c); }
{ const [a, ...[b, ...c]] = ["x", 1, "z", 2]; say("a rest in a rest", c); console.log(a.length, b + 1, c[0].length, c[1] + 1); }
{ let all; [...all] = ["x", 1]; say("assigned", all); console.log(all[1] + 1); }
{ const holder = {}; [holder.first, ...holder.others] = ["x", 1, "z"]; say("into properties", holder.others); console.log(holder.others[0] + 1, holder.others[1].length); }
function parameters([first, ...others]) { return typeof first + " " + others.map(item => typeof item).join(); }
console.log("parameters", parameters(["x", 1, "z"]), parameters([1, "x"]));
function made() { return ["x", 1]; }
{ const [...all] = made(); say("returned", all); console.log(all[1] + 1); }
for (const [...all] of [["x", 1], [2, "y"]]) { say("for-of over written pairs", all); }
for (const [first, ...others] of [["x", 1, "z"], [2, "y", 3]]) { say("for-of, one ahead", others); console.log(typeof first); }
for (const [...all] of Object.entries({ a: 1, b: "two" })) { say("Object.entries", all); console.log(typeof all[1]); }
for (const [key, ...others] of Object.entries({ a: 1 })) { say("Object.entries, one ahead", others); console.log(key.length, others[0] + 1); }
for (const [...all] of new Map([["a", 1], ["b", 2]])) { say("a Map of written pairs", all); console.log(all[1] + 1, all[0].length); }
for (const [key, ...others] of new Map([["a", 1]])) { say("a Map, one ahead", others); console.log(key.length, others[0] + 1); }
for (const [...all] of new Map([["a", 1]]).entries()) { say("Map.entries()", all); console.log(all[1] + 1); }
for (const [...all] of new Set(["s", 2]).entries()) { say("Set.entries()", all); }
for (const [...all] of ["p", "q"].entries()) { say("Array.entries()", all); console.log(all[0] + 1, all[1].length); }
for (const [index, ...others] of ["p"].entries()) { say("Array.entries(), one ahead", others); console.log(index + 1, others[0].length); }
{ const [...all] = Object.entries({ a: 1 })[0]; say("one pair of Object.entries", all); console.log(all[1] + 1); }
{ const [[...inner], ...outer] = [["x", 1], ["y", 2], 3]; say("nested, inner", inner); say("nested, outer", outer); console.log(inner[1] + 1, outer[1] + 1); }
{ const copy = [...["x", 1]]; say("spread", copy); console.log(copy[1] + 1); }
{ const copy = ["w", ...["x", 1], 2]; say("spread in the middle", copy); console.log(copy[2] + 1, copy[1].length); }
function rest(...all) { return all; }
{ const all = rest(...["x", 1]); say("spread into a call", all); console.log(all[1] + 1); }
{ const [a = "d", ...others] = [undefined, 1, "z"]; say("a default ahead", others); console.log(a.length, others[0] + 1); }
{ const numbers = [1, 2, 3, 4, 5]; const [first, ...others] = numbers; say("numbers", others); console.log(first + others.length); }
{ const mixed = [1, "two", 3.5, null, undefined, true]; const [first, ...others] = mixed; say("six kinds", others); console.log(first + 1, others[0].length, others[1] * 2, others[4] === true); }
{ const empty = ["x", 1]; empty.length = 0; const [...all] = empty; say("emptied", all); console.log(all[0]); }
function* steps() { yield "x"; yield 1; }
{ const [...all] = steps(); say("a generator", all); console.log(all[1] + 1); }
{ const [...all] = "xy"; say("a text", all); }
