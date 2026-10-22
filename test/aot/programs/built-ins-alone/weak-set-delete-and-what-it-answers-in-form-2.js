const key = { name: 1 };
const subject = new WeakSet([key]);
const result = subject.delete(1.5);
console.log(typeof result, result);
