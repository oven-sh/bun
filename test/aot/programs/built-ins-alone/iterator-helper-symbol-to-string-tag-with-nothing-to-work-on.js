const subject = [].values().map(value => value);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
