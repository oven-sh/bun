// Fixed seeds of fuzz/every-own-name-of-what-a-commonjs-file-exports-however-it-is-stored-and-taken.ts: a CommonJS file lays names on what it exports, among them the names of
// `Object.prototype`, `default`, `__esModule`, `then` and names that are not enumerable, and another file takes them. It finds the names that it finds in plain Bun.
// From seed 481 on many stores stand under control flow, and most programs take the names through getters of a second CommonJS file over ES modules that hand them on.
import { generate } from "../../fuzz/every-own-name-of-what-a-commonjs-file-exports-however-it-is-stored-and-taken";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [
  5, 6, 13, 18, 22, 37, 38, 41, 49, 55, 81, 101, 108, 116, 166, 186, 187, 213, 238, 273, 276, 286, 302, 311, 317, 349,
  393, 428, 460, 522, 533, 563, 586, 613, 659, 690, 717, 763, 766, 777, 798, 802, 814, 820, 839,
];

generated(
  "every own name of what a CommonJS file exports, however it is stored and taken",
  Array.from({ length: 840 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds of each kind; AOT_GENERATED=all takes all.
    isAlwaysRun: index % 480 < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // An import of a name that is not found ends the program.
    exitsAsPlainBunDoes: true as const,
    // Nothing is put into the text: how a name is stored is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1), index >= 480),
  })),
);
