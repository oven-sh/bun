import { expect, test } from "bun:test";

function down(depth: number): number {
  if (depth === 0) throw new Error("forty calls down");
  return down(depth - 1) + 1;
}
function expectDown(depth: number): number {
  if (depth === 0) {
    expect(depth).toBe(1);
    return 0;
  }
  return expectDown(depth - 1) + 1;
}
async function downLater(depth: number): Promise<number> {
  await Promise.resolve();
  if (depth === 0) throw new Error("fifteen awaits down");
  return (await downLater(depth - 1)) + 1;
}

test("a deep throw", () => {
  down(40);
});
test("a deep expectation", () => {
  expectDown(40);
});
test("a deep rejection", async () => {
  await downLater(15);
});
test("the limit", () => {
  expect(Error.stackTraceLimit).toBe(-1);
});
test("the text of a stack", () => {
  let stack = "";
  try {
    down(40);
  } catch (error) {
    stack = String((error as Error).stack);
  }
  expect(stack.split("\n").length).toBe(-1);
});
