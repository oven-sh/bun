const subject = new Headers({ first: "1", second: "two" });
const result = subject.delete(1.5);
console.log(typeof result, result === undefined);
