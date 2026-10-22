const subject = new Headers({ first: "1", second: "two" });
const result = subject.delete("an");
console.log(typeof result, result === undefined);
