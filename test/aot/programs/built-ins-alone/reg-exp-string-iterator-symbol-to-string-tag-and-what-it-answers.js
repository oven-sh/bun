const subject = "banana".matchAll(/(a)(n)?/g);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
