// Object.assign() copies the members of `process`: whoever has the copy loads through it.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const copy = Object.assign({}, process) as typeof process;
  console.log("under", typeof copy.getBuiltinModule.call(process, ["node", "os"].join(":")).EOL);
  console.log("behind", facts());
});
