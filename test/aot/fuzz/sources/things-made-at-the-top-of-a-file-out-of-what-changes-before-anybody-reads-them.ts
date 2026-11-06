// fuzz/things-made-at-the-top-of-a-file-out-of-what-changes-before-anybody-reads-them.ts: a file makes something at its top out of a function, a class, a literal, a list or a variable,
// what it was made out of is changed somewhere else, and only then does somebody read what was made. It is as it was when the file made it.
import { Random } from "../random";
import { generate } from "../things-made-at-the-top-of-a-file-out-of-what-changes-before-anybody-reads-them";
import { endless } from "../family";

export default endless("things made at the top of a file out of what changes before anybody reads them", index => ({
  name: `seed ${index + 1}.`,
  // Every fourth is built so that it checks what the compiler took for granted.
  flags: index % 4 === 3 ? ["--aot-validate"] : [],
  make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
}));
