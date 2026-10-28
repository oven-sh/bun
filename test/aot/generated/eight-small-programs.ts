// A family for ../programs-that-are-only-compiled-share-executables.test.ts, which runs it in a `bun test` of its own. Six programs print what plain Bun prints. One prints where its
// module lies, which is another place in an executable, so its test fails. One is rejected by TypeScript, so there is nothing to compare.
import { tsconfig } from "./births-and-uses/run";
import { generated } from "./run-generated";

const texts = [
  ...Array.from({ length: 6 }, (_, index) => `const n: number = ${index};\nconsole.log("twice", n * 2);\n`),
  `console.log(import.meta.path);\n`,
  `const n: number = "text";\nconsole.log(n);\n`,
];

generated(
  "eight small programs",
  texts.map((text, index) => ({
    name: `program ${index}`,
    isAlwaysRun: true,
    isOnlyCompiled: true as const,
    mayBeUnjudgeable: true as const,
    make: () => ({ file: "program.ts", text, files: { "tsconfig.json": tsconfig } }),
  })),
);
