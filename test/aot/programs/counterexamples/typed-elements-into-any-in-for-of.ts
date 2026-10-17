// `let x: any; for (x of typedArray)`: the elements keep their own functions.
declare const console: { log(...a: unknown[]): void };
const make = () => ({ m: () => 1 });
let x: any, y: any;
for (x of [1].map(make)); for (y of [1].map(make));
console.log(x.m === y.m);
