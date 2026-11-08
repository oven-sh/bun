import { test } from "bun:test";
test("b", async () => {
await import("./part.cjs").then(part => console.log("SAID the next file gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the next file threw", error.name));
});
