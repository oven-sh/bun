import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import near from "./conf.txt" with { type: "text" };
let seen; try { const { read } = await import("./below.mjs"); seen = show(read()); } catch (error) { seen = error.name; }
console.log("text first:", show(near), seen);
test("runs", () => {});
