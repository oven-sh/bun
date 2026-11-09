import { test, vi, jest, mock } from "bun:test";
vi.mock("./dep.mjs", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  const { take } = await import("./tools.mjs");
  const mid = await import("./mid.mjs");
  let warm = "";
  for (let i = 0; i < 40; i++) warm = take(mid).value();
  console.log("SAID under the mock", warm);
  vi.doUnmock("./dep.mjs");
  const again = await import("./mid.mjs");
  console.log("SAID loaded again", take(again).value(), "|", Reflect.get(again, "d").value());
});
