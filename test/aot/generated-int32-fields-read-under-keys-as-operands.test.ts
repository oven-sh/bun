// Fixed seeds of fuzz/int32-fields-read-under-keys-as-operands.ts: fields declared int32 are read with brackets, under a key that is one of a few
// names, a symbol, an enum member or a parameter, as operands of operators and of built-in functions. The objects come out of JSON.parse, so a
// field may hold what is no int32. The build takes every form, and the executable prints what plain Bun prints.
import { generate } from "./fuzz/int32-fields-read-under-keys-as-operands";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

generated(
  "int32 fields read under keys are operands as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  })),
);
