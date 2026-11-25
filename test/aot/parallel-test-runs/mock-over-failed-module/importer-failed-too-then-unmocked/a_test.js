import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  await import("./user.js").then(part => console.log("SAID the first load gave", part.a()), error => console.log("SAID the first load threw", error.name));
  mock.module("./part.cjs", () => ({ a: "mocked" }));
  vi.doUnmock("./part.cjs");
  await import("./user.js").then(part => console.log("SAID the second load gave", part.a(), globalThis.userRuns), error => console.log("SAID the second load threw", error.name));
});
