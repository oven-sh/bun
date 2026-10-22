const subject = new AsyncDisposableStack();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
