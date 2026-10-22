const subject = new Headers({ first: "1", second: "two" });
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
