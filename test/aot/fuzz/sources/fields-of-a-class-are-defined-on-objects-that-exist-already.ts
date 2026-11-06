// fuzz/fields-of-a-class-are-defined-on-objects-that-exist-already.ts. The base of a class returns an object that exists already, and the fields of the class are defined on it: objects of one maker, changed in several ways, one after the other. An executable prints what plain Bun prints.
import { generate } from "../fields-of-a-class-are-defined-on-objects-that-exist-already";
import { Random } from "../random";
import { endless } from "../family";

export default endless("fields of a class are defined on objects that exist already", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
