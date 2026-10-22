const subject = new Headers({ first: "1", second: "two" });
const result = subject.get(1.5);
console.log(result === null);
