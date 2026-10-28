// Reflect.set finds the setter of globalThis.self and calls it on the receiver that it is given.
const receiver = {};
console.log(Reflect.set(globalThis, "self", "reflected", receiver), Object.hasOwn(receiver, "self"), self);
