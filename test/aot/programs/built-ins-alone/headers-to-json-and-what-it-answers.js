const subject = new Headers({ first: "1", second: "two" });
const result = subject.toJSON();
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first.length, result.first);
console.log(typeof result.second, result.second.length, result.second);
