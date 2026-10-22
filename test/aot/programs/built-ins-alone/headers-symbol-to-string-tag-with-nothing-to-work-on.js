const subject = new Headers();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
