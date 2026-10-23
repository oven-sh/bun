// A fixed part of what test/aot/fuzz/run.ts draws from its source unsound-types without end: every hole of TypeScript's type system that generated/unsound-types.ts knows, eight to a
// program, each program from a fixed seed. TypeScript's own checker accepts each program, none has a cast, `any` or `!`, and the executable prints what plain Bun prints.
//
//   bun test test/aot/generated-unsound-types                       one round over the holes
//   AOT_GENERATED=all bun test test/aot/generated-unsound-types     four rounds, every second one of lean programs
import { expect, test } from "bun:test";
import { Random } from "./fuzz/random";
import { typeChecker, writtenEscapes } from "./fuzz/type-check";
import { generated } from "./generated/run-generated";
import { filed, holes, programOfHoles, tsconfig } from "./generated/unsound-types";

/** The programs of the first round that run into a bug that is filed, by their number. Take a line out when its fix is in. */
const failsToday: Record<number, string> = {
  5: "the build stops with BuilderCursorUsedAfterMove: programs/structural-types/the-json-of-a-tuple-is-appended-to-a-string-inside-try-and-finally.ts",
};

const open = holes.filter(hole => !(hole in filed));
const programs = [1, 2, 3, 4].flatMap(round =>
  Array.from({ length: Math.ceil(open.length / 8) }, (_, index) => {
    const some = open.slice(index * 8, index * 8 + 8);
    return {
      name: `round ${round}: ${some.join(", ")}`,
      round,
      index,
      text: programOfHoles(new Random(round * 1000 + index), some, { isLean: round % 2 === 0 }).text,
    };
  }),
);

test("TypeScript accepts every program, and none has a cast, any or !", () => {
  const check = typeChecker();
  expect(check).toBeDefined();
  const errors = check!(programs.map(program => program.text)).flatMap((found, index) =>
    found.map(error => `${programs[index].name}: ${error}`),
  );
  expect(errors).toEqual([]);
  expect(programs.flatMap(program => writtenEscapes(program.text))).toEqual([]);
});

generated(
  "a value arrives where its type says it cannot be",
  programs.map(({ name, round, index, text }) => ({
    name,
    isAlwaysRun: round === 1,
    isOnlyCompiled: true as const,
    ...(round === 1 && failsToday[index] ? { failsToday: failsToday[index] } : {}),
    make: () => ({ file: "main.ts", text, files: { "tsconfig.json": tsconfig } }),
  })),
);
