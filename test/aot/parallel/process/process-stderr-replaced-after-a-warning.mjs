// A store to process.stderr after a printed warning replaces the member where it stands among the keys. A deleted member stays deleted.
process.emitWarning("a warning");
await new Promise(resolve => setImmediate(resolve));
process.stderr = 5;
console.log(process.stderr, JSON.stringify(Object.getOwnPropertyDescriptor(process, "stderr")));
Object.entries(process);
console.log(Reflect.ownKeys(process).map(String).join());
console.log(delete process.stderr, "stderr" in process, process.stderr);
