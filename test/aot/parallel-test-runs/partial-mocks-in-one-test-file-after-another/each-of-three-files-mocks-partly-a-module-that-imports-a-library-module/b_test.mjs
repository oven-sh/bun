import { mock, test } from "bun:test";
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "b" }));
test("b", async () => {
  const dep = await import("./dep.mjs");
  console.log("| b " + dep.kind + " " + dep.extra + " " + dep.run);
});
