// Fixed seeds of fuzz/names-bound-by-import-equals-to-members-of-namespaces.ts: small TypeScript programs of two to four files in which `import name = holder.member` gives a member of a namespace a
// name of its own, and the name is used as a value.
import { generate } from "./fuzz/names-bound-by-import-equals-to-members-of-namespaces";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [28, 44, 70, 104, 124, 144, 166, 186];

generated(
  "names bound by import equals to members of namespaces",
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
