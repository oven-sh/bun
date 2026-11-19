// STATISTIC: BuiltinCallsOnNarrowRow >= 5
// STATISTIC: BuiltinCallsOnOnlyRow >= 2
// STATISTIC: BuiltinCallsOnNarrowRow <= 20
// STATISTIC: BuiltinCallsOnOnlyRow <= 8
// Calls in the program's own files are counted by the row of the built-in that they take. Library modules make hundreds of such calls, which are not counted.
const list = [3, 1, 2];
const text = "abcdef";
console.log(list.slice(1).length);
console.log(list.indexOf(2));
console.log(list.includes(7));
console.log(text.charCodeAt(2));
console.log(Math.max(list[0], 2));
const ownKeys = value => Object.keys(value).length;
console.log(ownKeys(JSON.parse('{"a":1}')));
