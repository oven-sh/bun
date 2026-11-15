import { jest, test, vi } from "bun:test";
test("a patch of jest's kind is kept too", async () => {
  const said = [];
  const h = await import("./h.mjs");
  said.push(h.read());
  jest.mock("./g.cjs", () => ({ word: "patch" }));
  said.push(h.read());
  vi.doUnmock("./g.cjs");
  said.push(h.read());
  console.log("SAID", said.join(" | "));
});
