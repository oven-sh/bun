const subject = new Uint8Array(0);
const result = subject.entries();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
