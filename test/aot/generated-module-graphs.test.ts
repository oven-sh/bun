import { program } from "./generated/module-graphs";
import { generated } from "./generated/run-generated";

// In these graphs it is plain Bun that departs from the language: after one module has thrown synchronously, a module elsewhere in the
// graph that is waiting at an `await` never goes on. The compiled program prints what Node.js prints.
const plainBunDeparts = new Set([559, 560]);

generated(
  "module graphs",
  Array.from({ length: 600 }, (_, seed) => seed)
    .filter(seed => !plainBunDeparts.has(seed))
    .map(seed => ({ name: `seed ${seed}`, isAlwaysRun: seed < 24, make: () => program(seed) })),
);
