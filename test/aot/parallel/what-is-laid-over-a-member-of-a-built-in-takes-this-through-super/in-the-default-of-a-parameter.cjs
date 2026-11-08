Object.defineProperty(process, "umask", { value(held = super.valueOf()) { return held; }, configurable: true });
const held = process.umask();
console.log(held === process, typeof held.allowedNodeEnvironmentFlags);
