import { mock, test, vi } from "bun:test";
test("a", async () => {
  const said = [require("./gear.cjs").word];
  vi.doMock("./gear.cjs", () => ({ word: "own" }));
  vi.doUnmock("./gear.cjs");
  const late = await import("./late.mjs");
  said.push(late.read());
  mock.module("./gear.cjs", () => ({ word: "patch" }));
  said.push(late.read());
  vi.doUnmock("./gear.cjs");
  said.push(late.read());
  console.log("SAID a", said.join(" | "));
});
