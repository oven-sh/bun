import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
let seen; try { seen = show((await import("./as-toml.mjs")).toml); } catch (error) { seen = error.name; }
let then; try { then = show((await import("./below.mjs")).held); } catch (error) { then = error.name; }
console.log("toml first:", seen, then);
test("runs", () => {});
