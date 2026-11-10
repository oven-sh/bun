// Programs of ../reexports-read-during-load-cycle.ts, one per seed. That file describes them.
import { corners, generate } from "../reexports-read-during-load-cycle";
import { Random } from "../random";
import { endless } from "../family";

/**
 * A getter returns the whole dependency from a `const` declared after it, and it is read while that file is still
 * loading.
 */
const constBehindItsGetter = [7, 169, 304, 493];

export default endless("reexports read during load cycle", index => {
  const corner = corners[index % corners.length];
  // The number of corners is a multiple of three, so the offset shifts by one with every row.
  const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
  return {
    name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), corner),
  };
});
