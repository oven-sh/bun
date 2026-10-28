// Nothing stores `self`, so it stays the global object.
const heir = Object.create(globalThis);
heir.other = 1;
console.log(self === globalThis, typeof self.setTimeout, heir.self === globalThis, Object.keys(heir).join());
