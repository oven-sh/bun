const key = { name: 1 };
const subject = new WeakMap();
const result = subject.get(key);
console.log(typeof result, result === undefined);
