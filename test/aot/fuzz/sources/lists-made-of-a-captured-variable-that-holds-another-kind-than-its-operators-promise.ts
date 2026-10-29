// fuzz/lists-made-of-a-captured-variable-that-holds-another-kind-than-its-operators-promise.ts: small programs in which the operators used on a variable, or its declared
// type, promise one kind of value, the variable holds another kind, a closure has captured it, and a list, a view or an object is made of it.
import { generate } from "../lists-made-of-a-captured-variable-that-holds-another-kind-than-its-operators-promise";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "lists made of a captured variable that holds another kind than its operators promise",
  index => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
