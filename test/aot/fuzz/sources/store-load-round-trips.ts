// A fixed list of seeds of ../store-load-round-trips.ts, which describes the programs.
import { Random } from "../random";
import { corners, drawn, generate } from "../store-load-round-trips";
import { family } from "../family";

/**
 * A loader, `eval` or a Function constructor is stored and read back with a computed key. The compiler cannot tell that
 * the call reaches it, so the executable rejects the call.
 */
const computedKeyReads = [
  "a key that is put together where it is read",
  "a variable that a module exports, under a key that is put together",
];
const loadersAndEvaluators = [
  "a function that loads modules",
  "the constructor of functions",
  "the function that evaluates text",
  "the constructor of generator functions",
  "the constructor of asynchronous functions",
  "the constructor of asynchronous generator functions",
];

export default family(
  "store load round trips",
  drawn.map(({ corner, thing, then }, index) => {
    const row = Math.floor(index / corners.length);
    const isErased = (index + row) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}, ${then ? `then ${then}, ` : ""}${thing}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // An executable does not list its own modules in require.cache, with or without --aot.
      ...(corner === "the cache of require" && { referenceIsCompiled: true as const }),
      ...(loadersAndEvaluators.includes(thing) &&
        (computedKeyReads.includes(corner) || computedKeyReads.includes(then!)) && {
          linesDepartToday: "a loader or evaluator read back with a computed key is rejected",
        }),
      make: () => generate(new Random(index + 1), corner, thing, then),
    };
  }),
);
