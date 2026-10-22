// Species: proxy programs  a blob name is stored through an unknown receiver. It prints what plain Bun prints.
const log = [];
class Name { constructor() { this.reads = 0; } toString() { this.reads = "many"; return "n.txt"; } }
globalThis.__file = new File(["a"], "first.txt");
const name = new Name();
try { globalThis.__file.name = name; } catch (error) { log.push(error.constructor.name); }
log.push(String(globalThis.__file.name), String(name.reads), String(new Name().reads));
console.log(log.join("; "));
