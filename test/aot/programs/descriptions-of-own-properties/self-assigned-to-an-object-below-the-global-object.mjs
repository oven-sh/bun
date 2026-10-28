// Object.assign stores, so it runs the setter of globalThis.self.
const heir = Object.assign(Object.create(globalThis), { self: "assigned" });
console.log(Object.hasOwn(heir, "self"), self);
