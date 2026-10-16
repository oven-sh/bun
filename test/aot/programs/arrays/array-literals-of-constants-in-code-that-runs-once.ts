// Array literals whose elements are all constants, written at the top level of a module, in functions that the top level calls once, in functions that are called often, and in
// loops: each evaluation makes a new array; what one holder does to its array no other holder sees; the elements are what the text says, whatever their kind.
const lines: string[] = [];
const names = ["alpha", "beta", "gamma", "delta"];
const numbers = [1, 2, 3, 5, 8, 13, 21];
const halves = [0.5, 1.5, 2.5, -0, NaN];
const mixed = [1, "two", null, undefined, true, 4.5, "six"];
const flags = [true, false, true];
const long = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];
function describe(list: readonly unknown[]): string { return list.length + ":" + list.map(item => Object.is(item, -0) ? "-0" : String(item)).join("|"); }
function once(): string[][] { const first = ["once", "upon", "a", "time"]; const second = ["once", "upon", "a", "time"]; return [first, second]; }
function often(): string[] { return ["often", "made", "anew"]; }
function oftenNumbers(): number[] { return [10, 20, 30]; }
lines.push(describe(names), describe(numbers), describe(halves), describe(mixed), describe(flags), describe(long));
const [first, second] = once();
lines.push(String(first === second), describe(first), describe(second));
first.push("more"); first[0] = "changed"; lines.push(describe(first), describe(second));
names.push("epsilon"); names[1] = "BETA"; numbers.length = 3; mixed.reverse(); halves.sort(); flags.fill(false);
lines.push(describe(names), describe(numbers), describe(halves), describe(mixed), describe(flags));
const made: string[][] = []; for (let i = 0; i < 5; i++) { const list = often(); if (i & 1) list.push("odd" + i); else list[0] = "even" + i; made.push(list); }
lines.push(made.map(describe).join(" ; "), describe(often()));
let total = 0; for (let i = 0; i < 1000; i++) { const list = oftenNumbers(); list[i % 3] += i; total += list[0] + list[1] + list[2]; }
lines.push("total " + total);
for (let i = 0; i < 3; i++) { const inLoop = ["in", "a", "loop"]; inLoop[i] = inLoop[i].toUpperCase(); lines.push(describe(inLoop)); }
lines.push(String(Array.isArray(long)), String(long.indexOf("c9")), String(Object.keys(flags).length), JSON.stringify([["nested", "one"], ["nested", "two"], [1, 2], []]));
const frozen = Object.freeze(["kept", "as", "it", "is"]); try { (frozen as string[]).push("no"); } catch (error) { lines.push(error instanceof TypeError ? "TypeError" : "another error"); } lines.push(describe(frozen));
console.log(lines.join("\n"));
