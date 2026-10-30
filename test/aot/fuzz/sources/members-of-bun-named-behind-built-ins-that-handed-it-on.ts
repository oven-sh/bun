// fuzz/members-of-bun-named-behind-built-ins-that-handed-it-on.ts: `Bun` goes through a row of promises, lists, maps, generators,
// copies, descriptors, proxies and objects that inherit from it, and behind the row a member is read, called, constructed, stored or asked for.
import { generate } from "../members-of-bun-named-behind-built-ins-that-handed-it-on";
import { Random } from "../random";
import { endless } from "../family";

const lacksAMember: number[] = [18];

export default endless("a member of Bun that is named behind built-ins answers as in plain Bun", index => ({
  name: `seed ${index + 1}.`,
  ...(lacksAMember.includes(index + 1)
    ? { linesDepartToday: "a member that the program names behind a built-in is not in the executable" }
    : {}),
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
