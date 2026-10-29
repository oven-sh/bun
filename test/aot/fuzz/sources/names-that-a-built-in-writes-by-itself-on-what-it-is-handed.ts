// fuzz/names-that-a-built-in-writes-by-itself-on-what-it-is-handed.ts: small programs in which an object of the program declares a member, code of the program reads it, and a built-in that is
// handed the object writes a member of that very name by itself.
import { generate } from "../names-that-a-built-in-writes-by-itself-on-what-it-is-handed";
import { Random } from "../random";
import { endless } from "../family";

export default endless("names that a built-in writes by itself on what it is handed", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
