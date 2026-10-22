const key = { name: 1 };
const subject = new WeakSet([key]);
const result = subject.delete(key);
console.log(typeof result, result);
