// Two test files load the module, and each walks a snapshot of its own.
import { test } from "bun:test";
import { use, fill } from "./store";
import { variablesOfLoadedModules } from "./walk";
test("b", () => {
  fill("b");
  console.log("b", use() > 0);
  console.log(variablesOfLoadedModules(["shelf", "ledger"]));
});
