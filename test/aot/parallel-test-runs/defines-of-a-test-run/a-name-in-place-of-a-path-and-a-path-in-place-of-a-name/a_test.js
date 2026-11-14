// `bun test` looks the first name up where the defined path or name stands: a parameter, a variable of the file, a variable that a closure holds.
import { test } from "bun:test";
globalThis.mode = "global";
globalThis.settings = { level: "global" };
const mode = "module";
const settings = { level: "module" };
function pick(mode) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return config.mode + work; }
function later(mode) { return () => import.meta.env.MODE; }
function own(config) { return config.mode; }
function level(settings) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return LEVEL + work; }
test("a name in place of a path, a path in place of a name", () => {
  console.log(config.mode, import.meta.env.MODE, pick("parameter"), later("captured")(), own({ mode: "own" }), typeof config.mode);
  console.log(LEVEL, level({ level: "parameter" }));
});
