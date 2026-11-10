import { test, vi } from "bun:test";
const said = [];
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const user = async step => said.unshift(step + " " + await tried(async () => (await import("./user.mjs")).seen()));
const part = async () => said.unshift("part " + await tried(async () => (await import("./part.mjs")).x) + " " + await tried(() => require("./part.mjs").x));
const takeOut = () => { for (const key of Object.keys(require.cache)) if (key.endsWith("part.mjs")) delete require.cache[key]; };
const say = name => console.log("SAID", name, "part ran", globalThis.ran?.part ?? 0, "|", said.join(" | "));
test("x", async () => {
  vi.doMock("./part.mjs", () => ({ x: "mock" })); await user("mocked"); takeOut(); vi.doUnmock("./part.mjs"); await part(); await user("ended");
  say("x");
});
