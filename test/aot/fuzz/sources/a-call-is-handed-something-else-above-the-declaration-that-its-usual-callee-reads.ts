// fuzz/a-call-is-handed-something-else-above-the-declaration-that-its-usual-callee-reads.ts: small programs about one place that calls, constructs or asks a member of whatever it is handed:
// forty times a function, class or object of the program, and once, above the declaration that this one reads, something else that answers to the same use.
import { generate } from "../a-call-is-handed-something-else-above-the-declaration-that-its-usual-callee-reads";
import { Random } from "../random";
import { endless } from "../family";

export default endless("a call is handed something else above the declaration that its usual callee reads", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
