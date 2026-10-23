// The language under --aot is the language of plain Bun. A type that is written in a program is a claim that the compiler may bet on, never a check: a cast lets every value through, a field, a parameter,
// a result, an element takes a value of any kind by whatever way it gets there, and the code behind it does with that value what plain Bun does. New errors come at build time only.
// (The one exception is not about types: the built-ins that are locked. ./programs/type-rules has those.)
//
// NO PROGRAM OF THIS FOLDER HAS A STORED OUTPUT: what plain Bun prints is what is expected, with the types and with the types erased.
import { expect, test } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";
import { programs, programsBuiltWith } from "./run-programs";

programs("nothing-throws-because-of-a-type");
// Where the compiler tests every fact it used, a bet that was taken for a fact ends the program.
programsBuiltWith("nothing-throws-because-of-a-type", "validated", ["--aot-validate"]);
// Cold code goes by records and stubs in the place of tests in line.
programsBuiltWith("nothing-throws-because-of-a-type", "every-function-cold", ["--aot-heat=everything-is-cold"]);
programsBuiltWith("nothing-throws-because-of-a-type", "every-function-cold-types-erased", [
  "--aot-heat=everything-is-cold",
  "--aot-erase-types",
]);

test("no program of the folder says that --aot may differ from plain Bun", () => {
  const files = readdirSync(join(import.meta.dir, "programs", "nothing-throws-because-of-a-type"), {
    recursive: true,
  }) as string[];
  expect(files.filter(file => /\.(expected|erased|build-errors|todo)\.txt$/.test(file))).toEqual([]);
});
