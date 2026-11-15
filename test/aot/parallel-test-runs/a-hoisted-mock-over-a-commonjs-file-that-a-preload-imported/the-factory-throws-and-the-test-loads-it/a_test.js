import { test, mock, vi, jest } from "bun:test";
vi.mock("./part.cjs", () => { console.log("SAID the factory runs"); throw new RangeError("made up"); });
test("t", async () => {
  await import("./part.cjs").then(part => console.log("SAID first gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID first threw", error.name));
});
