// fuzz/a-typed-function-lays-a-member-that-is-not-what-its-type-says-into-a-literal-beside-a-number.ts: TypeScript programs of about ten lines: a typed function lays a member of its parameter into a new
// literal beside a number, and is handed, through a function from `any`, an object in which the member holds another kind of value than its type says.
import { generate } from "../a-typed-function-lays-a-member-that-is-not-what-its-type-says-into-a-literal-beside-a-number";
import { Random } from "../random";
import { endless } from "../family";

export default endless(
  "a typed function lays a member that is not what its type says into a literal beside a number",
  index => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  }),
);
