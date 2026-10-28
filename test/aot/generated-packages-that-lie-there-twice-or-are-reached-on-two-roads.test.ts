// Fixed seeds of fuzz/packages-that-lie-there-twice-or-are-reached-on-two-roads.ts: a package lies in node_modules twice (two versions, two copies, a file for `import` and one for `require`) or once and is reached on two
// roads (by itself, by name and by path, under two subpaths, through "imports", through links to a store). The program takes it itself and through a package that depends on it, and asks both for their version, their
// counter, their class and the fields of their instances. TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints. Every third program is built with its types erased.
import { corners, generate } from "./fuzz/packages-that-lie-there-twice-or-are-reached-on-two-roads";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "packages that lie there twice or are reached on two roads",
  Array.from({ length: corners.length * 24 }, (_, index) => {
    const corner = corners[index % corners.length];
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isErased ? ", types erased" : ""}.`,
      // Every run takes two seeds of each corner; AOT_GENERATED=all takes all.
      isAlwaysRun: index < corners.length * 2,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: its node_modules is its own.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
