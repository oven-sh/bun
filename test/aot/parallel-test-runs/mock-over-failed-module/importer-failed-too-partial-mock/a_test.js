import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  await import("./user.js").then(part => console.log("SAID the first load gave", part.a()), error => console.log("SAID the first load threw", error.name));
  mock.module("./part.cjs", async real => ({ ...(await real()), a: "mocked" }));
  await import("./user.js").then(part => console.log("SAID the second load gave", part.a(), globalThis.userRuns), error => console.log("SAID the second load threw", error.name));
  await import("./part.cjs").then(part => console.log("SAID the file itself gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the file itself threw", error.name));
});
