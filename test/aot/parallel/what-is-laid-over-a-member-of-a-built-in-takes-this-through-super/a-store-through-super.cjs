Object.defineProperty(process, "umask", { value() { super.argv0 = "mine"; }, configurable: true }); // A guard, no witness: this one was as plain before `super` counted as a place of `this`.
process.umask();
const read = () => process.argv0;
console.log(process.argv0, read());
