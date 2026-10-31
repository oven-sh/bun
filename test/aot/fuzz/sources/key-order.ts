import { program } from "../generators/key-order";
import { family } from "../family";

export default family(
  "the order of keys",
  Array.from({ length: 40 }, (_, i) => ({ name: `seed ${i + 1}.`, make: () => program(i + 1) })),
);
