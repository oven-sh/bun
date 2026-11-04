// The name under which spyOn() replaces a member of `process` is made when the test runs.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const name = ["c", "wd"].join("") as "cwd";
  const spy = spyOn(process, name).mockReturnValue(7 as any);
  console.log("under", facts(), process.cwd());
  spy.mockRestore();
  console.log("behind", facts());
});
