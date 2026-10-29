// fuzz/exports-that-change-and-the-namespaces-that-show-them.ts: ES modules whose exports change while the program runs, files that hand exports on under the same and other names,
// and the namespace objects that show them: their keys, attributes and what may be done to them. Every importer sees each change at once.
import { generate } from "../exports-that-change-and-the-namespaces-that-show-them";
import { Random } from "../random";
import { endless } from "../family";

export default endless("exports that change and the namespaces that show them", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
