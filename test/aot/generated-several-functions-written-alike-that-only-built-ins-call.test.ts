// Fixed seeds of fuzz/several-functions-written-alike-that-only-built-ins-call.ts: small programs of one to fourteen cases: each lays a function on an object under a name or a symbol that a built-in reads by
// itself and hands the object to that built-in; nothing in the program calls the function, and all functions of a program are written alike.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/several-functions-written-alike-that-only-built-ins-call";
import { generated } from "./generated/run-generated";

const onceWrong = [16, 178, 201, 229];

generated(
  "several functions written alike that only built-ins call",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: how many functions of one form the program holds is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
