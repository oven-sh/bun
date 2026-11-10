// The printer of warnings reads the platform that it was built for, not `process.platform`: process lists a member from when it is first read.
process.emitWarning("made up");
await new Promise(resolve => setImmediate(resolve));
Object.entries(process);
console.log(Reflect.ownKeys(process).map(String).join());
