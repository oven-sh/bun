import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  vi.doMock("./part.cjs");
  await import("./part.cjs").then(part => console.log("SAID first gave", Object.keys(part).sort().join(), String(part.a), String(part.late)), error => console.log("SAID first threw", error.name));
  await import("./part.cjs").then(part => console.log("SAID second gave", Object.keys(part).sort().join(), String(part.a), String(part.late)), error => console.log("SAID second threw", error.name));
});
