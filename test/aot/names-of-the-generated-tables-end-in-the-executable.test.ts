import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { test } from "./supported";

// A text of Rust has no end of its own, so the names of a generated table stood flush against one another in the executable, and a tool that
// looks for texts there read two names as one. In its table each of these names is followed by the one below it: the specifiers of two modules,
// and their tokens.
const names = ["internal/abort_listener", "InternalAbort_listener"];
const namesBehindThem = ["internal/assert/assertion_error", "InternalAssertAssertion_error"];

test("no two names of the generated tables stand flush against one another in the executable", () => {
  const executable = readFileSync(process.execPath);
  expect(executable.includes(names[0])).toBeTrue();
  for (const [index, name] of names.entries()) {
    const flush = name + namesBehindThem[index];
    expect({ flush, isThere: executable.includes(flush) }).toEqual({ flush, isThere: false });
  }
});
