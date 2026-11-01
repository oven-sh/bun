// Printing a warning reads process.stderr, so process lists the key from then on. An executable that holds no streams prints without making the stream.
process.emitWarning("first");
await new Promise(resolve => setImmediate(resolve));
process.emitWarning("second");
await new Promise(resolve => setImmediate(resolve));
const described = Object.getOwnPropertyDescriptor(process, "stderr");
console.log(Object.keys(described).join(), typeof described.value.write, described.writable, described.enumerable, described.configurable);
console.log(described.value === process.stderr, process.stderr.fd);
Object.entries(process);
console.log(Reflect.ownKeys(process).map(String).join());
