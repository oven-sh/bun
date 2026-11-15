const { test, vi, mock } = require("bun:test");
const say = (at, all) => console.log("SAID", at, Object.prototype.toString.call(all), Object.keys(all).sort().join(), String(all.a), typeof all.f, typeof all.f === "function" ? String(all.f()) : "-", vi.isMockFunction(all.f), Object.getPrototypeOf(all) === Object.prototype, "__esModule" in all);
test("t", async () => {
  vi.doMock("./names.cjs", () => ({ a: "mocked", f: () => "mocked" }));
  say("the mock", await vi.importMock("./names.cjs"));
});
