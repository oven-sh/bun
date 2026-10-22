function read() { return globalThis.__definedLater?.post; }
console.log(typeof read());
globalThis.__definedLater = { post(value) { return value + 1; } };
console.log(typeof read(), read()(1));
