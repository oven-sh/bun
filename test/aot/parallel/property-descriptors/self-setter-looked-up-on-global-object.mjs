// __lookupSetter__ hands out the setter of globalThis.self.
globalThis.__lookupSetter__("self").call({}, "looked up");
console.log(self, typeof self, globalThis.self);
