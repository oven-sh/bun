const subject = new Headers({ first: "1", second: "two" });
const result = subject.get("an");
console.log(result === null);
