Object.defineProperty(process, "umask", { value() { return super.valueOf(); }, configurable: true });
const held = process.umask();
console.log(held === process, typeof held.allowedNodeEnvironmentFlags);
