// No expression of the program stands for `Bun` where it is stored into, so `import.meta.main` is decided in the code. `bun run` takes the store and an executable may refuse it.
// Either way all that names the main module says the same afterwards.
import { path } from "./other.mjs";
const realm = new Function("return this")();
let caught = "nothing";
try {
  realm["B" + "un"].main = path;
} catch (error) {
  caught = error.name;
}
console.log(caught === "nothing" || caught === "TypeError");
console.log(import.meta.main === (Bun.main === import.meta.path), (caught === "nothing") === (Bun.main === path));
