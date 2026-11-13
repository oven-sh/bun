// A store, a definition and `in` under a well-known symbol held in a constant go by that name as the read does. What is stored there is reached when the language looks for it: spread, Array.from, a pattern, instanceof.
const stepsKey = Symbol.iterator;
const testKey = Symbol.hasInstance;
const shelf = { items: [1, 2] };
shelf[stepsKey] = function* () { yield* this.items; };
class Row {}
Row.prototype[stepsKey] = function* () { yield 7; yield 8; };
const Even = {};
Object.defineProperty(Even, testKey, { value: n => n % 2 === 0 });
const [first] = new Row();
console.log([...shelf].join(), Array.from(new Row()).join(), first, 2 instanceof Even, 3 instanceof Even);
console.log(stepsKey in shelf, delete shelf[stepsKey], stepsKey in shelf);
