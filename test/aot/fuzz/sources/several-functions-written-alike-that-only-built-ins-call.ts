// fuzz/several-functions-written-alike-that-only-built-ins-call.ts: small programs of one to fourteen cases: each lays a function on an object under a name or a symbol that a built-in reads by
// itself and hands the object to that built-in; nothing in the program calls the function, and all functions of a program are written alike.
import { Random } from "../random";
import { generate } from "../several-functions-written-alike-that-only-built-ins-call";
import { endless } from "../family";

export default endless("several functions written alike that only built-ins call", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 2 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1)),
}));
