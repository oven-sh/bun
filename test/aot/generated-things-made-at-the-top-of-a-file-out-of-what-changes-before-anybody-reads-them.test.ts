// Fixed seeds of fuzz/things-made-at-the-top-of-a-file-out-of-what-changes-before-anybody-reads-them.ts: a file makes something at its top out of a function, a class, a literal, a list or a variable,
// what it was made out of is changed somewhere else, and only then does somebody read what was made. It is as it was when the file made it.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/things-made-at-the-top-of-a-file-out-of-what-changes-before-anybody-reads-them";
import { generated } from "./generated/run-generated";

const onceWrong = [3, 11, 14, 16, 21, 25, 26, 29, 34, 41, 43, 50];

generated(
  "things made at the top of a file out of what changes before anybody reads them",
  Array.from({ length: 300 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 3 ? ["--aot-validate"] : [],
    make: () => ({ file: "main.js", ...generate(new Random(index + 1)) }),
  })),
);
