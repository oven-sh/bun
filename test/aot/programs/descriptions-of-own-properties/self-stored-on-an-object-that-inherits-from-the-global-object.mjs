// A store to `self` on an object that inherits from the global object runs the setter of globalThis.self, which defines `self` on the global object.
const heir = Object.create(globalThis);
heir.self = 1;
console.log(self === globalThis, typeof self, Object.hasOwn(heir, "self"));
