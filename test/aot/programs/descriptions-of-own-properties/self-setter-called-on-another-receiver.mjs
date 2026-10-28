// The setter of globalThis.self defines `self` on the global object, whatever receiver it is called on.
Object.getOwnPropertyDescriptor(globalThis, "self").set.call(undefined, 11);
console.log(self === globalThis, typeof self, typeof globalThis.self);
