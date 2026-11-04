// `process` is kept in a list, and a module is loaded through what the list holds.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const kept = [process];
  console.log("under", typeof kept[0].getBuiltinModule(["node", "os"].join(":")).EOL);
  console.log("behind", facts());
});
