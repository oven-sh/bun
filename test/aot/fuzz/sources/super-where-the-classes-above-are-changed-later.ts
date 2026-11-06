// fuzz/super-where-the-classes-above-are-changed-later.ts: classes that use `super.name` and `super(..)` in every place, while the program changes the prototypes of the class and of its
// `prototype`, and replaces, deletes and adds members above. `super` asks what stands above at that moment.
import { Random } from "../random";
import { generate } from "../super-where-the-classes-above-are-changed-later";
import { endless } from "../family";

export default endless("super where the classes above are changed later", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
