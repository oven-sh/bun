import { test, vi, mock } from "bun:test";
const WAY = "falsy", key = require.resolve("./part.cjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + error?.name; } };
const out = () => { if (WAY === "delete") delete require.cache[key]; else if (WAY === "reset") vi.resetModules(); else require.cache[key] = undefined; };
const look = async step => console.log("SAID", step, "runs", globalThis.runs ?? "-", "import", await tried(async () => (await import("./part.cjs")).default.x),
  "require", await tried(() => require("./part.cjs").x), "user", await tried(() => require("./user.cjs").seen()));
test("t", async () => {
  mock.module("./part.cjs", () => ({ x: "mock", bump: () => -1 }));
  await look("mocked"); out(); await look("out once"); out(); await look("out twice");
  console.log("SAID the original", await tried(async () => (await vi.importActual("./part.cjs")).x), "runs", globalThis.runs ?? "-");
  vi.doUnmock("./part.cjs"); await look("ended");
  console.log("SAID entry", await tried(() => require.cache[key].exports === require("./part.cjs")), "user holds it", await tried(() => require("./user.cjs").part === require("./part.cjs")),
    "bumps", await tried(() => require("./part.cjs").bump()), await tried(async () => (await import("./part.cjs")).default.bump()), "runs", globalThis.runs);
});
