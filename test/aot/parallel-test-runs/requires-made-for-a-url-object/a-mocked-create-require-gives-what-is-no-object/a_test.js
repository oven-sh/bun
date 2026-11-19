// The build asks the base of createRequire() whether it still names the folder of the file, and remembers what createRequire() gave where it does not.
// A mock may give anything: what is no object is remembered nowhere, and nothing throws.
import { test, mock } from "bun:test";
let given;
mock.module("node:module", () => ({ createRequire: () => given }));
test("what the mock gives comes back", async () => {
  const { make, makeForPath } = await import("./src/user.mjs");
  for (given of [5, undefined, null, "text", Symbol.iterator, 5n, true, {}, () => 1]) {
    let said;
    try { said = (make() === given) + " " + (makeForPath() === given); } catch (error) { said = "threw " + error.name; }
    console.log("SAID", typeof given, said);
  }
});
