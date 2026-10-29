// fuzz/members-removed-at-shared-sites-from-many-kinds-of-objects.ts: three functions remove a member under a written name or a
// key, and objects of many kinds and shapes go through them for a hundred rounds and more. After each removal the program lists and reads what
// is left. One seed in four is a CommonJS file that is not strict.
import { generate } from "../members-removed-at-shared-sites-from-many-kinds-of-objects";
import { Random } from "../random";
import { endless } from "../family";

const listsArgumentsOtherwise: number[] = [158];

export default endless("what is left behind a removal is what is left in plain Bun", index => ({
  name: `seed ${index + 1}.`,
  ...(listsArgumentsOtherwise.includes(index + 1)
    ? { linesDepartToday: "a member added to the arguments of a strict function is listed behind callee" }
    : {}),
  make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
}));
