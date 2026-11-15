import { test, vi, mock } from "bun:test";
const say = f => { try { return f(); } catch (e) { return e.name; } };
test("s5", async () => {
  vi.doMock("@made-up/below", () => ({ x: "first" }));
  const k = (await import("@made-up/below")).x;
  vi.doMock("node:os", () => ({ default: {}, platform: () => "mocked" }));
  const late = import("./root.js");
  mock.module("@made-up/below", () => ({ x: "second" }));
  let said;
  try { const { all } = await late; said = say(all); } catch (e) { said = "import: " + e.name; }
  const last = (await import("@made-up/below")).x;
  console.log("SAID s5", k, said, last);
});
