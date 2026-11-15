import { test, vi } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
const said = [], key = require.resolve("./part.mjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const user = async step => said.unshift(step + " " + await tried(async () => (await import("./user.mjs")).seen()));
const part = async () => said.unshift("part " + await tried(async () => (await import("./part.mjs")).x) + " " + await tried(() => require("./part.mjs").x));
const takeOut = () => { for (const each of Object.keys(require.cache)) if (each.endsWith("part.mjs")) delete require.cache[each]; };
const file = new URL("./made.mjs", import.meta.url), name = ["./made", "mjs"].join(".");
const write = text => writeFileSync(file, text);
const made = async step => said.unshift(step + " " + await tried(async () => (await import(name)).seen()));
const say = () => { rmSync(file, { force: true }); console.log("SAID x part ran", globalThis.ran?.part ?? 0, "|", said.join(" | ")); };
test("x", async () => {
  vi.doMock("./part.mjs", () => ({ x: "mock" })); await user("mocked"); vi.doUnmock("./part.mjs"); vi.resetModules(); await part(); await user("ended");
  say();
});
