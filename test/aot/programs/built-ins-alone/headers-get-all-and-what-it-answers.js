const subject = new Headers({ first: "1", second: "two" });
const result = subject.getAll("Set-Cookie");
console.log(Array.isArray(result), result.length);
