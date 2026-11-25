import { expect, test } from "bun:test";

let ran = "no";
global
{
  ran = "yes";
}
console.log("the block:", ran);
test("the block has run", () => {
  expect(ran).toBe("yes");
});
