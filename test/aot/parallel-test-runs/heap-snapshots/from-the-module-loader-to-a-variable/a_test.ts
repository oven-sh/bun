// A test that walks a heap snapshot from the module loader of the global object comes to the variables of the module under test.
import { test } from "bun:test";
import { use, fill } from "./store";
import { variablesOfLoadedModules } from "./walk";
test("a", () => {
  fill("one");
  console.log("a", use());
  console.log(variablesOfLoadedModules(["shelf", "ledger", "crate", "Keeper"]));
});
