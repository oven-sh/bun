const key = { name: 1 };
const subject = new WeakMap();
const result = subject.delete(key);
console.log(typeof result, result);
