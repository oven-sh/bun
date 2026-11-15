import { mock, test } from "bun:test";
mock.module("./other.mjs", () => { throw new Error("no mock"); });
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: 1 }));
test("t", async () => {
  console.log("| " + await import("./dep.mjs").then(dep => dep.sees + " " + dep.extra, error => error.message));
});
