let n = 0;
const key = { toString() { return n++ ? "b" : "a"; } };
const target = {};
Object.defineProperty(target, key, Object.getOwnPropertyDescriptor({ get a() { return "a"; }, get b() { return "b"; } }, key));
console.log(target.b);
