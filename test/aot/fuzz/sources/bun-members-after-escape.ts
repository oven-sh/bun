// Programs of ../bun-members-after-escape.ts, one per seed. That file describes them.
import { generate } from "../bun-members-after-escape";
import { Random } from "../random";
import { endless } from "../family";

const lacksAMember: number[] = [18];

export default endless("bun members after escape", index => ({
  name: `seed ${index + 1}.`,
  ...(lacksAMember.includes(index + 1)
    ? { linesDepartToday: "a member that the program names behind a built-in is not in the executable" }
    : {}),
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
