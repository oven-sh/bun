const subject = new Headers();
const result = subject.getSetCookie();
console.log(Array.isArray(result), result.length);
