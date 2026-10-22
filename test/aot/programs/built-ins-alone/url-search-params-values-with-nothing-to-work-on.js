const subject = new URLSearchParams();
const result = subject.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
