import { program } from "./generated/key-order";
import { generated } from "./generated/run-generated";

generated(
  "the order of keys",
  Array.from({ length: 40 }, (_, i) => ({ name: `seed ${i + 1}.`, isAlwaysRun: i < 2, make: () => program(i + 1) })),
);
