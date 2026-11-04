// The symbol comes out of a read under a name that is made when the program runs, off a value that may be Bun.inspect.
const holder = process.argv.length > 99 ? {} : Bun.inspect;
const name = process.argv.length > 99 ? "table" : "custom";
console.log({ [holder[name]]() { return "mine"; } });
