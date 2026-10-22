const key = { name: 1 };
const subject = new WeakMap();
const result = subject.getOrInsert(key, 2.5);
console.log(typeof result, result + 1);
