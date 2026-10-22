const key = { name: 1 };
const subject = new WeakRef(key);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
