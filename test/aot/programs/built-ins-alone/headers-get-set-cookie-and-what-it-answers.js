const subject = new Headers({ first: "1", second: "two" });
const result = subject.getSetCookie();
console.log(Array.isArray(result), result.length);
