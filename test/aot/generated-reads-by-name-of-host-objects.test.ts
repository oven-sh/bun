import { program } from "./generated/reads-by-name-of-host-objects";
import { generated } from "./generated/run-generated";

// What differs from run to run, what differs between a run from the sources and an executable, and the source text of the functions of built-in modules.
const notCompared = /^(process (title|argv0|pid|execArgv|argv) |performance timeOrigin |fs\.statSync\('\.'\) |module |new (Type)?Error\('m'.* (sourceURL|line|column|stack) |util\.inspect toString )/;
// In the programs of these seeds plain Bun ends with an error that nothing catches.
const endInPlainBun = [3, 9, 15, 19, 21, 27];

generated(
  "reads by name of host objects",
  Array.from({ length: 30 }, (_, i) => i + 1)
    .filter(seed => !endInPlainBun.includes(seed))
    .map(seed => ({ name: `seed ${seed}`, isAlwaysRun: seed <= 2, groupsMayBeRefused: notCompared, make: () => program(seed) })),
);
