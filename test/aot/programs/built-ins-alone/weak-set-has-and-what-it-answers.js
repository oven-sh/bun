const key = { name: 1 };
const subject = new WeakSet([key]);
const result = subject.has(key);
console.log(typeof result, result);
