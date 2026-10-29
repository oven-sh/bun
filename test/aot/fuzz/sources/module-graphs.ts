import { program } from "../generators/module-graphs";
import { family } from "../family";

// In these graphs it is plain Bun that departs from the language: after one module has thrown synchronously, a module elsewhere in the
// graph that is waiting at an `await` never goes on. The compiled program prints what Node.js prints.
const plainBunDeparts = new Set([559, 560]);

export default family(
  "module graphs",
  Array.from({ length: 600 }, (_, seed) => seed)
    .filter(seed => !plainBunDeparts.has(seed))
    .map(seed => ({ name: `seed ${seed}`, make: () => program(seed) })),
);
