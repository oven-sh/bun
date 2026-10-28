// Fixed seeds of fuzz/a-typed-function-lays-a-member-that-is-not-what-its-type-says-into-a-literal-beside-a-number.ts: TypeScript programs of about ten lines: a typed function lays a member of its parameter into a new
// literal beside a number, and is handed, through a function from `any`, an object in which the member holds another kind of value than its type says.
import { generate } from "./fuzz/a-typed-function-lays-a-member-that-is-not-what-its-type-says-into-a-literal-beside-a-number";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [17, 27, 37, 57, 90, 93, 153, 183, 188, 196, 202, 204, 230, 232, 236];

generated(
  "a typed function lays a member that is not what its type says into a literal beside a number",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the program is a few lines, and that nothing else stands in it is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
