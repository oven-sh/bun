class Holder { __proto__() { return "a method"; } }
const made = new Holder();
console.log(made.__proto__(), Object.hasOwn(Holder.prototype, "__proto__"), Object.getPrototypeOf(made) === Holder.prototype);
