class Holder { __proto__ = "a field"; static __proto__ = "a static field"; }
const made = new Holder();
console.log(Object.hasOwn(made, "__proto__"), Object.getPrototypeOf(made) === Holder.prototype, Object.getOwnPropertyDescriptor(made, "__proto__").value);
console.log(Object.hasOwn(Holder, "__proto__"), Object.getPrototypeOf(Holder) === Function.prototype);
