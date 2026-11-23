// `bun test` looks the name up where the defined name stands: a parameter, a variable of the file, a variable that a closure holds.
import { test } from "bun:test";
import { read } from "./product.js";
globalThis.mode = "global";
const mode = "module";
function pick(mode) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return MODE + work; }
function later(mode) { return () => MODE; }
function store(mode) { MODE = "stored"; return mode; }
function local(Math) { return CALC.max(1, 2); }
test("a name in place of a name", () => {
  console.log(MODE, pick("parameter"), later("captured")(), store("parameter"), globalThis.mode, typeof MODE);
  console.log(local({ max: () => "local" }), CALC.max(1, 2), read(), typeof load("node:os").platform, load("./words.cjs").word);
});
