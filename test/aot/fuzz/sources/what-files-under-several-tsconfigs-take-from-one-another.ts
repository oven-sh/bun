// fuzz/what-files-under-several-tsconfigs-take-from-one-another.ts: the files of a project lie under several tsconfig.json files and take from one another what each says of
// itself, constants made of that, packages with a file for `import` and one for `require`, and a `require` that gets paths from the folders of its callers. An executable prints what plain Bun prints.
import { Random } from "../random";
import { generate } from "../what-files-under-several-tsconfigs-take-from-one-another";
import { endless } from "../family";

export default endless("what files under several tsconfigs take from one another", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
