// A File is kept under a name of the global object and read back. A store to its name changes nothing and does not turn the value into a string.
const log = [];
class Name { constructor() { this.reads = 0; } toString() { this.reads = "many"; return "n.txt"; } }
globalThis.__file = new File(["a"], "first.txt");
const name = new Name();
try { globalThis.__file.name = name; } catch (error) { log.push(error.constructor.name); }
log.push(String(globalThis.__file.name), String(name.reads), String(new Name().reads));
console.log(log.join("; "));
