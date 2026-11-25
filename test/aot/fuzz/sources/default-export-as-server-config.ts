// A fixed list of seeds of ../default-export-as-server-config.ts, which describes the programs.
import { generate } from "../default-export-as-server-config";
import { Random } from "../random";
import { family, type Drawn } from "../family";

const programs = family(
  "default export as server config",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => generate(new Random(index + 1)),
  })),
);

// Only the default export of a build's entry point is served: as a module of a shared build a program starts no server.
const asEntryPoint: Drawn = (seed, runner) => {
  const program = programs(seed, runner);
  return program && { ...program, needsOwnBuild: true };
};

export default asEntryPoint;
