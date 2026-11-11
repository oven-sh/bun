import { test, mock, vi } from "bun:test";
test("t", async () => {
await import("./part.cjs").then(part => console.log("SAID the first load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the first load threw", error.name));
mock.module("./part.cjs", () => ({ a: "mocked" }));
try { vi.doUnmock("./part.cjs"); console.log("SAID unmocked"); } catch (error) { console.log("SAID the unmock threw", error.name); }
await import("./part.cjs").then(part => console.log("SAID the second load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the second load threw", error.name));
});
