// fuzz/effects-inside-expressions-whose-value-nobody-uses.ts: small programs of statements whose value nobody uses, with something inside each that happens all the same.
import { generate } from "../effects-inside-expressions-whose-value-nobody-uses";
import { Random } from "../random";
import { endless } from "../family";

export default endless("effects inside expressions whose value nobody uses", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
