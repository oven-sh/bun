const key = { name: 1 };
const subject = new WeakMap();
const result = subject.has(key);
console.log(typeof result, result);
