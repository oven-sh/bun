import { mock, test } from "bun:test";
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "a" }));
test("a", async () => {
  const dep = await import("./dep.mjs");
  console.log("| a " + dep.kind + " " + dep.extra);
});
