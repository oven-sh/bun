// fuzz/files-that-export-one-value-and-every-way-to-import-it.ts: files that end in `export = value` and files that import them by `import name = require(..)`, as the default,
// as a namespace, by the names of members, by `require(..)` and by `import(..)`. They print which files run, in which order, and what arrives.
import { generate } from "../files-that-export-one-value-and-every-way-to-import-it";
import { Random } from "../random";
import { endless } from "../family";

export default endless("files that export one value and every way to import it", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", ...generate(new Random(index + 1)) }),
}));
