// Build prints: 0 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
const key = JSON.parse('"constructor"');
const found = {}[key];
console.log(Reflect.defineProperty(found, "groupBy", { value: () => "mine" }));
console.log(JSON.stringify(Object.groupBy([1], () => "a")));
/* Output:
false
{"a":[1]}
*/
