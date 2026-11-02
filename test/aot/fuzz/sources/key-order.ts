// A list of programs from ../generators/key-order.ts, which describes them.
import { program } from "../generators/key-order";
import { family } from "../family";

export default family(
  "key order",
  Array.from({ length: 40 }, (_, i) => ({ name: `seed ${i + 1}.`, make: () => program(i + 1) })),
);
