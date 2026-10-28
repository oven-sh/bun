// Fixed seeds of fuzz/lists-read-under-keys-of-every-kind.ts: a list, or something that is read as a list is, is read under a key in brackets: its length, a name of its own, a name that an object
// above it has, a symbol, a name that reads as a number, a number. The key comes as a constant, a variable, a parameter, the variable of a loop, a template or one of two. What the read answers goes
// into list literals and typed lists, into arithmetic, a typed parameter, a field of a class and a function with a declared result. The executable prints what plain Bun prints.
// Every receiver meets every key in every way, without types and, where TypeScript accepts the program, with them.
import { generate, isAccepted, isWritten, keys, receivers, ways } from "./fuzz/lists-read-under-keys-of-every-kind";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const programs = receivers.flatMap(receiver =>
  keys.flatMap(key =>
    ways
      .filter(way => isWritten(key, way))
      .flatMap(way =>
        [false, ...(isAccepted(receiver, key) ? [true] : [])].map(isTyped => ({ receiver, key, way, isTyped })),
      ),
  ),
);

const onceWrong = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 106, 107, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133,
  135, 136, 225, 226, 239, 242, 244, 250, 254, 344, 345, 359, 360, 361, 364, 365, 369, 597, 599, 601, 602, 605, 609,
  690,
];

generated(
  "lists read under keys of every kind",
  programs.map(({ receiver, key, way, isTyped }, index) => ({
    name: `seed ${index + 1}, ${receiver} under ${key}, which comes as ${way}${isTyped ? ", typed" : ""}.`,
    // Every run takes one program in seven; AOT_GENERATED=all takes all.
    isAlwaysRun: index % 7 === 0,
    isOnlyCompiled: true as const,
    ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
    make: () => generate(new Random(index + 1), receiver, key, way, isTyped),
  })),
);
