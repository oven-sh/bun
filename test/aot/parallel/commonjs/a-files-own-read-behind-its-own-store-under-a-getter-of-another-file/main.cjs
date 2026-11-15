// A getter without a setter ignores the store of the file's own text, and the file's next read asks the getter.
// Todo: "own" | "fake": a wrong answer today: under `bun build --compile --aot` it prints "own", where `bun <file>` prints "fake"
// `module.exports` in a file's own text is the program's variable, and the variable and the object are brought together at a require() alone.
const lib = require("./lib.cjs");
Object.defineProperty(module.children[0], "exports", { get: () => ({ a: "fake" }) });
lib.set({ a: "own" });
console.log(lib.read());
