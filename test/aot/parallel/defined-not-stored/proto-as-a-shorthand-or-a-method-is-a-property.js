const __proto__ = { member: "above" };
const short = { __proto__ };
console.log(Object.getPrototypeOf(short) === Object.prototype, Object.hasOwn(short, "__proto__"), short.member);
const method = { __proto__() { return "a method"; } };
console.log(Object.getPrototypeOf(method) === Object.prototype, Object.hasOwn(method, "__proto__"), method.__proto__());
const accessor = { get __proto__() { return "a getter"; } };
console.log(Object.getPrototypeOf(accessor) === Object.prototype, accessor.__proto__);
