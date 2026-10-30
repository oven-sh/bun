// Fixed seeds of fuzz/lists-read-under-keys-of-every-kind.ts: a list, or something that is read as a list is, is read under a key in brackets: its length, a name of its own, a name that an object
// above it has, a symbol, a name that reads as a number, a number. The key comes as a constant, a variable, a parameter, the variable of a loop, a template or one of two. What the read answers goes
// into list literals and typed lists, into arithmetic, a typed parameter, a field of a class and a function with a declared result. The executable prints what plain Bun prints.
// Every receiver meets every key in every way, without types and, where TypeScript accepts the program, with them.
import { generate, isAccepted, isWritten, keys, receivers, ways } from "../lists-read-under-keys-of-every-kind";
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
  "lists read under keys of every kind",
  programs.map(({ receiver, key, way, isTyped }, index) => ({
    name: `seed ${index + 1}, ${receiver} under ${key}, which comes as ${way}${isTyped ? ", typed" : ""}.`,
    make: () => generate(new Random(index + 1), receiver, key, way, isTyped),
  })),
);
