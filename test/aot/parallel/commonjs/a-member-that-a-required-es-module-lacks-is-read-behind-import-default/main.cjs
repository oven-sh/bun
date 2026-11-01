// Flags: --aot-validate
// What tsc emits for `import x from "./dep"` is __importDefault(require("./dep")). An ES module that is required comes back as its namespace object, and nine functions that one call chooses among use it:
// one of them reads a member that the module does not export. A namespace object is no compiled object: a test of what lies above an object and of what it holds besides has no words to read in it.
const imported = require("./imported.cjs");
for (const name of ["dumped", "listed", "default", "first", "second", "kind", "called", "names", "text"]) {
  let answer;
  try {
    answer = imported.uses[name]();
  } catch (error) {
    answer = "!" + error.name;
  }
  console.log(name + " " + String(answer));
}
