// Fixed seeds of fuzz/statements-between-a-declaration-and-the-return-of-its-variable.ts: functions that declare a variable whose value a build may know, do something, and give the variable back.
import { Random } from "./fuzz/random";
import {
  flagsOfABuildThatIgnoresMarks,
  flagsOfTheBuild,
  generate,
} from "./fuzz/statements-between-a-declaration-and-the-return-of-its-variable";
import { generated } from "./generated/run-generated";

const dialects = [
  "module",
  "commonjs",
  "typescript",
  "module",
  "module",
  "commonjs",
  "typescript",
  "typescript that nobody checks",
] as const;

const onceWrong = [4, 8, 12, 19, 28, 32, 43, 63, 69, 74, 75, 76];

generated(
  "statements between a declaration and the return of its variable",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first forty seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 40,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Every second is compiled as it is written.
    keepsItsText: index % 2 === 0 || undefined,
    // Every eighth is built so that it checks what the compiler took for granted.
    flags: index % 8 === 5 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1), dialects[index % dialects.length]),
  })),
);

const onceWrongUnderFlags = [1, 3, 5, 8, 15, 18, 34, 47, 48, 58];

const dialectsWithImports = ["module", "typescript", "module", "typescript that nobody checks"] as const;

generated(
  "statements between a declaration and the return of its variable that the flags of the build decide about",
  Array.from({ length: 300 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrongUnderFlags.includes(index + 1),
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    referenceIsCompiled: true as const,
    flagsOfBothBuilds: index % 3 === 2 ? flagsOfABuildThatIgnoresMarks : flagsOfTheBuild,
    make: () => generate(new Random(index + 1), dialectsWithImports[index % dialectsWithImports.length], true),
  })),
);
