// fuzz/literals-in-text-made-at-run-time-that-begin-like-what-the-program-hands-out.ts: text that is evaluated at run time writes object literals that begin with the members of
// literals the program hands out and go on with accessors, spreads, computed keys, indexes and prototypes; the text and the program change them in turns and the program reads them.
import { generate } from "../literals-in-text-made-at-run-time-that-begin-like-what-the-program-hands-out";
import { Random } from "../random";
import { endless } from "../family";

export default endless("literals in text made at run time begin like what the program hands out", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: index & 1 ? "main.js" : "main.ts", text: generate(new Random(index + 1), !(index & 1)) }),
}));
