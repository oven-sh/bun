// the default of a parameter of a generator function stores another object under `prototype` of the function, and the generator of that very call stands below the new object
const other = Object.create(Object.getPrototypeOf(function* () {}).prototype, { label: { value: "other" } });
function* count(limit = deed()) { for (let i = 0; i < limit; i++) yield i; }
const first = count.prototype;
function deed() { count.prototype = other; return 2; }
function below(generator) { const above = Object.getPrototypeOf(generator); return above === other ? "other" : above === first ? "first" : "neither"; }
console.log(below(count(1)));
console.log(below(count()));
count.prototype = first;
for (let i = 0; i < 3; i++) { console.log(below(count(1)), below(count()), String(count().label)); count.prototype = first; }
let total = 0;
for (const value of count()) total += value;
console.log(String(total));
