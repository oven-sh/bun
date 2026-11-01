// No new place in the C++ of --aot where a call is made, or a function left, while somebody still owes a look at the exception. What it is and what a run needs: ./tools/exception-scope-lint.ts.
// exception-scope-lint.txt holds the places that stood there when the test was written. They are leads, not faults: "can make a scope" is not "makes one on the common path".
// A mend is not made by the list alone: to give a function a scope obliges every caller. It wants this test again and a run under BUN_JSC_validateExceptionChecks=1 on a build with assertions.
//
// It wants a build folder with compile_commands.json, the sources that the folder was built from, and LLVM's development files. CI's test machines have none of these.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { findPlacesThatOweCheck } from "./tools/exception-scope-lint";

const { AOT_LINT_BUILD_DIR: buildFolder, LLVM_DIR: llvm } = process.env;
if (!buildFolder || !llvm)
  console.error(
    "exception-scope-lint: NOT RUN: it wants AOT_LINT_BUILD_DIR (a build folder with compile_commands.json) and LLVM_DIR",
  );

test.skipIf(!buildFolder || !llvm)(
  "no new place owes a look at the exception",
  async () => {
    const stored = readFileSync(join(import.meta.dir, "exception-scope-lint.txt"), "utf8")
      .split("\n")
      .filter(Boolean);
    const { places, unitsWithErrors } = await findPlacesThatOweCheck(buildFolder!, llvm!);
    const gone = stored.filter(place => !places.includes(place));
    if (gone.length)
      console.error(
        `exception-scope-lint: ${gone.length} stored places are gone: take them out of exception-scope-lint.txt:\n${gone.join("\n")}`,
      );
    // One function of each of the two leans on a header that its file does not include. Another name here is another file that the checker does not see whole.
    const unitsKnownNotToParse = ["BunPlugin.cpp", "JSFunctionParametersSource.cpp"];
    const added = places.filter(place => !stored.includes(place));
    expect({ unitsWithErrors, added }).toEqual({ unitsWithErrors: unitsKnownNotToParse, added: [] });
  },
  3_600_000,
);
