// To ask what stands above `process` and to compare the answer looks at the object and reads no member of it: nothing that `process` can do comes along.
// STATISTIC: FunctionsLowered <= 600
const above = Object.getPrototypeOf(process);
console.log(above !== null, above !== Object.prototype, typeof above);
console.log(Reflect.getPrototypeOf(process) === above);
