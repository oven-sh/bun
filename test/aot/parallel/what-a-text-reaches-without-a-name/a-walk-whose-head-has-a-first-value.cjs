// Sloppy code may give the declared head of a walk over names a first value: the variable still holds the names.
const steps = JSON.parse(process.argv[2] ?? '{"flatMap":0}');
let value = [1, 2];
for (var step = 0 in steps) value = value[step]((n) => [n, n]);
console.log(value);
