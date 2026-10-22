const key = { name: 1 };
const subject = new WeakRef(key);
const result = subject.deref();
console.log(typeof result, Object.keys(result).join(), typeof result.name, result.name + 1);
