// The graphs of generated/module-graphs-of-both-kinds.ts where their first file is not what the program starts with: a file in front of it loads it with `import()`, under its name or, as a further
// entry point of the build, under a computed name, with or without a chain of jobs that looks on.
import { startedAs } from "./fuzz/turns-in-which-imports-settle";
import { program } from "./generated/module-graphs-of-both-kinds";
import { generated } from "./generated/run-generated";

const forms = [
  "a further entry point",
  "imported by name",
  "imported beside a chain",
  "a further entry point beside a chain",
] as const;

generated(
  "module graphs of both kinds that import() loads",
  Array.from({ length: 40 }, (_, index) => index + 1).flatMap(seed =>
    forms.map(form => ({
      name: `seed ${seed}, ${form}`,
      // Every run takes the first six seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: seed <= 6,
      isOnlyCompiled: true as const,
      exitsAsPlainBunDoes: true as const,
      keepsItsText: true as const,
      // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
      plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
      make: () => startedAs(form, program(seed)),
    })),
  ),
);
