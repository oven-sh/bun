import { test, vi } from "bun:test";
test("t", async () => {
await import("./part.cjs").then(part => console.log("SAID the first load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the first load threw", error.name));
vi.doMock("./part.cjs", async real => ({ ...(await real()), a: "mocked" }));
await import("./part.cjs").then(part => console.log("SAID the second load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the second load threw", error.name));
});
