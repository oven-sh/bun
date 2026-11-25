import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  await import("./named.js").then(part => console.log("SAID the first load gave", part.read()), error => console.log("SAID the first load threw", error.name));
  mock.module("./part.cjs", () => ({ a: "mocked" }));
  await import("./named.js").then(part => console.log("SAID the second load gave", part.read()), error => console.log("SAID the second load threw", error.name));
});
