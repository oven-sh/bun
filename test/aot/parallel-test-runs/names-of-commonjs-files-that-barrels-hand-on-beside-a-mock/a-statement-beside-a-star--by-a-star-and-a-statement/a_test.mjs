import { test, mock } from "bun:test";
mock.module("./prices.mjs", () => ({ rate: "the rate of the mock of prices.mjs" }));
const look = async () => { try { return String((await import("./till.mjs")).shown()); } catch (e) { return e.name; } };
test("t", async () => {
  console.log(await look());
});
