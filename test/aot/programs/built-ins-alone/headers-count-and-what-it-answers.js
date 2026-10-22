const subject = new Headers({ first: "1", second: "two" });
const result = subject.count;
console.log(typeof result, result + 1);
