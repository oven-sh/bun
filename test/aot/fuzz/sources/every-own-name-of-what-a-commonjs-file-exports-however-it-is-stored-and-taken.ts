// Fixed seeds of fuzz/every-own-name-of-what-a-commonjs-file-exports-however-it-is-stored-and-taken.ts: a CommonJS file lays names on what it exports, among them the names of
// `Object.prototype`, `default`, `__esModule`, `then` and names that are not enumerable, and another file takes them. It finds the names that it finds in plain Bun.
// From seed 481 on many stores stand under control flow, and most programs take the names through getters of a second CommonJS file over ES modules that hand them on.
import { generate } from "../every-own-name-of-what-a-commonjs-file-exports-however-it-is-stored-and-taken";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "every own name of what a CommonJS file exports, however it is stored and taken",
  Array.from({ length: 840 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1), index >= 480),
  })),
);
