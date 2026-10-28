// Fixed seeds of fuzz/names-that-a-built-in-writes-by-itself-on-what-it-is-handed.ts: small programs in which an object of the program declares a member, code of the program reads it, and a built-in that is
// handed the object writes a member of that very name by itself.
import { generate } from "./fuzz/names-that-a-built-in-writes-by-itself-on-what-it-is-handed";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [29, 35, 54, 55, 61, 66, 89, 128, 134, 142, 175, 205, 207, 217, 223];

generated(
  "names that a built-in writes by itself on what it is handed",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Every second is compiled as it is written.
    keepsItsText: index % 2 === 0 || undefined,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
