import { vi, test } from "bun:test";
vi.mock("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "b" }));
test("b", async () => {
  const dep = await import("./dep.mjs");
  console.log("| b " + dep.kind + " " + dep.extra);
});
