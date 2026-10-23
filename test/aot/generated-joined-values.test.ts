import { joins, kinds, program } from "./generated/joined-values";
import { generated } from "./generated/run-generated";

generated(
  "joined values",
  kinds.flatMap(kind =>
    joins.map(join => ({
      name: `${kind}, ${join}`,
      isAlwaysRun: kind === "boolean" || join === "A || B",
      make: () => program(kind, join),
    })),
  ),
);
