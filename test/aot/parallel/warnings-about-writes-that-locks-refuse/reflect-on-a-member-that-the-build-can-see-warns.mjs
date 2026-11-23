// Build prints: 1 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
console.log(Reflect.defineProperty(Object, "groupBy", { value: () => "mine" }));
console.log(JSON.stringify(Object.groupBy([1], () => "a")));
/* Output:
false
{"a":[1]}
*/
