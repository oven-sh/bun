const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.toJSON();
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.first), result.first.length);
console.log(typeof result.first[0], result.first[0].length, result.first[0]);
console.log(typeof result.first[1], result.first[1].length, result.first[1]);
console.log(typeof result.second, result.second.length, result.second);
