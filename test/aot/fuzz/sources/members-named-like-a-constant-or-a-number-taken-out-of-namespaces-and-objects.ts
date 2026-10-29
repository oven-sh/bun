// fuzz/members-named-like-a-constant-or-a-number-taken-out-of-namespaces-and-objects.ts: small programs in which an export or a member is named like a constant, a number
// or a built-in, is taken out of its namespace or object in every way there is, and is asked what it is.
import { generate } from "../members-named-like-a-constant-or-a-number-taken-out-of-namespaces-and-objects";
import { Random } from "../random";
import { endless } from "../family";

export default endless("members named like a constant or a number taken out of namespaces and objects", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
