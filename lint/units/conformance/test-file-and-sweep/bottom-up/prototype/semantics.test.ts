// Probe: behaviour of bun:test that the test file relies on.
import { describe, expect, test } from "bun:test";
const slow: number | undefined = undefined;
describe("an empty table registers nothing", () => {
  test.each([] as [number, string[]][])("batch %i", (_k, _names) => {
    throw new Error("never runs");
  }, slow);
  test("the block still has a test", () => {
    expect(1).toBe(1);
  }, slow);
});
describe.skipIf(true)("a skipped block", () => {
  test.each([[1, ["a"]]] as [number, string[]][])("batch %i", () => {
    throw new Error("never runs");
  });
});
test.each([[1, 3, ["a.ts", "b(target=es2015).ts"]]] as [number, number, string[]][])("batch %i of %i", (k, n, names) => {
  expect([k, n, names.length]).toEqual([1, 3, 2]);
});
test.each(["compiler/2dArrays.errors.txt", "conformance/a(b=c).errors.txt"])("round trip of %s", name => {
  expect(name.endsWith(".errors.txt")).toBe(true);
});
test.concurrent.each([1, 2, 3])("concurrent %i", async k => {
  await Bun.sleep(1);
  expect(k).toBeGreaterThan(0);
});
test.skipIf(false)("a timeout of 20 ms fails a test of 200 ms", async () => {
  await Bun.sleep(200);
}, 20);
