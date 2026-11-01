// A fixed list of seeds of ../array-reads-by-any-key.ts, which describes the programs.
import { generate, isAccepted, isWritten, keys, receivers, ways } from "../array-reads-by-any-key";
import { Random } from "../random";
import { family } from "../family";

const programs = receivers.flatMap(receiver =>
  keys.flatMap(key =>
    ways
      .filter(way => isWritten(key, way))
      .flatMap(way =>
        [false, ...(isAccepted(receiver, key) ? [true] : [])].map(isTyped => ({ receiver, key, way, isTyped })),
      ),
  ),
);

export default family(
  "array reads by any key",
  programs.map(({ receiver, key, way, isTyped }, index) => ({
    name: `seed ${index + 1}, ${receiver} under ${key}, which comes as ${way}${isTyped ? ", typed" : ""}.`,
    make: () => generate(new Random(index + 1), receiver, key, way, isTyped),
  })),
);
