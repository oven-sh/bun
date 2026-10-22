const subject = new Headers();
const result = subject.toJSON();
console.log(typeof result, Object.keys(result).join());
