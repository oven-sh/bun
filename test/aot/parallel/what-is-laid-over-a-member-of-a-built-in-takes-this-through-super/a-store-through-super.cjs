Object.defineProperty(process, "umask", { value() { super.argv0 = "mine"; }, configurable: true });
process.umask();
const read = () => process.argv0;
console.log(process.argv0, read());
