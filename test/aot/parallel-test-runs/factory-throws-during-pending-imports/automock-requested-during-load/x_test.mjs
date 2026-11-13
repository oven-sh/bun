import { test, vi } from "bun:test";
import { hasBegun, ready } from "./start.mjs";
import { load } from "./load.mjs";

vi.mock("./config.mjs");

const keys = value =>
  Object.keys(value)
    .sort()
    .map(key => key + "=" + (typeof value[key] === "function" ? "f" + vi.isMockFunction(value[key]) : String(value[key])))
    .join(",");

test("reads the settings", async () => {
  await hasBegun;
  const [how, settings] = await load();
  console.log("SAID", how, keys(settings), "&", keys(await import("./config.mjs")), process.argv.length);
  await ready;
});
