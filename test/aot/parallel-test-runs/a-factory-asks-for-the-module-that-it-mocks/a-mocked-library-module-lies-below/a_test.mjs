import { mock, test } from "bun:test";
mock.module("node:path", () => ({ sep: "mock sep" }));
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: 1 }));
test("t", async () => {
  const dep = await import("./dep.mjs");
  console.log("| " + dep.sees + " " + dep.extra);
});
