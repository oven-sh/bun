const subject = new Headers({ first: "1", second: "two" });
const result = subject.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
