import { mock, test } from "bun:test";
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "c" }));
test("c", async () => {
  const dep = await import("./dep.mjs");
  console.log("| c " + dep.kind + " " + dep.extra + " " + dep.run);
});
