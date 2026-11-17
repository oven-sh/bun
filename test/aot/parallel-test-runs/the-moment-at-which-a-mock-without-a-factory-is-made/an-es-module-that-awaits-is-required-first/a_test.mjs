import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  jest.doMock("./waits.mjs");
  try { const part = require("./waits.mjs"); console.log("SAID first gave", Object.keys(part).sort().join(), String(part.a), String(part.late)); } catch (error) { console.log("SAID first threw", error.name); }
  await import("./waits.mjs").then(part => console.log("SAID second gave", Object.keys(part).sort().join(), String(part.a), String(part.late)), error => console.log("SAID second threw", error.name));
});
