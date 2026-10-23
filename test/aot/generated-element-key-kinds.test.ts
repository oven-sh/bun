import { program } from "./generated/element-key-kinds";
import { generated } from "./generated/run-generated";

generated(
  "elements by keys of every kind",
  Array.from({ length: 30 }, (_, i) => i + 1).map(seed => ({
    name: `seed ${seed}`,
    isAlwaysRun: seed <= 2,
    make: () => program(seed),
  })),
);
