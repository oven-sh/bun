import { program } from "./generated/host-object-named-reads";
import { generated } from "./generated/run-generated";

// What differs from run to run, what differs between a run from the sources and an executable, the source text of the functions of built-in modules,
// and the source text of a class or a function of the program: an executable has it as it was written, plain Bun as its transpiler printed it.
const notCompared =
  /^(process (title|argv0|pid|execArgv|argv) |performance timeOrigin |fs\.statSync\('\.'\) |module |new (Type)?Error\('m'.* (sourceURL|line|column|stack) |util\.inspect toString |class K \{.*\} toString |\(a => a\) toString )/;
// In the programs of these seeds plain Bun ends with an error that nothing catches.
const endInPlainBun = [3, 9, 15, 19, 21, 27];

generated(
  "reads by name of host objects",
  Array.from({ length: 30 }, (_, i) => i + 1)
    .filter(seed => !endInPlainBun.includes(seed))
    .map(seed => ({
      name: `seed ${seed}`,
      isAlwaysRun: seed <= 2,
      groupsMayBeRefused: notCompared,
      make: () => program(seed),
    })),
);
