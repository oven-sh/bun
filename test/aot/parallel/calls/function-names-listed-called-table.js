// Object.getOwnPropertyNames makes the properties `length` and `name` of the function it is handed. The function is still the one it was: a call through the table enters it.
const first = () => "first";
const second = () => "second";
const third = () => "third";
console.log(Object.keys(first).length, Object.getOwnPropertyNames(second).join(), JSON.stringify(third), Object.entries(first).length);
const table = [first, second, third];
function run(n) { return table[n](); }
console.log(run(0), run(1), run(2));
