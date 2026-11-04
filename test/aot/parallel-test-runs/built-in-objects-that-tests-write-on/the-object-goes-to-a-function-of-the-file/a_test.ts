// `process` is handed to a function of the file, which loads through it.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const load = (from: typeof process, name: string) => from.getBuiltinModule(name);
  console.log("under", typeof load(process, ["node", "os"].join(":")).EOL);
  console.log("behind", facts());
});
