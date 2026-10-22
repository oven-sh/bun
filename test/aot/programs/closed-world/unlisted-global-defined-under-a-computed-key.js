function read() { return globalThis.__underAComputedKey; }
console.log(read());
globalThis["__underA" + (process.env.REST ?? "ComputedKey")] = () => "called";
console.log(typeof read(), read()());
