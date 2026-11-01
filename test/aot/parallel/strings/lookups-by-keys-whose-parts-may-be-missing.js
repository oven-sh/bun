// A key that is put together for one lookup, `table.get(a + ":" + b)`, is looked up by its parts also where a part may be undefined or null, or is now a text and now an integer: each of them prints in one way.
// CALLS+ getWithMissingText operationAOTMapGetByKeyParts
// CALLS+ hasWithMissingInteger operationAOTHasByKeyParts
// CALLS+ listsTextOrInteger operationAOTHasByKeyParts
// CALLS- getWithMissingNumber ByKeyParts
export function getWithMissingText(table, a, b) { return table.get(a + ":" + b); }
export function hasWithMissingInteger(table, a, n) { return table.has(a + "#" + n); }
export function listsTextOrInteger(names, a, b) { return names.has(`${a}${b}`); }
export function getWithMissingNumber(table, a, x) { return table.get(a + "/" + x); }

const table = new Map([["a:b", 1], ["undefined:b", 2], ["null:b", 3], [":b", 4], ["a#7", 5], ["a#null", 6], ["a#undefined", 7], ["a#-2147483648", 8], ["a/1.5", 9], ["a/undefined", 10], ["é:b", 11]]);
const names = new Set(["a1", "1a", "11", "aundefined", "nulla", "undefinednull", "日本7"]);
const texts = ["a", undefined, null, "", "c", "é", "a".repeat(300)];
const integers = [7, null, undefined, -2147483648, 0, 2147483647];
const either = ["a", 1, undefined, null, "日本", 7];
const numbers = [1.5, undefined, 2, NaN];
const int32 = x => (typeof x === "number" ? x | 0 : x);
const lines = [];
for (let round = 0; round < 3; round++) {
  lines.push(texts.map(a => getWithMissingText(table, a, "b")).join());
  lines.push(integers.map(n => hasWithMissingInteger(table, "a", int32(n))).join());
  lines.push(either.map(a => either.map(b => (listsTextOrInteger(names, int32(a), int32(b)) ? 1 : 0)).join("")).join());
  lines.push(numbers.map(x => getWithMissingNumber(table, "a", x)).join());
}
console.log(lines.join("\n"));
