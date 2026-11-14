// A fixed list of seeds of ../require-through-reexport-chains.ts, which describes the programs.
import { count, drawnAt, generate } from "../require-through-reexport-chains";
import { Random } from "../random";
import { family } from "../family";

/**
 * The name is destructured from a file with getters, and an ES module without side effects is between that file and
 * another one with getters.
 */
const throughAnEsModuleBetweenGetters = [1257, 1275, 1613, 1614, 1621, 1693, 1775];

export default family(
  "require through reexport chains",
  Array.from({ length: count }, (_, index) => {
    const drawn = drawnAt(index);
    return {
      name: `seed ${index + 1}, ${drawn.take}, side effects: ${drawn.says}, ${drawn.chain?.join(" | ") ?? `${drawn.depth} deep`}.`,
      make: () => generate(new Random(index + 1), drawn),
    };
  }),
);
