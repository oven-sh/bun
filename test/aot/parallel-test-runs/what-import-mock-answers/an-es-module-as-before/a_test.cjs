const { test, vi, mock } = require("bun:test");
const say = (at, all) => console.log("SAID", at, Object.prototype.toString.call(all), Object.keys(all).sort().join(), String(all.a), typeof all.f, typeof all.f === "function" ? String(all.f()) : "-", vi.isMockFunction(all.f), typeof all.default, Object.getPrototypeOf(all) === Object.prototype, "__esModule" in all);
test("t", async () => {
  say("the mock", await vi.importMock("./names.mjs"));
  say("again", await vi.importMock("./names.mjs"));
  const real = await import("./names.mjs");
  console.log("SAID the real file", Object.prototype.toString.call(real), String(real.a));
});
