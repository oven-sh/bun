const subject = new URLSearchParams("first=1").entries();
const result = subject.next();
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.value), result.value.length);
console.log(typeof result.value[0], result.value[0].length, result.value[0]);
console.log(typeof result.value[1], result.value[1].length, result.value[1], typeof result.done, result.done);
