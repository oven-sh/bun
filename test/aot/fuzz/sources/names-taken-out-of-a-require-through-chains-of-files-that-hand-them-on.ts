// Fixed seeds of fuzz/names-taken-out-of-a-require-through-chains-of-files-that-hand-them-on.ts: one name lies in the last file and reaches the first one through a chain of one to four files that hand it on, by
// getters, stars, copies or as ES modules. The first file takes it out of what `require` gives in one of thirty-nine ways, under each of eight things that package.json says of side effects, at each depth, and through an
// ES module between two files with getters; and by a pattern through every pair of forms in a package without side effects. In half of the programs that one read is all that leads to the last file. The executable prints what plain Bun prints.
import { count, drawnAt, generate } from "../names-taken-out-of-a-require-through-chains-of-files-that-hand-them-on";
import { Random } from "../random";
import { family } from "../family";

/** A pattern takes the name from a file with getters, and an ES module without side effects stands between that file and another one with getters. */
const throughAnEsModuleBetweenGetters = [1257, 1275, 1613, 1614, 1621, 1693, 1775];

export default family(
  "names taken out of a require through chains of files that hand them on",
  Array.from({ length: count }, (_, index) => {
    const drawn = drawnAt(index);
    return {
      name: `seed ${index + 1}, ${drawn.take}, side effects: ${drawn.says}, ${drawn.chain?.join(" | ") ?? `${drawn.depth} deep`}.`,
      make: () => generate(new Random(index + 1), drawn),
    };
  }),
);
