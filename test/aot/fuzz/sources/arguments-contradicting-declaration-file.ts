// Programs of ../arguments-contradicting-declaration-file.ts, one per seed. That file describes them.
import { Random } from "../random";
import { corners, generate } from "../arguments-contradicting-declaration-file";
import { endless } from "../family";

export default endless("arguments contradicting declaration file", index => {
  const corner = corners[index % corners.length];
  // The number of corners is a multiple of three, so the offset shifts by one with every row.
  const isErased = (index + Math.floor(index / corners.length)) % 3 === 2;
  return {
    name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
    ...(isErased && { flags: ["--aot-erase-types"] }),
    make: () => generate(new Random(index + 1), corner),
  };
});
