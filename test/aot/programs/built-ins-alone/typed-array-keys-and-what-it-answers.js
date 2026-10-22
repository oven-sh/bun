const subject = new Uint8Array([1, 2, 3]);
const result = subject.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, 1 / step.value, [...result].length);
