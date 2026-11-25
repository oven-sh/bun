const taken = [];
Object.defineProperty(process, "umask", { value() { super.hasOwnProperty.call({}, taken.push(super.valueOf())); }, configurable: true });
process.umask();
const held = taken[0];
console.log(held === process, typeof held.allowedNodeEnvironmentFlags);
