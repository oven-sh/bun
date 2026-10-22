const subject = "x".matchAll(/a/g);
const result = subject.next();
console.log(typeof result, Object.keys(result).join(), typeof result.value, result.value === undefined);
console.log(typeof result.done, result.done);
