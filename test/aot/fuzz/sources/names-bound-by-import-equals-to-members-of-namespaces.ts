// fuzz/names-bound-by-import-equals-to-members-of-namespaces.ts: small TypeScript programs of two to four files in which `import name = holder.member` gives a member of a namespace a
// name of its own, and the name is used as a value.
import { generate } from "../names-bound-by-import-equals-to-members-of-namespaces";
import { Random } from "../random";
import { endless } from "../family";

export default endless("names bound by import equals to members of namespaces", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
