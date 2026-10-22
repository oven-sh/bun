const subject = new Headers({ first: "1" }).entries();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
