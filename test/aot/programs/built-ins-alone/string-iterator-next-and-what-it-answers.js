const subject = "ab"[Symbol.iterator]();
const result = subject.next();
console.log(typeof result, Object.keys(result).join(), typeof result.value, result.value.length, result.value);
console.log(typeof result.done, result.done);
