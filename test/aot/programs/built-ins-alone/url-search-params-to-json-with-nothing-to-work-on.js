const subject = new URLSearchParams();
const result = subject.toJSON();
console.log(typeof result, Object.keys(result).join());
