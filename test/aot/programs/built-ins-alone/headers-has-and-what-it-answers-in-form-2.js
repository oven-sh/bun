const subject = new Headers({ first: "1", second: "two" });
const result = subject.has(1.5);
console.log(typeof result, result);
