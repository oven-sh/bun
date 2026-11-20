// `fn(...bound, ...rest)`: the list of what is passed holds whole numbers and the rest lists are lists of values: their members are appended in the stub: if each append left it for the run time's operation, a call through `partial` would cost twice as much.
// COUNT: operation:operationAOTAppendElements <= 20
const line = (a, b, x) => a * x + b;
const partial = (fn, ...bound) => (...rest) => fn(...bound, ...rest);
const scale = partial(line, 3, 4);
let sum = 0;
for (let x = 0; x < 3000; x++) sum += scale(x);
console.log("SAID " + sum);
