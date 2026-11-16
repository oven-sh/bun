import { test } from "bun:test";
test("t", async () => {
await import("./part.cjs").then(part => console.log("SAID the first load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the first load threw", error.name));
await import("./part.cjs").then(part => console.log("SAID the second load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the second load threw", error.name));
await import("./part.cjs").then(part => console.log("SAID the third load gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID the third load threw", error.name));
});
