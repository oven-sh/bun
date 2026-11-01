// A list of programs from ../generators/module-graphs.ts, which describes them.
import { program } from "../generators/module-graphs";
import { family } from "../family";

// In these graphs plain Bun deviates from the specification: after one module has thrown synchronously, a module
// elsewhere in the graph that is suspended at an `await` never resumes. The compiled program prints what Node.js
// prints.
const plainBunDeparts = new Set([559, 560]);

export default family(
  "module graphs",
  Array.from({ length: 600 }, (_, seed) => seed)
    .filter(seed => !plainBunDeparts.has(seed))
    .map(seed => ({ name: `seed ${seed}`, make: () => program(seed) })),
);
