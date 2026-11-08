// This program stopped the build too, and no built-in is the receiver: the checker knows the key, so the load brought little; the read was taken for one under a key that nobody knows.
// STATISTIC: ImageFunctionsEmitted <= 10
const tagKey = Symbol.toStringTag;
class Crate { get [Symbol.toStringTag]() { return "Crate"; } }
console.log(new Crate()[tagKey], Object.prototype.toString.call(new Crate()));
