// The setter of self is looked up and called where console log may be any global.
globalThis.__lookupSetter__("self").call({}, "looked up");
if (process.argv.length > 5) console.log = globalThis[process.argv[5]];
console.log(self);
