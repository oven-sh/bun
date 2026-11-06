// fuzz/the-lists-that-tags-of-templates-are-handed.ts: tagged templates in every kind of function, reached straight and through other functions. One place in the source has one
// list of texts, however often and from wherever it runs, and two places never share one. They print a number for each list, its texts, and whether it can be changed.
import { Random } from "../random";
import { generate } from "../the-lists-that-tags-of-templates-are-handed";
import { endless } from "../family";

export default endless("the lists that tags of templates are handed", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
