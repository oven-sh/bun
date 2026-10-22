const subject = new DisposableStack();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
