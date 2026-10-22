const subject = new Headers();
const result = subject.getAll("Set-Cookie");
console.log(Array.isArray(result), result.length);
