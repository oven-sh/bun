const subject = new Uint8Array(0);
const result = subject.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
