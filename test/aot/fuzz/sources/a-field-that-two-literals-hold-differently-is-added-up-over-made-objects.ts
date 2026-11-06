// fuzz/a-field-that-two-literals-hold-differently-is-added-up-over-made-objects.ts. Loops add up a field of objects that a function has made, and another literal holds something else under the same name. Built with the types erased. An executable prints what plain Bun prints.
import { generate } from "../a-field-that-two-literals-hold-differently-is-added-up-over-made-objects";
import { Random } from "../random";
import { endless } from "../family";

export default endless("a field that two literals hold differently is added up over made objects", index => ({
  name: `seed ${index + 1}.`,
  flags: ["--aot-erase-types"],
  make: () => generate(new Random(index + 1)),
}));
