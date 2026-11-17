import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import { held } from "./below.mjs";
let seen; try { seen = show((await import("./as-toml.mjs")).toml); } catch (error) { seen = error.name; }
console.log("text first:", show(held), seen);
test("runs", () => {});
