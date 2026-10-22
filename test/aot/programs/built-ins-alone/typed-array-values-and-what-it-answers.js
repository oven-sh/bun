const subject = new Uint8Array([1, 2, 3]);
const result = subject.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);
