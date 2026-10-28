// The descriptions of all own properties of the global object hold the setter of `self`.
const { get, set, value } = Object.getOwnPropertyDescriptors(globalThis).self;
console.log(typeof get, typeof set, value, get() === globalThis);
set.call(undefined, "described");
console.log(self, typeof self, globalThis.self);
