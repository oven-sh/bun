// Two test files load the module, and each walks a snapshot of its own.
import { test } from "bun:test";
import { use, fill } from "./store";
import { variablesOfLoadedModules } from "./walk";
test("a", () => {
  fill("a");
  console.log("a", use() > 0);
  console.log(variablesOfLoadedModules(["shelf", "ledger"]));
});
