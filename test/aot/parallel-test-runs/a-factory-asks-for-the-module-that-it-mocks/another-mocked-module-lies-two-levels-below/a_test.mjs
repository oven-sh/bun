import { mock, test } from "bun:test";
mock.module("./other.mjs", () => ({ who: "mock other" }));
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: 1 }));
test("t", async () => {
  const dep = await import("./dep.mjs");
  console.log("| " + dep.sees + " " + dep.extra);
});
