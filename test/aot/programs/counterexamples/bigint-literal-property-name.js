// `{ 1n: ++n }` has the property "1", and its value is evaluated.
let n = 0;
console.log({ 1n: ++n }[1], n);
